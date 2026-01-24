//! transcript-cli - CLI for managing Claude Code transcripts

mod cli;
mod commands;
mod output;

use anyhow::Result;
use clap::Parser;
use transcript_db::TranscriptDb;

use cli::{Cli, Command, IndexCommand};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Open database connection
    let db = match &cli.db_path {
        Some(path) => TranscriptDb::open(path),
        None => TranscriptDb::open_default(),
    };

    // Handle commands that don't require a database
    match &cli.command {
        Command::Doctor => {
            return commands::doctor::run(&cli, db.ok());
        }
        Command::Index(IndexCommand::Status) => {
            return commands::index::status(&cli, db.ok());
        }
        _ => {}
    }

    // For other commands, ensure database is available
    let db = db?;

    match &cli.command {
        Command::View {
            session,
            types,
            last,
            first,
            search,
            from_time,
            to_time,
            from_line,
            to_line,
            reverse,
        } => commands::view::run(
            &cli,
            &db,
            session,
            types.as_deref(),
            *last,
            *first,
            search.as_deref(),
            from_time.as_deref(),
            to_time.as_deref(),
            *from_line,
            *to_line,
            *reverse,
        ),

        Command::List {
            limit,
            days,
            search,
        } => commands::list::run(&cli, &db, *limit, *days, search.as_deref()),

        Command::Info { session } => commands::info::run(&cli, &db, session),

        Command::Search {
            query,
            limit,
            session,
            context,
        } => commands::search::run(&cli, &db, query, *limit, session.as_deref(), *context),

        Command::Index(cmd) => match cmd {
            IndexCommand::Status => unreachable!(), // Handled above
            IndexCommand::Build => commands::index::build(&cli),
            IndexCommand::Update => commands::index::update(&cli),
        },

        Command::Doctor => unreachable!(), // Handled above
    }
}
