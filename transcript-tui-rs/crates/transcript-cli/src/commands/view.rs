//! View command - display transcript lines

use anyhow::{bail, Result};
use transcript_db::{GetLinesOptions, LineOrder, TranscriptDb};

use crate::cli::{Cli, OutputFormat};
use crate::output::{human, json, minimal};

#[allow(clippy::too_many_arguments)]
pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    session: &str,
    types: Option<&[String]>,
    last: Option<i64>,
    first: Option<i64>,
    search: Option<&str>,
    from_time: Option<&str>,
    to_time: Option<&str>,
    from_line: Option<i64>,
    to_line: Option<i64>,
    reverse: bool,
) -> Result<()> {
    // Resolve session ID from name/slug
    let session_info = db.resolve_session(session)?;
    let session_id = match session_info {
        Some(info) => info.session_id,
        None => {
            // Try partial match
            let matches = db.find_sessions(session)?;
            if matches.is_empty() {
                bail!("Session not found: {}", session);
            } else if matches.len() == 1 {
                matches[0].session_id.clone()
            } else {
                eprintln!("Multiple sessions match '{}':", session);
                for m in &matches {
                    let name = m.slug.as_deref().unwrap_or(&m.session_id);
                    eprintln!("  - {}", name);
                }
                bail!("Please specify a more specific session name");
            }
        }
    };

    // Build query options
    let mut options = GetLinesOptions::for_session(&session_id);

    if let Some(t) = types {
        options.types = Some(t.to_vec());
    }

    if let Some(s) = search {
        options.search = Some(s.to_string());
    }

    if let Some(t) = from_time {
        options.from_time = Some(normalize_time(t));
    }

    if let Some(t) = to_time {
        options.to_time = Some(normalize_time(t));
    }

    if let Some(n) = from_line {
        options.from_line = Some(n);
    }

    if let Some(n) = to_line {
        options.to_line = Some(n);
    }

    // Handle first/last
    if let Some(n) = last {
        options.order = LineOrder::Desc;
        options.limit = Some(n);
    } else if let Some(n) = first {
        options.order = LineOrder::Asc;
        options.limit = Some(n);
    } else if reverse {
        options.order = LineOrder::Desc;
    }

    // Fetch lines
    let mut lines = db.get_lines(&options)?;

    // If we used DESC for --last, reverse to show in chronological order
    if last.is_some() && !reverse {
        lines.reverse();
    }

    // Output based on format
    for line in &lines {
        match cli.format {
            OutputFormat::Human => {
                println!("{}", human::format_line(line, true));
                println!(); // Blank line between entries
            }
            OutputFormat::Json => {
                println!("{}", json::format_line(line));
            }
            OutputFormat::Minimal => {
                let content = minimal::format_line(line);
                if !content.is_empty() {
                    println!("{}", content);
                }
            }
        }
    }

    if lines.is_empty() {
        eprintln!("No lines found matching criteria");
    }

    Ok(())
}

/// Normalize time string to ISO format
fn normalize_time(time: &str) -> String {
    // If it looks like just a time (HH:MM:SS), prefix with today's date
    if time.len() <= 8 && time.contains(':') && !time.contains('T') {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        format!("{}T{}", today, time)
    } else {
        time.to_string()
    }
}
