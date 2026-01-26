//! View hook events for a session

use anyhow::{bail, Result};
use transcript_core::{HookEventFilter, Order};
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{human, json};

pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    session: &str,
    event_types: Option<&[String]>,
    tool_names: Option<&[String]>,
    last: Option<i64>,
    first: Option<i64>,
    limit: Option<i64>,
    offset: Option<i64>,
    from_time: Option<&str>,
    to_time: Option<&str>,
    tail: bool,
    watch: bool,
) -> Result<()> {
    let session_id = match db.resolve_hook_session(session)? {
        Some(id) => id,
        None => bail!("No hook events found for session: {}\nTip: Use \".\" for most recent session, or provide a full session ID", session),
    };

    if tail {
        return tail_mode(cli, db, &session_id, event_types, tool_names);
    }

    if watch {
        return watch_mode(cli, db, &session_id, event_types, tool_names);
    }

    // Determine order and limit for --last / --first
    let (order, query_limit) = if let Some(n) = last {
        (Order::Desc, Some(n))
    } else if let Some(n) = first {
        (Order::Asc, Some(n))
    } else {
        (Order::Asc, limit)
    };

    let filter = HookEventFilter {
        session_id: Some(session_id),
        event_types: event_types.map(|v| v.to_vec()),
        tool_names: tool_names.map(|v| v.to_vec()),
        limit: query_limit.or(Some(100)),
        offset: offset,
        from_time: from_time.map(|s| s.to_string()),
        to_time: to_time.map(|s| s.to_string()),
        order,
    };

    let mut events = db.get_hook_events(&filter)?;

    // Reverse if we used desc for --last (so output is chronological)
    if last.is_some() {
        events.reverse();
    }

    if events.is_empty() {
        println!("No matching events found.");
        return Ok(());
    }

    let format = cli.effective_format();
    let use_color = cli.use_color();

    for event in &events {
        match format {
            OutputFormat::Json => {
                println!("{}", json::format_event(event, cli.pretty));
            }
            OutputFormat::Minimal => {
                println!("{}", human::format_event_minimal(event, use_color));
            }
            OutputFormat::Human => {
                println!("{}", human::format_event(event, use_color));
                println!();
            }
        }
    }

    Ok(())
}

fn tail_mode(
    cli: &Cli,
    db: &TranscriptDb,
    session_id: &str,
    event_types: Option<&[String]>,
    tool_names: Option<&[String]>,
) -> Result<()> {
    let format = cli.effective_format();
    let use_color = cli.use_color();

    // Print last 10 events first
    let filter = HookEventFilter {
        session_id: Some(session_id.to_string()),
        event_types: event_types.map(|v| v.to_vec()),
        tool_names: tool_names.map(|v| v.to_vec()),
        limit: Some(10),
        order: Order::Desc,
        ..Default::default()
    };

    let mut initial = db.get_hook_events(&filter)?;
    initial.reverse();

    for event in &initial {
        print_event(event, &format, use_color, cli.pretty);
    }

    let mut last_id = db.get_max_hook_event_id(Some(session_id))?;
    eprintln!("\n--- Watching for new events (Ctrl+C to stop) ---\n");

    loop {
        std::thread::sleep(std::time::Duration::from_millis(500));

        let new_events = db.get_hook_events_after_id(
            last_id,
            Some(session_id),
            event_types,
            tool_names,
        )?;

        for event in &new_events {
            print_event(event, &format, use_color, cli.pretty);
            if event.id > last_id {
                last_id = event.id;
            }
        }
    }
}

fn watch_mode(
    cli: &Cli,
    db: &TranscriptDb,
    session_id: &str,
    event_types: Option<&[String]>,
    tool_names: Option<&[String]>,
) -> Result<()> {
    let format = cli.effective_format();
    let use_color = cli.use_color();
    let mut last_content = String::new();

    loop {
        let filter = HookEventFilter {
            session_id: Some(session_id.to_string()),
            event_types: event_types.map(|v| v.to_vec()),
            tool_names: tool_names.map(|v| v.to_vec()),
            limit: Some(1),
            order: Order::Desc,
            ..Default::default()
        };

        let events = db.get_hook_events(&filter)?;

        if let Some(event) = events.first() {
            let content = match format {
                OutputFormat::Json => json::format_event(event, cli.pretty),
                OutputFormat::Minimal => human::format_event_minimal(event, use_color),
                OutputFormat::Human => human::format_event(event, use_color),
            };

            if content != last_content {
                // Clear screen
                print!("\x1b[2J\x1b[H");
                println!("{}", content);
                println!("\n--- Watching for updates (Ctrl+C to stop) ---");
                last_content = content;
            }
        } else if last_content.is_empty() {
            print!("\x1b[2J\x1b[H");
            println!("No matching events found.");
            println!("\n--- Watching for updates (Ctrl+C to stop) ---");
            last_content = "__empty__".to_string();
        }

        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

fn print_event(
    event: &transcript_core::HookEvent,
    format: &OutputFormat,
    use_color: bool,
    pretty: bool,
) {
    match format {
        OutputFormat::Json => {
            println!("{}", json::format_event(event, pretty));
        }
        OutputFormat::Minimal => {
            println!("{}", human::format_event_minimal(event, use_color));
        }
        OutputFormat::Human => {
            println!("{}", human::format_event(event, use_color));
            println!();
        }
    }
}
