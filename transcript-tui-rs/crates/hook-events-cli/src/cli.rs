//! CLI argument definitions for hook-events

use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

/// CLI for viewing and querying Claude Code hook events
#[derive(Parser, Debug)]
#[command(name = "hook-events")]
#[command(author = "Claude Code SDK")]
#[command(version)]
#[command(about = "View and query Claude Code hook events")]
#[command(propagate_version = true)]
pub struct Cli {
    /// Custom database path
    #[arg(long, global = true, env = "TRANSCRIPT_DB_PATH")]
    pub db_path: Option<PathBuf>,

    /// Output format (auto-detects based on TTY if not specified)
    #[arg(long, short = 'f', global = true)]
    pub format: Option<OutputFormat>,

    /// Output raw JSON (alias for --format json)
    #[arg(long, global = true)]
    pub json: bool,

    /// Output human-readable (alias for --format human)
    #[arg(long, short = 'H', global = true)]
    pub human: bool,

    /// Output minimal text (alias for --format minimal)
    #[arg(long, short = 'm', global = true)]
    pub minimal: bool,

    /// Pretty-print JSON with indentation
    #[arg(long, short = 'p', global = true)]
    pub pretty: bool,

    /// Force color output
    #[arg(long, global = true)]
    pub color: bool,

    /// Disable color output
    #[arg(long, global = true)]
    pub no_color: bool,

    #[command(subcommand)]
    pub command: Command,
}

impl Cli {
    /// Get the effective output format
    pub fn effective_format(&self) -> OutputFormat {
        if self.json {
            return OutputFormat::Json;
        }
        if self.human {
            return OutputFormat::Human;
        }
        if self.minimal {
            return OutputFormat::Minimal;
        }
        if let Some(f) = self.format {
            return f;
        }
        if atty::is(atty::Stream::Stdout) {
            OutputFormat::Human
        } else {
            OutputFormat::Json
        }
    }

    /// Check if colors should be used
    pub fn use_color(&self) -> bool {
        if self.no_color {
            return false;
        }
        if self.color {
            return true;
        }
        atty::is(atty::Stream::Stdout)
    }
}

/// Output format
#[derive(Debug, Clone, Copy, ValueEnum, Default, PartialEq, Eq)]
pub enum OutputFormat {
    /// Human-readable output with colors
    #[default]
    Human,
    /// JSON output (one object per line)
    Json,
    /// Minimal single-line output
    Minimal,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// View hook events for a session
    View {
        /// Session name, ID, or "." for most recent
        session: String,

        /// Filter by event type (comma-separated)
        #[arg(short, long, value_delimiter = ',')]
        event: Option<Vec<String>>,

        /// Filter by tool name (comma-separated)
        #[arg(short, long, value_delimiter = ',')]
        tool: Option<Vec<String>>,

        /// Show last N events
        #[arg(long)]
        last: Option<i64>,

        /// Show first N events
        #[arg(long)]
        first: Option<i64>,

        /// Limit results (default 100)
        #[arg(long)]
        limit: Option<i64>,

        /// Skip first N results
        #[arg(long)]
        offset: Option<i64>,

        /// Events after this time (HH:MM or ISO)
        #[arg(long)]
        from_time: Option<String>,

        /// Events before this time
        #[arg(long)]
        to_time: Option<String>,

        /// Stream new events (poll every 500ms)
        #[arg(long)]
        tail: bool,

        /// Show last event, update on change
        #[arg(long)]
        watch: bool,
    },

    /// List sessions with hook events
    List {
        /// Show sessions from last N days
        #[arg(long)]
        recent: Option<i64>,

        /// Show session IDs only
        #[arg(long)]
        names: bool,
    },

    /// Show session statistics
    Info {
        /// Session name, ID, or "." for most recent
        session: String,
    },

    /// Search across all hook events
    Search {
        /// Search query
        query: String,

        /// Limit results
        #[arg(short = 'n', long, default_value = "50")]
        limit: i64,
    },

    /// List files edited in a session
    Files {
        /// Session name, ID, or "." for most recent
        session: String,

        /// Include file statistics
        #[arg(long)]
        stats: bool,
    },
}
