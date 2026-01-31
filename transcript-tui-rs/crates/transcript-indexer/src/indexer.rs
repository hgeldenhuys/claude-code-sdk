//! Transcript JSONL file indexer
//!
//! Indexes transcript.jsonl files into the `lines` and `sessions` tables.
//! Supports both full and delta (byte-offset) indexing.

use rusqlite::Connection;
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

use crate::connection::IndexerError;
use crate::content_trimmer::trim_raw_transcript_line;
use crate::discovery;
use crate::text_extract::extract_searchable_text;

/// Line types that have zero searchable content and only consume raw storage.
/// These are skipped during indexing to save ~44% of database size.
/// - `progress`: streaming tool execution updates (partial stdout, elapsed time)
/// - `file-history-snapshot`: git file snapshots
/// - `queue-operation`: internal queue operations
const SKIP_TYPES: &[&str] = &["progress", "file-history-snapshot", "queue-operation"];

/// Result of indexing a single transcript file
#[derive(Debug, Default)]
pub struct IndexResult {
    pub lines_indexed: usize,
    pub byte_offset: u64,
    pub session_id: String,
}

/// Result of indexing all transcript files
#[derive(Debug, Default)]
pub struct IndexAllResult {
    pub files_indexed: usize,
    pub lines_indexed: usize,
}

/// Result of delta update
#[derive(Debug, Default)]
pub struct UpdateResult {
    pub files_checked: usize,
    pub files_updated: usize,
    pub new_lines: usize,
}

/// Index a single transcript JSONL file (full or delta)
///
/// - `conn`: Database connection
/// - `file_path`: Path to the transcript JSONL file
/// - `from_byte_offset`: Byte offset to start reading from (0 for full index)
/// - `start_line_number`: Line number to start from (1 for full index)
pub fn index_transcript_file(
    conn: &Connection,
    file_path: &Path,
    from_byte_offset: u64,
    start_line_number: i64,
) -> Result<IndexResult, IndexerError> {
    let metadata = std::fs::metadata(file_path)?;
    let file_size = metadata.len();

    // Nothing new to index
    if from_byte_offset >= file_size {
        return Ok(IndexResult {
            lines_indexed: 0,
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
    let mut slug: Option<String> = None;
    let mut first_timestamp: Option<String> = None;
    let mut last_timestamp: Option<String> = None;
    let mut line_number = start_line_number;
    let mut first_line = from_byte_offset > 0;

    let mut insert_stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO lines
         (session_id, uuid, parent_uuid, line_number, type, subtype, timestamp,
          slug, role, model, cwd, content, raw, file_path,
          turn_id, turn_sequence, session_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
    )?;

    // Wrap in explicit savepoint for batch performance
    // (We can't use conn.transaction() here since we borrow conn for prepared stmt)
    conn.execute_batch("SAVEPOINT index_transcript")?;

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

        // Extract fields
        if let Some(sid) = parsed.get("sessionId").and_then(|v| v.as_str()) {
            if !sid.is_empty() {
                session_id = sid.to_string();
            }
        }
        if let Some(s) = parsed.get("slug").and_then(|v| v.as_str()) {
            if !s.is_empty() {
                slug = Some(s.to_string());
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

        let entry_type = parsed
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        // Skip non-searchable types (no content, only raw blob)
        if SKIP_TYPES.contains(&entry_type.as_str()) {
            line_number += 1;
            continue;
        }

        let content = extract_searchable_text(&parsed);

        let uuid = parsed
            .get("uuid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("line-{}", line_number));

        let parent_uuid = parsed
            .get("parentUuid")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let subtype = parsed
            .get("subtype")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let role = parsed
            .get("message")
            .and_then(|m| m.get("role"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let model = parsed
            .get("message")
            .and_then(|m| m.get("model"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let cwd = parsed
            .get("cwd")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let file_path_str = file_path.to_string_lossy().to_string();
        let trimmed_raw = trim_raw_transcript_line(&parsed);

        insert_stmt.execute(rusqlite::params![
            session_id,
            uuid,
            parent_uuid,
            line_number,
            entry_type,
            subtype,
            timestamp,
            slug,
            role,
            model,
            cwd,
            content,
            trimmed_raw,
            file_path_str,
            Option::<String>::None, // turn_id
            Option::<i64>::None,    // turn_sequence
            Option::<String>::None, // session_name
        ])?;

        indexed_count += 1;
        line_number += 1;
    }

    conn.execute_batch("RELEASE index_transcript")?;

    let new_byte_offset = file_size;
    let file_path_str = file_path.to_string_lossy().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    // Update sessions table
    if from_byte_offset == 0 {
        conn.execute(
            "INSERT OR REPLACE INTO sessions
             (file_path, session_id, slug, line_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                file_path_str,
                if session_id.is_empty() {
                    "unknown"
                } else {
                    &session_id
                },
                slug,
                line_number - 1,
                new_byte_offset as i64,
                first_timestamp,
                last_timestamp,
                now,
            ],
        )?;
    } else {
        conn.execute(
            "UPDATE sessions SET line_count = ?1, byte_offset = ?2, last_timestamp = ?3, indexed_at = ?4
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

    Ok(IndexResult {
        lines_indexed: indexed_count,
        byte_offset: new_byte_offset,
        session_id,
    })
}

/// Index all transcript files (full rebuild)
pub fn index_all_transcripts<F>(
    conn: &Connection,
    projects_dir: Option<&Path>,
    mut on_progress: F,
) -> Result<IndexAllResult, IndexerError>
where
    F: FnMut(&str, usize, usize, usize),
{
    let files = discovery::find_transcript_files(projects_dir);
    let total = files.len();
    let mut result = IndexAllResult::default();

    for (i, file) in files.iter().enumerate() {
        match index_transcript_file(conn, file, 0, 1) {
            Ok(r) => {
                result.files_indexed += 1;
                result.lines_indexed += r.lines_indexed;
                on_progress(
                    &file.to_string_lossy(),
                    i + 1,
                    total,
                    r.lines_indexed,
                );
            }
            Err(e) => {
                eprintln!("Error indexing {}: {}", file.display(), e);
            }
        }
    }

    // Update last indexed timestamp
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_indexed', ?1)",
        [&now],
    )?;

    Ok(result)
}

/// Update index with only new content (delta update)
pub fn update_transcripts<F>(
    conn: &Connection,
    projects_dir: Option<&Path>,
    mut on_progress: F,
) -> Result<UpdateResult, IndexerError>
where
    F: FnMut(&str, usize, usize, usize, bool),
{
    let files = discovery::find_transcript_files(projects_dir);
    let total = files.len();
    let mut result = UpdateResult::default();

    for (i, file) in files.iter().enumerate() {
        result.files_checked += 1;

        let file_path_str = file.to_string_lossy().to_string();

        // Get current index state
        let state: Option<(i64, i64)> = conn
            .query_row(
                "SELECT byte_offset, line_count FROM sessions WHERE file_path = ?1",
                [&file_path_str],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        // Get current file size
        let file_size = match std::fs::metadata(file) {
            Ok(m) => m.len(),
            Err(_) => continue,
        };

        // Skip if file hasn't grown
        if let Some((offset, _)) = state {
            if offset as u64 >= file_size {
                on_progress(&file_path_str, i + 1, total, 0, true);
                continue;
            }
        }

        let from_offset = state.map(|(o, _)| o as u64).unwrap_or(0);
        let start_line = state.map(|(_, c)| c + 1).unwrap_or(1);

        match index_transcript_file(conn, file, from_offset, start_line) {
            Ok(r) => {
                if r.lines_indexed > 0 {
                    result.files_updated += 1;
                    result.new_lines += r.lines_indexed;
                }
                on_progress(&file_path_str, i + 1, total, r.lines_indexed, false);
            }
            Err(e) => {
                eprintln!("Error updating {}: {}", file.display(), e);
            }
        }
    }

    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_indexed', ?1)",
        [&now],
    )?;

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
    fn test_index_transcript_file() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("transcript.jsonl");

        let lines = vec![
            r#"{"sessionId":"sess-1","uuid":"uuid-1","type":"user","timestamp":"2024-01-01T00:00:00Z","message":{"content":"Hello world","role":"user"}}"#,
            r#"{"sessionId":"sess-1","uuid":"uuid-2","type":"assistant","timestamp":"2024-01-01T00:00:01Z","message":{"content":"Hi there","role":"assistant","model":"claude-3"}}"#,
        ];
        fs::write(&file_path, lines.join("\n") + "\n").unwrap();

        let result = index_transcript_file(&conn, &file_path, 0, 1).unwrap();
        assert_eq!(result.lines_indexed, 2);
        assert_eq!(result.session_id, "sess-1");
        assert!(result.byte_offset > 0);

        // Verify lines in DB
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);

        // Verify sessions table
        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 1);
    }

    #[test]
    fn test_delta_indexing() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("transcript.jsonl");

        // Write initial content
        let line1 = r#"{"sessionId":"sess-1","uuid":"uuid-1","type":"user","timestamp":"2024-01-01T00:00:00Z","message":{"content":"First"}}"#;
        fs::write(&file_path, format!("{}\n", line1)).unwrap();

        let result1 = index_transcript_file(&conn, &file_path, 0, 1).unwrap();
        assert_eq!(result1.lines_indexed, 1);
        let offset = result1.byte_offset;

        // Append new content
        let line2 = r#"{"sessionId":"sess-1","uuid":"uuid-2","type":"assistant","timestamp":"2024-01-01T00:00:01Z","message":{"content":"Second"}}"#;
        let mut f = fs::OpenOptions::new()
            .append(true)
            .open(&file_path)
            .unwrap();
        std::io::Write::write_all(&mut f, format!("{}\n", line2).as_bytes()).unwrap();

        // Delta index from previous offset
        let result2 = index_transcript_file(&conn, &file_path, offset, 2).unwrap();
        assert_eq!(result2.lines_indexed, 1);

        // Total should be 2
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn test_index_skips_malformed_lines() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("transcript.jsonl");

        let content = r#"{"sessionId":"s1","uuid":"u1","type":"user","timestamp":"2024-01-01T00:00:00Z","message":{"content":"Good"}}
not valid json
{"sessionId":"s1","uuid":"u2","type":"user","timestamp":"2024-01-01T00:00:01Z","message":{"content":"Also good"}}
"#;
        fs::write(&file_path, content).unwrap();

        let result = index_transcript_file(&conn, &file_path, 0, 1).unwrap();
        assert_eq!(result.lines_indexed, 2);
    }

    #[test]
    fn test_skip_non_searchable_types() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("transcript.jsonl");

        // Mix of searchable and non-searchable types
        let lines = vec![
            r#"{"sessionId":"sess-1","uuid":"uuid-1","type":"user","timestamp":"2024-01-01T00:00:00Z","message":{"content":"Hello world","role":"user"}}"#,
            r#"{"sessionId":"sess-1","uuid":"uuid-2","type":"progress","timestamp":"2024-01-01T00:00:01Z","data":{"elapsed":1.5}}"#,
            r#"{"sessionId":"sess-1","uuid":"uuid-3","type":"file-history-snapshot","timestamp":"2024-01-01T00:00:02Z","data":{"files":["a.ts"]}}"#,
            r#"{"sessionId":"sess-1","uuid":"uuid-4","type":"queue-operation","timestamp":"2024-01-01T00:00:03Z","data":{"op":"push"}}"#,
            r#"{"sessionId":"sess-1","uuid":"uuid-5","type":"assistant","timestamp":"2024-01-01T00:00:04Z","message":{"content":"Hi there","role":"assistant","model":"claude-3"}}"#,
        ];
        fs::write(&file_path, lines.join("\n") + "\n").unwrap();

        let result = index_transcript_file(&conn, &file_path, 0, 1).unwrap();

        // Only user + assistant should be indexed (2 out of 5)
        assert_eq!(result.lines_indexed, 2);

        // Verify no skipped types in DB
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines WHERE type IN ('progress', 'file-history-snapshot', 'queue-operation')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);

        // Verify searchable types are present
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))
            .unwrap();
        assert_eq!(total, 2);
    }

    #[test]
    fn test_fts_populated() {
        let conn = setup_db();
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("transcript.jsonl");

        let line = r#"{"sessionId":"s1","uuid":"u1","type":"user","timestamp":"2024-01-01T00:00:00Z","message":{"content":"searchable content here"}}"#;
        fs::write(&file_path, format!("{}\n", line)).unwrap();

        index_transcript_file(&conn, &file_path, 0, 1).unwrap();

        // Search FTS
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lines_fts WHERE lines_fts MATCH '\"searchable\"'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
