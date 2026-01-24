//! Conversation context view mode

use ratatui::prelude::*;
use transcript_core::{LineType, TranscriptLine};

/// Render line in conversation context format
pub fn render(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let mut lines: Vec<Line<'static>> = Vec::new();

    // Role prefix
    let (prefix, prefix_style) = match line.line_type {
        LineType::User => ("👤 USER:", Style::default().fg(Color::Green).bold()),
        LineType::Assistant => ("🤖 ASSISTANT:", Style::default().fg(Color::Blue).bold()),
        LineType::System => ("⚙️  SYSTEM:", Style::default().fg(Color::Yellow).bold()),
        LineType::Summary => ("📝 SUMMARY:", Style::default().fg(Color::Magenta).bold()),
        _ => ("📄 ", Style::default().fg(Color::Gray)),
    };

    lines.push(Line::from(Span::styled(prefix.to_string(), prefix_style)));

    // Content with indentation
    if let Some(content) = &line.content {
        for content_line in content.lines() {
            lines.push(Line::from(format!("   {}", content_line)));
        }
    }

    // Add tool info for assistant messages
    if line.line_type == LineType::Assistant {
        if let Ok(parsed) = line.parse() {
            if let Some(msg) = &parsed.message {
                let tool_uses = msg.content.tool_uses();
                if !tool_uses.is_empty() {
                    lines.push(Line::from(""));
                    for (_, name, _) in tool_uses {
                        lines.push(Line::from(vec![
                            Span::styled("   ", Style::default()),
                            Span::styled("🔧 ", Style::default().fg(Color::Yellow)),
                            Span::styled(name.to_string(), Style::default().fg(Color::Yellow)),
                        ]));
                    }
                }
            }
        }
    }

    lines.push(Line::from("")); // Blank line between messages

    lines
}
