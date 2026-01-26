//! File watching daemon for real-time indexing
//!
//! Uses the `notify` crate with debouncing for efficient file system monitoring.
//! Falls back to polling when native events are unreliable.

use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use crate::connection::{IndexerDb, IndexerError};
use crate::correlation::correlate_lines_to_turns;
use crate::hook_indexer::index_hook_file;
use crate::indexer::index_transcript_file;

/// Indexer daemon that watches for file changes and auto-indexes
pub struct IndexerDaemon {
    projects_dir: PathBuf,
    hooks_dir: PathBuf,
}

impl IndexerDaemon {
    /// Create a new daemon with default directories
    pub fn new() -> Self {
        Self {
            projects_dir: crate::discovery::default_projects_dir(),
            hooks_dir: crate::discovery::default_hooks_dir(),
        }
    }

    /// Create a daemon with custom directories
    pub fn with_dirs(projects_dir: PathBuf, hooks_dir: PathBuf) -> Self {
        Self {
            projects_dir,
            hooks_dir,
        }
    }

    /// Run the daemon (blocking). Returns on SIGINT/SIGTERM or error.
    pub fn run(&self, db: &mut IndexerDb) -> Result<(), IndexerError> {
        eprintln!(
            "[daemon] Watching {} and {}",
            self.projects_dir.display(),
            self.hooks_dir.display()
        );

        // Ensure directories exist
        let _ = std::fs::create_dir_all(&self.projects_dir);
        let _ = std::fs::create_dir_all(&self.hooks_dir);

        let (tx, rx) = mpsc::channel();

        // Create debounced watcher (100ms debounce)
        let mut debouncer = new_debouncer(Duration::from_millis(100), tx.clone())
            .map_err(|e| IndexerError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;

        // Watch both directories recursively
        let watcher = debouncer.watcher();
        if self.projects_dir.exists() {
            watcher
                .watch(&self.projects_dir, notify::RecursiveMode::Recursive)
                .map_err(|e| {
                    IndexerError::Io(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
        }
        if self.hooks_dir.exists() {
            watcher
                .watch(&self.hooks_dir, notify::RecursiveMode::Recursive)
                .map_err(|e| {
                    IndexerError::Io(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
        }

        eprintln!("[daemon] Watching for changes... (Ctrl+C to stop)");

        // Also run a polling fallback every second
        let poll_tx = tx.clone();
        let projects_dir = self.projects_dir.clone();
        let hooks_dir = self.hooks_dir.clone();

        std::thread::spawn(move || {
            loop {
                std::thread::sleep(Duration::from_secs(1));
                // Send a synthetic event to trigger polling check
                let _ = poll_tx.send(Ok(vec![notify_debouncer_mini::DebouncedEvent {
                    path: projects_dir.clone(),
                    kind: DebouncedEventKind::Any,
                }]));
                let _ = poll_tx.send(Ok(vec![notify_debouncer_mini::DebouncedEvent {
                    path: hooks_dir.clone(),
                    kind: DebouncedEventKind::Any,
                }]));
            }
        });

        // Process events
        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    let mut indexed_hooks = false;

                    for event in events {
                        let path = &event.path;

                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.ends_with(".hooks.jsonl") {
                                self.handle_hook_file_change(db, path);
                                indexed_hooks = true;
                            } else if name.ends_with(".jsonl") {
                                self.handle_transcript_file_change(db, path);
                            }
                        } else if path.is_dir() {
                            // Directory-level event - check for new/changed files
                            self.poll_directory(db, path, &mut indexed_hooks);
                        }
                    }

                    // After hook events are indexed, run correlation
                    if indexed_hooks {
                        match correlate_lines_to_turns(db.connection()) {
                            Ok(result) => {
                                if result.updated > 0 {
                                    eprintln!(
                                        "[daemon] Correlated {} lines across {} sessions",
                                        result.updated, result.sessions
                                    );
                                }
                            }
                            Err(e) => {
                                eprintln!("[daemon] Correlation error: {}", e);
                            }
                        }
                    }
                }
                Ok(Err(errors)) => {
                    eprintln!("[daemon] Watch error: {:?}", errors);
                }
                Err(_) => {
                    eprintln!("[daemon] Channel closed, shutting down");
                    break;
                }
            }
        }

        Ok(())
    }

    fn handle_transcript_file_change(&self, db: &mut IndexerDb, path: &Path) {
        if !path.exists() || !path.is_file() {
            return;
        }

        let file_path_str = path.to_string_lossy().to_string();
        let conn = db.connection();

        // Get current state
        let state: Option<(i64, i64)> = conn
            .query_row(
                "SELECT byte_offset, line_count FROM sessions WHERE file_path = ?1",
                [&file_path_str],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let file_size = match std::fs::metadata(path) {
            Ok(m) => m.len(),
            Err(_) => return,
        };

        let from_offset = state.map(|(o, _)| o as u64).unwrap_or(0);
        if from_offset >= file_size {
            return;
        }

        let start_line = state.map(|(_, c)| c + 1).unwrap_or(1);

        match index_transcript_file(conn, path, from_offset, start_line) {
            Ok(result) => {
                if result.lines_indexed > 0 {
                    eprintln!(
                        "[daemon] Indexed {} new transcript lines from {}",
                        result.lines_indexed,
                        path.display()
                    );
                }
            }
            Err(e) => {
                eprintln!("[daemon] Error indexing {}: {}", path.display(), e);
            }
        }
    }

    fn handle_hook_file_change(&self, db: &mut IndexerDb, path: &Path) {
        if !path.exists() || !path.is_file() {
            return;
        }

        let file_path_str = path.to_string_lossy().to_string();
        let conn = db.connection();

        let state: Option<(i64, i64)> = conn
            .query_row(
                "SELECT byte_offset, event_count FROM hook_files WHERE file_path = ?1",
                [&file_path_str],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let file_size = match std::fs::metadata(path) {
            Ok(m) => m.len(),
            Err(_) => return,
        };

        let from_offset = state.map(|(o, _)| o as u64).unwrap_or(0);
        if from_offset >= file_size {
            return;
        }

        let start_line = state.map(|(_, c)| c + 1).unwrap_or(1);

        match index_hook_file(conn, path, from_offset, start_line) {
            Ok(result) => {
                if result.events_indexed > 0 {
                    eprintln!(
                        "[daemon] Indexed {} new hook events from {}",
                        result.events_indexed,
                        path.display()
                    );
                }
            }
            Err(e) => {
                eprintln!("[daemon] Error indexing hook file {}: {}", path.display(), e);
            }
        }
    }

    fn poll_directory(&self, db: &mut IndexerDb, dir: &Path, indexed_hooks: &mut bool) {
        // Check for transcript files that need updating
        if dir.starts_with(&self.projects_dir) || dir == self.projects_dir {
            let files = crate::discovery::find_transcript_files(Some(&self.projects_dir));
            for file in &files {
                self.handle_transcript_file_change(db, file);
            }
        }

        // Check for hook files that need updating
        if dir.starts_with(&self.hooks_dir) || dir == self.hooks_dir {
            let files = crate::discovery::find_hook_files(Some(&self.hooks_dir));
            for file in &files {
                let file_path_str = file.to_string_lossy().to_string();
                let conn = db.connection();

                let state: Option<(i64,)> = conn
                    .query_row(
                        "SELECT byte_offset FROM hook_files WHERE file_path = ?1",
                        [&file_path_str],
                        |row| Ok((row.get(0)?,)),
                    )
                    .ok();

                let file_size = match std::fs::metadata(file) {
                    Ok(m) => m.len(),
                    Err(_) => continue,
                };

                let offset = state.map(|(o,)| o as u64).unwrap_or(0);
                if offset < file_size {
                    self.handle_hook_file_change(db, file);
                    *indexed_hooks = true;
                }
            }
        }
    }
}

impl Default for IndexerDaemon {
    fn default() -> Self {
        Self::new()
    }
}
