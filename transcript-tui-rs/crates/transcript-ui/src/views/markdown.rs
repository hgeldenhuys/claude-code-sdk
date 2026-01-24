//! Markdown rendered view mode

use pulldown_cmark::{Event, Parser, Tag, TagEnd, CodeBlockKind};
use ratatui::prelude::*;
use transcript_core::TranscriptLine;

/// Render line with markdown formatting
pub fn render(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    let content = match &line.content {
        Some(c) => c.clone(),
        None => return vec![Line::from("(no content)")],
    };

    render_markdown(&content)
}

/// Render markdown text to styled lines
fn render_markdown(text: &str) -> Vec<Line<'static>> {
    let parser = Parser::new(text);
    let mut lines: Vec<Line<'static>> = Vec::new();
    let mut current_line: Vec<Span<'static>> = Vec::new();
    let mut style_stack: Vec<Style> = vec![Style::default()];
    let mut in_code_block = false;
    let mut code_lang = String::new();

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    // Flush current line
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                    let prefix = "#".repeat(level as usize);
                    current_line.push(Span::styled(
                        format!("{} ", prefix),
                        Style::default().fg(Color::Cyan).bold(),
                    ));
                    style_stack.push(Style::default().fg(Color::Cyan).bold());
                }
                Tag::Paragraph => {
                    // Start new paragraph
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                }
                Tag::CodeBlock(kind) => {
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                    in_code_block = true;
                    code_lang = match kind {
                        CodeBlockKind::Fenced(lang) => lang.to_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    if !code_lang.is_empty() {
                        lines.push(Line::from(Span::styled(
                            format!("── {} ──", code_lang),
                            Style::default().fg(Color::DarkGray),
                        )));
                    }
                }
                Tag::Strong => {
                    style_stack.push(Style::default().add_modifier(Modifier::BOLD));
                }
                Tag::Emphasis => {
                    style_stack.push(Style::default().add_modifier(Modifier::ITALIC));
                }
                Tag::Link { dest_url, .. } => {
                    style_stack.push(Style::default().fg(Color::Blue).add_modifier(Modifier::UNDERLINED));
                    // Store URL for later
                    let _ = dest_url;
                }
                Tag::List(_) => {
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                }
                Tag::Item => {
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                    current_line.push(Span::raw("  • "));
                }
                Tag::BlockQuote(_) => {
                    if !current_line.is_empty() {
                        lines.push(Line::from(std::mem::take(&mut current_line)));
                    }
                    current_line.push(Span::styled("│ ", Style::default().fg(Color::DarkGray)));
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                TagEnd::Heading(_) => {
                    style_stack.pop();
                    lines.push(Line::from(std::mem::take(&mut current_line)));
                }
                TagEnd::Paragraph => {
                    lines.push(Line::from(std::mem::take(&mut current_line)));
                    lines.push(Line::from("")); // Blank line after paragraph
                }
                TagEnd::CodeBlock => {
                    in_code_block = false;
                    code_lang.clear();
                }
                TagEnd::Strong | TagEnd::Emphasis | TagEnd::Link => {
                    style_stack.pop();
                }
                TagEnd::List(_) => {
                    lines.push(Line::from("")); // Blank line after list
                }
                TagEnd::Item => {
                    lines.push(Line::from(std::mem::take(&mut current_line)));
                }
                TagEnd::BlockQuote(_) => {}
                _ => {}
            },
            Event::Text(text) => {
                let style = style_stack.last().cloned().unwrap_or_default();
                if in_code_block {
                    // Code block text - yellow
                    for code_line in text.lines() {
                        lines.push(Line::from(Span::styled(
                            code_line.to_string(),
                            Style::default().fg(Color::Yellow),
                        )));
                    }
                } else {
                    current_line.push(Span::styled(text.to_string(), style));
                }
            }
            Event::Code(code) => {
                // Inline code
                current_line.push(Span::styled(
                    format!(" {} ", code),
                    Style::default().bg(Color::DarkGray).fg(Color::White),
                ));
            }
            Event::SoftBreak => {
                current_line.push(Span::raw(" "));
            }
            Event::HardBreak => {
                lines.push(Line::from(std::mem::take(&mut current_line)));
            }
            Event::Rule => {
                if !current_line.is_empty() {
                    lines.push(Line::from(std::mem::take(&mut current_line)));
                }
                lines.push(Line::from(Span::styled(
                    "─".repeat(40),
                    Style::default().fg(Color::DarkGray),
                )));
            }
            _ => {}
        }
    }

    // Flush remaining content
    if !current_line.is_empty() {
        lines.push(Line::from(current_line));
    }

    lines
}
