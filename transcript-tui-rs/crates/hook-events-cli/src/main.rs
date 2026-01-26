//! hook-events-cli - CLI for viewing and querying Claude Code hook events

mod cli;
mod commands;
mod output;

use anyhow::Result;
use clap::Parser;
use transcript_db::TranscriptDb;

use cli::{Cli, Command};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Open database connection
    let db = match &cli.db_path {
        Some(path) => TranscriptDb::open(path)?,
        None => TranscriptDb::open_default()?,
    };

    match &cli.command {
        Command::View {
            session,
            event,
            tool,
            last,
            first,
            limit,
            offset,
            from_time,
            to_time,
            tail,
            watch,
        } => commands::view::run(
            &cli,
            &db,
            session,
            event.as_deref(),
            tool.as_deref(),
            *last,
            *first,
            *limit,
            *offset,
            from_time.as_deref(),
            to_time.as_deref(),
            *tail,
            *watch,
        ),

        Command::List { recent, names } => {
            commands::list::run(&cli, &db, *recent, *names)
        }

        Command::Info { session } => commands::info::run(&cli, &db, session),

        Command::Search { query, limit } => {
            commands::search::run(&cli, &db, query, *limit)
        }

        Command::Files { session, stats } => {
            commands::files::run(&cli, &db, session, *stats)
        }
    }
}
