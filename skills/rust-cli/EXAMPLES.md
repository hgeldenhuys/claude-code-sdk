# Rust CLI Examples

Real code examples from the transcript-tui-rs project.

## CLI Argument Parsing

From `transcript-tui/src/cli.rs`:

```rust
use clap::Parser;

/// High-performance transcript viewer for Claude Code sessions
#[derive(Parser, Debug)]
#[command(name = "transcript-tui-rs")]
#[command(author = "Claude Code SDK")]
#[command(version)]
#[command(about = "Interactive TUI for browsing Claude Code transcripts")]
pub struct Cli {
    /// Session name, ID, or file path to view
    ///
    /// Can be:
    /// - A session name (e.g., "tender-spider")
    /// - A session ID (UUID)
    /// - A direct path to a .jsonl file
    /// - Comma-separated list for multi-session view
    #[arg(value_name = "SESSION", required_unless_present_any = ["stats", "list"])]
    pub session: Option<String>,

    /// Start in live mode (watch for new lines)
    #[arg(short, long)]
    pub live: bool,

    /// Initial view mode (1=json, 2=custom)
    #[arg(short, long, default_value = "2", value_parser = clap::value_parser!(u8).range(1..=2))]
    pub mode: u8,

    /// Jump to specific line number
    #[arg(short = 'n', long)]
    pub line: Option<i64>,

    /// Filter to specific types (user, assistant, system, tool)
    #[arg(short, long, value_delimiter = ',')]
    pub types: Option<Vec<String>>,

    /// Show only text content (no metadata)
    #[arg(short = 'o', long)]
    pub text_only: bool,

    /// Custom database path
    #[arg(long, env = "TRANSCRIPT_DB_PATH")]
    pub db_path: Option<std::path::PathBuf>,

    /// Show database statistics and exit
    #[arg(long)]
    pub stats: bool,

    /// List recent sessions and exit
    #[arg(long)]
    pub list: bool,
}
```

## Error Handling

From `transcript-db/src/connection.rs`:

```rust
use std::path::PathBuf;
use thiserror::Error;

/// Database errors
#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database not found at {0}")]
    NotFound(PathBuf),

    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Database not initialized (run: transcript index build)")]
    NotInitialized,

    #[error("Database version mismatch: expected {expected}, found {found}")]
    VersionMismatch { expected: i32, found: i32 },
}
```

## Main Entry Point

From `transcript-tui/src/main.rs`:

```rust
use anyhow::{Context, Result};
use clap::Parser;

use cli::Cli;
use transcript_db::{DbError, TranscriptDb};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle early-exit commands first
    if cli.stats {
        return show_stats(&cli);
    }

    if cli.list {
        return list_sessions(&cli);
    }

    // Open database with helpful error messages
    let db = open_database(&cli)?;

    // Get session (required at this point)
    let session = cli.session.as_ref().expect("session required");

    // Resolve session and load lines
    let (session_id, lines) = load_session(&db, session)?;

    if lines.is_empty() {
        eprintln!("No transcript lines found for: {}", session);
        return Ok(());
    }

    // Run main application
    run_tui(app, db)
}

/// Open the database with helpful error messages
fn open_database(cli: &Cli) -> Result<TranscriptDb> {
    let db = if let Some(path) = &cli.db_path {
        TranscriptDb::open(path)
    } else {
        TranscriptDb::open_default()
    };

    match db {
        Ok(db) => Ok(db),
        Err(DbError::NotFound(path)) => {
            eprintln!("Database not found at: {}", path.display());
            eprintln!("Run: transcript index build");
            std::process::exit(1);
        }
        Err(DbError::NotInitialized) => {
            eprintln!("Database not initialized. Run: transcript index build");
            std::process::exit(1);
        }
        Err(e) => Err(e.into()),
    }
}
```

## Session Resolution with Suggestions

```rust
fn load_session(db: &TranscriptDb, session_input: &str) -> Result<(String, Vec<TranscriptLine>)> {
    let session = db
        .resolve_session(session_input)
        .context("Failed to resolve session")?;

    match session {
        Some(info) => {
            let options = GetLinesOptions::for_session(&info.session_id);
            let lines = db.get_lines(&options).context("Failed to load lines")?;
            Ok((info.session_id, lines))
        }
        None => {
            // Try partial match
            let sessions = db
                .find_sessions(session_input)
                .context("Failed to search sessions")?;

            if sessions.is_empty() {
                eprintln!("Session not found: {}", session_input);
                eprintln!("\nRecent sessions:");
                if let Ok(recent) = db.get_sessions(Some(7)) {
                    for s in recent.iter().take(10) {
                        let name = s.slug.as_deref().unwrap_or(&s.session_id[..8]);
                        eprintln!("  {} ({} lines)", name, s.line_count);
                    }
                }
                std::process::exit(1);
            }

            if sessions.len() == 1 {
                let info = &sessions[0];
                let options = GetLinesOptions::for_session(&info.session_id);
                let lines = db.get_lines(&options).context("Failed to load lines")?;
                Ok((info.session_id.clone(), lines))
            } else {
                eprintln!("Multiple sessions match '{}'. Be more specific:", session_input);
                for s in &sessions {
                    let name = s.slug.as_deref().unwrap_or(&s.session_id[..8]);
                    eprintln!("  {} ({} lines)", name, s.line_count);
                }
                std::process::exit(1);
            }
        }
    }
}
```

## Statistics Display

```rust
fn show_stats(cli: &Cli) -> Result<()> {
    let db = open_database(cli)?;
    let stats = db.stats().context("Failed to get stats")?;

    println!("Transcript Database Statistics");
    println!("==============================");
    println!("Version:      {}", stats.version);
    println!("Lines:        {}", stats.line_count);
    println!("Sessions:     {}", stats.session_count);
    println!("Hook Events:  {}", stats.hook_event_count);
    println!("Size:         {}", stats.format_size());
    println!("Path:         {}", stats.db_path.display());
    if let Some(indexed) = &stats.last_indexed {
        println!("Last Indexed: {}", indexed);
    }

    Ok(())
}
```

## List Sessions

```rust
fn list_sessions(cli: &Cli) -> Result<()> {
    let db = open_database(cli)?;
    let sessions = db.get_sessions(Some(30)).context("Failed to get sessions")?;

    println!("Recent Sessions (last 30 days)");
    println!("==============================");

    for s in sessions {
        let name = s.slug.as_deref().unwrap_or(&s.session_id[..8]);
        let last = s.last_timestamp.as_deref().unwrap_or("unknown");
        println!("{:20} {:6} lines  {}", name, s.line_count, last);
    }

    Ok(())
}
```

## Type Definitions with Serde

From `transcript-core/src/types.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Token usage statistics for a message
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens.unwrap_or(0)
            + self.cache_read_input_tokens.unwrap_or(0)
    }
}

/// Content block types - tagged enum for discriminated unions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        #[serde(default)]
        is_error: bool,
    },
    Thinking {
        thinking: String,
        #[serde(default)]
        signature: Option<String>,
    },
}
```

## Database Statistics Struct

```rust
#[derive(Debug, Clone)]
pub struct DbStats {
    pub version: i32,
    pub line_count: i64,
    pub session_count: i64,
    pub hook_event_count: i64,
    pub last_indexed: Option<String>,
    pub db_path: PathBuf,
    pub db_size_bytes: u64,
}

impl DbStats {
    /// Format database size as human-readable string
    pub fn format_size(&self) -> String {
        let bytes = self.db_size_bytes as f64;
        if bytes < 1024.0 {
            format!("{} B", bytes)
        } else if bytes < 1024.0 * 1024.0 {
            format!("{:.1} KB", bytes / 1024.0)
        } else if bytes < 1024.0 * 1024.0 * 1024.0 {
            format!("{:.1} MB", bytes / (1024.0 * 1024.0))
        } else {
            format!("{:.1} GB", bytes / (1024.0 * 1024.0 * 1024.0))
        }
    }
}
```

## Filter Options with Builder

From `transcript-core/src/filter.rs`:

```rust
use std::collections::HashSet;

#[derive(Debug, Clone, Default)]
pub struct FilterOptions {
    pub types: Option<Vec<LineType>>,
    pub display_types: Option<Vec<String>>,
    pub search: Option<String>,
    pub session_ids: Option<Vec<String>>,
    pub exclude_types: Option<Vec<LineType>>,
}

impl FilterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn conversations_only() -> Self {
        Self {
            types: Some(vec![LineType::User, LineType::Assistant]),
            ..Default::default()
        }
    }

    pub fn with_types(mut self, types: Vec<LineType>) -> Self {
        self.types = Some(types);
        self
    }

    pub fn with_display_types(mut self, types: Vec<String>) -> Self {
        self.display_types = Some(types);
        self
    }

    pub fn with_search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }
}

/// Filter transcript lines based on options
pub fn filter_lines<'a>(
    lines: &'a [TranscriptLine],
    options: &FilterOptions,
) -> Vec<&'a TranscriptLine> {
    let mut result: Vec<&TranscriptLine> = lines.iter().collect();

    // Filter by line type
    if let Some(types) = &options.types {
        let type_set: HashSet<_> = types.iter().collect();
        result.retain(|line| type_set.contains(&line.line_type));
    }

    // Text search (case-insensitive)
    if let Some(search) = &options.search {
        let search_lower = search.to_lowercase();
        result.retain(|line| {
            if let Some(content) = &line.content {
                if content.to_lowercase().contains(&search_lower) {
                    return true;
                }
            }
            line.raw.to_lowercase().contains(&search_lower)
        });
    }

    result
}
```

## Workspace Cargo.toml

From the transcript-tui-rs project:

```toml
[workspace]
resolver = "2"
members = [
    "crates/transcript-core",
    "crates/transcript-db",
    "crates/transcript-ui",
    "crates/transcript-tui",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Claude Code SDK"]
license = "MIT"
description = "High-performance transcript viewer for Claude Code sessions"

[workspace.dependencies]
# Core
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"
anyhow = "1.0"

# Database
rusqlite = { version = "0.32", features = ["bundled"] }

# TUI
ratatui = "0.29"
crossterm = "0.28"

# CLI
clap = { version = "4.5", features = ["derive", "env"] }

[profile.release]
lto = true
codegen-units = 1
panic = "abort"
strip = true
```
