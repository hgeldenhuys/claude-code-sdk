//! Custom view renderer - Tool-specific rendering
//!
//! Renders tools with specialized formatting:
//! - Edit: Unified diff with color highlighting
//! - Bash: Command + stdout/stderr
//! - Read/Write: File content with line numbers
//! - Grep: Pattern + highlighted matches
//! - Glob: File tree visualization
//! - TodoWrite: Task list with progress

use ratatui::prelude::*;
use transcript_core::TranscriptLine;

use super::human;

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

/// Render custom view for a transcript line
pub fn render(line: &TranscriptLine, width: usize) -> Vec<Line<'static>> {
    // Check if this is a tool use line
    if let Some(tool_name) = get_tool_name(line) {
        match tool_name.as_str() {
            "Edit" => return render_edit_diff(line, width),
            "Bash" => return render_bash_output(line, width),
            "Read" => return render_read_output(line, width),
            "Write" => return render_write_output(line, width),
            "Grep" => return render_grep_output(line, width),
            "Glob" => return render_glob_output(line, width),
            "TodoWrite" => return render_todo_list(line, width),
            _ => return render_generic_tool(line, &tool_name, width),
        }
    }

    // For non-tool lines, fall back to human/MD view
    human::render(line, width)
}

/// Render Edit tool as unified diff
fn render_edit_diff(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ EDIT ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("File: "),
                        Span::styled(file_path.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                    lines.push(Line::from(""));
                }

                let old_string = input.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                let new_string = input.get("new_string").and_then(|v| v.as_str()).unwrap_or("");

                lines.push(Line::from(Span::styled(
                    "@@ removed / added @@",
                    Style::default().fg(Color::DarkGray),
                )));

                for old_line in old_string.lines() {
                    lines.push(Line::from(Span::styled(
                        format!("- {}", old_line),
                        Style::default().fg(Color::Red),
                    )));
                }
                for new_line in new_string.lines() {
                    lines.push(Line::from(Span::styled(
                        format!("+ {}", new_line),
                        Style::default().fg(Color::Green),
                    )));
                }
            }
        }
    }

    lines
}

/// Render Bash tool output
fn render_bash_output(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ BASH ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::styled("$ ", Style::default().fg(Color::Green)),
                        Span::styled(command.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                    lines.push(Line::from(""));
                }
            }
        }

        // Show tool result if available
        if let Some(result) = &parsed.tool_use_result {
            if let Some(stdout) = result.get("stdout").and_then(|v| v.as_str()) {
                if !stdout.is_empty() {
                    for stdout_line in stdout.lines() {
                        lines.push(Line::from(stdout_line.to_string()));
                    }
                }
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str()) {
                if !stderr.is_empty() {
                    for stderr_line in stderr.lines() {
                        lines.push(Line::from(Span::styled(
                            stderr_line.to_string(),
                            Style::default().fg(Color::Red),
                        )));
                    }
                }
            }
        }
    }

    lines
}

/// Render Read tool output with line numbers
fn render_read_output(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ READ ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("File: "),
                        Span::styled(file_path.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                    lines.push(Line::from(""));
                }
            }
        }
    }

    // Show file content with line numbers
    if let Some(content) = &line.content {
        for (i, content_line) in content.lines().enumerate() {
            lines.push(Line::from(vec![
                Span::styled(
                    format!("{:>4} ", i + 1),
                    Style::default().fg(Color::DarkGray),
                ),
                Span::raw(content_line.to_string()),
            ]));
        }
    }

    lines
}

/// Render Write tool with file content
fn render_write_output(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ WRITE ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("File: "),
                        Span::styled(file_path.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                    lines.push(Line::from(""));
                }

                if let Some(content) = input.get("content").and_then(|v| v.as_str()) {
                    for (i, content_line) in content.lines().enumerate() {
                        lines.push(Line::from(vec![
                            Span::styled(
                                format!("{:>4} ", i + 1),
                                Style::default().fg(Color::DarkGray),
                            ),
                            Span::raw(content_line.to_string()),
                        ]));
                    }
                }
            }
        }
    }

    lines
}

/// Render Grep tool with pattern highlighted
fn render_grep_output(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ GREP ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("Pattern: "),
                        Span::styled(pattern.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                }
                if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("Path: "),
                        Span::styled(path.to_string(), Style::default().fg(Color::Cyan)),
                    ]));
                }
            }
        }
    }

    lines.push(Line::from(""));
    if let Some(content) = &line.content {
        for content_line in content.lines() {
            lines.push(Line::from(content_line.to_string()));
        }
    }

    lines
}

/// Render Glob tool as file tree
fn render_glob_output(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ GLOB ━━━", Style::default().fg(Color::Cyan)),
        ]),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("Pattern: "),
                        Span::styled(pattern.to_string(), Style::default().fg(Color::Yellow)),
                    ]));
                }
                if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                    lines.push(Line::from(vec![
                        Span::raw("Path: "),
                        Span::styled(path.to_string(), Style::default().fg(Color::Cyan)),
                    ]));
                }
            }
        }
    }

    lines.push(Line::from(""));
    if let Some(content) = &line.content {
        for file in content.lines() {
            if !file.trim().is_empty() {
                lines.push(Line::from(vec![
                    Span::styled("  ├─ ", Style::default().fg(Color::DarkGray)),
                    Span::raw(file.to_string()),
                ]));
            }
        }
    }

    lines
}

/// Render TodoWrite tool as task list
fn render_todo_list(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled("━━━ TODOWRITE ━━━", Style::default().fg(Color::Cyan)),
        ]),
        Line::from(""),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Some(todos) = input.get("todos").and_then(|v| v.as_array()) {
                    let total = todos.len();
                    let mut completed = 0;

                    for todo in todos {
                        let content = todo.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let status = todo.get("status").and_then(|v| v.as_str()).unwrap_or("pending");

                        let (checkbox, color) = match status {
                            "completed" => {
                                completed += 1;
                                ("[✓]", Color::Green)
                            }
                            "in_progress" => ("[→]", Color::Yellow),
                            _ => ("[ ]", Color::DarkGray),
                        };

                        lines.push(Line::from(vec![
                            Span::styled(checkbox.to_string(), Style::default().fg(color)),
                            Span::raw(format!(" {}", content)),
                        ]));
                    }

                    lines.push(Line::from(""));
                    let percent = if total > 0 { completed * 100 / total } else { 0 };
                    lines.push(Line::from(Span::styled(
                        format!("Progress: {}/{} ({}%)", completed, total, percent),
                        Style::default().fg(Color::Cyan),
                    )));
                }
            }
        }
    }

    lines
}

/// Render generic tool (name + input)
fn render_generic_tool(line: &TranscriptLine, tool_name: &str, _width: usize) -> Vec<Line<'static>> {
    let mut lines = vec![
        Line::from(vec![
            Span::styled(
                format!("━━━ {} ━━━", tool_name.to_uppercase()),
                Style::default().fg(Color::Cyan),
            ),
        ]),
        Line::from(""),
    ];

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, _, input) in msg.content.tool_uses() {
                if let Ok(pretty) = serde_json::to_string_pretty(input) {
                    for json_line in pretty.lines() {
                        lines.push(Line::from(json_line.to_string()));
                    }
                }
            }
        }
    }

    lines
}
