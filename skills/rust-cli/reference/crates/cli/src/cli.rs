//! CLI argument parsing

use clap::Parser;

/// Example CLI demonstrating rust-cli patterns
#[derive(Parser, Debug)]
#[command(name = "example")]
#[command(author, version, about)]
pub struct Cli {
    /// Input file or identifier
    #[arg(value_name = "INPUT", required_unless_present_any = ["list", "doctor"])]
    pub input: Option<String>,

    /// Enable verbose output
    #[arg(short, long)]
    pub verbose: bool,

    /// Configuration file path
    #[arg(short, long, env = "EXAMPLE_CONFIG")]
    pub config: Option<std::path::PathBuf>,

    /// List available items and exit
    #[arg(long)]
    pub list: bool,

    /// Run diagnostics and exit
    #[arg(long)]
    pub doctor: bool,

    /// Auto-fix issues found by doctor
    #[arg(long, requires = "doctor")]
    pub fix: bool,
}
