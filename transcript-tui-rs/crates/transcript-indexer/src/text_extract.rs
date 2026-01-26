//! Extract searchable text from parsed transcript entries
//!
//! Ported from TypeScript `extractTextFromParsed` in db.ts

use serde_json::Value;

/// Extract searchable text from a parsed transcript JSON entry
///
/// Handles:
/// - `message.content` (string or array of content blocks)
///   - text blocks -> text field
///   - tool_use blocks -> name + input fields (< 500 chars)
///   - tool_result blocks -> first 1000 chars of content
/// - `summary` field
/// - `data.text` field
pub fn extract_searchable_text(parsed: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Extract from message.content
    if let Some(message) = parsed.get("message") {
        if let Some(content) = message.get("content") {
            match content {
                Value::String(s) => {
                    parts.push(s.clone());
                }
                Value::Array(blocks) => {
                    for block in blocks {
                        if let Some(block_obj) = block.as_object() {
                            match block_obj.get("type").and_then(|t| t.as_str()) {
                                Some("text") => {
                                    if let Some(text) = block_obj.get("text").and_then(|t| t.as_str()) {
                                        parts.push(text.to_string());
                                    }
                                }
                                Some("tool_use") => {
                                    if let Some(name) = block_obj.get("name").and_then(|n| n.as_str()) {
                                        parts.push(format!("[Tool: {}]", name));
                                    }
                                    if let Some(input) = block_obj.get("input").and_then(|i| i.as_object()) {
                                        for (key, value) in input {
                                            if let Some(s) = value.as_str() {
                                                if s.len() < 500 {
                                                    parts.push(format!("{}: {}", key, s));
                                                }
                                            }
                                        }
                                    }
                                }
                                Some("tool_result") => {
                                    if let Some(content_str) = block_obj.get("content").and_then(|c| c.as_str()) {
                                        // Limit tool results to ~1000 chars (truncate at char boundary)
                                        let truncated = truncate_at_char_boundary(content_str, 1000);
                                        parts.push(truncated.to_string());
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    // Extract from summary
    if let Some(summary) = parsed.get("summary").and_then(|s| s.as_str()) {
        parts.push(summary.to_string());
    }

    // Extract from data.text
    if let Some(data) = parsed.get("data") {
        if let Some(text) = data.get("text").and_then(|t| t.as_str()) {
            parts.push(text.to_string());
        }
    }

    parts.join("\n")
}

/// Truncate a string at the nearest char boundary at or before `max_bytes`
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    // Find the nearest char boundary at or before max_bytes
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_string_content() {
        let parsed = json!({
            "message": {
                "content": "Hello world"
            }
        });
        assert_eq!(extract_searchable_text(&parsed), "Hello world");
    }

    #[test]
    fn test_extract_text_block() {
        let parsed = json!({
            "message": {
                "content": [
                    {"type": "text", "text": "Some text here"}
                ]
            }
        });
        assert_eq!(extract_searchable_text(&parsed), "Some text here");
    }

    #[test]
    fn test_extract_tool_use_block() {
        let parsed = json!({
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "Bash",
                        "input": {
                            "command": "ls -la",
                            "description": "List files"
                        }
                    }
                ]
            }
        });
        let result = extract_searchable_text(&parsed);
        assert!(result.contains("[Tool: Bash]"));
        assert!(result.contains("command: ls -la"));
        assert!(result.contains("description: List files"));
    }

    #[test]
    fn test_extract_tool_result_truncated() {
        let long_content = "x".repeat(2000);
        let parsed = json!({
            "message": {
                "content": [
                    {"type": "tool_result", "content": long_content}
                ]
            }
        });
        let result = extract_searchable_text(&parsed);
        assert_eq!(result.len(), 1000);
    }

    #[test]
    fn test_extract_summary() {
        let parsed = json!({
            "summary": "This is a summary"
        });
        assert_eq!(extract_searchable_text(&parsed), "This is a summary");
    }

    #[test]
    fn test_extract_data_text() {
        let parsed = json!({
            "data": {"text": "Data text content"}
        });
        assert_eq!(extract_searchable_text(&parsed), "Data text content");
    }

    #[test]
    fn test_extract_combined() {
        let parsed = json!({
            "message": {"content": "Hello"},
            "summary": "World"
        });
        assert_eq!(extract_searchable_text(&parsed), "Hello\nWorld");
    }

    #[test]
    fn test_extract_empty() {
        let parsed = json!({});
        assert_eq!(extract_searchable_text(&parsed), "");
    }

    #[test]
    fn test_extract_skips_long_input_values() {
        let long_value = "x".repeat(600);
        let parsed = json!({
            "message": {
                "content": [
                    {
                        "type": "tool_use",
                        "name": "Read",
                        "input": {
                            "short": "ok",
                            "long": long_value
                        }
                    }
                ]
            }
        });
        let result = extract_searchable_text(&parsed);
        assert!(result.contains("[Tool: Read]"));
        assert!(result.contains("short: ok"));
        assert!(!result.contains(&long_value));
    }
}
