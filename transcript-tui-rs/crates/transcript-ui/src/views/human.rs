//! Human-readable view mode

use ratatui::prelude::*;
use transcript_core::{LineType, TranscriptLine};

/// Render line in human-readable format
pub fn render(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();

    // Header
    let type_style = match line.line_type {
        LineType::User => Style::default().fg(Color::Green).bold(),
        LineType::Assistant => Style::default().fg(Color::Blue).bold(),
        LineType::System => Style::default().fg(Color::Yellow).bold(),
        LineType::Summary => Style::default().fg(Color::Magenta).bold(),
        _ => Style::default().fg(Color::Gray).bold(),
    };

    lines.push(Line::from(vec![
        Span::styled("━━━ ", Style::default().fg(Color::DarkGray)),
        Span::styled(line.display_type().to_uppercase(), type_style),
        Span::styled(" ━━━ ", Style::default().fg(Color::DarkGray)),
        Span::styled(line.format_time(), Style::default().fg(Color::DarkGray)),
        Span::styled(" ━━━", Style::default().fg(Color::DarkGray)),
    ]));

    // Session info
    if let Some(name) = &line.session_name {
        lines.push(Line::from(vec![
            Span::styled("Session: ", Style::default().fg(Color::DarkGray)),
            Span::styled(name.clone(), Style::default().fg(Color::Cyan)),
        ]));
    } else if let Some(slug) = &line.slug {
        lines.push(Line::from(vec![
            Span::styled("Session: ", Style::default().fg(Color::DarkGray)),
            Span::styled(slug.clone(), Style::default().fg(Color::Cyan)),
        ]));
    }

    // Turn info
    if let Some(turn_id) = &line.turn_id {
        let turn_info = if let Some(seq) = line.turn_sequence {
            format!("{} (seq {})", turn_id, seq)
        } else {
            turn_id.clone()
        };
        lines.push(Line::from(vec![
            Span::styled("Turn: ", Style::default().fg(Color::DarkGray)),
            Span::styled(turn_info, Style::default().fg(Color::DarkGray)),
        ]));
    }

    lines.push(Line::from("")); // Blank line

    // Main content
    match line.line_type {
        LineType::User | LineType::Assistant => {
            if let Some(content) = &line.content {
                for content_line in content.lines() {
                    lines.push(Line::from(content_line.to_string()));
                }
            }

            // Parse for tool uses and token usage
            if let Ok(parsed) = line.parse() {
                if let Some(msg) = &parsed.message {
                    // Tool uses
                    for (id, name, input) in msg.content.tool_uses() {
                        lines.push(Line::from(""));
                        lines.push(Line::from(vec![
                            Span::styled("🔧 Tool: ", Style::default().fg(Color::Yellow)),
                            Span::styled(name.to_string(), Style::default().fg(Color::Yellow).bold()),
                        ]));
                        lines.push(Line::from(vec![
                            Span::styled("   ID: ", Style::default().fg(Color::DarkGray)),
                            Span::raw(id.to_string()),
                        ]));

                        // Pretty print input
                        if let Ok(pretty) = serde_json::to_string_pretty(input) {
                            for input_line in pretty.lines() {
                                lines.push(Line::from(vec![
                                    Span::styled("   ", Style::default()),
                                    Span::raw(input_line.to_string()),
                                ]));
                            }
                        }
                    }

                    // Token usage
                    if let Some(usage) = &msg.usage {
                        lines.push(Line::from(""));
                        lines.push(Line::from(vec![
                            Span::styled("📊 Tokens: ", Style::default().fg(Color::Cyan)),
                            Span::styled(
                                format!("{} in", usage.input_tokens),
                                Style::default().fg(Color::Green),
                            ),
                            Span::raw(" / "),
                            Span::styled(
                                format!("{} out", usage.output_tokens),
                                Style::default().fg(Color::Blue),
                            ),
                            Span::raw(" = "),
                            Span::styled(
                                format!("{} total", usage.total()),
                                Style::default().fg(Color::Yellow).bold(),
                            ),
                        ]));

                        // Cache info
                        if let Some(cache_create) = usage.cache_creation_input_tokens {
                            if cache_create > 0 {
                                lines.push(Line::from(vec![
                                    Span::styled("   Cache create: ", Style::default().fg(Color::DarkGray)),
                                    Span::raw(format!("{}", cache_create)),
                                ]));
                            }
                        }
                        if let Some(cache_read) = usage.cache_read_input_tokens {
                            if cache_read > 0 {
                                lines.push(Line::from(vec![
                                    Span::styled("   Cache read: ", Style::default().fg(Color::DarkGray)),
                                    Span::raw(format!("{}", cache_read)),
                                ]));
                            }
                        }
                    }
                }
            }
        }
        LineType::System => {
            if let Ok(parsed) = line.parse() {
                if let Some(subtype) = &parsed.subtype {
                    lines.push(Line::from(vec![
                        Span::styled("Subtype: ", Style::default().fg(Color::DarkGray)),
                        Span::raw(subtype.clone()),
                    ]));
                }
                if let Some(data) = &parsed.data {
                    if let Ok(pretty) = serde_json::to_string_pretty(data) {
                        for data_line in pretty.lines() {
                            lines.push(Line::from(data_line.to_string()));
                        }
                    }
                }
            }
        }
        LineType::Summary => {
            if let Ok(parsed) = line.parse() {
                if let Some(summary) = &parsed.summary {
                    for summary_line in summary.lines() {
                        lines.push(Line::from(summary_line.to_string()));
                    }
                }
            }
        }
        _ => {
            if let Some(content) = &line.content {
                for content_line in content.lines() {
                    lines.push(Line::from(content_line.to_string()));
                }
            }
        }
    }

    lines
}
