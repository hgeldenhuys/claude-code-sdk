//! Index command - manage transcript index

use anyhow::Result;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn status(cli: &Cli, db: Option<TranscriptDb>) -> Result<()> {
    match db {
        Some(db) => {
            let stats = db.stats()?;

            match cli.format {
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
                    println!("{}", serde_json::to_string_pretty(&output)?);
                }

                OutputFormat::Minimal => {
                    println!("{}", stats.db_path.display());
                }
            }
        }
        None => match cli.format {
            OutputFormat::Human => {
                println!("{}", colors::error("Database not found"));
                println!();
                println!("Run the indexer daemon to create the database:");
                println!("  bun run bin/transcript.ts index daemon start");
            }
            OutputFormat::Json => {
                let output = serde_json::json!({
                    "status": "not_found",
                    "error": "Database not found"
                });
                println!("{}", serde_json::to_string_pretty(&output)?);
            }
            OutputFormat::Minimal => {
                eprintln!("not found");
            }
        },
    }

    Ok(())
}

pub fn build(cli: &Cli) -> Result<()> {
    match cli.format {
        OutputFormat::Human => {
            println!("{}", colors::warning("Index build not implemented in Rust CLI"));
            println!();
            println!("Use the TypeScript CLI to build the index:");
            println!("  bun run bin/transcript.ts index build");
        }
        OutputFormat::Json => {
            let output = serde_json::json!({
                "status": "not_implemented",
                "message": "Index build requires TypeScript CLI"
            });
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Minimal => {
            eprintln!("not implemented");
        }
    }

    Ok(())
}

pub fn update(cli: &Cli) -> Result<()> {
    match cli.format {
        OutputFormat::Human => {
            println!("{}", colors::warning("Index update not implemented in Rust CLI"));
            println!();
            println!("Use the TypeScript CLI to update the index:");
            println!("  bun run bin/transcript.ts index update");
        }
        OutputFormat::Json => {
            let output = serde_json::json!({
                "status": "not_implemented",
                "message": "Index update requires TypeScript CLI"
            });
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Minimal => {
            eprintln!("not implemented");
        }
    }

    Ok(())
}
