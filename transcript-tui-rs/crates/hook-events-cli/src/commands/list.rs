//! List sessions with hook events

use anyhow::Result;
use serde_json::json;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    recent_days: Option<i64>,
    names_only: bool,
) -> Result<()> {
    let sessions = db.get_hook_sessions(recent_days, names_only)?;

    if sessions.is_empty() {
        println!("No hook event sessions found.");
        return Ok(());
    }

    let format = cli.effective_format();
    let use_color = cli.use_color();

    if format == OutputFormat::Json {
        let json_sessions: Vec<_> = sessions
            .iter()
            .map(|s| {
                json!({
                    "sessionId": s.session_id,
                    "filePath": s.file_path,
                    "eventCount": s.event_count,
                    "firstTimestamp": s.first_timestamp,
                    "lastTimestamp": s.last_timestamp,
                    "indexedAt": s.indexed_at,
                    "sessionName": s.session_name,
                })
            })
            .collect();

        if cli.pretty {
            println!("{}", serde_json::to_string_pretty(&json_sessions)?);
        } else {
            println!("{}", serde_json::to_string(&json_sessions)?);
        }
        return Ok(());
    }

    if names_only {
        for session in &sessions {
            println!("{}", session.session_id);
        }
        return Ok(());
    }

    // Table format
    if use_color {
        println!(
            "{}",
            colors::header("SESSION ID                             EVENTS   NAME             LAST MODIFIED")
        );
    } else {
        println!("SESSION ID                             EVENTS   NAME             LAST MODIFIED");
    }
    println!("{}", "-".repeat(85));

    for session in &sessions {
        let id = if session.session_id.len() > 36 {
            format!("{}...", &session.session_id[..33])
        } else {
            format!("{:<36}", session.session_id)
        };
        let events = format!("{:>6}", session.event_count);
        let name = session
            .session_name
            .as_deref()
            .unwrap_or("-");
        let name_col = format!("{:<16}", if name.len() > 16 {
            format!("{}...", &name[..13])
        } else {
            name.to_string()
        });
        let date = session
            .last_timestamp
            .as_deref()
            .map(|ts| colors::format_date(ts))
            .unwrap_or_else(|| "-".to_string());

        if use_color {
            println!(
                "{} {} {} {}",
                id,
                events,
                colors::colored_session(&name_col),
                date
            );
        } else {
            println!("{} {} {} {}", id, events, name_col, date);
        }
    }

    println!("\nTotal: {} session(s)", sessions.len());
    Ok(())
}
