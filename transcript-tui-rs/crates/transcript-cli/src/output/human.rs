//! Human-readable output formatting

use colored::Colorize;
use super::colors::*;
use transcript_core::{LineType, SessionInfo, TranscriptLine};

/// Noise patterns to skip in output
const NOISE_PATTERNS: &[&str] = &[
    "Status dialog dismissed",
    "status dialog dismissed",
];

/// Check if content is noise that should be skipped
fn is_noise(content: &str) -> bool {
    let trimmed = content.trim();
    for pattern in NOISE_PATTERNS {
        if trimmed == *pattern {
            return true;
        }
    }
    false
}

/// Format duration in human-readable form
fn format_duration(ms: u64) -> String {
    if ms < 1000 {
        format!("{}ms", ms)
    } else if ms < 60_000 {
        format!("{:.1}s", ms as f64 / 1000.0)
    } else if ms < 3_600_000 {
        let mins = ms / 60_000;
        let secs = (ms % 60_000) / 1000;
        format!("{}m {}s", mins, secs)
    } else {
        let hours = ms / 3_600_000;
        let mins = (ms % 3_600_000) / 60_000;
        format!("{}h {}m", hours, mins)
    }
}

/// Extract useful content from system message JSON
fn extract_system_content(parsed: &serde_json::Value) -> Option<String> {
    let subtype = parsed.get("subtype").and_then(|v| v.as_str())?;

    match subtype {
        "turn_duration" => {
            let duration_ms = parsed.get("durationMs").and_then(|v| v.as_u64())?;
            Some(format!("Turn completed in {}", format_duration(duration_ms)))
        }

        "stop_hook_summary" => {
            let hook_count = parsed.get("hookCount").and_then(|v| v.as_u64()).unwrap_or(0);
            let hook_errors = parsed.get("hookErrors")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let prevented = parsed.get("preventedContinuation").and_then(|v| v.as_bool()).unwrap_or(false);

            let mut parts = Vec::new();
            if hook_count > 0 {
                parts.push(format!("{} hook(s) ran", hook_count));
            }
            if hook_errors > 0 {
                parts.push(format!("{} error(s)", hook_errors).red().to_string());
            }
            if prevented {
                parts.push("continuation prevented".yellow().to_string());
            }

            if parts.is_empty() {
                None  // Skip if nothing interesting
            } else {
                Some(parts.join(", "))
            }
        }

        "local_command" => {
            // Extract command name from content
            if let Some(content) = parsed.get("content").and_then(|v| v.as_str()) {
                // Check for noise
                if is_noise(content) {
                    return None;
                }

                // Extract command name from XML
                if let Some(start) = content.find("<command-name>") {
                    if let Some(end) = content.find("</command-name>") {
                        let cmd = &content[start + 14..end];
                        return Some(format!("/{}", cmd.trim_start_matches('/')));
                    }
                }

                // Extract stdout if meaningful
                if let Some(start) = content.find("<local-command-stdout>") {
                    if let Some(end) = content.find("</local-command-stdout>") {
                        let stdout = &content[start + 22..end];
                        if !is_noise(stdout) && !stdout.trim().is_empty() {
                            return Some(stdout.trim().to_string());
                        }
                    }
                }
            }
            None
        }

        "init" => {
            let version = parsed.get("version").and_then(|v| v.as_str()).unwrap_or("?");
            let branch = parsed.get("gitBranch").and_then(|v| v.as_str());
            if let Some(b) = branch {
                Some(format!("Session started (v{}, {})", version, b))
            } else {
                Some(format!("Session started (v{})", version))
            }
        }

        "api_conversation_stats" => {
            let input = parsed.get("inputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let output = parsed.get("outputTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_read = parsed.get("cacheReadTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let cache_create = parsed.get("cacheCreationTokens").and_then(|v| v.as_u64()).unwrap_or(0);
            let cost = parsed.get("costUSD").and_then(|v| v.as_f64());

            let total = input + output + cache_read + cache_create;
            if total > 0 {
                let mut s = format!("{} tokens", format_count(total as i64));
                if let Some(c) = cost {
                    s.push_str(&format!(" (${:.4})", c));
                }
                Some(s)
            } else {
                None
            }
        }

        "context_cleared" | "context_compacted" => {
            Some(format!("Context {}", subtype.replace("context_", "")))
        }

        _ => {
            // For unknown subtypes, just show the subtype name
            Some(format!("[{}]", subtype))
        }
    }
}

/// Get content from line, with smart extraction for system messages
fn get_content(line: &TranscriptLine) -> Option<String> {
    // Parse raw JSON for richer extraction
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line.raw) {
        // For system messages, use smart extraction
        if line.line_type == LineType::System {
            return extract_system_content(&parsed);
        }

        // For assistant messages, try message.content
        if line.line_type == LineType::Assistant {
            if let Some(msg) = parsed.get("message") {
                // Check for tool use
                if let Some(content) = msg.get("content") {
                    if let Some(blocks) = content.as_array() {
                        for block in blocks {
                            if let Some(block_type) = block.get("type").and_then(|v| v.as_str()) {
                                if block_type == "tool_use" {
                                    let tool_name = block.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
                                    // Get a preview of what the tool is doing
                                    if let Some(input) = block.get("input") {
                                        let preview = get_tool_preview(tool_name, input);
                                        return Some(format!("[Tool: {}]{}", tool_name,
                                            if preview.is_empty() { String::new() } else { format!("\n{}", preview) }));
                                    }
                                    return Some(format!("[Tool: {}]", tool_name));
                                }
                                if block_type == "text" {
                                    if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                        let trimmed = text.trim();
                                        if !trimmed.is_empty() {
                                            return Some(trimmed.to_string());
                                        }
                                    }
                                }
                                if block_type == "thinking" {
                                    if let Some(thinking) = block.get("thinking").and_then(|v| v.as_str()) {
                                        let preview: String = thinking.trim().chars().take(100).collect();
                                        return Some(format!("<thinking> {}...", preview));
                                    }
                                }
                            }
                        }
                    }
                    // Simple string content
                    if let Some(text) = content.as_str() {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                }
            }
        }

        // For user messages, get content
        if line.line_type == LineType::User {
            if let Some(msg) = parsed.get("message") {
                if let Some(content) = msg.get("content") {
                    if let Some(text) = content.as_str() {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            return Some(trimmed.to_string());
                        }
                    }
                    // Array of content blocks
                    if let Some(blocks) = content.as_array() {
                        for block in blocks {
                            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                                let trimmed = text.trim();
                                if !trimmed.is_empty() {
                                    return Some(trimmed.to_string());
                                }
                            }
                        }
                    }
                }
            }
            // Try direct content field
            if let Some(content) = parsed.get("content").and_then(|v| v.as_str()) {
                let trimmed = content.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // Fallback to database content field
    if let Some(content) = &line.content {
        let trimmed = content.trim();
        if !trimmed.is_empty() && !is_noise(trimmed) {
            return Some(trimmed.to_string());
        }
    }

    None
}

/// Get a preview of tool input for display
fn get_tool_preview(tool_name: &str, input: &serde_json::Value) -> String {
    match tool_name {
        "Bash" => {
            input.get("command")
                .and_then(|v| v.as_str())
                .map(|cmd| {
                    let first_line = cmd.lines().next().unwrap_or("");
                    if first_line.len() > 80 {
                        format!("{}...", &first_line[..77])
                    } else {
                        first_line.to_string()
                    }
                })
                .unwrap_or_default()
        }
        "Read" => {
            input.get("file_path")
                .and_then(|v| v.as_str())
                .map(|p| p.to_string())
                .unwrap_or_default()
        }
        "Write" => {
            input.get("file_path")
                .and_then(|v| v.as_str())
                .map(|p| p.to_string())
                .unwrap_or_default()
        }
        "Edit" => {
            input.get("file_path")
                .and_then(|v| v.as_str())
                .map(|p| p.to_string())
                .unwrap_or_default()
        }
        "Grep" => {
            input.get("pattern")
                .and_then(|v| v.as_str())
                .map(|p| format!("/{}/", p))
                .unwrap_or_default()
        }
        "Glob" => {
            input.get("pattern")
                .and_then(|v| v.as_str())
                .map(|p| p.to_string())
                .unwrap_or_default()
        }
        "Task" => {
            let agent = input.get("subagent_type").and_then(|v| v.as_str()).unwrap_or("");
            let desc = input.get("description").and_then(|v| v.as_str()).unwrap_or("");
            if !agent.is_empty() && !desc.is_empty() {
                format!("{}: {}", agent, desc)
            } else if !desc.is_empty() {
                desc.to_string()
            } else {
                agent.to_string()
            }
        }
        _ => String::new()
    }
}

/// Format a transcript line for human-readable output
pub fn format_line(line: &TranscriptLine, show_content: bool) -> String {
    let mut parts = Vec::new();

    // Line number and timestamp
    parts.push(format!(
        "{} {}",
        colored_line_num(line.line_number),
        colored_time(&line.timestamp)
    ));

    // Type indicator
    parts.push(format!("[{}]", colored_type(line.line_type)));

    // Model for assistant messages
    if let Some(model) = &line.model {
        parts.push(format!("({})", colored_model(model)));
    }

    // Turn info if available
    if let Some(turn_id) = &line.turn_id {
        if let Some(seq) = line.turn_sequence {
            let short_turn = turn_id.split(':').last().unwrap_or(turn_id);
            parts.push(format!("[T{}.{}]", short_turn, seq));
        }
    }

    let header = parts.join(" ");

    if show_content {
        if let Some(content) = get_content(line) {
            let indent = "  ";
            let formatted_content = content
                .lines()
                .map(|l| format!("{}{}", indent, l))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}\n{}", header, formatted_content)
        } else {
            header
        }
    } else {
        // Just preview - try get_content for richer preview
        if let Some(content) = get_content(line) {
            let preview: String = content.lines().next().unwrap_or("").chars().take(60).collect();
            if preview.len() < content.lines().next().unwrap_or("").len() {
                format!("{} {}...", header, preview)
            } else {
                format!("{} {}", header, preview)
            }
        } else {
            header
        }
    }
}

/// Check if a line should be hidden (noise)
pub fn should_hide(line: &TranscriptLine) -> bool {
    // Hide system messages with no meaningful content
    if line.line_type == LineType::System {
        if get_content(line).is_none() {
            return true;
        }
    }
    false
}

/// Format a session for human-readable list output
pub fn format_session(session: &SessionInfo) -> String {
    let name = session
        .slug
        .as_deref()
        .unwrap_or_else(|| &session.session_id[..8]);

    let time = session
        .last_timestamp
        .as_deref()
        .map(|t| {
            // Extract date and time
            if let Some(t_pos) = t.find('T') {
                let date = &t[..t_pos];
                let time = t[t_pos + 1..].split('.').next().unwrap_or("??:??:??");
                format!("{} {}", date, time)
            } else {
                t.to_string()
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    format!(
        "{} {} lines  {}",
        colored_session(name),
        format_count(session.line_count),
        colored_time(&time)
    )
}

/// Format session info detail view
pub fn format_session_info(session: &SessionInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!(
        "{}: {}",
        label("Session ID"),
        value(&session.session_id)
    ));

    if let Some(slug) = &session.slug {
        lines.push(format!("{}: {}", label("Slug"), colored_session(slug)));
    }

    lines.push(format!("{}: {}", label("File"), value(&session.file_path)));
    lines.push(format!(
        "{}: {}",
        label("Lines"),
        value(&format_count(session.line_count))
    ));

    if let Some(first) = &session.first_timestamp {
        lines.push(format!("{}: {}", label("Started"), value(first)));
    }

    if let Some(last) = &session.last_timestamp {
        lines.push(format!("{}: {}", label("Last activity"), value(last)));
    }

    lines.push(format!(
        "{}: {}",
        label("Indexed at"),
        value(&session.indexed_at)
    ));

    lines.join("\n")
}
