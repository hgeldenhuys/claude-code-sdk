//! Color helpers for hook event output

use colored::Colorize;

/// Get colored event type
pub fn colored_event_type(event_type: &str) -> String {
    match event_type {
        "UserPromptSubmit" | "UserPromptSubmitHook" => event_type.green().to_string(),
        "PreToolUse" | "PreSubagentToolUse" => event_type.yellow().to_string(),
        "PostToolUse" | "PostSubagentToolUse" => event_type.cyan().to_string(),
        "SessionStart" => event_type.magenta().to_string(),
        "SessionEnd" | "Stop" | "SubagentStop" => event_type.red().to_string(),
        _ => event_type.white().to_string(),
    }
}

/// Get colored abbreviated event type
pub fn colored_event_abbrev(abbrev: &str, full_type: &str) -> String {
    match full_type {
        "UserPromptSubmit" | "UserPromptSubmitHook" => abbrev.green().to_string(),
        "PreToolUse" | "PreSubagentToolUse" => abbrev.yellow().to_string(),
        "PostToolUse" | "PostSubagentToolUse" => abbrev.cyan().to_string(),
        "SessionStart" => abbrev.magenta().to_string(),
        "SessionEnd" | "Stop" | "SubagentStop" => abbrev.red().to_string(),
        _ => abbrev.white().to_string(),
    }
}

/// Get colored tool name
pub fn colored_tool(name: &str) -> String {
    name.bright_white().to_string()
}

/// Get colored timestamp
pub fn colored_time(time: &str) -> String {
    time.white().dimmed().to_string()
}

/// Get colored context usage percentage
pub fn colored_usage(pct: u8) -> String {
    let s = format!("[{}%]", pct);
    if pct <= 50 {
        s.green().to_string()
    } else if pct <= 70 {
        s.yellow().to_string()
    } else {
        s.red().to_string()
    }
}

/// Get colored session name
pub fn colored_session(name: &str) -> String {
    name.cyan().bold().to_string()
}

/// Get colored decision
pub fn colored_decision(decision: &str) -> String {
    match decision {
        "allow" => decision.green().to_string(),
        "block" => decision.red().bold().to_string(),
        _ => decision.yellow().to_string(),
    }
}

/// Format a header line
pub fn header(text: &str) -> String {
    text.bold().underline().to_string()
}

/// Format a label
pub fn label(text: &str) -> String {
    text.white().dimmed().to_string()
}

/// Format count with comma separators
pub fn format_count(n: i64) -> String {
    let s = n.to_string();
    let chars: Vec<char> = s.chars().collect();
    let mut result = String::new();
    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(*c);
    }
    result
}

/// Format date from ISO timestamp for display
pub fn format_date(timestamp: &str) -> String {
    // Parse ISO and format as "Jan 25, 14:30:02"
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(timestamp) {
        dt.format("%b %d, %H:%M:%S").to_string()
    } else if let Some(t_pos) = timestamp.find('T') {
        // Fallback: extract date and time parts
        let date_part = &timestamp[..t_pos];
        let time_part = timestamp[t_pos + 1..].split('.').next().unwrap_or("");
        format!("{} {}", date_part, time_part)
    } else {
        timestamp.to_string()
    }
}

/// Format time from ISO timestamp (HH:MM:SS)
pub fn format_time(timestamp: &str) -> String {
    if let Some(t_pos) = timestamp.find('T') {
        let time_part = &timestamp[t_pos + 1..];
        time_part.split('.').next().unwrap_or(time_part).to_string()
    } else {
        timestamp.to_string()
    }
}
