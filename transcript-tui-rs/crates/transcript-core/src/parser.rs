//! JSONL parsing utilities for transcript files

use crate::types::{LineType, ParsedLine, TranscriptLine};
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Parse a single JSONL line into a TranscriptLine
pub fn parse_line(raw: &str, line_number: i64, id: i64) -> Option<TranscriptLine> {
    let parsed: ParsedLine = serde_json::from_str(raw).ok()?;

    let line_type = match parsed.r#type.as_deref() {
        Some("user") => LineType::User,
        Some("assistant") => LineType::Assistant,
        Some("system") => LineType::System,
        Some("summary") => LineType::Summary,
        Some("progress") => LineType::Progress,
        Some("file-history-snapshot") => LineType::FileHistorySnapshot,
        _ => LineType::Unknown,
    };

    // Extract content from message
    let content = if let Some(msg) = &parsed.message {
        Some(msg.content.as_text())
    } else if let Some(summary) = &parsed.summary {
        Some(summary.clone())
    } else {
        None
    };

    let role = parsed.message.as_ref().map(|m| m.role.clone());
    let model = parsed.message.as_ref().and_then(|m| m.model.clone());

    Some(TranscriptLine {
        id,
        line_number,
        line_type,
        uuid: parsed.uuid.unwrap_or_default(),
        parent_uuid: parsed.parent_uuid,
        session_id: parsed.session_id.unwrap_or_default(),
        timestamp: parsed.timestamp.unwrap_or_default(),
        cwd: parsed.cwd,
        slug: parsed.slug,
        role,
        model,
        content,
        raw: raw.to_string(),
        turn_id: None,
        turn_sequence: None,
        session_name: None,
    })
}

/// Parse a JSONL file into transcript lines
pub fn parse_file<P: AsRef<Path>>(path: P) -> std::io::Result<Vec<TranscriptLine>> {
    let file = std::fs::File::open(path)?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    let mut line_number = 1i64;
    let mut id = 1i64;

    for line_result in reader.lines() {
        let raw = line_result?;
        if !raw.trim().is_empty() {
            if let Some(line) = parse_line(&raw, line_number, id) {
                lines.push(line);
                id += 1;
            }
        }
        line_number += 1;
    }

    Ok(lines)
}

/// Extract searchable text from a transcript line
pub fn extract_text(line: &TranscriptLine) -> String {
    let mut parts = Vec::new();

    if let Some(content) = &line.content {
        parts.push(content.clone());
    }

    // Parse raw JSON for additional content
    if let Ok(parsed) = line.parse() {
        // Tool use inputs
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                parts.push(format!("[Tool: {}]", name));
                if let Some(obj) = input.as_object() {
                    for (key, value) in obj {
                        if let Some(s) = value.as_str() {
                            if s.len() < 500 {
                                parts.push(format!("{}: {}", key, s));
                            }
                        }
                    }
                }
            }
        }

        // Summary text
        if let Some(summary) = &parsed.summary {
            parts.push(summary.clone());
        }
    }

    parts.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_user_line() {
        let raw = r#"{"type":"user","uuid":"abc","sessionId":"123","timestamp":"2024-01-01T00:00:00Z","message":{"role":"user","content":"Hello"}}"#;
        let line = parse_line(raw, 1, 1).unwrap();
        assert_eq!(line.line_type, LineType::User);
        assert_eq!(line.content, Some("Hello".to_string()));
    }

    #[test]
    fn test_parse_assistant_line() {
        let raw = r#"{"type":"assistant","uuid":"def","sessionId":"123","timestamp":"2024-01-01T00:00:01Z","message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}]}}"#;
        let line = parse_line(raw, 2, 2).unwrap();
        assert_eq!(line.line_type, LineType::Assistant);
        assert_eq!(line.content, Some("Hi there!".to_string()));
    }
}
