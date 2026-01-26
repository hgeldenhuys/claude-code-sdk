//! Recall command - unified search grouped by session

use anyhow::Result;
use colored::Colorize;
use serde::Serialize;
use transcript_indexer::IndexerDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

/// A matched line from FTS search
struct MatchedLine {
    session_id: String,
    session_name: Option<String>,
    line_number: i64,
    entry_type: String,
    timestamp: String,
    content: String,
    rank: f64,
    source: &'static str, // "transcript" or "hook"
}

/// A session group for recall output
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecallSession {
    session_id: String,
    session_name: Option<String>,
    best_rank: f64,
    latest_timestamp: String,
    matches: Vec<RecallMatch>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecallMatch {
    source: String,
    line_number: i64,
    entry_type: String,
    timestamp: String,
    content: String,
}

pub fn run(
    cli: &Cli,
    query: &str,
    max_sessions: usize,
    max_matches: usize,
) -> Result<()> {
    let indexer_db = IndexerDb::open_or_create_default()?;
    let conn = indexer_db.connection();

    // Build FTS query - wrap each word in quotes for OR search
    let fts_query: String = query
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ");

    let mut all_matches: Vec<MatchedLine> = Vec::new();

    // Search transcript lines via FTS
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT
                l.session_id,
                l.session_name,
                l.line_number,
                l.type,
                l.timestamp,
                l.content,
                bm25(lines_fts) AS rank
            FROM lines_fts fts
            JOIN lines l ON fts.rowid = l.id
            WHERE lines_fts MATCH ?1
            ORDER BY rank
            LIMIT 200
            "#,
        )?;

        let rows = stmt.query_map(rusqlite::params![fts_query], |row| {
            Ok(MatchedLine {
                session_id: row.get(0)?,
                session_name: row.get(1)?,
                line_number: row.get(2)?,
                entry_type: row.get(3)?,
                timestamp: row.get(4)?,
                content: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                rank: row.get(6)?,
                source: "transcript",
            })
        })?;

        for row in rows {
            match row {
                Ok(m) => all_matches.push(m),
                Err(_) => continue,
            }
        }
    }

    // Search hook events via FTS
    {
        let mut stmt = conn.prepare(
            r#"
            SELECT
                h.session_id,
                h.session_name,
                h.line_number,
                h.event_type,
                h.timestamp,
                COALESCE(h.tool_name, '') || ' ' || COALESCE(h.event_type, ''),
                bm25(hook_events_fts) AS rank
            FROM hook_events_fts fts
            JOIN hook_events h ON fts.rowid = h.id
            WHERE hook_events_fts MATCH ?1
            ORDER BY rank
            LIMIT 200
            "#,
        )?;

        let rows = stmt.query_map(rusqlite::params![fts_query], |row| {
            Ok(MatchedLine {
                session_id: row.get(0)?,
                session_name: row.get(1)?,
                line_number: row.get(2)?,
                entry_type: row.get(3)?,
                timestamp: row.get(4)?,
                content: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                rank: row.get(6)?,
                source: "hook",
            })
        })?;

        for row in rows {
            match row {
                Ok(m) => all_matches.push(m),
                Err(_) => continue,
            }
        }
    }

    // Group matches by session_id
    let mut session_map: std::collections::HashMap<String, Vec<MatchedLine>> =
        std::collections::HashMap::new();

    for m in all_matches {
        session_map
            .entry(m.session_id.clone())
            .or_default()
            .push(m);
    }

    // Build session groups with best rank and latest timestamp
    let mut sessions: Vec<RecallSession> = Vec::new();

    for (session_id, mut matches) in session_map {
        // Sort matches within session by rank (best first)
        matches.sort_by(|a, b| a.rank.partial_cmp(&b.rank).unwrap_or(std::cmp::Ordering::Equal));

        let best_rank = matches.first().map(|m| m.rank).unwrap_or(0.0);
        let latest_timestamp = matches
            .iter()
            .map(|m| m.timestamp.as_str())
            .max()
            .unwrap_or("")
            .to_string();
        let session_name = matches
            .iter()
            .find_map(|m| m.session_name.clone());

        // Take top N matches per session
        let top_matches: Vec<RecallMatch> = matches
            .into_iter()
            .take(max_matches)
            .map(|m| RecallMatch {
                source: m.source.to_string(),
                line_number: m.line_number,
                entry_type: m.entry_type,
                timestamp: m.timestamp,
                content: m.content,
            })
            .collect();

        sessions.push(RecallSession {
            session_id,
            session_name,
            best_rank,
            latest_timestamp,
            matches: top_matches,
        });
    }

    // Sort sessions: best BM25 rank first, then most recent
    sessions.sort_by(|a, b| {
        a.best_rank
            .partial_cmp(&b.best_rank)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.latest_timestamp.cmp(&a.latest_timestamp))
    });

    // Limit sessions
    sessions.truncate(max_sessions);

    // Output
    match cli.effective_format() {
        OutputFormat::Human => {
            if sessions.is_empty() {
                println!("No results found for: {}", query.cyan());
            } else {
                println!(
                    "{}",
                    colors::header(&format!(
                        "Recall: '{}' ({} sessions)",
                        query,
                        sessions.len()
                    ))
                );
                println!();

                for (i, session) in sessions.iter().enumerate() {
                    if i > 0 {
                        println!();
                    }

                    // Session header
                    let name_display = session
                        .session_name
                        .as_deref()
                        .unwrap_or(&session.session_id);
                    print!("  {}", colors::colored_session(name_display));
                    println!(
                        "  {}",
                        colors::label(&format!(
                            "({} matches)",
                            session.matches.len()
                        ))
                    );

                    // Matches
                    for m in &session.matches {
                        let source_tag = match m.source.as_str() {
                            "hook" => "[hook]".yellow().to_string(),
                            _ => "[line]".blue().to_string(),
                        };

                        let time = colors::colored_time(&m.timestamp);
                        let entry_type = m.entry_type.white().dimmed().to_string();

                        // Truncate content for display
                        let content = truncate_content(&m.content, 120);

                        println!(
                            "    {} {} {} L{}: {}",
                            source_tag, time, entry_type, m.line_number, content
                        );
                    }
                }
            }
        }

        OutputFormat::Json => {
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&sessions)?);
            } else {
                println!("{}", serde_json::to_string(&sessions)?);
            }
        }

        OutputFormat::Minimal => {
            for session in &sessions {
                let name = session
                    .session_name
                    .as_deref()
                    .unwrap_or(&session.session_id);
                println!("{} ({})", name, session.matches.len());
                for m in &session.matches {
                    println!(
                        "  {}",
                        truncate_content(&m.content, 100)
                    );
                }
            }
        }
    }

    Ok(())
}

/// Truncate content to max length with ellipsis
fn truncate_content(content: &str, max_len: usize) -> String {
    // Take first line only
    let first_line = content.lines().next().unwrap_or(content);
    if first_line.len() > max_len {
        format!("{}...", &first_line[..max_len])
    } else {
        first_line.to_string()
    }
}
