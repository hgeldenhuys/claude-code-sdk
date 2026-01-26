//! Hook event JSONL file indexer
//!
//! Indexes *.hooks.jsonl files into the `hook_events` and `hook_files` tables.
//! Supports both full and delta (byte-offset) indexing.

use rusqlite::Connection;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use crate::connection::IndexerError;
use crate::discovery;

/// Result of indexing a single hook file
#[derive(Debug, Default)]
pub struct HookIndexResult {
    pub events_indexed: usize,
    pub byte_offset: u64,
    pub session_id: String,
}

/// Result of indexing all hook files
#[derive(Debug, Default)]
pub struct HookIndexAllResult {
    pub files_indexed: usize,
    pub events_indexed: usize,
}

/// Result of delta update for hooks
#[derive(Debug, Default)]
pub struct HookUpdateResult {
    pub files_checked: usize,
    pub files_updated: usize,
    pub new_events: usize,
}

/// Index a single hook events JSONL file (full or delta)
pub fn index_hook_file(
    conn: &Connection,
    file_path: &Path,
    from_byte_offset: u64,
    start_line_number: i64,
) -> Result<HookIndexResult, IndexerError> {
    let metadata = std::fs::metadata(file_path)?;
    let file_size = metadata.len();

    if from_byte_offset >= file_size {
        return Ok(HookIndexResult {
            events_indexed: 0,
            byte_offset: from_byte_offset,
            session_id: String::new(),
        });
    }

    let mut file = File::open(file_path)?;
    if from_byte_offset > 0 {
        file.seek(SeekFrom::Start(from_byte_offset))?;
    }

    let reader = BufReader::new(file);
    let mut indexed_count: usize = 0;
    let mut session_id = String::new();
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut line_number = start_line_number;
    let mut first_line = from_byte_offset > 0;

    let mut insert_stmt = conn.prepare_cached(
        "INSERT INTO hook_events
         (session_id, timestamp, event_type, tool_use_id, tool_name, decision,
          handler_results, input_json, context_json, file_path, line_number,
          turn_id, turn_sequence, session_name, git_hash, git_branch, git_dirty)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
    )?;

    conn.execute_batch("SAVEPOINT index_hooks")?;

    for line_result in reader.lines() {
        let raw_line = match line_result {
            Ok(l) => l,
            Err(_) => {
                line_number += 1;
                continue;
            }
        };

        // Skip partial first line when reading from offset
        if first_line {
            first_line = false;
            if !raw_line.starts_with('{') {
                line_number += 1;
                continue;
            }
        }

        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                line_number += 1;
                continue;
            }
        };

        // Extract session ID
        if let Some(sid) = parsed.get("sessionId").and_then(|v| v.as_str()) {
            if !sid.is_empty() {
                session_id = sid.to_string();
            }
        }

        let timestamp = parsed
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        if first_timestamp.is_none() && !timestamp.is_empty() {
            first_timestamp = Some(timestamp.clone());
        }
        if !timestamp.is_empty() {
            last_timestamp = Some(timestamp.clone());
        }

        let event_type = parsed
            .get("eventType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let tool_use_id = parsed
            .get("toolUseId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let tool_name = parsed
            .get("toolName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let decision = parsed
            .get("decision")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // Extract handler results
        let handler_results = parsed.get("handlerResults");
        let handler_results_json = handler_results
            .map(|v| serde_json::to_string(v).unwrap_or_default());

        // Extract turn info from handler results
        let (turn_id, turn_sequence, session_name, git_hash, git_branch, git_dirty) =
            extract_handler_data(handler_results, &parsed);

        let input_json = parsed
            .get("input")
            .map(|v| serde_json::to_string(v).unwrap_or_default());

        let context_json = parsed
            .get("context")
            .map(|v| serde_json::to_string(v).unwrap_or_default());

        let file_path_str = file_path.to_string_lossy().to_string();

        insert_stmt.execute(rusqlite::params![
            if session_id.is_empty() {
                ""
            } else {
                &session_id
            },
            timestamp,
            event_type,
            tool_use_id,
            tool_name,
            decision,
            handler_results_json,
            input_json,
            context_json,
            file_path_str,
            line_number,
            turn_id,
            turn_sequence,
            session_name,
            git_hash,
            git_branch,
            git_dirty,
        ])?;

        indexed_count += 1;
        line_number += 1;
    }

    conn.execute_batch("RELEASE index_hooks")?;

    let new_byte_offset = file_size;
    let file_path_str = file_path.to_string_lossy().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Update hook_files tracking table
    if session_id.is_empty() && indexed_count == 0 {
        // Nothing to track
    } else if from_byte_offset == 0 {
        conn.execute(
            "INSERT OR REPLACE INTO hook_files
             (file_path, session_id, event_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                file_path_str,
                if session_id.is_empty() {
                    "unknown"
                } else {
                    &session_id
                },
                line_number - 1,
                new_byte_offset as i64,
                first_timestamp,
                last_timestamp,
                now,
            ],
        )?;
    } else {
        conn.execute(
            "UPDATE hook_files SET event_count = ?1, byte_offset = ?2, last_timestamp = ?3, indexed_at = ?4
             WHERE file_path = ?5",
            rusqlite::params![
                line_number - 1,
                new_byte_offset as i64,
                last_timestamp,
                now,
                file_path_str,
            ],
        )?;
    }

    Ok(HookIndexResult {
        events_indexed: indexed_count,
        byte_offset: new_byte_offset,
        session_id,
    })
}

/// Extract turn tracker, session naming, and git tracker data from handler results
fn extract_handler_data(
    handler_results: Option<&Value>,
    parsed: &Value,
) -> (
    Option<String>,  // turn_id
    Option<i64>,     // turn_sequence
    Option<String>,  // session_name
    Option<String>,  // git_hash
    Option<String>,  // git_branch
    Option<i64>,     // git_dirty (0 or 1)
) {
    let mut turn_id: Option<String> = None;
    let mut turn_sequence: Option<i64> = None;
    let mut session_name: Option<String> = None;
    let mut git_hash: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut git_dirty: Option<i64> = None;

    if let Some(results) = handler_results.and_then(|v| v.as_object()) {
        for (key, value) in results {
            if key.starts_with("turn-tracker") {
                if let Some(data) = value.get("data") {
                    if let Some(tid) = data.get("turnId").and_then(|v| v.as_str()) {
                        turn_id = Some(tid.to_string());
                    }
                    if let Some(seq) = data
                        .get("sequence")
                        .or_else(|| data.get("turnSequence"))
                        .and_then(|v| v.as_i64())
                    {
                        turn_sequence = Some(seq);
                    }
                }
            }
            if key.starts_with("session-naming") {
                if let Some(data) = value.get("data") {
                    if let Some(name) = data.get("sessionName").and_then(|v| v.as_str()) {
                        session_name = Some(name.to_string());
                    }
                }
            }
            if key.starts_with("git-tracker") {
                if let Some(data) = value.get("data") {
                    if let Some(git_state) = data.get("gitState") {
                        if let Some(hash) = git_state.get("hash").and_then(|v| v.as_str()) {
                            git_hash = Some(hash.to_string());
                        }
                        if let Some(branch) = git_state.get("branch").and_then(|v| v.as_str()) {
                            git_branch = Some(branch.to_string());
                        }
                        if let Some(dirty) = git_state.get("isDirty").and_then(|v| v.as_bool()) {
                            git_dirty = Some(if dirty { 1 } else { 0 });
                        }
                    }
                }
            }
        }
    }

    // Fallback to top-level fields
    if turn_id.is_none() {
        turn_id = parsed
            .get("turnId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    if turn_sequence.is_none() {
        turn_sequence = parsed.get("turnSequence").and_then(|v| v.as_i64());
    }
    if session_name.is_none() {
        session_name = parsed
            .get("sessionName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }

    (turn_id, turn_sequence, session_name, git_hash, git_branch, git_dirty)
}

/// Index all hook event files (full rebuild)
pub fn index_all_hook_files<F>(
    conn: &Connection,
    hooks_dir: Option<&Path>,
    mut on_progress: F,
) -> Result<HookIndexAllResult, IndexerError>
where
    F: FnMut(&str, usize, usize, usize),
{
    let files = discovery::find_hook_files(hooks_dir);
    let total = files.len();
    let mut result = HookIndexAllResult::default();

    for (i, file) in files.iter().enumerate() {
        match index_hook_file(conn, file, 0, 1) {
            Ok(r) => {
                result.files_indexed += 1;
                result.events_indexed += r.events_indexed;
                on_progress(&file.to_string_lossy(), i + 1, total, r.events_indexed);
            }
            Err(e) => {
                eprintln!("Error indexing hook file {}: {}", file.display(), e);
            }
        }
    }

    Ok(result)
}

/// Update hook index with only new content (delta update)
pub fn update_hook_index<F>(
    conn: &Connection,
    hooks_dir: Option<&Path>,
    mut on_progress: F,
) -> Result<HookUpdateResult, IndexerError>
where
    F: FnMut(&str, usize, usize, usize, bool),
{
    let files = discovery::find_hook_files(hooks_dir);
    let total = files.len();
    let mut result = HookUpdateResult::default();

    for (i, file) in files.iter().enumerate() {
        result.files_checked += 1;
        let file_path_str = file.to_string_lossy().to_string();

        let state: Option<(i64, i64)> = conn
            .query_row(
                "SELECT byte_offset, event_count FROM hook_files WHERE file_path = ?1",
                [&file_path_str],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let file_size = match std::fs::metadata(file) {
            Ok(m) => m.len(),
            Err(_) => continue,
        };

        if let Some((offset, _)) = state {
            if offset as u64 >= file_size {
                on_progress(&file_path_str, i + 1, total, 0, true);
                continue;
            }
        }

        let from_offset = state.map(|(o, _)| o as u64).unwrap_or(0);
        let start_line = state.map(|(_, c)| c + 1).unwrap_or(1);

        match index_hook_file(conn, file, from_offset, start_line) {
            Ok(r) => {
                if r.events_indexed > 0 {
                    result.files_updated += 1;
                    result.new_events += r.events_indexed;
                }
                on_progress(&file_path_str, i + 1, total, r.events_indexed, false);
            }
            Err(e) => {
                eprintln!("Error updating hook file {}: {}", file.display(), e);
            }
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;
    use rusqlite::Connection;
    use std::fs;

    fn setup_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::init_schema(&mut conn).unwrap();
        conn
    }

    #[test]
    fn test_index_hook_file() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("events.hooks.jsonl");

        let lines = vec![
            r#"{"sessionId":"sess-1","timestamp":"2024-01-01T00:00:00Z","eventType":"PreToolUse","toolName":"Bash","toolUseId":"tu-1","input":{"command":"ls"}}"#,
            r#"{"sessionId":"sess-1","timestamp":"2024-01-01T00:00:01Z","eventType":"PostToolUse","toolName":"Bash","toolUseId":"tu-1"}"#,
        ];
        fs::write(&file_path, lines.join("\n") + "\n").unwrap();

        let result = index_hook_file(&conn, &file_path, 0, 1).unwrap();
        assert_eq!(result.events_indexed, 2);
        assert_eq!(result.session_id, "sess-1");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hook_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_handler_data_extraction() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("events.hooks.jsonl");

        let event = r#"{"sessionId":"sess-1","timestamp":"2024-01-01T00:00:00Z","eventType":"Stop","handlerResults":{"turn-tracker-Stop":{"data":{"turnId":"sess-1:3","sequence":3}},"session-naming-SessionStart":{"data":{"sessionName":"happy-dog"}},"git-tracker-Stop":{"data":{"gitState":{"hash":"abc123","branch":"main","isDirty":false}}}}}"#;
        fs::write(&file_path, format!("{}\n", event)).unwrap();

        index_hook_file(&conn, &file_path, 0, 1).unwrap();

        let row: (
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT turn_id, turn_sequence, session_name, git_hash, git_branch, git_dirty FROM hook_events LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ))
                },
            )
            .unwrap();

        assert_eq!(row.0.unwrap(), "sess-1:3");
        assert_eq!(row.1.unwrap(), 3);
        assert_eq!(row.2.unwrap(), "happy-dog");
        assert_eq!(row.3.unwrap(), "abc123");
        assert_eq!(row.4.unwrap(), "main");
        assert_eq!(row.5.unwrap(), 0); // not dirty
    }

    #[test]
    fn test_hook_fts_populated() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("events.hooks.jsonl");

        let event = r#"{"sessionId":"s1","timestamp":"2024-01-01T00:00:00Z","eventType":"PreToolUse","toolName":"Bash","input":{"command":"cargo test"}}"#;
        fs::write(&file_path, format!("{}\n", event)).unwrap();

        index_hook_file(&conn, &file_path, 0, 1).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM hook_events_fts WHERE hook_events_fts MATCH '\"Bash\"'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
