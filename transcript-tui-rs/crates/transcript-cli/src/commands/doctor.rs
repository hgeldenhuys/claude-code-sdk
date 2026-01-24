//! Doctor command - diagnose transcript indexing pipeline

use anyhow::Result;
use std::path::PathBuf;
use transcript_db::{default_db_path, TranscriptDb, DB_VERSION};

use crate::cli::{Cli, OutputFormat};
use crate::output::colors;

pub fn run(cli: &Cli, db: Option<TranscriptDb>) -> Result<()> {
    let mut checks: Vec<Check> = Vec::new();

    // Check 1: Database file exists
    let db_path = cli.db_path.clone().unwrap_or_else(default_db_path);
    let db_exists = db_path.exists();
    checks.push(Check {
        name: "Database file".to_string(),
        passed: db_exists,
        details: if db_exists {
            format!("Found at {}", db_path.display())
        } else {
            format!("Not found at {}", db_path.display())
        },
    });

    // Check 2: Database can be opened
    let db_opens = db.is_some();
    checks.push(Check {
        name: "Database opens".to_string(),
        passed: db_opens,
        details: if db_opens {
            "Successfully opened".to_string()
        } else {
            "Failed to open (version mismatch or corruption?)".to_string()
        },
    });

    // Check 3: Schema version
    if let Some(ref db) = db {
        let stats = db.stats();
        if let Ok(stats) = stats {
            let version_ok = stats.version >= DB_VERSION;
            checks.push(Check {
                name: "Schema version".to_string(),
                passed: version_ok,
                details: format!(
                    "v{} (expected >= v{})",
                    stats.version, DB_VERSION
                ),
            });
        }
    }

    // Check 4: FTS tables exist
    if let Some(ref db) = db {
        let fts_ok = check_fts_tables(db);
        checks.push(Check {
            name: "FTS tables".to_string(),
            passed: fts_ok,
            details: if fts_ok {
                "lines_fts table exists".to_string()
            } else {
                "lines_fts table missing".to_string()
            },
        });
    }

    // Check 5: Has sessions
    if let Some(ref db) = db {
        let sessions = db.get_sessions(Some(7));
        match sessions {
            Ok(sessions) => {
                let has_sessions = !sessions.is_empty();
                checks.push(Check {
                    name: "Has data".to_string(),
                    passed: has_sessions,
                    details: if has_sessions {
                        format!("{} sessions in last 7 days", sessions.len())
                    } else {
                        "No recent sessions".to_string()
                    },
                });
            }
            Err(e) => {
                checks.push(Check {
                    name: "Has data".to_string(),
                    passed: false,
                    details: format!("Query failed: {}", e),
                });
            }
        }
    }

    // Check 6: Transcript source directories
    let claude_dir = dirs::home_dir()
        .map(|h| h.join(".claude"))
        .unwrap_or_else(|| PathBuf::from("~/.claude"));
    let projects_dir = claude_dir.join("projects");
    let projects_exist = projects_dir.exists();
    checks.push(Check {
        name: "Transcript source".to_string(),
        passed: projects_exist,
        details: if projects_exist {
            format!("Found at {}", projects_dir.display())
        } else {
            format!("Not found at {}", projects_dir.display())
        },
    });

    // Output results
    match cli.effective_format() {
        OutputFormat::Human => {
            println!("{}", colors::header("Transcript Indexing Doctor"));
            println!();

            let all_passed = checks.iter().all(|c| c.passed);

            for check in &checks {
                let status = if check.passed {
                    colors::success(&check.name)
                } else {
                    colors::error(&check.name)
                };
                println!("  {} - {}", status, check.details);
            }

            println!();
            if all_passed {
                println!("{}", colors::success("All checks passed"));
            } else {
                println!("{}", colors::error("Some checks failed"));
                println!();
                println!("To fix:");
                if !db_exists {
                    println!("  1. Run: bun run bin/transcript.ts index build");
                } else if !db_opens {
                    println!("  1. Run: bun run bin/transcript.ts index rebuild");
                }
            }
        }

        OutputFormat::Json => {
            let output = serde_json::json!({
                "checks": checks.iter().map(|c| serde_json::json!({
                    "name": c.name,
                    "passed": c.passed,
                    "details": c.details
                })).collect::<Vec<_>>(),
                "all_passed": checks.iter().all(|c| c.passed)
            });
            if cli.pretty {
                println!("{}", serde_json::to_string_pretty(&output)?);
            } else {
                println!("{}", serde_json::to_string(&output)?);
            }
        }

        OutputFormat::Minimal => {
            let failed: Vec<_> = checks.iter().filter(|c| !c.passed).collect();
            if failed.is_empty() {
                println!("ok");
            } else {
                for c in failed {
                    println!("FAIL: {}", c.name);
                }
            }
        }
    }

    Ok(())
}

struct Check {
    name: String,
    passed: bool,
    details: String,
}

fn check_fts_tables(db: &TranscriptDb) -> bool {
    let result: Result<i64, _> = db.connection().query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lines_fts'",
        [],
        |row| row.get(0),
    );
    matches!(result, Ok(1))
}
