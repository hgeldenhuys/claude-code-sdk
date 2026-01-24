//! JSON output formatting

use transcript_core::{SessionInfo, TranscriptLine};

/// Output a transcript line as JSON (raw JSON from database)
/// If pretty is true, parse and re-format with indentation
pub fn format_line(line: &TranscriptLine, pretty: bool) -> String {
    if pretty {
        // Parse and re-serialize with pretty printing
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line.raw) {
            if let Ok(pretty_json) = serde_json::to_string_pretty(&parsed) {
                return pretty_json;
            }
        }
    }
    // Return raw JSON as-is (compact)
    line.raw.clone()
}

/// Output a session as JSON
pub fn format_session(session: &SessionInfo, pretty: bool) -> String {
    let json = serde_json::json!({
        "session_id": session.session_id,
        "slug": session.slug,
        "file_path": session.file_path,
        "line_count": session.line_count,
        "first_timestamp": session.first_timestamp,
        "last_timestamp": session.last_timestamp,
        "indexed_at": session.indexed_at
    });

    if pretty {
        serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string())
    } else {
        json.to_string()
    }
}
