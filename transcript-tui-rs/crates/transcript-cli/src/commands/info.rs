//! Info command - show session details

use anyhow::{bail, Result};
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{colors, human};

pub fn run(cli: &Cli, db: &TranscriptDb, session: &str) -> Result<()> {
    // Resolve session
    let session_info = db.resolve_session(session)?;
    let session_info = match session_info {
        Some(info) => info,
        None => {
            let matches = db.find_sessions(session)?;
            if matches.is_empty() {
                bail!("Session not found: {}", session);
            } else if matches.len() == 1 {
                matches.into_iter().next().unwrap()
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

    match cli.effective_format() {
        OutputFormat::Human => {
            println!("{}", colors::header("Session Info"));
            println!();
            println!("{}", human::format_session_info(&session_info));

            // Get line type statistics
            println!();
            println!("{}", colors::header("Line Statistics"));
            println!();

            let lines = db.get_lines(
                &transcript_db::GetLinesOptions::for_session(&session_info.session_id),
            )?;

            let mut user_count = 0i64;
            let mut assistant_count = 0i64;
            let mut system_count = 0i64;
            let mut other_count = 0i64;
            let mut total_tokens = 0u64;

            for line in &lines {
                match line.line_type {
                    transcript_core::LineType::User => user_count += 1,
                    transcript_core::LineType::Assistant => assistant_count += 1,
                    transcript_core::LineType::System => system_count += 1,
                    _ => other_count += 1,
                }
                if let Some(usage) = line.usage() {
                    total_tokens += usage.total();
                }
            }

            println!(
                "  {}: {}",
                colors::label("User messages"),
                colors::format_count(user_count)
            );
            println!(
                "  {}: {}",
                colors::label("Assistant messages"),
                colors::format_count(assistant_count)
            );
            println!(
                "  {}: {}",
                colors::label("System messages"),
                colors::format_count(system_count)
            );
            if other_count > 0 {
                println!(
                    "  {}: {}",
                    colors::label("Other"),
                    colors::format_count(other_count)
                );
            }
            if total_tokens > 0 {
                println!(
                    "  {}: {}",
                    colors::label("Total tokens"),
                    colors::format_count(total_tokens as i64)
                );
            }
        }

        OutputFormat::Json => {
            let lines = db.get_lines(
                &transcript_db::GetLinesOptions::for_session(&session_info.session_id),
            )?;

            let mut user_count = 0i64;
            let mut assistant_count = 0i64;
            let mut system_count = 0i64;
            let mut other_count = 0i64;
            let mut total_tokens = 0u64;

            for line in &lines {
                match line.line_type {
                    transcript_core::LineType::User => user_count += 1,
                    transcript_core::LineType::Assistant => assistant_count += 1,
                    transcript_core::LineType::System => system_count += 1,
                    _ => other_count += 1,
                }
                if let Some(usage) = line.usage() {
                    total_tokens += usage.total();
                }
            }

            let output = serde_json::json!({
                "session_id": session_info.session_id,
                "slug": session_info.slug,
                "file_path": session_info.file_path,
                "line_count": session_info.line_count,
                "first_timestamp": session_info.first_timestamp,
                "last_timestamp": session_info.last_timestamp,
                "indexed_at": session_info.indexed_at,
                "statistics": {
                    "user_messages": user_count,
                    "assistant_messages": assistant_count,
                    "system_messages": system_count,
                    "other_messages": other_count,
                    "total_tokens": total_tokens
                }
            });
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", serde_json::to_string(&output)?);
            }
        }

        OutputFormat::Minimal => {
            println!("{}", session_info.session_id);
        }
    }

    Ok(())
}
