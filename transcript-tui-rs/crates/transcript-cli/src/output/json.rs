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

/// Output a session as JSON value (for use in arrays)
pub fn session_to_json(session: &SessionInfo) -> serde_json::Value {
    serde_json::json!({
        "sessionId": session.session_id,
        "slug": session.slug,
        "filePath": session.file_path,
        "lineCount": session.line_count,
        "firstTimestamp": session.first_timestamp,
        "lastTimestamp": session.last_timestamp,
        "indexedAt": session.indexed_at
    })
}

/// Output a session as JSON string (deprecated, use session_to_json for arrays)
pub fn format_session(session: &SessionInfo, pretty: bool) -> String {
    let json = session_to_json(session);

    if pretty {
        serde_json::to_string_pretty(&json).unwrap_or_else(|_| json.to_string())
    } else {
        json.to_string()
    }
}
