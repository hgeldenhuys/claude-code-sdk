//! Content trimmer for transcript and hook event indexing.
//!
//! Deep-walks `serde_json::Value` trees and trims large string leaves to
//! previews. Full content remains accessible in original JSONL files via
//! `file_path` + `line_number`.
//!
//! Design rules:
//! - TodoWrite and Task tool inputs are preserved in full (they carry semantics)
//! - `prompt` field values are never trimmed (user input must be searchable)
//! - Trimmed strings get suffix: ` [trimmed from N chars]`
//! - JSON structure is always preserved

use serde_json::Value;

/// Maximum length of a trimmed preview
const PREVIEW_LENGTH: usize = 500;

/// Strings longer than this are candidates for trimming
const LARGE_THRESHOLD: usize = 1024;

/// Handler results use a higher threshold (they're usually small)
const HANDLER_THRESHOLD: usize = 4096;

/// Tools whose `input` should be preserved in full
const FULL_PAYLOAD_TOOLS: &[&str] = &["TodoWrite", "Task"];

/// Field names whose string values should never be trimmed
const FULL_PAYLOAD_FIELDS: &[&str] = &["prompt"];

/// Truncate a string at a char boundary, ensuring we don't split a multi-byte
/// character. Returns at most `max_len` bytes worth of complete characters.
fn truncate_at_char_boundary(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        return s;
    }
    // Walk backwards from max_len to find a valid char boundary
    let mut end = max_len;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Deep-walk a `serde_json::Value`, trimming string leaves that exceed
/// `threshold` bytes. Field names in `FULL_PAYLOAD_FIELDS` are never trimmed.
/// JSON structure (objects, arrays) is always preserved.
fn trim_value(value: &Value, threshold: usize) -> Value {
    match value {
        Value::String(s) => {
            if s.len() > threshold {
                let preview = truncate_at_char_boundary(s, PREVIEW_LENGTH);
                Value::String(format!("{} [trimmed from {} chars]", preview, s.len()))
            } else {
                value.clone()
            }
        }
        Value::Object(map) => {
            let mut new_map = serde_json::Map::with_capacity(map.len());
            for (key, val) in map {
                if FULL_PAYLOAD_FIELDS.contains(&key.as_str()) {
                    // Never trim protected fields
                    new_map.insert(key.clone(), val.clone());
                } else {
                    new_map.insert(key.clone(), trim_value(val, threshold));
                }
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => {
            let new_arr: Vec<Value> = arr.iter().map(|v| trim_value(v, threshold)).collect();
            Value::Array(new_arr)
        }
        // Numbers, booleans, null pass through unchanged
        _ => value.clone(),
    }
}

/// Trim hook event `input` JSON.
///
/// If `tool_name` is in `FULL_PAYLOAD_TOOLS`, returns full serialization.
/// Otherwise deep-walks and trims large strings at `LARGE_THRESHOLD`.
pub fn trim_input_json(input: &Value, tool_name: &str) -> String {
    if FULL_PAYLOAD_TOOLS.contains(&tool_name) {
        // Preserve full payload for TodoWrite, Task, etc.
        serde_json::to_string(input).unwrap_or_default()
    } else {
        let trimmed = trim_value(input, LARGE_THRESHOLD);
        serde_json::to_string(&trimmed).unwrap_or_default()
    }
}

/// Trim hook event `context` JSON. Always trims large strings.
pub fn trim_context_json(context: &Value) -> String {
    let trimmed = trim_value(context, LARGE_THRESHOLD);
    serde_json::to_string(&trimmed).unwrap_or_default()
}

/// Trim handler results JSON. Uses higher threshold (4KB) since handler
/// results are usually small structured data.
pub fn trim_handler_results(results: &Value) -> String {
    let trimmed = trim_value(results, HANDLER_THRESHOLD);
    serde_json::to_string(&trimmed).unwrap_or_default()
}

/// Trim a raw transcript JSONL line (parsed Value).
///
/// Deep-walks and trims large strings in message content, tool inputs, etc.
/// This is used for the `raw` column in the `lines` table.
pub fn trim_raw_transcript_line(parsed: &Value) -> String {
    let trimmed = trim_value(parsed, LARGE_THRESHOLD);
    serde_json::to_string(&trimmed).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_short_strings_pass_through() {
        let val = json!({"command": "ls -la", "path": "/tmp"});
        let trimmed = trim_value(&val, LARGE_THRESHOLD);
        assert_eq!(val, trimmed);
    }

    #[test]
    fn test_large_strings_are_trimmed() {
        let big = "x".repeat(2000);
        let val = json!({"stdout": big});
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        let stdout = trimmed.get("stdout").unwrap().as_str().unwrap();
        assert!(stdout.contains("[trimmed from 2000 chars]"));
        assert!(stdout.len() < 600); // preview + marker
    }

    #[test]
    fn test_prompt_field_never_trimmed() {
        let big_prompt = "x".repeat(5000);
        let val = json!({"prompt": big_prompt, "other": big_prompt.clone()});
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        // prompt should be preserved
        let prompt = trimmed.get("prompt").unwrap().as_str().unwrap();
        assert_eq!(prompt.len(), 5000);

        // other should be trimmed
        let other = trimmed.get("other").unwrap().as_str().unwrap();
        assert!(other.contains("[trimmed from 5000 chars]"));
    }

    #[test]
    fn test_nested_objects_are_walked() {
        let big = "y".repeat(2000);
        let val = json!({
            "input": {
                "command": "echo hello",
                "nested": {
                    "deep": big
                }
            }
        });
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        let deep = trimmed
            .get("input")
            .unwrap()
            .get("nested")
            .unwrap()
            .get("deep")
            .unwrap()
            .as_str()
            .unwrap();
        assert!(deep.contains("[trimmed from 2000 chars]"));

        // Short string preserved
        let cmd = trimmed
            .get("input")
            .unwrap()
            .get("command")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(cmd, "echo hello");
    }

    #[test]
    fn test_arrays_are_walked() {
        let big = "z".repeat(2000);
        let val = json!([{"text": big}, {"text": "short"}]);
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        let arr = trimmed.as_array().unwrap();
        assert!(arr[0].get("text").unwrap().as_str().unwrap().contains("[trimmed"));
        assert_eq!(arr[1].get("text").unwrap().as_str().unwrap(), "short");
    }

    #[test]
    fn test_full_payload_tools_preserved() {
        let big = "t".repeat(5000);
        let input = json!({"todos": [{"subject": big}]});

        // TodoWrite should keep everything
        let result = trim_input_json(&input, "TodoWrite");
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let subject = parsed
            .get("todos")
            .unwrap()
            .as_array()
            .unwrap()[0]
            .get("subject")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(subject.len(), 5000);

        // Bash should trim
        let result = trim_input_json(&input, "Bash");
        let parsed: Value = serde_json::from_str(&result).unwrap();
        let subject = parsed
            .get("todos")
            .unwrap()
            .as_array()
            .unwrap()[0]
            .get("subject")
            .unwrap()
            .as_str()
            .unwrap();
        assert!(subject.contains("[trimmed"));
    }

    #[test]
    fn test_handler_results_higher_threshold() {
        let medium = "h".repeat(2000); // > 1KB but < 4KB
        let big = "h".repeat(5000);    // > 4KB

        let val = json!({"turn-tracker": {"data": medium, "big": big}});

        let result = trim_handler_results(&val);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // Medium should pass through (under 4KB handler threshold)
        let data = parsed
            .get("turn-tracker")
            .unwrap()
            .get("data")
            .unwrap()
            .as_str()
            .unwrap();
        assert_eq!(data.len(), 2000);

        // Big should be trimmed
        let big_val = parsed
            .get("turn-tracker")
            .unwrap()
            .get("big")
            .unwrap()
            .as_str()
            .unwrap();
        assert!(big_val.contains("[trimmed from 5000 chars]"));
    }

    #[test]
    fn test_context_json_always_trims() {
        let big = "c".repeat(2000);
        let val = json!({"cwd": "/tmp", "usage": big});

        let result = trim_context_json(&val);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed.get("cwd").unwrap().as_str().unwrap(), "/tmp");
        assert!(parsed.get("usage").unwrap().as_str().unwrap().contains("[trimmed"));
    }

    #[test]
    fn test_trim_raw_transcript_line() {
        let big = "r".repeat(3000);
        let val = json!({
            "sessionId": "sess-1",
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "hello"},
                    {"type": "tool_result", "content": big}
                ]
            }
        });

        let result = trim_raw_transcript_line(&val);
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // sessionId preserved (short)
        assert_eq!(parsed.get("sessionId").unwrap().as_str().unwrap(), "sess-1");

        // Large tool_result content trimmed
        let content = parsed
            .get("message")
            .unwrap()
            .get("content")
            .unwrap()
            .as_array()
            .unwrap();
        let tool_result = content[1].get("content").unwrap().as_str().unwrap();
        assert!(tool_result.contains("[trimmed from 3000 chars]"));

        // Short text preserved
        let text = content[0].get("text").unwrap().as_str().unwrap();
        assert_eq!(text, "hello");
    }

    #[test]
    fn test_truncate_at_char_boundary() {
        // ASCII
        assert_eq!(truncate_at_char_boundary("hello world", 5), "hello");

        // Multi-byte: a 2-byte char at position 5 shouldn't be split
        let s = "hell\u{00f6} world"; // 'o' with umlaut is 2 bytes
        let result = truncate_at_char_boundary(s, 5);
        assert!(result.is_char_boundary(result.len()));

        // Empty string
        assert_eq!(truncate_at_char_boundary("", 10), "");

        // String shorter than max
        assert_eq!(truncate_at_char_boundary("hi", 10), "hi");
    }

    #[test]
    fn test_numbers_booleans_null_preserved() {
        let val = json!({"count": 42, "enabled": true, "data": null, "big": "x".repeat(2000)});
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        assert_eq!(trimmed.get("count").unwrap(), &json!(42));
        assert_eq!(trimmed.get("enabled").unwrap(), &json!(true));
        assert!(trimmed.get("data").unwrap().is_null());
        assert!(trimmed.get("big").unwrap().as_str().unwrap().contains("[trimmed"));
    }

    #[test]
    fn test_string_exactly_at_threshold_not_trimmed() {
        let exact = "x".repeat(LARGE_THRESHOLD);
        let val = json!({"field": exact});
        let trimmed = trim_value(&val, LARGE_THRESHOLD);

        // Exactly at threshold should NOT be trimmed (> threshold, not >=)
        let field = trimmed.get("field").unwrap().as_str().unwrap();
        assert!(!field.contains("[trimmed"));
        assert_eq!(field.len(), LARGE_THRESHOLD);
    }

    #[test]
    fn test_task_tool_preserved() {
        let big = "t".repeat(5000);
        let input = json!({"description": big, "prompt": "do stuff"});

        let result = trim_input_json(&input, "Task");
        let parsed: Value = serde_json::from_str(&result).unwrap();

        // Both fields preserved for Task tool
        assert_eq!(
            parsed.get("description").unwrap().as_str().unwrap().len(),
            5000
        );
    }
}
