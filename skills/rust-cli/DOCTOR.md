# Doctor Command Implementation

The `--doctor` command provides diagnostic checks to help users troubleshoot issues.

## DiagnosticResult Structure

```rust
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
    /// Check name (e.g., "Database connection")
    pub name: String,
    /// Status: Pass, Warn, or Fail
    pub status: DiagnosticStatus,
    /// Human-readable message
    pub message: String,
    /// Optional fix command
    pub fix: Option<String>,
}
```

## Diagnostic Check Functions

Each check should be a standalone function returning `DiagnosticResult`:

```rust
fn check_database_exists() -> DiagnosticResult {
    let path = default_db_path();
    if path.exists() {
        DiagnosticResult {
            name: "Database file".to_string(),
            status: DiagnosticStatus::Pass,
            message: format!("Found at {}", path.display()),
            fix: None,
        }
    } else {
        DiagnosticResult {
            name: "Database file".to_string(),
            status: DiagnosticStatus::Fail,
            message: format!("Not found at {}", path.display()),
            fix: Some("my-cli init".to_string()),
        }
    }
}

fn check_database_version() -> DiagnosticResult {
    match Database::open_default() {
        Ok(db) => {
            let version = db.version();
            if version >= REQUIRED_VERSION {
                DiagnosticResult {
                    name: "Database version".to_string(),
                    status: DiagnosticStatus::Pass,
                    message: format!("v{}", version),
                    fix: None,
                }
            } else {
                DiagnosticResult {
                    name: "Database version".to_string(),
                    status: DiagnosticStatus::Fail,
                    message: format!("v{} (requires v{})", version, REQUIRED_VERSION),
                    fix: Some("my-cli migrate".to_string()),
                }
            }
        }
        Err(e) => DiagnosticResult {
            name: "Database version".to_string(),
            status: DiagnosticStatus::Fail,
            message: format!("Cannot check: {}", e),
            fix: Some("my-cli init".to_string()),
        },
    }
}

fn check_config_file() -> DiagnosticResult {
    let config_path = config_path();
    if config_path.exists() {
        match std::fs::read_to_string(&config_path) {
            Ok(content) => match serde_json::from_str::<Config>(&content) {
                Ok(_) => DiagnosticResult {
                    name: "Config file".to_string(),
                    status: DiagnosticStatus::Pass,
                    message: "Valid JSON".to_string(),
                    fix: None,
                },
                Err(e) => DiagnosticResult {
                    name: "Config file".to_string(),
                    status: DiagnosticStatus::Fail,
                    message: format!("Invalid JSON: {}", e),
                    fix: None,
                },
            },
            Err(e) => DiagnosticResult {
                name: "Config file".to_string(),
                status: DiagnosticStatus::Fail,
                message: format!("Cannot read: {}", e),
                fix: None,
            },
        }
    } else {
        DiagnosticResult {
            name: "Config file".to_string(),
            status: DiagnosticStatus::Warn,
            message: "Not found (using defaults)".to_string(),
            fix: Some(format!("echo '{{}}' > {}", config_path.display())),
        }
    }
}

fn check_disk_space() -> DiagnosticResult {
    let path = default_db_path();
    if let Ok(metadata) = std::fs::metadata(&path) {
        let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
        if size_mb < 1000.0 {
            DiagnosticResult {
                name: "Disk usage".to_string(),
                status: DiagnosticStatus::Pass,
                message: format!("{:.1} MB", size_mb),
                fix: None,
            }
        } else {
            DiagnosticResult {
                name: "Disk usage".to_string(),
                status: DiagnosticStatus::Warn,
                message: format!("{:.1} MB (consider cleanup)", size_mb),
                fix: Some("my-cli cleanup --older-than 30d".to_string()),
            }
        }
    } else {
        DiagnosticResult {
            name: "Disk usage".to_string(),
            status: DiagnosticStatus::Warn,
            message: "Cannot determine".to_string(),
            fix: None,
        }
    }
}

fn check_permissions() -> DiagnosticResult {
    let path = default_db_path();
    match std::fs::OpenOptions::new().read(true).open(&path) {
        Ok(_) => DiagnosticResult {
            name: "File permissions".to_string(),
            status: DiagnosticStatus::Pass,
            message: "Readable".to_string(),
            fix: None,
        },
        Err(e) => DiagnosticResult {
            name: "File permissions".to_string(),
            status: DiagnosticStatus::Fail,
            message: format!("{}", e),
            fix: Some(format!("chmod 644 {}", path.display())),
        },
    }
}
```

## Output Formatting

Colorblind-friendly output with symbols + colors:

```rust
fn print_diagnostic(result: &DiagnosticResult) {
    let (symbol, color) = match result.status {
        DiagnosticStatus::Pass => ("✓", "32"),  // Green
        DiagnosticStatus::Warn => ("⚠", "33"),  // Yellow
        DiagnosticStatus::Fail => ("✗", "31"),  // Red
    };

    println!(
        "\x1b[{}m{}\x1b[0m {}: {}",
        color, symbol, result.name, result.message
    );

    if let Some(fix) = &result.fix {
        println!("    \x1b[36mFix:\x1b[0m {}", fix);
    }
}
```

## Running Doctor

```rust
fn run_doctor() -> Result<()> {
    println!("Running diagnostics...\n");

    let checks = vec![
        check_database_exists(),
        check_database_version(),
        check_config_file(),
        check_disk_space(),
        check_permissions(),
    ];

    let mut pass_count = 0;
    let mut warn_count = 0;
    let mut fail_count = 0;

    for result in &checks {
        print_diagnostic(result);
        match result.status {
            DiagnosticStatus::Pass => pass_count += 1,
            DiagnosticStatus::Warn => warn_count += 1,
            DiagnosticStatus::Fail => fail_count += 1,
        }
    }

    println!();
    println!(
        "Summary: {} passed, {} warnings, {} failed",
        pass_count, warn_count, fail_count
    );

    if fail_count > 0 {
        println!("\nRun suggested fixes and try again.");
        std::process::exit(1);
    }

    if warn_count > 0 {
        println!("\nWarnings may affect performance.");
    } else {
        println!("\n\x1b[32mAll checks passed!\x1b[0m");
    }

    Ok(())
}
```

## Auto-Fix Support

Add `--fix` flag to automatically run fix commands:

```rust
#[derive(Parser)]
pub struct Cli {
    /// Run diagnostics
    #[arg(long)]
    pub doctor: bool,

    /// Auto-fix issues found by doctor
    #[arg(long, requires = "doctor")]
    pub fix: bool,
}

fn run_doctor_with_fix(auto_fix: bool) -> Result<()> {
    println!("Running diagnostics...\n");

    let checks = vec![
        check_database_exists(),
        check_config_file(),
    ];

    for result in &checks {
        print_diagnostic(&result);

        if auto_fix && result.status == DiagnosticStatus::Fail {
            if let Some(fix) = &result.fix {
                println!("    \x1b[36mRunning:\x1b[0m {}", fix);
                let status = std::process::Command::new("sh")
                    .arg("-c")
                    .arg(fix)
                    .status();

                match status {
                    Ok(s) if s.success() => {
                        println!("    \x1b[32m✓ Fixed\x1b[0m");
                    }
                    _ => {
                        println!("    \x1b[31m✗ Fix failed\x1b[0m");
                    }
                }
            }
        }
    }

    Ok(())
}
```

## CLI Integration

```rust
fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.doctor {
        return run_doctor_with_fix(cli.fix);
    }

    // ... rest of main
}
```

## Example Output

```
Running diagnostics...

✓ Database file: Found at /home/user/.my-cli/data.db
✓ Database version: v3
⚠ Config file: Not found (using defaults)
    Fix: echo '{}' > /home/user/.my-cli/config.json
✓ Disk usage: 45.2 MB
✓ File permissions: Readable

Summary: 4 passed, 1 warnings, 0 failed

Warnings may affect performance.
```

## With Auto-Fix

```
$ my-cli --doctor --fix

Running diagnostics...

✓ Database file: Found at /home/user/.my-cli/data.db
✗ Config file: Not found
    Fix: echo '{}' > /home/user/.my-cli/config.json
    Running: echo '{}' > /home/user/.my-cli/config.json
    ✓ Fixed

Summary: 1 passed, 0 warnings, 1 failed (fixed)
```
