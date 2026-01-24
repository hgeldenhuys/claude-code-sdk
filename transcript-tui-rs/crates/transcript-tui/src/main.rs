//! transcript-tui-rs - High-performance transcript viewer for Claude Code
//!
//! This is an experimental Rust rewrite of the TypeScript transcript-tui.

mod cli;

use std::io::stdout;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use crossterm::{
    event,
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    prelude::*,
};

use cli::Cli;
use transcript_core::{FilterOptions, ViewMode};
use transcript_db::{DbError, GetLinesOptions, TranscriptDb};
use transcript_ui::{
    components::{
        render_content_pane, render_footer, render_header, render_help_overlay,
        render_list_pane, render_search_input, render_usage_graph,
    },
    event::{handle_event, AppAction},
    App,
};

fn main() -> Result<()> {
    let cli = Cli::parse();

    // Handle stats command
    if cli.stats {
        return show_stats(&cli);
    }

    // Handle list command
    if cli.list {
        return list_sessions(&cli);
    }

    // Open database
    let db = open_database(&cli)?;

    // Get session (required at this point since we're past --stats/--list)
    let session = cli.session.as_ref().expect("session required");

    // Resolve session and load lines
    let (session_id, lines) = load_session(&db, session)?;

    if lines.is_empty() {
        eprintln!("No transcript lines found for: {}", session);
        return Ok(());
    }

    // Create app state
    let mut app = App::new(lines, session_id);
    app.set_view_mode(cli.view_mode());
    app.live_mode = cli.live;

    // Apply type filter if specified
    if let Some(types) = &cli.types {
        let filter = FilterOptions::new().with_display_types(types.clone());
        app.apply_filter(filter);
    }

    // Jump to line if specified
    if let Some(line_num) = cli.line {
        if let Some(idx) = app.lines.iter().position(|l| l.line_number == line_num) {
            app.current_index = idx;
        }
    }

    // Screenshot mode: render one frame and exit
    if cli.screenshot {
        return run_screenshot(&app, cli.width, cli.height);
    }

    // Run TUI
    run_tui(app, db)
}

/// Open the database
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

/// Load session lines from database
fn load_session(db: &TranscriptDb, session_input: &str) -> Result<(String, Vec<transcript_core::TranscriptLine>)> {
    // Try to resolve session
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

/// Show database statistics
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

/// List recent sessions
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

/// Run the TUI application
fn run_tui(mut app: App, db: TranscriptDb) -> Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    // Live mode polling interval
    let poll_interval = Duration::from_millis(200);
    let mut last_poll = std::time::Instant::now();

    // Main event loop
    loop {
        // Draw
        terminal.draw(|frame| ui(frame, &app))?;

        // Poll for events with timeout for live mode
        let timeout = if app.live_mode {
            Duration::from_millis(100)
        } else {
            Duration::from_millis(250)
        };

        if event::poll(timeout)? {
            let event = event::read()?;
            let action = handle_event(event, app.search_mode, app.fullscreen);

            match action {
                AppAction::Quit => break,
                AppAction::SelectPrev => app.select_prev(),
                AppAction::SelectNext => app.select_next(),
                AppAction::SelectFirst => app.select_first(),
                AppAction::SelectLast => app.select_last(),
                AppAction::PageUp => app.page_up(10),
                AppAction::PageDown => app.page_down(10),
                AppAction::TogglePane => app.toggle_pane(),
                AppAction::SetViewMode(n) => {
                    if let Some(mode) = ViewMode::from_key((b'0' + n) as char) {
                        app.set_view_mode(mode);
                    }
                }
                AppAction::ToggleFullscreen => app.toggle_fullscreen(),
                AppAction::ScrollUp => app.scroll_content_up(),
                AppAction::ScrollDown => app.scroll_content_down(),
                AppAction::ScrollLeft => app.scroll_content_left(),
                AppAction::ScrollRight => app.scroll_content_right(),
                AppAction::ToggleBookmark => app.toggle_bookmark(),
                AppAction::NextBookmark => app.next_bookmark(),
                AppAction::PrevBookmark => app.prev_bookmark(),
                AppAction::StartSearch => app.start_search(),
                AppAction::CancelSearch => app.cancel_search(),
                AppAction::SubmitSearch => app.execute_search(),
                AppAction::SearchInput(c) => app.search_query.push(c),
                AppAction::SearchBackspace => {
                    app.search_query.pop();
                }
                AppAction::NextSearchResult => app.next_search_result(),
                AppAction::PrevSearchResult => app.prev_search_result(),
                AppAction::ToggleHelp => app.show_help = !app.show_help,
                AppAction::ToggleUsageGraph => app.show_usage_graph = !app.show_usage_graph,
                AppAction::ToggleLiveMode => app.toggle_live_mode(),
                AppAction::Redraw => {
                    terminal.clear()?;
                }
                AppAction::None => {}
            }
        }

        // Live mode: poll for new lines
        if app.live_mode && last_poll.elapsed() >= poll_interval {
            last_poll = std::time::Instant::now();
            if let Err(e) = app.poll_new_lines(&db) {
                app.error_message = Some(format!("Poll error: {}", e));
            }
        }

        // Clear status message after a while
        if app.status_message.is_some() {
            // We'll let the message stay until next action
        }
    }

    // Cleanup
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;

    Ok(())
}

/// Run screenshot mode: render one frame and output to stdout
fn run_screenshot(app: &App, width: u16, height: u16) -> Result<()> {
    use ratatui::backend::TestBackend;
    use std::io::Write;

    // Create a test backend with the specified size
    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend)?;

    // Render one frame
    terminal.draw(|frame| ui(frame, app))?;

    // Get the buffer and convert to ANSI
    let buffer = terminal.backend().buffer();

    // Output each cell with ANSI styling
    let mut output = String::new();
    let mut last_style: Option<Style> = None;

    for y in 0..height {
        for x in 0..width {
            let cell = buffer.cell((x, y)).unwrap();
            let style = cell.style();

            // Only emit style codes when style changes
            if last_style != Some(style) {
                // Reset and apply new style
                output.push_str("\x1b[0m");

                // Foreground color
                if let Some(fg) = style.fg {
                    output.push_str(&color_to_ansi(fg, true));
                }

                // Background color
                if let Some(bg) = style.bg {
                    output.push_str(&color_to_ansi(bg, false));
                }

                // Modifiers
                if style.add_modifier.contains(Modifier::BOLD) {
                    output.push_str("\x1b[1m");
                }
                if style.add_modifier.contains(Modifier::DIM) {
                    output.push_str("\x1b[2m");
                }
                if style.add_modifier.contains(Modifier::ITALIC) {
                    output.push_str("\x1b[3m");
                }
                if style.add_modifier.contains(Modifier::UNDERLINED) {
                    output.push_str("\x1b[4m");
                }
                if style.add_modifier.contains(Modifier::REVERSED) {
                    output.push_str("\x1b[7m");
                }

                last_style = Some(style);
            }

            output.push_str(cell.symbol());
        }
        output.push_str("\x1b[0m\n");
        last_style = None;
    }

    // Write to stdout
    std::io::stdout().write_all(output.as_bytes())?;
    std::io::stdout().flush()?;

    Ok(())
}

/// Convert ratatui Color to ANSI escape code
fn color_to_ansi(color: Color, foreground: bool) -> String {
    let base = if foreground { 30 } else { 40 };
    match color {
        Color::Black => format!("\x1b[{}m", base),
        Color::Red => format!("\x1b[{}m", base + 1),
        Color::Green => format!("\x1b[{}m", base + 2),
        Color::Yellow => format!("\x1b[{}m", base + 3),
        Color::Blue => format!("\x1b[{}m", base + 4),
        Color::Magenta => format!("\x1b[{}m", base + 5),
        Color::Cyan => format!("\x1b[{}m", base + 6),
        Color::White => format!("\x1b[{}m", base + 7),
        Color::Gray => format!("\x1b[{}m", if foreground { 90 } else { 100 }),
        Color::DarkGray => format!("\x1b[{}m", if foreground { 90 } else { 100 }),
        Color::LightRed => format!("\x1b[{}m", if foreground { 91 } else { 101 }),
        Color::LightGreen => format!("\x1b[{}m", if foreground { 92 } else { 102 }),
        Color::LightYellow => format!("\x1b[{}m", if foreground { 93 } else { 103 }),
        Color::LightBlue => format!("\x1b[{}m", if foreground { 94 } else { 104 }),
        Color::LightMagenta => format!("\x1b[{}m", if foreground { 95 } else { 105 }),
        Color::LightCyan => format!("\x1b[{}m", if foreground { 96 } else { 106 }),
        Color::Rgb(r, g, b) => {
            if foreground {
                format!("\x1b[38;2;{};{};{}m", r, g, b)
            } else {
                format!("\x1b[48;2;{};{};{}m", r, g, b)
            }
        }
        Color::Indexed(i) => {
            if foreground {
                format!("\x1b[38;5;{}m", i)
            } else {
                format!("\x1b[48;5;{}m", i)
            }
        }
        Color::Reset => "\x1b[0m".to_string(),
    }
}

/// Render the UI
fn ui(frame: &mut Frame, app: &App) {
    let area = frame.area();

    if app.fullscreen {
        // Fullscreen content view
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),  // Header
                Constraint::Min(0),     // Content
                Constraint::Length(2),  // Footer
            ])
            .split(area);

        render_header(frame, chunks[0], app);
        render_content_pane(frame, chunks[1], app);
        render_footer(frame, chunks[2], app);
    } else {
        // Normal two-pane view
        let chunks = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),  // Header
                Constraint::Min(0),     // Main content
                Constraint::Length(2),  // Footer
            ])
            .split(area);

        render_header(frame, chunks[0], app);

        // Split main area into list and content panes
        let main_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(40),  // List
                Constraint::Percentage(60),  // Content
            ])
            .split(chunks[1]);

        render_list_pane(frame, main_chunks[0], app);
        render_content_pane(frame, main_chunks[1], app);

        render_footer(frame, chunks[2], app);
    }

    // Overlays
    if app.search_mode {
        render_search_input(frame, app);
    }

    if app.show_help {
        render_help_overlay(frame);
    }

    if app.show_usage_graph {
        render_usage_graph(frame, app);
    }
}
