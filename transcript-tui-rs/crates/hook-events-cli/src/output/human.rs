//! Human-readable output formatting for hook events

use transcript_core::HookEvent;

use super::colors;

/// Format a hook event in human-readable format (multiline)
pub fn format_event(event: &HookEvent, use_color: bool) -> String {
    let mut lines = Vec::new();

    // Header: [HH:MM:SS] EventType [ToolName] -> decision
    let time = event.format_time();
    let tool_info = event
        .tool_name
        .as_deref()
        .map(|t| format!(" [{}]", if use_color { colors::colored_tool(t) } else { t.to_string() }))
        .unwrap_or_default();
    let decision_info = event
        .decision
        .as_deref()
        .map(|d| {
            format!(
                " -> {}",
                if use_color {
                    colors::colored_decision(d)
                } else {
                    d.to_string()
                }
            )
        })
        .unwrap_or_default();

    let event_str = if use_color {
        colors::colored_event_type(&event.event_type)
    } else {
        event.event_type.clone()
    };
    let time_str = if use_color {
        colors::colored_time(&time)
    } else {
        time
    };

    lines.push(format!(
        "[{}] {}{}{}",
        time_str, event_str, tool_info, decision_info
    ));

    // Context usage
    if let Some((tokens, pct)) = event.context_usage() {
        let usage_str = if use_color {
            format!("  Context: {} tokens {}", colors::format_count(tokens as i64), colors::colored_usage(pct))
        } else {
            format!("  Context: {} tokens [{}%]", tokens, pct)
        };
        lines.push(usage_str);
    }

    // Input preview
    if let Some(preview) = event.input_preview(100) {
        lines.push(format!("  Input: {}", preview));
    }

    // Output preview (PostToolUse only)
    if let Some(preview) = event.output_preview(80) {
        lines.push(format!("  Output: {}", preview));
    }

    // Turn/session info
    if let Some(ref turn_id) = event.turn_id {
        let seq = event.turn_sequence.unwrap_or(0);
        let session = event
            .session_name
            .as_deref()
            .unwrap_or("?");
        if use_color {
            lines.push(format!(
                "  Turn: {}-{}",
                seq,
                colors::colored_session(session)
            ));
        } else {
            lines.push(format!("  Turn: {}-{} ({})", seq, session, turn_id));
        }
    }

    lines.join("\n")
}

/// Format a hook event in minimal format (single line)
pub fn format_event_minimal(event: &HookEvent, use_color: bool) -> String {
    let time = event.format_time();
    let abbrev = event.event_abbrev();
    let tool = event.tool_name.as_deref().unwrap_or("");

    let event_str = if use_color {
        colors::colored_event_abbrev(abbrev, &event.event_type)
    } else {
        abbrev.to_string()
    };

    let tool_str = if use_color && !tool.is_empty() {
        colors::colored_tool(tool)
    } else {
        tool.to_string()
    };

    // Get input preview for the command column
    let preview = event
        .input_preview(30)
        .unwrap_or_default();

    let decision_info = match event.decision.as_deref() {
        Some(d) if d != "allow" => {
            if use_color {
                format!(" [{}]", colors::colored_decision(d))
            } else {
                format!(" [{}]", d)
            }
        }
        _ => String::new(),
    };

    let usage_str = event
        .context_usage()
        .map(|(_, pct)| {
            if use_color {
                format!(" {}", colors::colored_usage(pct))
            } else {
                format!(" [{}%]", pct)
            }
        })
        .unwrap_or_default();

    let turn_str = if let Some(seq) = event.turn_sequence {
        let session = event.session_name.as_deref().unwrap_or("?");
        if use_color {
            format!(" {}-{}", seq, colors::colored_session(session))
        } else {
            format!(" {}-{}", seq, session)
        }
    } else {
        String::new()
    };

    format!(
        "{} {:<7} {:<12} {}{}{}{}",
        time, event_str, tool_str, preview, decision_info, usage_str, turn_str
    )
}
