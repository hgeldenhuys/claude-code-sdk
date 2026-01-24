# Rust CLI Patterns

Common patterns for building robust Rust CLIs.

## Builder Pattern

Fluent API for configuring options:

```rust
/// Filter options with builder pattern
#[derive(Debug, Clone, Default)]
pub struct FilterOptions {
    pub types: Option<Vec<String>>,
    pub search: Option<String>,
    pub limit: Option<usize>,
    pub exclude: Option<Vec<String>>,
}

impl FilterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_types(mut self, types: Vec<String>) -> Self {
        self.types = Some(types);
        self
    }

    pub fn with_search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn exclude(mut self, exclude: Vec<String>) -> Self {
        self.exclude = Some(exclude);
        self
    }
}

// Usage
let filter = FilterOptions::new()
    .with_types(vec!["user".to_string(), "assistant".to_string()])
    .with_search("error")
    .with_limit(100);
```

### Preset Constructors

```rust
impl FilterOptions {
    /// Only user and assistant messages
    pub fn conversations_only() -> Self {
        Self {
            types: Some(vec!["user".to_string(), "assistant".to_string()]),
            ..Default::default()
        }
    }

    /// Exclude system messages
    pub fn exclude_system() -> Self {
        Self {
            exclude: Some(vec!["system".to_string(), "progress".to_string()]),
            ..Default::default()
        }
    }
}
```

## Type-Safe Enum Pattern

Use enums for type-safe options:

```rust
use serde::{Deserialize, Serialize};

/// View modes for content display
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ViewMode {
    #[default]
    Json,
    Custom,
    Markdown,
}

impl ViewMode {
    /// Get all view modes in order
    pub fn all() -> &'static [ViewMode] {
        &[ViewMode::Json, ViewMode::Custom, ViewMode::Markdown]
    }

    /// Get view mode from key (1-3)
    pub fn from_key(key: char) -> Option<ViewMode> {
        match key {
            '1' => Some(ViewMode::Json),
            '2' => Some(ViewMode::Custom),
            '3' => Some(ViewMode::Markdown),
            _ => None,
        }
    }

    /// Get display name
    pub fn name(&self) -> &'static str {
        match self {
            ViewMode::Json => "JSON",
            ViewMode::Custom => "CUSTOM",
            ViewMode::Markdown => "MARKDOWN",
        }
    }
}
```

### For CLI (with clap)

```rust
use clap::ValueEnum;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum OutputFormat {
    Json,
    Text,
    Table,
}

#[derive(Parser)]
pub struct Cli {
    #[arg(short, long, value_enum, default_value_t = OutputFormat::Text)]
    pub format: OutputFormat,
}
```

## Database Connection Pattern

Wrapper struct for database connections:

```rust
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database not found at {0}")]
    NotFound(PathBuf),

    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Database not initialized (run: my-cli init)")]
    NotInitialized,
}

pub const DB_VERSION: i32 = 1;

pub fn default_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home).join(".my-cli").join("data.db")
}

pub struct Database {
    conn: Connection,
    path: PathBuf,
}

impl Database {
    pub fn open_default() -> Result<Self, DbError> {
        Self::open(&default_db_path())
    }

    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, DbError> {
        let path = path.as_ref().to_path_buf();

        if !path.exists() {
            return Err(DbError::NotFound(path));
        }

        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        let db = Self { conn, path };
        db.check_version()?;

        Ok(db)
    }

    fn check_version(&self) -> Result<(), DbError> {
        let version: Option<i32> = self.conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .ok();

        match version {
            None => Err(DbError::NotInitialized),
            Some(v) if v < DB_VERSION => Err(DbError::NotInitialized),
            Some(_) => Ok(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}
```

## Event/Action Enum Pattern

Type-safe event handling:

```rust
/// Actions that can be triggered by user input
pub enum AppAction {
    Quit,
    SelectPrev,
    SelectNext,
    SelectFirst,
    SelectLast,
    PageUp,
    PageDown,
    TogglePane,
    SetViewMode(u8),
    ToggleFullscreen,
    ScrollUp,
    ScrollDown,
    ToggleHelp,
    None,
}

/// Handle keyboard event and return action
pub fn handle_event(event: Event) -> AppAction {
    match event {
        Event::Key(key) => match key.code {
            KeyCode::Char('q') => AppAction::Quit,
            KeyCode::Up | KeyCode::Char('k') => AppAction::SelectPrev,
            KeyCode::Down | KeyCode::Char('j') => AppAction::SelectNext,
            KeyCode::Char('g') => AppAction::SelectFirst,
            KeyCode::Char('G') => AppAction::SelectLast,
            KeyCode::PageUp => AppAction::PageUp,
            KeyCode::PageDown => AppAction::PageDown,
            KeyCode::Tab => AppAction::TogglePane,
            KeyCode::Char('?') => AppAction::ToggleHelp,
            KeyCode::Char(c) if c.is_ascii_digit() => {
                AppAction::SetViewMode(c.to_digit(10).unwrap() as u8)
            }
            _ => AppAction::None,
        },
        _ => AppAction::None,
    }
}

// Usage in main loop
loop {
    let action = handle_event(event::read()?);
    match action {
        AppAction::Quit => break,
        AppAction::SelectPrev => app.select_prev(),
        AppAction::SelectNext => app.select_next(),
        // ...
        AppAction::None => {}
    }
}
```

## Filtering Pattern

Generic filtering with predicates:

```rust
use std::collections::HashSet;

/// Filter items based on options
pub fn filter_items<'a, T>(
    items: &'a [T],
    options: &FilterOptions,
    get_type: impl Fn(&T) -> &str,
    get_content: impl Fn(&T) -> Option<&str>,
) -> Vec<&'a T> {
    let mut result: Vec<&T> = items.iter().collect();

    // Filter by type
    if let Some(types) = &options.types {
        let type_set: HashSet<_> = types.iter().map(|s| s.as_str()).collect();
        result.retain(|item| type_set.contains(get_type(item)));
    }

    // Exclude types
    if let Some(exclude) = &options.exclude {
        let exclude_set: HashSet<_> = exclude.iter().map(|s| s.as_str()).collect();
        result.retain(|item| !exclude_set.contains(get_type(item)));
    }

    // Text search (case-insensitive)
    if let Some(search) = &options.search {
        let search_lower = search.to_lowercase();
        result.retain(|item| {
            get_content(item)
                .map(|c| c.to_lowercase().contains(&search_lower))
                .unwrap_or(false)
        });
    }

    // Apply limit
    if let Some(limit) = options.limit {
        result.truncate(limit);
    }

    result
}
```

## Progress Reporting Pattern

For long-running operations:

```rust
pub struct Progress {
    total: usize,
    current: usize,
    last_percent: u8,
}

impl Progress {
    pub fn new(total: usize) -> Self {
        Self {
            total,
            current: 0,
            last_percent: 0,
        }
    }

    pub fn increment(&mut self) {
        self.current += 1;
        let percent = ((self.current as f64 / self.total as f64) * 100.0) as u8;
        if percent != self.last_percent {
            self.last_percent = percent;
            eprint!("\rProcessing... {}%", percent);
        }
    }

    pub fn finish(&self) {
        eprintln!("\rProcessing... done ({} items)", self.total);
    }
}

// Usage
let mut progress = Progress::new(items.len());
for item in &items {
    process(item)?;
    progress.increment();
}
progress.finish();
```

## Human-Readable Size Pattern

```rust
pub fn format_size(bytes: u64) -> String {
    let bytes = bytes as f64;
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
```

## Timestamp Formatting Pattern

```rust
/// Format ISO timestamp to HH:MM:SS
pub fn format_time(timestamp: &str) -> String {
    if let Some(time_part) = timestamp.split('T').nth(1) {
        if let Some(time) = time_part.split('.').next() {
            return time.to_string();
        }
    }
    timestamp.to_string()
}

/// Format duration in human-readable form
pub fn format_duration(seconds: u64) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else if seconds < 3600 {
        format!("{}m {}s", seconds / 60, seconds % 60)
    } else {
        format!("{}h {}m", seconds / 3600, (seconds % 3600) / 60)
    }
}
```
