//! Raw JSON view mode

use ratatui::prelude::*;
use transcript_core::TranscriptLine;

/// Render line as raw JSON with syntax highlighting
pub fn render(line: &TranscriptLine, _width: usize) -> Vec<Line<'static>> {
    // Parse and pretty print JSON
    let json_text = match serde_json::from_str::<serde_json::Value>(&line.raw) {
        Ok(value) => serde_json::to_string_pretty(&value).unwrap_or_else(|_| line.raw.clone()),
        Err(_) => line.raw.clone(),
    };

    // Apply syntax highlighting
    json_text
        .lines()
        .map(|l| highlight_json_line(l))
        .collect()
}

/// Apply JSON syntax highlighting to a single line
fn highlight_json_line(text: &str) -> Line<'static> {
    let mut spans = Vec::new();
    let mut chars = text.chars().peekable();
    let mut current = String::new();

    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                // Flush current
                if !current.is_empty() {
                    spans.push(Span::raw(std::mem::take(&mut current)));
                }

                // Collect string
                let mut s = String::from("\"");
                while let Some(&c) = chars.peek() {
                    s.push(chars.next().unwrap());
                    if c == '"' {
                        break;
                    }
                    if c == '\\' {
                        if let Some(&next) = chars.peek() {
                            s.push(chars.next().unwrap());
                            let _ = next;
                        }
                    }
                }

                // Determine if it's a key (followed by colon)
                let mut lookahead = chars.clone();
                let mut is_key = false;
                while let Some(&c) = lookahead.peek() {
                    if c == ':' {
                        is_key = true;
                        break;
                    } else if !c.is_whitespace() {
                        break;
                    }
                    lookahead.next();
                }

                let style = if is_key {
                    Style::default().fg(Color::Cyan)
                } else {
                    Style::default().fg(Color::Green)
                };

                spans.push(Span::styled(s, style));
            }
            '0'..='9' | '-' => {
                // Flush current
                if !current.is_empty() {
                    spans.push(Span::raw(std::mem::take(&mut current)));
                }

                // Collect number
                let mut num = String::from(ch);
                while let Some(&c) = chars.peek() {
                    if c.is_ascii_digit() || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-'
                    {
                        num.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }

                spans.push(Span::styled(num, Style::default().fg(Color::Yellow)));
            }
            't' | 'f' | 'n' => {
                // Flush current
                if !current.is_empty() {
                    spans.push(Span::raw(std::mem::take(&mut current)));
                }

                // Check for true/false/null
                let mut keyword = String::from(ch);
                while let Some(&c) = chars.peek() {
                    if c.is_alphabetic() {
                        keyword.push(chars.next().unwrap());
                    } else {
                        break;
                    }
                }

                if keyword == "true" || keyword == "false" || keyword == "null" {
                    spans.push(Span::styled(keyword, Style::default().fg(Color::Magenta)));
                } else {
                    current.push_str(&keyword);
                }
            }
            '{' | '}' | '[' | ']' | ':' | ',' => {
                // Flush current
                if !current.is_empty() {
                    spans.push(Span::raw(std::mem::take(&mut current)));
                }
                spans.push(Span::styled(
                    ch.to_string(),
                    Style::default().fg(Color::White),
                ));
            }
            _ => {
                current.push(ch);
            }
        }
    }

    // Flush remaining
    if !current.is_empty() {
        spans.push(Span::raw(current));
    }

    Line::from(spans)
}
