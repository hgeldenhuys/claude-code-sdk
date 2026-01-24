//! CLI argument parsing

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

    /// Screenshot mode: render one frame and exit (for comparison testing)
    #[arg(long)]
    pub screenshot: bool,

    /// Screenshot width (default: 120)
    #[arg(long, default_value = "120")]
    pub width: u16,

    /// Screenshot height (default: 40)
    #[arg(long, default_value = "40")]
    pub height: u16,
}

impl Cli {
    /// Get the initial view mode
    pub fn view_mode(&self) -> transcript_core::ViewMode {
        match self.mode {
            1 => transcript_core::ViewMode::Json,
            _ => transcript_core::ViewMode::Custom,
        }
    }
}
