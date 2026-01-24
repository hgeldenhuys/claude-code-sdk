//! JSON output formatting

use transcript_core::{SessionInfo, TranscriptLine};

/// Output a transcript line as JSON (raw JSON from database)
pub fn format_line(line: &TranscriptLine) -> String {
    // The raw field already contains the original JSON
    line.raw.clone()
}

/// Output a session as JSON
pub fn format_session(session: &SessionInfo) -> String {
    serde_json::json!({
        "session_id": session.session_id,
        "slug": session.slug,
        "file_path": session.file_path,
        "line_count": session.line_count,
        "first_timestamp": session.first_timestamp,
        "last_timestamp": session.last_timestamp,
        "indexed_at": session.indexed_at
    })
    .to_string()
}
