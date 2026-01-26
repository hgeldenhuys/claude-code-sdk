//! Adapter trait for extensible indexing
//!
//! Defines a pluggable interface for indexing different data sources.
//! Built-in adapters wrap the transcript and hook event indexers.

use rusqlite::Connection;
use std::path::{Path, PathBuf};

use crate::connection::IndexerError;

/// Result of processing a file through an adapter
#[derive(Debug, Default)]
pub struct AdapterProcessResult {
    pub entries_processed: usize,
    pub byte_offset: u64,
}

/// Trait for indexing adapters
pub trait Adapter: Send + Sync {
    /// Unique name for this adapter
    fn name(&self) -> &str;

    /// Human-readable description
    fn description(&self) -> &str;

    /// File extensions this adapter handles (e.g., [".jsonl"])
    fn file_extensions(&self) -> &[&str];

    /// Find all files this adapter can process
    fn find_files(&self) -> Vec<PathBuf>;

    /// Initialize any adapter-specific schema
    fn init_schema(&self, conn: &Connection) -> Result<(), IndexerError>;

    /// Process a file (full or delta)
    fn process_file(
        &self,
        conn: &Connection,
        file_path: &Path,
        from_byte_offset: u64,
        start_line: i64,
    ) -> Result<AdapterProcessResult, IndexerError>;

    /// Get the stored cursor (byte offset) for a file
    fn get_cursor(&self, conn: &Connection, file_path: &Path) -> Result<u64, IndexerError>;

    /// Save cursor position for a file
    fn save_cursor(
        &self,
        conn: &Connection,
        file_path: &Path,
        byte_offset: u64,
        line_count: i64,
    ) -> Result<(), IndexerError>;
}

/// Built-in adapter for transcript JSONL files
pub struct TranscriptLinesAdapter;

impl Adapter for TranscriptLinesAdapter {
    fn name(&self) -> &str {
        "transcript-lines"
    }

    fn description(&self) -> &str {
        "Indexes transcript JSONL files into lines and sessions tables"
    }

    fn file_extensions(&self) -> &[&str] {
        &[".jsonl"]
    }

    fn find_files(&self) -> Vec<PathBuf> {
        crate::discovery::find_transcript_files(None)
    }

    fn init_schema(&self, _conn: &Connection) -> Result<(), IndexerError> {
        // Schema is handled by main init_schema
        Ok(())
    }

    fn process_file(
        &self,
        conn: &Connection,
        file_path: &Path,
        from_byte_offset: u64,
        start_line: i64,
    ) -> Result<AdapterProcessResult, IndexerError> {
        let result =
            crate::indexer::index_transcript_file(conn, file_path, from_byte_offset, start_line)?;
        Ok(AdapterProcessResult {
            entries_processed: result.lines_indexed,
            byte_offset: result.byte_offset,
        })
    }

    fn get_cursor(&self, conn: &Connection, file_path: &Path) -> Result<u64, IndexerError> {
        let file_path_str = file_path.to_string_lossy().to_string();
        let offset: i64 = conn
            .query_row(
                "SELECT byte_offset FROM sessions WHERE file_path = ?1",
                [&file_path_str],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(offset as u64)
    }

    fn save_cursor(
        &self,
        _conn: &Connection,
        _file_path: &Path,
        _byte_offset: u64,
        _line_count: i64,
    ) -> Result<(), IndexerError> {
        // Cursor is saved by index_transcript_file directly
        Ok(())
    }
}

/// Built-in adapter for hook event JSONL files
pub struct HookEventsAdapter;

impl Adapter for HookEventsAdapter {
    fn name(&self) -> &str {
        "hook-events"
    }

    fn description(&self) -> &str {
        "Indexes hook event JSONL files into hook_events and hook_files tables"
    }

    fn file_extensions(&self) -> &[&str] {
        &[".hooks.jsonl"]
    }

    fn find_files(&self) -> Vec<PathBuf> {
        crate::discovery::find_hook_files(None)
    }

    fn init_schema(&self, _conn: &Connection) -> Result<(), IndexerError> {
        // Schema is handled by main init_schema
        Ok(())
    }

    fn process_file(
        &self,
        conn: &Connection,
        file_path: &Path,
        from_byte_offset: u64,
        start_line: i64,
    ) -> Result<AdapterProcessResult, IndexerError> {
        let result =
            crate::hook_indexer::index_hook_file(conn, file_path, from_byte_offset, start_line)?;
        Ok(AdapterProcessResult {
            entries_processed: result.events_indexed,
            byte_offset: result.byte_offset,
        })
    }

    fn get_cursor(&self, conn: &Connection, file_path: &Path) -> Result<u64, IndexerError> {
        let file_path_str = file_path.to_string_lossy().to_string();
        let offset: i64 = conn
            .query_row(
                "SELECT byte_offset FROM hook_files WHERE file_path = ?1",
                [&file_path_str],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(offset as u64)
    }

    fn save_cursor(
        &self,
        _conn: &Connection,
        _file_path: &Path,
        _byte_offset: u64,
        _line_count: i64,
    ) -> Result<(), IndexerError> {
        // Cursor is saved by index_hook_file directly
        Ok(())
    }
}

/// Get all built-in adapters
pub fn builtin_adapters() -> Vec<Box<dyn Adapter>> {
    vec![
        Box::new(TranscriptLinesAdapter),
        Box::new(HookEventsAdapter),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_builtin_adapters() {
        let adapters = builtin_adapters();
        assert_eq!(adapters.len(), 2);
        assert_eq!(adapters[0].name(), "transcript-lines");
        assert_eq!(adapters[1].name(), "hook-events");
    }

    #[test]
    fn test_adapter_file_extensions() {
        let transcript = TranscriptLinesAdapter;
        assert_eq!(transcript.file_extensions(), &[".jsonl"]);

        let hooks = HookEventsAdapter;
        assert_eq!(hooks.file_extensions(), &[".hooks.jsonl"]);
    }
}
