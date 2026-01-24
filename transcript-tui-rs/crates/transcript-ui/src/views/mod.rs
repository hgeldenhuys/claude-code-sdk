//! View mode renderers
//!
//! Two view modes:
//! - JSON: Raw JSON with syntax highlighting
//! - CUSTOM: Smart view (MD for text, tool-specific for tools)

pub mod raw;  // JSON view
pub mod human;  // MD view (used by CUSTOM for non-tool content)
pub mod custom;  // CUSTOM view (tool-specific)

// Keep for internal use
pub mod minimal;
pub mod context;
pub mod markdown;

use ratatui::prelude::*;
use transcript_core::{TranscriptLine, ViewMode};

/// Render content for a line in the specified view mode
pub fn render_content(line: &TranscriptLine, mode: ViewMode, width: usize) -> Vec<Line<'static>> {
    match mode {
        ViewMode::Json => raw::render(line, width),
        ViewMode::Custom => custom::render(line, width),
    }
}
