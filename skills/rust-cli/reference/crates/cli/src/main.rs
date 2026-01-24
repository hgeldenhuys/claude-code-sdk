//! example - Example CLI demonstrating rust-cli patterns

mod cli;

use anyhow::{Context, Result};
use clap::Parser;

use cli::Cli;
use example_core::{Config, DiagnosticResult, DiagnosticStatus};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle early-exit commands
    if cli.doctor {
        return run_doctor(cli.fix);
    }

    if cli.list {
        return list_items();
    }

    // Load config first (before moving cli.input)
    let config = load_config(&cli)?;

    // Main logic requires input
    let input = cli.input.expect("input required");

    // Run main logic
    run(&input, &config)?;

    Ok(())
}

fn load_config(cli: &Cli) -> Result<Config> {
    if let Some(path) = &cli.config {
        let content = std::fs::read_to_string(path)
            .context(format!("Failed to read config from {}", path.display()))?;
        let mut config: Config =
            serde_json::from_str(&content).context("Failed to parse config")?;
        config.verbose = cli.verbose || config.verbose;
        Ok(config)
    } else {
        Ok(Config {
            verbose: cli.verbose,
            ..Config::default()
        })
    }
}

fn run(input: &str, config: &Config) -> Result<()> {
    if config.verbose {
        eprintln!("Processing: {}", input);
    }

    println!("Hello from example CLI!");
    println!("Input: {}", input);

    Ok(())
}

fn list_items() -> Result<()> {
    println!("Available Items");
    println!("===============");
    println!("  item-1  Example item");
    println!("  item-2  Another item");
    Ok(())
}

fn run_doctor(auto_fix: bool) -> Result<()> {
    println!("Running diagnostics...\n");

    let checks = vec![check_rust_version(), check_config_exists()];

    let mut pass_count = 0;
    let mut warn_count = 0;
    let mut fail_count = 0;

    for result in &checks {
        print_diagnostic(result);

        // Auto-fix if enabled
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
        if !auto_fix {
            println!("Or use --doctor --fix to auto-fix issues.");
        }
        std::process::exit(1);
    }

    if warn_count > 0 {
        println!("\nWarnings may affect functionality.");
    } else {
        println!("\n\x1b[32mAll checks passed!\x1b[0m");
    }

    Ok(())
}

fn check_rust_version() -> DiagnosticResult {
    DiagnosticResult {
        name: "Rust version".to_string(),
        status: DiagnosticStatus::Pass,
        message: "1.70+".to_string(),
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
        println!("    \x1b[36mFix:\x1b[0m {}", fix);
    }
}
