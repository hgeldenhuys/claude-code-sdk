//! Index command - manage transcript index

use anyhow::Result;
use transcript_db::TranscriptDb;
use transcript_indexer::IndexerDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn status(cli: &Cli, db: Option<TranscriptDb>) -> Result<()> {
    match db {
        Some(db) => {
            let stats = db.stats()?;

            match cli.effective_format() {
                OutputFormat::Human => {
                    println!("{}", colors::header("Index Status"));
                    println!();
                    println!(
                        "  {}: {}",
                        colors::label("Database"),
                        stats.db_path.display()
                    );
                    println!(
                        "  {}: {}",
                        colors::label("Size"),
                        colors::format_size(stats.db_size_bytes)
                    );
                    println!(
                        "  {}: {}",
                        colors::label("Version"),
                        colors::value(&stats.version.to_string())
                    );
                    println!();
                    println!(
                        "  {}: {}",
                        colors::label("Sessions"),
                        colors::format_count(stats.session_count)
                    );
                    println!(
                        "  {}: {}",
                        colors::label("Transcript lines"),
                        colors::format_count(stats.line_count)
                    );
                    println!(
                        "  {}: {}",
                        colors::label("Hook events"),
                        colors::format_count(stats.hook_event_count)
                    );

                    if let Some(last) = &stats.last_indexed {
                        println!();
                        println!(
                            "  {}: {}",
                            colors::label("Last indexed"),
                            colors::value(last)
                        );
                    }

                    println!();
                    println!("{}", colors::success("Index is healthy"));
                }

                OutputFormat::Json => {
                    let output = serde_json::json!({
                        "db_path": stats.db_path.to_string_lossy(),
                        "db_size_bytes": stats.db_size_bytes,
                        "version": stats.version,
                        "session_count": stats.session_count,
                        "line_count": stats.line_count,
                        "hook_event_count": stats.hook_event_count,
                        "last_indexed": stats.last_indexed,
                        "status": "healthy"
                    });
                    if cli.pretty {
                        println!("{}", serde_json::to_string_pretty(&output)?);
                    } else {
                        println!("{}", serde_json::to_string(&output)?);
                    }
                }

                OutputFormat::Minimal => {
                    println!("{}", stats.db_path.display());
                }
            }
        }
        None => match cli.effective_format() {
            OutputFormat::Human => {
                println!("{}", colors::error("Database not found"));
                println!();
                println!("Run the indexer to create the database:");
                println!("  transcript index build");
            }
            OutputFormat::Json => {
                let output = serde_json::json!({
                    "status": "not_found",
                    "error": "Database not found"
                });
                if cli.pretty {
                    println!("{}", serde_json::to_string_pretty(&output)?);
                } else {
                    println!("{}", serde_json::to_string(&output)?);
                }
            }
            OutputFormat::Minimal => {
                eprintln!("not found");
            }
        },
    }

    Ok(())
}

pub fn build(cli: &Cli) -> Result<()> {
    let indexer_db = IndexerDb::open_or_create_default()?;
    let conn = indexer_db.connection();

    match cli.effective_format() {
        OutputFormat::Human => {
            eprintln!("{}", colors::header("Building index..."));
            eprintln!();

            // Index transcripts
            eprintln!("  {} Indexing transcripts...", colors::label("Step 1/3:"));
            let transcript_result = transcript_indexer::index_all_transcripts(
                conn,
                None,
                |file, current, total, lines| {
                    eprintln!(
                        "    [{}/{}] {} ({} lines)",
                        current,
                        total,
                        abbreviate_path(file),
                        lines
                    );
                },
            )?;
            eprintln!(
                "    {} {} files, {} lines",
                colors::success("Done:"),
                transcript_result.files_indexed,
                transcript_result.lines_indexed
            );

            // Index hook events
            eprintln!();
            eprintln!("  {} Indexing hook events...", colors::label("Step 2/3:"));
            let hook_result = transcript_indexer::index_all_hook_files(
                conn,
                None,
                |file, current, total, events| {
                    eprintln!(
                        "    [{}/{}] {} ({} events)",
                        current,
                        total,
                        abbreviate_path(file),
                        events
                    );
                },
            )?;
            eprintln!(
                "    {} {} files, {} events",
                colors::success("Done:"),
                hook_result.files_indexed,
                hook_result.events_indexed
            );

            // Correlate turns
            eprintln!();
            eprintln!(
                "  {} Correlating turns...",
                colors::label("Step 3/3:")
            );
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            eprintln!(
                "    {} {} lines updated across {} sessions",
                colors::success("Done:"),
                corr_result.updated,
                corr_result.sessions
            );

            eprintln!();
            eprintln!("{}", colors::success("Index build complete"));
        }

        OutputFormat::Json => {
            let transcript_result =
                transcript_indexer::index_all_transcripts(conn, None, |_, _, _, _| {})?;
            let hook_result =
                transcript_indexer::index_all_hook_files(conn, None, |_, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;

            let output = serde_json::json!({
                "status": "success",
                "transcripts": {
                    "files_indexed": transcript_result.files_indexed,
                    "lines_indexed": transcript_result.lines_indexed,
                },
                "hooks": {
                    "files_indexed": hook_result.files_indexed,
                    "events_indexed": hook_result.events_indexed,
                },
                "correlation": {
                    "lines_updated": corr_result.updated,
                    "sessions_processed": corr_result.sessions,
                }
            });
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", serde_json::to_string(&output)?);
            }
        }

        OutputFormat::Minimal => {
            let transcript_result =
                transcript_indexer::index_all_transcripts(conn, None, |_, _, _, _| {})?;
            let hook_result =
                transcript_indexer::index_all_hook_files(conn, None, |_, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            println!(
                "{} lines, {} events, {} correlated",
                transcript_result.lines_indexed,
                hook_result.events_indexed,
                corr_result.updated
            );
        }
    }

    Ok(())
}

pub fn update(cli: &Cli) -> Result<()> {
    let indexer_db = IndexerDb::open_or_create_default()?;
    let conn = indexer_db.connection();

    match cli.effective_format() {
        OutputFormat::Human => {
            eprintln!("{}", colors::header("Updating index..."));
            eprintln!();

            // Delta update transcripts
            eprintln!("  {} Updating transcripts...", colors::label("Step 1/3:"));
            let transcript_result = transcript_indexer::update_transcripts(
                conn,
                None,
                |file, current, total, new_lines, skipped| {
                    if !skipped && new_lines > 0 {
                        eprintln!(
                            "    [{}/{}] {} (+{} lines)",
                            current,
                            total,
                            abbreviate_path(file),
                            new_lines
                        );
                    }
                },
            )?;
            eprintln!(
                "    {} checked {}, updated {}, +{} lines",
                colors::success("Done:"),
                transcript_result.files_checked,
                transcript_result.files_updated,
                transcript_result.new_lines
            );

            // Delta update hooks
            eprintln!();
            eprintln!(
                "  {} Updating hook events...",
                colors::label("Step 2/3:")
            );
            let hook_result = transcript_indexer::update_hook_index(
                conn,
                None,
                |file, current, total, new_events, skipped| {
                    if !skipped && new_events > 0 {
                        eprintln!(
                            "    [{}/{}] {} (+{} events)",
                            current,
                            total,
                            abbreviate_path(file),
                            new_events
                        );
                    }
                },
            )?;
            eprintln!(
                "    {} checked {}, updated {}, +{} events",
                colors::success("Done:"),
                hook_result.files_checked,
                hook_result.files_updated,
                hook_result.new_events
            );

            // Correlate turns
            eprintln!();
            eprintln!(
                "  {} Correlating turns...",
                colors::label("Step 3/3:")
            );
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            eprintln!(
                "    {} {} lines updated across {} sessions",
                colors::success("Done:"),
                corr_result.updated,
                corr_result.sessions
            );

            eprintln!();
            eprintln!("{}", colors::success("Index update complete"));
        }

        OutputFormat::Json => {
            let transcript_result =
                transcript_indexer::update_transcripts(conn, None, |_, _, _, _, _| {})?;
            let hook_result =
                transcript_indexer::update_hook_index(conn, None, |_, _, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;

            let output = serde_json::json!({
                "status": "success",
                "transcripts": {
                    "files_checked": transcript_result.files_checked,
                    "files_updated": transcript_result.files_updated,
                    "new_lines": transcript_result.new_lines,
                },
                "hooks": {
                    "files_checked": hook_result.files_checked,
                    "files_updated": hook_result.files_updated,
                    "new_events": hook_result.new_events,
                },
                "correlation": {
                    "lines_updated": corr_result.updated,
                    "sessions_processed": corr_result.sessions,
                }
            });
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", serde_json::to_string(&output)?);
            }
        }

        OutputFormat::Minimal => {
            let transcript_result =
                transcript_indexer::update_transcripts(conn, None, |_, _, _, _, _| {})?;
            let hook_result =
                transcript_indexer::update_hook_index(conn, None, |_, _, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            println!(
                "+{} lines, +{} events, {} correlated",
                transcript_result.new_lines,
                hook_result.new_events,
                corr_result.updated
            );
        }
    }

    Ok(())
}

pub fn rebuild(cli: &Cli) -> Result<()> {
    let mut indexer_db = IndexerDb::open_or_create_default()?;

    match cli.effective_format() {
        OutputFormat::Human => {
            eprintln!("{}", colors::header("Rebuilding index..."));
            eprintln!();
            eprintln!("  Clearing existing data...");
            transcript_indexer::rebuild_index(indexer_db.connection_mut())?;
            eprintln!("  {}", colors::success("Cleared"));
            eprintln!();
        }

        OutputFormat::Json | OutputFormat::Minimal => {
            transcript_indexer::rebuild_index(indexer_db.connection_mut())?;
        }
    }

    // Now do a full build
    build_with_db(cli, &indexer_db)?;

    Ok(())
}

fn build_with_db(cli: &Cli, indexer_db: &IndexerDb) -> Result<()> {
    let conn = indexer_db.connection();

    match cli.effective_format() {
        OutputFormat::Human => {
            eprintln!("  {} Indexing transcripts...", colors::label("Step 1/3:"));
            let transcript_result = transcript_indexer::index_all_transcripts(
                conn,
                None,
                |file, current, total, lines| {
                    eprintln!(
                        "    [{}/{}] {} ({} lines)",
                        current,
                        total,
                        abbreviate_path(file),
                        lines
                    );
                },
            )?;
            eprintln!(
                "    {} {} files, {} lines",
                colors::success("Done:"),
                transcript_result.files_indexed,
                transcript_result.lines_indexed
            );

            eprintln!();
            eprintln!("  {} Indexing hook events...", colors::label("Step 2/3:"));
            let hook_result = transcript_indexer::index_all_hook_files(
                conn,
                None,
                |file, current, total, events| {
                    eprintln!(
                        "    [{}/{}] {} ({} events)",
                        current,
                        total,
                        abbreviate_path(file),
                        events
                    );
                },
            )?;
            eprintln!(
                "    {} {} files, {} events",
                colors::success("Done:"),
                hook_result.files_indexed,
                hook_result.events_indexed
            );

            eprintln!();
            eprintln!(
                "  {} Correlating turns...",
                colors::label("Step 3/3:")
            );
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            eprintln!(
                "    {} {} lines updated across {} sessions",
                colors::success("Done:"),
                corr_result.updated,
                corr_result.sessions
            );

            eprintln!();
            eprintln!("{}", colors::success("Rebuild complete"));
        }

        OutputFormat::Json => {
            let transcript_result =
                transcript_indexer::index_all_transcripts(conn, None, |_, _, _, _| {})?;
            let hook_result =
                transcript_indexer::index_all_hook_files(conn, None, |_, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;

            let output = serde_json::json!({
                "status": "success",
                "action": "rebuild",
                "transcripts": {
                    "files_indexed": transcript_result.files_indexed,
                    "lines_indexed": transcript_result.lines_indexed,
                },
                "hooks": {
                    "files_indexed": hook_result.files_indexed,
                    "events_indexed": hook_result.events_indexed,
                },
                "correlation": {
                    "lines_updated": corr_result.updated,
                    "sessions_processed": corr_result.sessions,
                }
            });
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", serde_json::to_string(&output)?);
            }
        }

        OutputFormat::Minimal => {
            let transcript_result =
                transcript_indexer::index_all_transcripts(conn, None, |_, _, _, _| {})?;
            let hook_result =
                transcript_indexer::index_all_hook_files(conn, None, |_, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;
            println!(
                "rebuilt: {} lines, {} events, {} correlated",
                transcript_result.lines_indexed,
                hook_result.events_indexed,
                corr_result.updated
            );
        }
    }

    Ok(())
}

pub fn watch(cli: &Cli) -> Result<()> {
    let mut indexer_db = IndexerDb::open_or_create_default()?;

    match cli.effective_format() {
        OutputFormat::Human => {
            eprintln!("{}", colors::header("Starting index daemon..."));
            eprintln!();

            // Do an initial update first
            let conn = indexer_db.connection();
            let transcript_result =
                transcript_indexer::update_transcripts(conn, None, |_, _, _, _, _| {})?;
            let hook_result =
                transcript_indexer::update_hook_index(conn, None, |_, _, _, _, _| {})?;
            let corr_result = transcript_indexer::correlate_lines_to_turns(conn)?;

            eprintln!(
                "  Initial sync: +{} lines, +{} events, {} correlated",
                transcript_result.new_lines,
                hook_result.new_events,
                corr_result.updated
            );
            eprintln!();

            // Start daemon
            let daemon = transcript_indexer::IndexerDaemon::new();
            daemon.run(&mut indexer_db)?;
        }

        OutputFormat::Json => {
            eprintln!(r#"{{"status":"watching"}}"#);
            let daemon = transcript_indexer::IndexerDaemon::new();
            daemon.run(&mut indexer_db)?;
        }

        OutputFormat::Minimal => {
            let daemon = transcript_indexer::IndexerDaemon::new();
            daemon.run(&mut indexer_db)?;
        }
    }

    Ok(())
}

/// Abbreviate a file path for display
fn abbreviate_path(path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() && path.starts_with(&home) {
        format!("~{}", &path[home.len()..])
    } else {
        path.to_string()
    }
}
