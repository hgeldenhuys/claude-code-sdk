//! Minimal (text-only) view mode

use ratatui::prelude::*;
use transcript_core::TranscriptLine;

/// Render line with just the text content
pub fn render(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    if let Some(content) = &line.content {
        content.lines().map(|l| Line::from(l.to_string())).collect()
    } else {
        vec![Line::from("(no text content)")]
    }
}
