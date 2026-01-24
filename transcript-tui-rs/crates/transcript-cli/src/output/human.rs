//! Human-readable output formatting

use super::colors::*;
use transcript_core::{SessionInfo, TranscriptLine};

/// Format a transcript line for human-readable output
pub fn format_line(line: &TranscriptLine, show_content: bool) -> String {
    let mut parts = Vec::new();

    // Line number and timestamp
    parts.push(format!(
        "{} {}",
        colored_line_num(line.line_number),
        colored_time(&line.timestamp)
    ));

    // Type indicator
    parts.push(format!("[{}]", colored_type(line.line_type)));

    // Model for assistant messages
    if let Some(model) = &line.model {
        parts.push(format!("({})", colored_model(model)));
    }

    // Turn info if available
    if let Some(turn_id) = &line.turn_id {
        if let Some(seq) = line.turn_sequence {
            let short_turn = turn_id.split(':').last().unwrap_or(turn_id);
            parts.push(format!("[T{}.{}]", short_turn, seq));
        }
    }

    let header = parts.join(" ");

    if show_content {
        if let Some(content) = &line.content {
            let indent = "  ";
            let formatted_content = content
                .lines()
                .map(|l| format!("{}{}", indent, l))
                .collect::<Vec<_>>()
                .join("\n");
            format!("{}\n{}", header, formatted_content)
        } else {
            header
        }
    } else {
        // Just preview
        let preview = line.preview(60);
        format!("{} {}", header, preview)
    }
}

/// Format a session for human-readable list output
pub fn format_session(session: &SessionInfo) -> String {
    let name = session
        .slug
        .as_deref()
        .unwrap_or_else(|| &session.session_id[..8]);

    let time = session
        .last_timestamp
        .as_deref()
        .map(|t| {
            // Extract date and time
            if let Some(t_pos) = t.find('T') {
                let date = &t[..t_pos];
                let time = t[t_pos + 1..].split('.').next().unwrap_or("??:??:??");
                format!("{} {}", date, time)
            } else {
                t.to_string()
            }
        })
        .unwrap_or_else(|| "unknown".to_string());

    format!(
        "{} {} lines  {}",
        colored_session(name),
        format_count(session.line_count),
        colored_time(&time)
    )
}

/// Format session info detail view
pub fn format_session_info(session: &SessionInfo) -> String {
    let mut lines = Vec::new();

    lines.push(format!(
        "{}: {}",
        label("Session ID"),
        value(&session.session_id)
    ));

    if let Some(slug) = &session.slug {
        lines.push(format!("{}: {}", label("Slug"), colored_session(slug)));
    }

    lines.push(format!("{}: {}", label("File"), value(&session.file_path)));
    lines.push(format!(
        "{}: {}",
        label("Lines"),
        value(&format_count(session.line_count))
    ));

    if let Some(first) = &session.first_timestamp {
        lines.push(format!("{}: {}", label("Started"), value(first)));
    }

    if let Some(last) = &session.last_timestamp {
        lines.push(format!("{}: {}", label("Last activity"), value(last)));
    }

    lines.push(format!(
        "{}: {}",
        label("Indexed at"),
        value(&session.indexed_at)
    ));

    lines.join("\n")
}
