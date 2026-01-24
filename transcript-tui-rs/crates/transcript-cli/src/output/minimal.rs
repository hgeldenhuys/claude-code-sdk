//! Minimal text output formatting

use transcript_core::{SessionInfo, TranscriptLine};

/// Format a transcript line as minimal text (content only)
pub fn format_line(line: &TranscriptLine) -> String {
    line.content.clone().unwrap_or_default()
}

/// Format a session as minimal text
pub fn format_session(session: &SessionInfo) -> String {
    session
        .slug
        .clone()
        .unwrap_or_else(|| session.session_id.clone())
}
