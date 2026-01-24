//! Content rendering utilities

use crate::types::{LineType, TranscriptLine, ViewMode};

/// Rendered content with optional styling hints
#[derive(Debug, Clone)]
pub struct RenderedContent {
    /// Plain text content
    pub text: String,
    /// Content has syntax highlighting applied
    pub highlighted: bool,
}

impl RenderedContent {
    pub fn plain(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            highlighted: false,
        }
    }

    pub fn highlighted(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            highlighted: true,
        }
    }
}

/// Render a transcript line for display
pub fn render_line(line: &TranscriptLine, mode: ViewMode) -> RenderedContent {
    match mode {
        ViewMode::Json => render_json(line),
        ViewMode::Custom => render_custom(line),
    }
}

/// Render JSON view with pretty printing
fn render_json(line: &TranscriptLine) -> RenderedContent {
    // Pretty print JSON
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line.raw) {
        if let Ok(pretty) = serde_json::to_string_pretty(&value) {
            return RenderedContent::plain(pretty);
        }
    }
    RenderedContent::plain(&line.raw)
}

/// Render MD view (metadata header + markdown content)
fn render_md(line: &TranscriptLine) -> RenderedContent {
    let mut parts = Vec::new();

    // Header with type and timestamp
    parts.push(format!(
        "━━━ {} ━━━ {} ━━━",
        line.display_type().to_uppercase(),
        line.format_time()
    ));

    // Session info if available
    if let Some(name) = &line.session_name {
        parts.push(format!("Session: {}", name));
    } else if let Some(slug) = &line.slug {
        parts.push(format!("Session: {}", slug));
    }

    // Turn info if available
    if let Some(turn_id) = &line.turn_id {
        if let Some(seq) = line.turn_sequence {
            parts.push(format!("Turn: {} (seq {})", turn_id, seq));
        }
    }

    parts.push(String::new()); // Blank line

    // Main content based on type
    match line.line_type {
        LineType::User | LineType::Assistant => {
            if let Some(content) = &line.content {
                parts.push(content.clone());
            }

            // Token usage
            if let Ok(parsed) = line.parse() {
                if let Some(msg) = &parsed.message {
                    if let Some(usage) = &msg.usage {
                        parts.push(String::new());
                        parts.push(format!(
                            "📊 Tokens: {} in / {} out = {} total",
                            usage.input_tokens,
                            usage.output_tokens,
                            usage.total()
                        ));
                    }
                }
            }
        }
        LineType::System => {
            if let Ok(parsed) = line.parse() {
                if let Some(subtype) = &parsed.subtype {
                    parts.push(format!("Subtype: {}", subtype));
                }
                if let Some(data) = &parsed.data {
                    if let Ok(pretty) = serde_json::to_string_pretty(data) {
                        parts.push(pretty);
                    }
                }
            }
        }
        LineType::Summary => {
            if let Ok(parsed) = line.parse() {
                if let Some(summary) = &parsed.summary {
                    parts.push(summary.clone());
                }
            }
        }
        _ => {
            if let Some(content) = &line.content {
                parts.push(content.clone());
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Get tool name from a line (if it contains tool_use)
fn get_tool_name(line: &TranscriptLine) -> Option<String> {
    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            let tools = msg.content.tool_uses();
            if let Some((_, name, _)) = tools.first() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Render CUSTOM view (tool-specific rendering)
fn render_custom(line: &TranscriptLine) -> RenderedContent {
    // Check if this is a tool use line
    if let Some(tool_name) = get_tool_name(line) {
        match tool_name.as_str() {
            "Edit" => return render_edit_diff(line),
            "Bash" => return render_bash_output(line),
            "Read" => return render_read_output(line),
            "Write" => return render_write_output(line),
            "Grep" => return render_grep_output(line),
            "Glob" => return render_glob_output(line),
            "TodoWrite" => return render_todo_list(line),
            _ => {
                // For other tools, show tool name + input
                let mut parts = vec![format!("━━━ {} ━━━", tool_name.to_uppercase())];
                if let Ok(parsed) = line.parse() {
                    if let Some(msg) = &parsed.message {
                        for (_, _, input) in msg.content.tool_uses() {
                            if let Ok(pretty) = serde_json::to_string_pretty(input) {
                                parts.push(pretty);
                            }
                        }
                    }
                }
                return RenderedContent::plain(parts.join("\n"));
            }
        }
    }

    // For non-tool lines, fall back to MD view
    render_md(line)
}

/// Render Edit tool as unified diff
fn render_edit_diff(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ EDIT ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    parts.push(format!("File: {}", file_path));
                    parts.push(String::new());
                }

                let old_string = input.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new_string = input.get("new_string").and_then(|v| v.as_str()).unwrap_or("");

                parts.push("@@ removed / added @@".to_string());
                for old_line in old_string.lines() {
                    parts.push(format!("- {}", old_line));
                }
                for new_line in new_string.lines() {
                    parts.push(format!("+ {}", new_line));
                }
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render Bash tool output
fn render_bash_output(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ BASH ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
                    parts.push(format!("$ {}", command));
                    parts.push(String::new());
                }
            }
        }

        // Show tool result if available
        if let Some(result) = &parsed.tool_use_result {
            if let Some(stdout) = result.get("stdout").and_then(|v| v.as_str()) {
                if !stdout.is_empty() {
                    parts.push(stdout.to_string());
                }
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str()) {
                if !stderr.is_empty() {
                    parts.push(format!("[stderr] {}", stderr));
                }
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render Read tool output with line numbers
fn render_read_output(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ READ ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    parts.push(format!("File: {}", file_path));
                    parts.push(String::new());
                }
            }
        }

        // Show file content if available
        if let Some(content) = &line.content {
            for (i, content_line) in content.lines().enumerate() {
                parts.push(format!("{:>4} {}", i + 1, content_line));
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render Write tool with file content
fn render_write_output(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ WRITE ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    parts.push(format!("File: {}", file_path));
                    parts.push(String::new());
                }

                if let Some(content) = input.get("content").and_then(|v| v.as_str()) {
                    for (i, content_line) in content.lines().enumerate() {
                        parts.push(format!("{:>4} {}", i + 1, content_line));
                    }
                }
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render Grep tool with pattern highlighted
fn render_grep_output(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ GREP ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                    parts.push(format!("Pattern: {}", pattern));
                }
                if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                    parts.push(format!("Path: {}", path));
                }
            }
        }
    }

    parts.push(String::new());
    if let Some(content) = &line.content {
        parts.push(content.clone());
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render Glob tool as file tree
fn render_glob_output(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ GLOB ━━━".to_string()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                    parts.push(format!("Pattern: {}", pattern));
                }
                if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                    parts.push(format!("Path: {}", path));
                }
            }
        }
    }

    parts.push(String::new());
    if let Some(content) = &line.content {
        for file in content.lines() {
            if !file.trim().is_empty() {
                parts.push(format!("  ├─ {}", file));
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Render TodoWrite tool as task list
fn render_todo_list(line: &TranscriptLine) -> RenderedContent {
    let mut parts = vec!["━━━ TODOWRITE ━━━".to_string(), String::new()];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(todos) = input.get("todos").and_then(|v| v.as_array()) {
                    let total = todos.len();
                    let mut completed = 0;

                    for todo in todos {
                        let content = todo.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let status = todo.get("status").and_then(|v| v.as_str()).unwrap_or("pending");

                        let checkbox = match status {
                            "completed" => {
                                completed += 1;
                                "[✓]"
                            }
                            "in_progress" => "[→]",
                            _ => "[ ]",
                        };

                        parts.push(format!("{} {}", checkbox, content));
                    }

                    parts.push(String::new());
                    let percent = if total > 0 { completed * 100 / total } else { 0 };
                    parts.push(format!("Progress: {}/{} ({}%)", completed, total, percent));
                }
            }
        }
    }

    RenderedContent::plain(parts.join("\n"))
}

/// Format a list item for the line list
pub fn format_list_item(line: &TranscriptLine, width: usize, is_selected: bool, is_bookmarked: bool) -> String {
    let time = line.format_time();
    let type_abbr = match line.line_type {
        LineType::User => "USR",
        LineType::Assistant => "AST",
        LineType::System => "SYS",
        LineType::Summary => "SUM",
        LineType::Progress => "PRG",
        LineType::FileHistorySnapshot => "FHS",
        LineType::Unknown => "???",
    };

    let bookmark_marker = if is_bookmarked { "★" } else { " " };
    let select_marker = if is_selected { ">" } else { " " };

    // Calculate remaining width for preview
    let prefix_len = 3 + 1 + 8 + 1 + 3 + 1; // ">★ HH:MM:SS USR "
    let preview_width = width.saturating_sub(prefix_len);
    let preview = line.preview(preview_width);

    format!(
        "{}{} {} {} {}",
        select_marker, bookmark_marker, time, type_abbr, preview
    )
}

/// Calculate context usage percentage
pub fn calculate_usage_percent(line: &TranscriptLine, context_size: u64) -> Option<f64> {
    let usage = line.usage()?;
    let total = usage.total();
    if context_size == 0 {
        return None;
    }
    Some((total as f64 / context_size as f64) * 100.0)
}

/// Default context window size for Claude (200K tokens)
pub const DEFAULT_CONTEXT_SIZE: u64 = 200_000;
