//! Search command - full-text search across transcripts

use anyhow::Result;
use colored::Colorize;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{colors, human, json};

pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    query: &str,
    limit: i64,
    session: Option<&str>,
    context: usize,
) -> Result<()> {
    // Resolve session if provided
    let session_id = if let Some(s) = session {
        let info = db.resolve_session(s)?;
        info.map(|i| i.session_id)
    } else {
        None
    };

    // Perform search
    let lines = db.search_lines(query, limit, session_id.as_deref())?;

    match cli.effective_format() {
        OutputFormat::Human => {
            if lines.is_empty() {
                println!("No results found for: {}", query.cyan());
            } else {
                println!(
                    "{}",
                    colors::header(&format!("Search results for '{}' ({})", query, lines.len()))
                );
                println!();

                for line in &lines {
                    // Show session name if not filtered to one session
                    if session.is_none() {
                        if let Some(name) = &line.session_name {
                            print!("{} ", colors::colored_session(name));
                        } else if let Some(slug) = &line.slug {
                            print!("{} ", colors::colored_session(slug));
                        }
                    }

                    // Format the line
                    if context > 0 {
                        // Show with highlighted match
                        println!("{}", human::format_line(line, true));
                        highlight_match(line.content.as_deref().unwrap_or(""), query);
                    } else {
                        println!("{}", human::format_line(line, false));
                    }
                }
            }
        }

        OutputFormat::Json => {
            for line in &lines {
                println!("{}", json::format_line(line, cli.pretty));
            }
        }

        OutputFormat::Minimal => {
            for line in &lines {
                if let Some(content) = &line.content {
                    println!("{}", content);
                }
            }
        }
    }

    Ok(())
}

/// Highlight matches in content
fn highlight_match(content: &str, query: &str) {
    let query_lower = query.to_lowercase();
    let content_lower = content.to_lowercase();

    if let Some(pos) = content_lower.find(&query_lower) {
        // Find line containing the match
        let before = &content[..pos];
        let line_start = before.rfind('\n').map(|p| p + 1).unwrap_or(0);

        let after = &content[pos..];
        let line_end = after.find('\n').map(|p| pos + p).unwrap_or(content.len());

        let matched_line = &content[line_start..line_end];

        // Re-find position in the line
        let line_lower = matched_line.to_lowercase();
        if let Some(match_pos) = line_lower.find(&query_lower) {
            let before_match = &matched_line[..match_pos];
            let matched = &matched_line[match_pos..match_pos + query.len()];
            let after_match = &matched_line[match_pos + query.len()..];

            println!(
                "  >>> {}{}{}",
                before_match,
                matched.black().on_yellow(),
                after_match
            );
        }
    }
}
