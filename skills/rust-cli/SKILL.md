# Rust CLI Development Skill

Build high-performance Rust command-line applications with clean architecture.

## Quick Reference

| Pattern | Purpose | See |
|---------|---------|-----|
| Workspace | Multi-crate monorepo | [Templates](TEMPLATES.md#workspace) |
| Clap derive | Type-safe CLI args | [Templates](TEMPLATES.md#cli-arguments) |
| thiserror | Domain errors in core | [Templates](TEMPLATES.md#errors) |
| anyhow | Error context in CLI | [Examples](EXAMPLES.md#error-handling) |
| Doctor command | Diagnostic checks | [Doctor](DOCTOR.md) |
| Builder pattern | Fluent configuration | [Patterns](PATTERNS.md#builder-pattern) |

## Workspace Structure

```
my-cli/
├── Cargo.toml              # Workspace manifest
├── crates/
│   ├── my-core/            # Types, logic, no I/O
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs      # pub mod declarations
│   │       ├── types.rs    # Domain types
│   │       └── errors.rs   # thiserror enums
│   └── my-cli/             # Binary, clap, main()
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs     # Entry point
│           └── cli.rs      # Clap structs
└── reference/              # (optional) Reference implementation
```

## CLI Argument Patterns

### Basic Structure (clap derive)

```rust
use clap::Parser;

#[derive(Parser, Debug)]
#[command(name = "my-cli")]
#[command(version, about)]
pub struct Cli {
    /// Required positional argument
    #[arg(value_name = "INPUT")]
    pub input: String,

    /// Optional with default
    #[arg(short, long, default_value = "output.txt")]
    pub output: String,

    /// Flag (bool)
    #[arg(short, long)]
    pub verbose: bool,

    /// Environment variable fallback
    #[arg(long, env = "MY_CLI_CONFIG")]
    pub config: Option<std::path::PathBuf>,
}
```

### Early-Exit Commands

Use `required_unless_present_any` for commands that don't need the main argument:

```rust
#[derive(Parser, Debug)]
pub struct Cli {
    /// Main input (not required if using --stats or --list)
    #[arg(value_name = "INPUT", required_unless_present_any = ["stats", "list", "doctor"])]
    pub input: Option<String>,

    /// Show statistics and exit
    #[arg(long)]
    pub stats: bool,

    /// List available items and exit
    #[arg(long)]
    pub list: bool,

    /// Run diagnostics and exit
    #[arg(long)]
    pub doctor: bool,
}
```

### Value Constraints

```rust
/// Numeric range
#[arg(short, long, default_value = "2", value_parser = clap::value_parser!(u8).range(1..=5))]
pub mode: u8,

/// Comma-separated list
#[arg(short, long, value_delimiter = ',')]
pub types: Option<Vec<String>>,

/// Value choices from enum
#[arg(short, long, value_enum, default_value_t = Format::Json)]
pub format: Format,
```

## Error Handling

### Core Crate (thiserror)

Define domain-specific errors with helpful messages:

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CoreError {
    #[error("File not found: {0}")]
    NotFound(std::path::PathBuf),

    #[error("Invalid format: expected {expected}, got {actual}")]
    InvalidFormat { expected: String, actual: String },

    #[error("Database not initialized (run: my-cli init)")]
    NotInitialized,
}
```

### CLI Crate (anyhow)

Wrap errors with context for better debugging:

```rust
use anyhow::{Context, Result};

fn load_config(path: &Path) -> Result<Config> {
    let content = std::fs::read_to_string(path)
        .context(format!("Failed to read config from {}", path.display()))?;

    serde_json::from_str(&content)
        .context("Failed to parse config as JSON")?
}
```

### Pattern: Early Exit with Helpful Messages

```rust
fn open_database(path: &Path) -> Result<Database> {
    match Database::open(path) {
        Ok(db) => Ok(db),
        Err(CoreError::NotFound(path)) => {
            eprintln!("Database not found at: {}", path.display());
            eprintln!("Run: my-cli init");
            std::process::exit(1);
        }
        Err(CoreError::NotInitialized) => {
            eprintln!("Database not initialized. Run: my-cli init");
            std::process::exit(1);
        }
        Err(e) => Err(e.into()),
    }
}
```

## Colorblind-Friendly Output

Use shapes + colors (never color alone):

| Status | Symbol | ANSI Code | Color |
|--------|--------|-----------|-------|
| Pass   | `✓`    | 32        | Green |
| Warn   | `⚠`    | 33        | Yellow |
| Fail   | `✗`    | 31        | Red |
| Info   | `ℹ`    | 36        | Cyan |

```rust
fn print_status(status: Status, message: &str) {
    match status {
        Status::Pass => println!("\x1b[32m✓\x1b[0m {}", message),
        Status::Warn => println!("\x1b[33m⚠\x1b[0m {}", message),
        Status::Fail => println!("\x1b[31m✗\x1b[0m {}", message),
        Status::Info => println!("\x1b[36mℹ\x1b[0m {}", message),
    }
}
```

## TypeScript to Rust Mapping

| TypeScript | Rust |
|------------|------|
| `interface Foo { ... }` | `struct Foo { ... }` |
| `foo?: string` | `foo: Option<String>` |
| `foo: string \| null` | `foo: Option<String>` |
| `Record<string, T>` | `HashMap<String, T>` |
| `foo[]` | `Vec<Foo>` |
| `console.log()` | `println!()` |
| `console.error()` | `eprintln!()` |
| `process.exit(1)` | `std::process::exit(1)` |
| `JSON.parse()` | `serde_json::from_str()` |
| `JSON.stringify()` | `serde_json::to_string()` |
| `async/await` | `tokio` + `async/await` |
| `try/catch` | `Result<T, E>` + `?` |
| `throw new Error()` | `return Err(...)` |
| `enum { A, B }` | `enum Foo { A, B }` |

### Serde Attributes for JSON

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyType {
    // Rename for JSON
    #[serde(rename = "camelCase")]
    pub camel_case: String,

    // Optional with default
    #[serde(default)]
    pub optional: Option<String>,

    // Skip if None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub maybe: Option<i32>,
}

// Tagged enum for discriminated unions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String },
}
```

## Release Profile

Add to workspace `Cargo.toml` for optimized binaries:

```toml
[profile.release]
lto = true           # Link-time optimization
codegen-units = 1    # Single codegen unit (slower compile, faster binary)
panic = "abort"      # Smaller binary, no unwinding
strip = true         # Strip symbols
```

## Workflows

### New CLI Project

1. Create workspace structure (see [Templates](TEMPLATES.md#workspace))
2. Add core crate with types and errors
3. Add CLI crate with clap and main
4. Implement early-exit commands (--help, --version, --list, --stats)
5. Add doctor command for diagnostics
6. Configure release profile

### Converting TypeScript CLI

1. Map interfaces to structs with serde derives
2. Convert optional fields to `Option<T>`
3. Replace `commander`/`yargs` with clap derive
4. Use thiserror for error types
5. Wrap with anyhow in main
6. Test with `cargo run -- --help`

## Reference Implementation

See `reference/` for a minimal working example:

- `reference/Cargo.toml` - Workspace manifest
- `reference/crates/core/` - Types and errors
- `reference/crates/cli/` - Binary with clap

Build with: `cd reference && cargo build --release`

## Related Files

- [TEMPLATES.md](TEMPLATES.md) - Starter templates
- [EXAMPLES.md](EXAMPLES.md) - Real code examples
- [PATTERNS.md](PATTERNS.md) - Common patterns
- [DOCTOR.md](DOCTOR.md) - Doctor command guide
