//! List command - show recent sessions

use anyhow::Result;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{human, json, minimal};

pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    limit: i64,
    days: Option<i64>,
    search: Option<&str>,
) -> Result<()> {
    let sessions = if let Some(pattern) = search {
        // Search for sessions matching pattern
        db.find_sessions(pattern)?
    } else {
        // Get recent sessions
        db.get_sessions(days)?
    };

    // Limit results
    let sessions: Vec<_> = sessions.into_iter().take(limit as usize).collect();

    match cli.effective_format() {
        OutputFormat::Human => {
            if sessions.is_empty() {
                println!("No sessions found");
            } else {
                println!(
                    "{}",
                    crate::output::colors::header(&format!("Sessions ({})", sessions.len()))
                );
                println!();
                for session in &sessions {
                    println!("{}", human::format_session(session));
                }
            }
        }
        OutputFormat::Json => {
            // Output as JSON array to match TS CLI format
            let json_array: Vec<serde_json::Value> = sessions
                .iter()
                .map(|s| json::session_to_json(s))
                .collect();

            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&json_array).unwrap_or_default());
            } else {
                println!("{}", serde_json::to_string(&json_array).unwrap_or_default());
            }
        }
        OutputFormat::Minimal => {
            for session in &sessions {
                println!("{}", minimal::format_session(session));
            }
        }
    }

    Ok(())
}
