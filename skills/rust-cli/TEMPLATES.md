# Rust CLI Templates

Starter templates for building Rust CLI applications.

## Workspace

### Cargo.toml (Workspace Root)

```toml
[workspace]
resolver = "2"
members = [
    "crates/{{project}}-core",
    "crates/{{project}}-cli",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
authors = ["Your Name"]
license = "MIT"
description = "{{description}}"

[workspace.dependencies]
# Core
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"
anyhow = "1.0"

# CLI
clap = { version = "4.5", features = ["derive", "env"] }

# Optional: Database
# rusqlite = { version = "0.32", features = ["bundled"] }

# Optional: Async
# tokio = { version = "1.43", features = ["full"] }

[profile.release]
lto = true
codegen-units = 1
panic = "abort"
strip = true
```

## Core Crate

### crates/{{project}}-core/Cargo.toml

```toml
[package]
name = "{{project}}-core"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
description = "Core types and logic for {{project}}"

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
```

### crates/{{project}}-core/src/lib.rs

```rust
//! {{project}}-core - Core types and business logic
//!
//! This crate provides the fundamental types and logic,
//! with no I/O or CLI dependencies.

pub mod types;
pub mod errors;

pub use types::*;
pub use errors::*;
```

### crates/{{project}}-core/src/types.rs

```rust
//! Core type definitions

use serde::{Deserialize, Serialize};

/// Configuration for the application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Path to data directory
    pub data_dir: std::path::PathBuf,

    /// Enable verbose output
    #[serde(default)]
    pub verbose: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            data_dir: std::path::PathBuf::from("."),
            verbose: false,
        }
    }
}

/// Status for diagnostic checks
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticStatus {
    Pass,
    Warn,
    Fail,
}

/// Result of a diagnostic check
#[derive(Debug, Clone)]
pub struct DiagnosticResult {
    pub name: String,
    pub status: DiagnosticStatus,
    pub message: String,
    pub fix: Option<String>,
}
```

### crates/{{project}}-core/src/errors.rs

```rust
//! Error types for the core crate

use std::path::PathBuf;
use thiserror::Error;

/// Core errors
#[derive(Error, Debug)]
pub enum CoreError {
    #[error("File not found: {0}")]
    NotFound(PathBuf),

    #[error("Invalid format: expected {expected}, got {actual}")]
    InvalidFormat { expected: String, actual: String },

    #[error("Not initialized (run: {{project}} init)")]
    NotInitialized,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
```

## CLI Crate

### crates/{{project}}-cli/Cargo.toml

```toml
[package]
name = "{{project}}"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
description.workspace = true

[[bin]]
name = "{{project}}"
path = "src/main.rs"

[dependencies]
{{project}}-core = { path = "../{{project}}-core" }
clap.workspace = true
anyhow.workspace = true
```

### crates/{{project}}-cli/src/cli.rs

```rust
//! CLI argument parsing

use clap::Parser;

/// {{description}}
#[derive(Parser, Debug)]
#[command(name = "{{project}}")]
#[command(author, version, about)]
pub struct Cli {
    /// Input file or identifier
    #[arg(value_name = "INPUT", required_unless_present_any = ["list", "stats", "doctor"])]
    pub input: Option<String>,

    /// Enable verbose output
    #[arg(short, long)]
    pub verbose: bool,

    /// Configuration file path
    #[arg(short, long, env = "{{PROJECT}}_CONFIG")]
    pub config: Option<std::path::PathBuf>,

    /// List available items and exit
    #[arg(long)]
    pub list: bool,

    /// Show statistics and exit
    #[arg(long)]
    pub stats: bool,

    /// Run diagnostics and exit
    #[arg(long)]
    pub doctor: bool,
}
```

### crates/{{project}}-cli/src/main.rs

```rust
//! {{project}} - {{description}}

mod cli;

use anyhow::{Context, Result};
use clap::Parser;

use cli::Cli;
use {{project}}_core::{Config, CoreError, DiagnosticResult, DiagnosticStatus};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle early-exit commands
    if cli.doctor {
        return run_doctor();
    }

    if cli.list {
        return list_items();
    }

    if cli.stats {
        return show_stats();
    }

    // Main logic requires input
    let input = cli.input.expect("input required");

    // Load config
    let config = load_config(&cli)?;

    // Run main logic
    run(&input, &config)?;

    Ok(())
}

fn load_config(cli: &Cli) -> Result<Config> {
    if let Some(path) = &cli.config {
        let content = std::fs::read_to_string(path)
            .context(format!("Failed to read config from {}", path.display()))?;
        let config: Config = serde_json::from_str(&content)
            .context("Failed to parse config")?;
        Ok(config)
    } else {
        Ok(Config::default())
    }
}

fn run(input: &str, config: &Config) -> Result<()> {
    if config.verbose {
        eprintln!("Processing: {}", input);
    }

    println!("Hello from {{project}}!");
    println!("Input: {}", input);

    Ok(())
}

fn list_items() -> Result<()> {
    println!("Available Items");
    println!("===============");
    println!("  (none configured)");
    Ok(())
}

fn show_stats() -> Result<()> {
    println!("Statistics");
    println!("==========");
    println!("Items: 0");
    Ok(())
}

fn run_doctor() -> Result<()> {
    println!("Running diagnostics...\n");

    let checks = vec![
        check_rust_version(),
        check_config_exists(),
    ];

    let mut has_failures = false;
    for result in &checks {
        print_diagnostic(result);
        if result.status == DiagnosticStatus::Fail {
            has_failures = true;
        }
    }

    if has_failures {
        println!("\nSome checks failed. Run suggested fixes and try again.");
        std::process::exit(1);
    }

    println!("\nAll checks passed!");
    Ok(())
}

fn check_rust_version() -> DiagnosticResult {
    DiagnosticResult {
        name: "Rust version".to_string(),
        status: DiagnosticStatus::Pass,
        message: format!("rustc {}", env!("CARGO_PKG_RUST_VERSION", "1.70+")),
        fix: None,
    }
}

fn check_config_exists() -> DiagnosticResult {
    let config_path = std::path::Path::new("config.json");
    if config_path.exists() {
        DiagnosticResult {
            name: "Config file".to_string(),
            status: DiagnosticStatus::Pass,
            message: "config.json found".to_string(),
            fix: None,
        }
    } else {
        DiagnosticResult {
            name: "Config file".to_string(),
            status: DiagnosticStatus::Warn,
            message: "config.json not found (using defaults)".to_string(),
            fix: Some("echo '{}' > config.json".to_string()),
        }
    }
}

fn print_diagnostic(result: &DiagnosticResult) {
    let (symbol, color) = match result.status {
        DiagnosticStatus::Pass => ("✓", "32"),
        DiagnosticStatus::Warn => ("⚠", "33"),
        DiagnosticStatus::Fail => ("✗", "31"),
    };

    println!(
        "\x1b[{}m{}\x1b[0m {}: {}",
        color, symbol, result.name, result.message
    );

    if let Some(fix) = &result.fix {
        println!("    Fix: {}", fix);
    }
}
```

## Usage

1. Replace all `{{project}}` with your project name (e.g., `my-tool`)
2. Replace `{{PROJECT}}` with uppercase version (e.g., `MY_TOOL`)
3. Replace `{{description}}` with your project description
4. Run `cargo build` to verify structure
5. Run `cargo run -- --help` to test CLI
