//! JSON output formatting for hook events

use serde_json::json;
use transcript_core::HookEvent;

/// Format a hook event as JSON
pub fn format_event(event: &HookEvent, pretty: bool) -> String {
    let mut obj = json!({
        "id": event.id,
        "sessionId": event.session_id,
        "timestamp": event.timestamp,
        "eventType": event.event_type,
        "toolName": event.tool_name,
        "decision": event.decision,
        "lineNumber": event.line_number,
    });

    // Add context usage
    if let Some((tokens, pct)) = event.context_usage() {
        obj["contextUsage"] = json!({
            "tokens": tokens,
            "percentage": pct,
        });
    }

    // Parse and include input_json
    if let Some(ref input_str) = event.input_json {
        if let Ok(input) = serde_json::from_str::<serde_json::Value>(input_str) {
            obj["input"] = input;
        } else {
            obj["inputJson"] = json!(input_str);
        }
    }

    // Parse and include context_json
    if let Some(ref ctx_str) = event.context_json {
        if let Ok(ctx) = serde_json::from_str::<serde_json::Value>(ctx_str) {
            obj["context"] = ctx;
        } else {
            obj["contextJson"] = json!(ctx_str);
        }
    }

    // Parse and include handler_results
    if let Some(ref hr_str) = event.handler_results_json {
        if let Ok(hr) = serde_json::from_str::<serde_json::Value>(hr_str) {
            obj["handlerResults"] = hr;
        } else {
            obj["handlerResults"] = json!(hr_str);
        }
    }

    // Turn tracking
    if event.turn_id.is_some() || event.session_name.is_some() {
        obj["turnId"] = json!(event.turn_id);
        obj["turnSequence"] = json!(event.turn_sequence);
        obj["sessionName"] = json!(event.session_name);
    }

    // Git tracking
    if event.git_hash.is_some() {
        obj["gitHash"] = json!(event.git_hash);
        obj["gitBranch"] = json!(event.git_branch);
        obj["gitDirty"] = json!(event.git_dirty);
    }

    if pretty {
        serde_json::to_string_pretty(&obj).unwrap_or_else(|_| format!("{:?}", event))
    } else {
        serde_json::to_string(&obj).unwrap_or_else(|_| format!("{:?}", event))
    }
}
