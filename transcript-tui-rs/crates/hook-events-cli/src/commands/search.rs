//! Search across hook events

use anyhow::Result;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{colors, human, json};

pub fn run(cli: &Cli, db: &TranscriptDb, query: &str, limit: i64) -> Result<()> {
    let events = db.search_hook_events(query, limit)?;

    if events.is_empty() {
        println!("No results found for \"{}\"", query);
        return Ok(());
    }

    let format = cli.effective_format();
    let use_color = cli.use_color();

    if format == OutputFormat::Json {
        for event in &events {
            println!("{}", json::format_event(event, cli.pretty));
        }
        return Ok(());
    }

    println!("Found {} result(s) for \"{}\":\n", events.len(), query);

    for event in &events {
        match format {
            OutputFormat::Minimal => {
                // Include session short ID in search results
                let session_short = if event.session_id.len() > 8 {
                    &event.session_id[..8]
                } else {
                    &event.session_id
                };
                let tool_info = event
                    .tool_name
                    .as_deref()
                    .map(|t| format!(" [{}]", t))
                    .unwrap_or_default();
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
                let date = colors::format_date(&event.timestamp);

                println!(
                    "[{}] {}{}{} - {}",
                    session_short, event.event_type, tool_info, usage_str, date
                );
            }
            OutputFormat::Human => {
                let session_short = if event.session_id.len() > 8 {
                    &event.session_id[..8]
                } else {
                    &event.session_id
                };

                if use_color {
                    print!("[{}] ", colors::label(session_short));
                } else {
                    print!("[{}] ", session_short);
                }
                println!("{}", human::format_event(event, use_color));
                println!();
            }
            OutputFormat::Json => unreachable!(),
        }
    }

    Ok(())
}
