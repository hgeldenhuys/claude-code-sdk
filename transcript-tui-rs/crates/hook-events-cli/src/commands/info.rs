//! Show session statistics

use anyhow::{bail, Result};
use serde_json::json;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn run(cli: &Cli, db: &TranscriptDb, session: &str) -> Result<()> {
    let session_id = match db.resolve_hook_session(session)? {
        Some(id) => id,
        None => bail!(
            "No hook events found for session: {}\nTip: Use \".\" for most recent session",
            session
        ),
    };

    let info = match db.get_hook_session_info(&session_id)? {
        Some(info) => info,
        None => bail!("No hook events found for session: {}", session_id),
    };

    let format = cli.effective_format();
    let use_color = cli.use_color();

    if format == OutputFormat::Json {
        let obj = json!({
            "sessionId": info.session_id,
            "sessionName": info.session_name,
            "filePath": info.file_path,
            "totalEvents": info.total_events,
            "firstTimestamp": info.first_timestamp,
            "lastTimestamp": info.last_timestamp,
            "eventCounts": info.event_counts.iter()
                .map(|(k, v)| json!({ "type": k, "count": v }))
                .collect::<Vec<_>>(),
            "toolCounts": info.tool_counts.iter()
                .map(|(k, v)| json!({ "tool": k, "count": v }))
                .collect::<Vec<_>>(),
        });

        if cli.pretty {
            println!("{}", serde_json::to_string_pretty(&obj)?);
        } else {
            println!("{}", serde_json::to_string(&obj)?);
        }
        return Ok(());
    }

    // Human / Minimal output
    if use_color {
        println!("{}", colors::header("Hook Events Information"));
    } else {
        println!("Hook Events Information");
    }
    println!();

    println!("Session ID:     {}", info.session_id);
    if let Some(ref name) = info.session_name {
        if use_color {
            println!("Session Name:   {}", colors::colored_session(name));
        } else {
            println!("Session Name:   {}", name);
        }
    }
    println!("File:           {}", info.file_path);
    println!("Event Count:    {}", colors::format_count(info.total_events));
    if let Some(ref ts) = info.first_timestamp {
        println!("First Event:    {}", colors::format_date(ts));
    }
    if let Some(ref ts) = info.last_timestamp {
        println!("Last Event:     {}", colors::format_date(ts));
    }

    // Event type counts
    println!("\nEvent Types:");
    for (event_type, count) in &info.event_counts {
        if use_color {
            println!(
                "  {} {}",
                format!("{:<24}", colors::colored_event_type(event_type)),
                count
            );
        } else {
            println!("  {:<24} {}", event_type, count);
        }
    }

    // Tool counts
    if !info.tool_counts.is_empty() {
        println!("\nTool Usage:");
        for (tool, count) in &info.tool_counts {
            if use_color {
                println!(
                    "  {} {}",
                    format!("{:<24}", colors::colored_tool(tool)),
                    count
                );
            } else {
                println!("  {:<24} {}", tool, count);
            }
        }
    }

    Ok(())
}
