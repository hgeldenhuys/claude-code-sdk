//! Search command - full-text search across transcripts

use anyhow::Result;
use colored::Colorize;
use serde::Serialize;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::{colors, human};

/// Structured search result for JSON output (matches TS CLI format)
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SearchResult {
    session_id: String,
    slug: Option<String>,
    session_name: Option<String>,
    line_number: i64,
    #[serde(rename = "type")]
    entry_type: String,
    timestamp: String,
    content: Option<String>,
    matched_text: String,
    raw: String,
}

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
            // Build structured search results matching TS CLI format
            let results: Vec<SearchResult> = lines
                .iter()
                .map(|line| {
                    // Create matched_text with FTS-style markers
                    let matched_text = highlight_text_with_markers(
                        line.content.as_deref().unwrap_or(""),
                        query,
                    );

                    SearchResult {
                        session_id: line.session_id.clone(),
                        slug: line.slug.clone(),
                        session_name: line.session_name.clone(),
                        line_number: line.line_number,
                        entry_type: line.line_type.to_string(),
                        timestamp: line.timestamp.clone(),
                        content: line.content.clone(),
                        matched_text,
                        raw: line.raw.clone(),
                    }
                })
                .collect();

            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&results)?);
            } else {
                println!("{}", serde_json::to_string(&results)?);
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

/// Add FTS-style markers around matched terms (for JSON output)
fn highlight_text_with_markers(content: &str, query: &str) -> String {
    let terms: Vec<&str> = query.split_whitespace().collect();
    let mut result = content.to_string();

    for term in terms {
        // Case-insensitive replacement with markers
        let term_lower = term.to_lowercase();
        let mut new_result = String::new();
        let mut remaining = result.as_str();

        while let Some(pos) = remaining.to_lowercase().find(&term_lower) {
            // Add text before match
            new_result.push_str(&remaining[..pos]);
            // Add marked match (preserve original case)
            new_result.push_str(">>>>");
            new_result.push_str(&remaining[pos..pos + term.len()]);
            new_result.push_str("<<<<");
            // Continue after match
            remaining = &remaining[pos + term.len()..];
        }
        new_result.push_str(remaining);
        result = new_result;
    }

    result
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
