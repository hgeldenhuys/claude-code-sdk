//! CLI argument definitions

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// CLI for managing Claude Code transcripts
#[derive(Parser, Debug)]
#[command(name = "transcript")]
#[command(author = "Claude Code SDK")]
#[command(version)]
#[command(about = "CLI for managing Claude Code transcripts")]
#[command(propagate_version = true)]
pub struct Cli {
    /// Custom database path
    #[arg(long, global = true, env = "TRANSCRIPT_DB_PATH")]
    pub db_path: Option<PathBuf>,

    /// Output format
    #[arg(long, short = 'f', global = true, default_value = "human")]
    pub format: OutputFormat,

    #[command(subcommand)]
    pub command: Command,
}

/// Output format for commands
#[derive(Debug, Clone, Copy, ValueEnum, Default)]
pub enum OutputFormat {
    /// Human-readable output with colors
    #[default]
    Human,
    /// JSON output (one object per line for lists)
    Json,
    /// Minimal text output (content only)
    Minimal,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// View transcript lines for a session
    View {
        /// Session name, ID, or file path
        session: String,

        /// Filter by line type (user, assistant, system, tool)
        #[arg(short, long, value_delimiter = ',')]
        types: Option<Vec<String>>,

        /// Show last N lines
        #[arg(long)]
        last: Option<i64>,

        /// Show first N lines
        #[arg(long)]
        first: Option<i64>,

        /// Search for text in content
        #[arg(long, short)]
        search: Option<String>,

        /// Start from this time (ISO format or HH:MM:SS)
        #[arg(long)]
        from_time: Option<String>,

        /// End at this time (ISO format or HH:MM:SS)
        #[arg(long)]
        to_time: Option<String>,

        /// Start from line number
        #[arg(long)]
        from_line: Option<i64>,

        /// End at line number
        #[arg(long)]
        to_line: Option<i64>,

        /// Reverse order (newest first)
        #[arg(short, long)]
        reverse: bool,
    },

    /// List recent sessions
    List {
        /// Number of sessions to show
        #[arg(short = 'n', long, default_value = "20")]
        limit: i64,

        /// Filter to sessions from last N days
        #[arg(long)]
        days: Option<i64>,

        /// Search for sessions matching pattern
        #[arg(short, long)]
        search: Option<String>,
    },

    /// Show session information and statistics
    Info {
        /// Session name, ID, or file path
        session: String,
    },

    /// Search transcripts using full-text search
    Search {
        /// Search query
        query: String,

        /// Limit results
        #[arg(short = 'n', long, default_value = "50")]
        limit: i64,

        /// Filter to specific session
        #[arg(short, long)]
        session: Option<String>,

        /// Show context around matches
        #[arg(short = 'C', long, default_value = "0")]
        context: usize,
    },

    /// Index management subcommands
    #[command(subcommand)]
    Index(IndexCommand),

    /// Diagnose transcript indexing pipeline
    Doctor,
}

#[derive(Subcommand, Debug)]
pub enum IndexCommand {
    /// Show index status and statistics
    Status,

    /// Rebuild the entire index (requires daemon)
    Build,

    /// Update index with new content (requires daemon)
    Update,
}
