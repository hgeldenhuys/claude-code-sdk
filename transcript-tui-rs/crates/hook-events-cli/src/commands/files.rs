//! List files edited in a session

use anyhow::{bail, Result};
use serde_json::json;
use transcript_db::TranscriptDb;

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn run(
    cli: &Cli,
    db: &TranscriptDb,
    session: &str,
    stats: bool,
) -> Result<()> {
    let session_id = match db.resolve_hook_session(session)? {
        Some(id) => id,
        None => bail!(
            "No hook events found for session: {}\nTip: Use \".\" for most recent session",
            session
        ),
    };

    let files = db.get_session_file_edits(&[session_id])?;

    if files.is_empty() {
        println!("No file edits found for this session.");
        return Ok(());
    }

    let format = cli.effective_format();
    let use_color = cli.use_color();

    if format == OutputFormat::Json {
        let json_files: Vec<_> = files
            .iter()
            .map(|f| {
                json!({
                    "path": f.file_path,
                    "editCount": f.edit_count,
                    "tools": f.tools_used,
                    "firstEdit": f.first_timestamp,
                    "lastEdit": f.last_timestamp,
                })
            })
            .collect();

        if cli.pretty {
            println!("{}", serde_json::to_string_pretty(&json_files)?);
        } else {
            println!("{}", serde_json::to_string(&json_files)?);
        }
        return Ok(());
    }

    let total_edits: i64 = files.iter().map(|f| f.edit_count).sum();

    if stats {
        println!(
            "Files edited in session ({} files, {} edits):\n",
            files.len(),
            total_edits
        );

        for file in &files {
            let tools = file.tools_used.join(", ");
            let first_time = colors::format_time(&file.first_timestamp);
            let last_time = colors::format_time(&file.last_timestamp);

            if use_color {
                println!("{}", colored::Colorize::bold(file.file_path.as_str()));
            } else {
                println!("{}", file.file_path);
            }
            println!("  Edits: {} | Tools: {}", file.edit_count, tools);
            println!("  First: {} | Last: {}\n", first_time, last_time);
        }
    } else {
        println!(
            "Files edited in session ({}):\n",
            files.len()
        );

        for file in &files {
            let count_suffix = if file.edit_count > 1 {
                format!(" ({} edits)", file.edit_count)
            } else {
                String::new()
            };
            println!("{}{}", file.file_path, count_suffix);
        }
    }

    Ok(())
}
