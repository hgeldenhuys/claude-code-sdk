//! ANSI color helpers for terminal output

use colored::Colorize;
use transcript_core::LineType;

/// Get colored line type indicator
pub fn colored_type(line_type: LineType) -> String {
    match line_type {
        LineType::User => "user".cyan().to_string(),
        LineType::Assistant => "assistant".green().to_string(),
        LineType::System => "system".yellow().to_string(),
        LineType::Summary => "summary".magenta().to_string(),
        LineType::Progress => "progress".blue().to_string(),
        LineType::FileHistorySnapshot => "file-history".white().dimmed().to_string(),
        LineType::Unknown => "unknown".white().dimmed().to_string(),
    }
}

/// Get colored timestamp
pub fn colored_time(timestamp: &str) -> String {
    // Extract time portion (HH:MM:SS) from ISO timestamp
    let time = if let Some(t_pos) = timestamp.find('T') {
        let time_part = &timestamp[t_pos + 1..];
        time_part.split('.').next().unwrap_or(time_part)
    } else {
        timestamp
    };
    time.white().dimmed().to_string()
}

/// Get colored session name
pub fn colored_session(name: &str) -> String {
    name.cyan().bold().to_string()
}

/// Get colored model name
pub fn colored_model(model: &str) -> String {
    if model.contains("opus") {
        model.magenta().to_string()
    } else if model.contains("sonnet") {
        model.blue().to_string()
    } else if model.contains("haiku") {
        model.green().to_string()
    } else {
        model.white().to_string()
    }
}

/// Get colored line number
pub fn colored_line_num(num: i64) -> String {
    format!("{:>5}", num).white().dimmed().to_string()
}

/// Get colored header
pub fn header(text: &str) -> String {
    text.bold().underline().to_string()
}

/// Get colored label
pub fn label(text: &str) -> String {
    text.white().dimmed().to_string()
}

/// Get colored value
pub fn value(text: &str) -> String {
    text.white().to_string()
}

/// Get colored success message
pub fn success(text: &str) -> String {
    format!("{} {}", "✓".green(), text)
}

/// Get colored warning message
pub fn warning(text: &str) -> String {
    format!("{} {}", "⚠".yellow(), text)
}

/// Get colored error message
pub fn error(text: &str) -> String {
    format!("{} {}", "✗".red(), text)
}

/// Format size in human-readable form
pub fn format_size(bytes: u64) -> String {
    let bytes = bytes as f64;
    if bytes < 1024.0 {
        format!("{:.0} B", bytes)
    } else if bytes < 1024.0 * 1024.0 {
        format!("{:.1} KB", bytes / 1024.0)
    } else if bytes < 1024.0 * 1024.0 * 1024.0 {
        format!("{:.1} MB", bytes / (1024.0 * 1024.0))
    } else {
        format!("{:.1} GB", bytes / (1024.0 * 1024.0 * 1024.0))
    }
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
