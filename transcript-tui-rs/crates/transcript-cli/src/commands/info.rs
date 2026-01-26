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

            // Build detailed type counts like TS CLI
            let mut type_counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
            for line in &lines {
                let type_name = line.line_type.to_string();
                *type_counts.entry(type_name).or_insert(0) += 1;
            }

            // Get version/cwd/gitBranch from first line
            let first_line = lines.first();
            let version = first_line.and_then(|l| {
                serde_json::from_str::<serde_json::Value>(&l.raw).ok()
                    .and_then(|v| v.get("version").and_then(|v| v.as_str().map(String::from)))
            });
            let cwd = first_line.and_then(|l| l.cwd.clone());
            let git_branch = first_line.and_then(|l| {
                serde_json::from_str::<serde_json::Value>(&l.raw).ok()
                    .and_then(|v| v.get("gitBranch").and_then(|v| v.as_str().map(String::from)))
            });

            let output = serde_json::json!({
                "sessionId": session_info.session_id,
                "slug": session_info.slug,
                "filePath": session_info.file_path,
                "lineCount": session_info.line_count,
                "firstTimestamp": session_info.first_timestamp,
                "lastTimestamp": session_info.last_timestamp,
                "indexedAt": session_info.indexed_at,
                "version": version,
                "cwd": cwd,
                "gitBranch": git_branch,
                "statistics": type_counts
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
