//! transcript-cursive - Cursive-based transcript viewer
//!
//! Full-featured TUI with colors, search, bookmarks, and live mode.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use clap::Parser;
use cursive::align::HAlign;
use cursive::event::Key;
use cursive::theme::{BaseColor, Color, ColorStyle, PaletteColor, Theme};
use cursive::traits::*;
use cursive::utils::markup::StyledString;
use cursive::views::{
    Dialog, EditView, LinearLayout, Panel, ResizedView, ScrollView,
    SelectView, TextView,
};
use cursive::Cursive;

use transcript_core::{TranscriptLine, ViewMode};
use transcript_db::{DbError, GetLinesOptions, TranscriptDb};

const VERSION: &str = "0.3.0";

/// Cursive-based transcript viewer
#[derive(Parser, Debug)]
#[command(name = "transcript-cursive")]
#[command(version = VERSION)]
#[command(about = "Cursive-based transcript viewer for Claude Code sessions")]
struct Cli {
    /// Session name, ID, or file path
    #[arg(value_name = "SESSION", required_unless_present_any = ["stats", "list"])]
    session: Option<String>,

    /// Initial view mode (1=json, 2=custom)
    #[arg(short, long, default_value = "2", value_parser = clap::value_parser!(u8).range(1..=2))]
    mode: u8,

    /// Start in live mode
    #[arg(short, long)]
    live: bool,

    /// Show database statistics
    #[arg(long)]
    stats: bool,

    /// List recent sessions
    #[arg(long)]
    list: bool,

    /// Custom database path
    #[arg(long, env = "TRANSCRIPT_DB_PATH")]
    db_path: Option<std::path::PathBuf>,

    /// Screenshot mode: dump screen and exit
    #[arg(long)]
    screenshot: bool,

    /// Text-only mode: filter to assistant text only (no tool_use)
    #[arg(short = 'o', long)]
    text_only: bool,
}

/// Focus state for panes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum FocusedPane {
    #[default]
    List,
    Content,
}

/// Application state
struct AppState {
    lines: Vec<TranscriptLine>,
    current_index: usize,
    view_mode: ViewMode,
    session_name: Option<String>,
    session_id: String,
    project_path: Option<String>,
    bookmarks: HashSet<i64>,
    search_query: String,
    search_results: Vec<usize>,
    search_result_index: usize,
    live_mode: bool,
    last_max_id: i64,
    status_message: Option<String>,
    focused_pane: FocusedPane,
    needs_initial_scroll: bool,
}

impl AppState {
    fn new(lines: Vec<TranscriptLine>, session_id: String) -> Self {
        let session_name = lines.iter().find_map(|l| l.session_name.clone());
        let current_index = if lines.is_empty() { 0 } else { lines.len() - 1 };
        let last_max_id = lines.iter().map(|l| l.id).max().unwrap_or(0);

        // Extract project path from first line's cwd field (in raw JSON)
        let project_path = lines.iter().find_map(|l| {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&l.raw) {
                parsed.get("cwd").and_then(|v| v.as_str()).map(String::from)
            } else {
                None
            }
        });

        Self {
            lines,
            current_index,
            view_mode: ViewMode::Custom,
            session_name,
            session_id,
            project_path,
            bookmarks: HashSet::new(),
            search_query: String::new(),
            search_results: Vec::new(),
            search_result_index: 0,
            live_mode: false,
            last_max_id,
            status_message: None,
            focused_pane: FocusedPane::List,
            needs_initial_scroll: true,
        }
    }

    fn current_line(&self) -> Option<&TranscriptLine> {
        self.lines.get(self.current_index)
    }

    fn title(&self) -> String {
        if let Some(name) = &self.session_name {
            name.clone()
        } else {
            self.session_id[..8.min(self.session_id.len())].to_string()
        }
    }

    fn toggle_bookmark(&mut self) {
        if let Some(line) = self.current_line() {
            let id = line.id;
            if self.bookmarks.contains(&id) {
                self.bookmarks.remove(&id);
                self.status_message = Some("Bookmark removed".to_string());
            } else {
                self.bookmarks.insert(id);
                self.status_message = Some("Bookmark added".to_string());
            }
        }
    }

    fn next_bookmark(&mut self) {
        if self.bookmarks.is_empty() {
            self.status_message = Some("No bookmarks".to_string());
            return;
        }

        for (i, line) in self.lines.iter().enumerate().skip(self.current_index + 1) {
            if self.bookmarks.contains(&line.id) {
                self.current_index = i;
                return;
            }
        }
        // Wrap around
        for (i, line) in self.lines.iter().enumerate() {
            if self.bookmarks.contains(&line.id) {
                self.current_index = i;
                return;
            }
        }
    }

    fn prev_bookmark(&mut self) {
        if self.bookmarks.is_empty() {
            self.status_message = Some("No bookmarks".to_string());
            return;
        }

        for i in (0..self.current_index).rev() {
            if let Some(line) = self.lines.get(i) {
                if self.bookmarks.contains(&line.id) {
                    self.current_index = i;
                    return;
                }
            }
        }
        // Wrap around
        for i in (0..self.lines.len()).rev() {
            if let Some(line) = self.lines.get(i) {
                if self.bookmarks.contains(&line.id) {
                    self.current_index = i;
                    return;
                }
            }
        }
    }

    fn execute_search(&mut self) {
        if self.search_query.is_empty() {
            self.search_results.clear();
            return;
        }

        let query_lower = self.search_query.to_lowercase();
        self.search_results = self
            .lines
            .iter()
            .enumerate()
            .filter(|(_, line)| {
                if let Some(content) = &line.content {
                    if content.to_lowercase().contains(&query_lower) {
                        return true;
                    }
                }
                line.raw.to_lowercase().contains(&query_lower)
            })
            .map(|(i, _)| i)
            .collect();

        self.search_result_index = 0;

        if let Some(&idx) = self.search_results.first() {
            self.current_index = idx;
            self.status_message = Some(format!("Found {} matches", self.search_results.len()));
        } else {
            self.status_message = Some("No matches found".to_string());
        }
    }

    fn next_search_result(&mut self) {
        if self.search_results.is_empty() {
            return;
        }
        self.search_result_index = (self.search_result_index + 1) % self.search_results.len();
        self.current_index = self.search_results[self.search_result_index];
        self.status_message = Some(format!(
            "Match {}/{}",
            self.search_result_index + 1,
            self.search_results.len()
        ));
    }

    fn prev_search_result(&mut self) {
        if self.search_results.is_empty() {
            return;
        }
        if self.search_result_index == 0 {
            self.search_result_index = self.search_results.len() - 1;
        } else {
            self.search_result_index -= 1;
        }
        self.current_index = self.search_results[self.search_result_index];
        self.status_message = Some(format!(
            "Match {}/{}",
            self.search_result_index + 1,
            self.search_results.len()
        ));
    }
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.stats {
        return show_stats(&cli);
    }

    if cli.list {
        return list_sessions(&cli);
    }

    let db = open_database(&cli)?;
    let session = cli.session.as_ref().expect("session required");
    let (session_id, lines) = load_session(&db, session)?;

    if lines.is_empty() {
        eprintln!("No transcript lines found for: {}", session);
        return Ok(());
    }

    let state = Arc::new(Mutex::new(AppState::new(lines, session_id.clone())));

    // Set initial view mode and live mode
    {
        let mut st = state.lock().unwrap();
        st.view_mode = match cli.mode {
            1 => ViewMode::Json,
            _ => ViewMode::Custom,
        };
        st.live_mode = cli.live;
    }

    if cli.screenshot {
        return run_screenshot(&state.lock().unwrap());
    }

    // Apply text-only filter if requested (assistant text only, no tool_use)
    if cli.text_only {
        let mut st = state.lock().unwrap();
        st.lines = st.lines.iter().filter(|line| {
            // Only keep assistant lines that have text content (not just tool_use)
            if line.line_type != transcript_core::LineType::Assistant {
                return false;
            }
            // Check if line has text content (not just tool use)
            if let Some(content) = &line.content {
                // Skip lines that are only tool use markers
                !content.starts_with("[Tool:")
            } else {
                false
            }
        }).cloned().collect();
        // Reset index to end
        st.current_index = if st.lines.is_empty() { 0 } else { st.lines.len() - 1 };
    }

    run_tui(state, db, session_id)
}

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

fn load_session(
    db: &TranscriptDb,
    session_input: &str,
) -> Result<(String, Vec<TranscriptLine>)> {
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
            let sessions = db
                .find_sessions(session_input)
                .context("Failed to search sessions")?;

            if sessions.is_empty() {
                eprintln!("Session not found: {}", session_input);
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

fn show_stats(cli: &Cli) -> Result<()> {
    let db = open_database(cli)?;
    let stats = db.stats().context("Failed to get stats")?;

    println!("Transcript Database Statistics");
    println!("==============================");
    println!("Version:      {}", stats.version);
    println!("Lines:        {}", stats.line_count);
    println!("Sessions:     {}", stats.session_count);
    println!("Size:         {}", stats.format_size());

    Ok(())
}

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

fn run_tui(state: Arc<Mutex<AppState>>, db: TranscriptDb, session_id: String) -> Result<()> {
    let mut siv = cursive::default();

    // Set up theme with colors
    siv.set_theme(create_theme());

    // Build the UI
    let ui = build_ui(Arc::clone(&state));
    siv.add_fullscreen_layer(ui);

    // Update content for initial selection
    update_all(&mut siv, &state.lock().unwrap());

    // ========== Key bindings ==========

    // Quit
    siv.add_global_callback('q', |s| s.quit());
    siv.add_global_callback(Key::Esc, |s| s.quit());

    // View mode keys (1-2)
    for (key, mode) in [
        ('1', ViewMode::Json),
        ('2', ViewMode::Custom),
    ] {
        let state_mode = Arc::clone(&state);
        siv.add_global_callback(key, move |s| {
            state_mode.lock().unwrap().view_mode = mode;
            update_all(s, &state_mode.lock().unwrap());
        });
    }

    // Navigation: j/k/Up/Down
    let state_j = Arc::clone(&state);
    siv.add_global_callback('j', move |s| {
        {
            let mut st = state_j.lock().unwrap();
            if st.current_index + 1 < st.lines.len() {
                st.current_index += 1;
            }
        }
        update_all(s, &state_j.lock().unwrap());
    });

    let state_k = Arc::clone(&state);
    siv.add_global_callback('k', move |s| {
        {
            let mut st = state_k.lock().unwrap();
            if st.current_index > 0 {
                st.current_index -= 1;
            }
        }
        update_all(s, &state_k.lock().unwrap());
    });

    // g/G for first/last
    let state_g = Arc::clone(&state);
    siv.add_global_callback('g', move |s| {
        state_g.lock().unwrap().current_index = 0;
        update_all(s, &state_g.lock().unwrap());
    });

    let state_gg = Arc::clone(&state);
    siv.add_global_callback('G', move |s| {
        {
            let mut st = state_gg.lock().unwrap();
            if !st.lines.is_empty() {
                st.current_index = st.lines.len() - 1;
            }
        }
        update_all(s, &state_gg.lock().unwrap());
    });

    // Tab to toggle focus between panes
    let state_tab = Arc::clone(&state);
    siv.add_global_callback(Key::Tab, move |s| {
        let new_pane = {
            let mut st = state_tab.lock().unwrap();
            st.focused_pane = match st.focused_pane {
                FocusedPane::List => FocusedPane::Content,
                FocusedPane::Content => FocusedPane::List,
            };
            st.status_message = Some(format!("Focus: {:?}", st.focused_pane));
            st.focused_pane
        };
        // Actually switch Cursive focus
        match new_pane {
            FocusedPane::List => { let _ = s.focus_name("list"); }
            FocusedPane::Content => { let _ = s.focus_name("content"); }
        }
        update_all(s, &state_tab.lock().unwrap());
    });

    // Bookmarks: b to toggle, [ and ] to navigate
    let state_b = Arc::clone(&state);
    siv.add_global_callback('b', move |s| {
        state_b.lock().unwrap().toggle_bookmark();
        update_all(s, &state_b.lock().unwrap());
    });

    let state_prev_bm = Arc::clone(&state);
    siv.add_global_callback('[', move |s| {
        state_prev_bm.lock().unwrap().prev_bookmark();
        update_all(s, &state_prev_bm.lock().unwrap());
    });

    let state_next_bm = Arc::clone(&state);
    siv.add_global_callback(']', move |s| {
        state_next_bm.lock().unwrap().next_bookmark();
        update_all(s, &state_next_bm.lock().unwrap());
    });

    // Copy: c for content, y for raw JSON
    let state_copy = Arc::clone(&state);
    siv.add_global_callback('c', move |s| {
        let mut st = state_copy.lock().unwrap();
        if let Some(line) = st.current_line().cloned() {
            let text = line.content.clone().unwrap_or_else(|| line.raw.clone());
            match arboard::Clipboard::new() {
                Ok(mut clipboard) => {
                    if clipboard.set_text(&text).is_ok() {
                        st.status_message = Some(format!("Copied {} chars", text.len()));
                    } else {
                        st.status_message = Some("Failed to copy".to_string());
                    }
                }
                Err(_) => {
                    st.status_message = Some("Clipboard unavailable".to_string());
                }
            }
            drop(st);
            update_all(s, &state_copy.lock().unwrap());
        }
    });

    let state_yank = Arc::clone(&state);
    siv.add_global_callback('y', move |s| {
        let mut st = state_yank.lock().unwrap();
        if let Some(line) = st.current_line().cloned() {
            match arboard::Clipboard::new() {
                Ok(mut clipboard) => {
                    if clipboard.set_text(&line.raw).is_ok() {
                        st.status_message = Some(format!("Yanked {} chars (raw)", line.raw.len()));
                    } else {
                        st.status_message = Some("Failed to yank".to_string());
                    }
                }
                Err(_) => {
                    st.status_message = Some("Clipboard unavailable".to_string());
                }
            }
            drop(st);
            update_all(s, &state_yank.lock().unwrap());
        }
    });

    // Search: / to open, n/N for next/prev
    let state_search = Arc::clone(&state);
    siv.add_global_callback('/', move |s| {
        show_search_dialog(s, Arc::clone(&state_search));
    });

    let state_n = Arc::clone(&state);
    siv.add_global_callback('n', move |s| {
        state_n.lock().unwrap().next_search_result();
        update_all(s, &state_n.lock().unwrap());
    });

    let state_nn = Arc::clone(&state);
    siv.add_global_callback('N', move |s| {
        state_nn.lock().unwrap().prev_search_result();
        update_all(s, &state_nn.lock().unwrap());
    });

    // Live mode toggle: L
    let state_live = Arc::clone(&state);
    let db_arc = Arc::new(Mutex::new(db));
    siv.add_global_callback('L', move |s| {
        {
            let mut st = state_live.lock().unwrap();
            st.live_mode = !st.live_mode;
            st.status_message = Some(if st.live_mode {
                "Live mode ON".to_string()
            } else {
                "Live mode OFF".to_string()
            });
        }
        update_all(s, &state_live.lock().unwrap());
    });

    // Help
    siv.add_global_callback('?', |s| {
        s.add_layer(
            Dialog::info(
                "Navigation:\n\
                 j/k         Navigate lines\n\
                 g/G         First/last line\n\
                 Tab         Switch focus (List/Content)\n\
                 \n\
                 View Modes:\n\
                 1           JSON - Raw JSON with highlighting\n\
                 2           CUSTOM - Smart view (MD/Diff/etc)\n\
                 \n\
                 Search:\n\
                 /           Open search\n\
                 n/N         Next/prev match\n\
                 \n\
                 Bookmarks:\n\
                 b           Toggle bookmark\n\
                 [/]         Prev/next bookmark\n\
                 \n\
                 Copy:\n\
                 c           Copy content to clipboard\n\
                 y           Yank raw JSON to clipboard\n\
                 \n\
                 Other:\n\
                 L           Toggle live mode\n\
                 q/Esc       Quit\n\
                 ?           Help\n\
                 \n\
                 Note: Turn data requires correlation.\n\
                 Run: bun run transcript index update"
            )
            .title("Help")
        );
    });

    // Live mode refresh callback
    let state_refresh = Arc::clone(&state);
    let db_for_refresh = Arc::clone(&db_arc);
    let session_for_refresh = session_id.clone();
    siv.set_fps(2); // 2 FPS for live mode checking

    siv.add_global_callback(cursive::event::Event::Refresh, move |s| {
        // Handle initial scroll on first refresh (after layout is complete)
        {
            let mut st = state_refresh.lock().unwrap();
            if st.needs_initial_scroll {
                st.needs_initial_scroll = false;
                drop(st); // Release lock before calling scroll
                scroll_list_to_selection(s, &state_refresh.lock().unwrap());
            }
        }

        let should_refresh = state_refresh.lock().unwrap().live_mode;
        if should_refresh {
            let db = db_for_refresh.lock().unwrap();

            // Poll for new lines
            let new_count = poll_new_lines(
                &state_refresh,
                &db,
                &session_for_refresh,
            );

            // Refresh turn data for lines missing it
            let turn_updated = refresh_turn_data(&state_refresh, &db);

            if new_count > 0 || turn_updated {
                // Rebuild list with new/updated items
                rebuild_list(s, &state_refresh.lock().unwrap());
                update_all(s, &state_refresh.lock().unwrap());
            }
        }
    });

    siv.run();
    Ok(())
}

fn create_theme() -> Theme {
    let mut theme = Theme::default();
    theme.palette[PaletteColor::Background] = Color::TerminalDefault;
    theme.palette[PaletteColor::View] = Color::TerminalDefault;
    theme.palette[PaletteColor::Primary] = Color::Light(BaseColor::White);
    theme.palette[PaletteColor::Secondary] = Color::Light(BaseColor::Cyan);
    theme.palette[PaletteColor::Tertiary] = Color::Light(BaseColor::Yellow);
    theme.palette[PaletteColor::TitlePrimary] = Color::Light(BaseColor::Cyan);
    theme.palette[PaletteColor::TitleSecondary] = Color::Light(BaseColor::Blue);
    theme.palette[PaletteColor::Highlight] = Color::Dark(BaseColor::Cyan);
    theme.palette[PaletteColor::HighlightInactive] = Color::Dark(BaseColor::Blue);
    theme.palette[PaletteColor::HighlightText] = Color::Light(BaseColor::White);
    theme
}

fn build_ui(state: Arc<Mutex<AppState>>) -> impl View {
    let st = state.lock().unwrap();

    // Build list with colored items
    let mut list_view = SelectView::<usize>::new()
        .h_align(HAlign::Left)
        .on_select({
            let state = Arc::clone(&state);
            move |s, &idx| {
                state.lock().unwrap().current_index = idx;
                update_content(s, &state.lock().unwrap());
                update_progress_bar(s, &state.lock().unwrap());
                update_footer(s, &state.lock().unwrap());
            }
        });

    for (i, line) in st.lines.iter().enumerate() {
        let is_bookmarked = st.bookmarks.contains(&line.id);
        let is_search_match = st.search_results.contains(&i);
        let label = format_list_item_styled(line, is_bookmarked, is_search_match);
        list_view.add_item(label, i);
    }

    list_view.set_selection(st.current_index);

    // Panel titles with focus indicator
    let list_title = if st.focused_pane == FocusedPane::List {
        "▶ Lines ◀".to_string()
    } else {
        "Lines".to_string()
    };
    let content_title = if st.focused_pane == FocusedPane::Content {
        format!("▶ Content ({}) ◀", st.view_mode.name())
    } else {
        format!("Content ({})", st.view_mode.name())
    };

    let list_panel = Panel::new(
        list_view
            .with_name("list")
            .scrollable()
            .scroll_x(false)
            .with_name("list_scroll")
    )
    .title(list_title)
    .title_position(HAlign::Left)
    .with_name("list_panel");

    // Content view
    let content_view = TextView::new(StyledString::new())
        .with_name("content");

    let content_panel = Panel::new(
        content_view
            .scrollable()
            .scroll_x(true)
    )
    .title(content_title)
    .title_position(HAlign::Left)
    .with_name("content_panel");

    // Header with styled text
    let header = TextView::new(build_header_styled(&st))
        .with_name("header");

    // Progress bar (fixed position)
    let progress_bar = TextView::new(build_progress_bar_styled(&st))
        .with_name("progress_bar");

    // Footer
    let footer = TextView::new(build_footer_styled(&st))
        .with_name("footer");

    // Layout - 78 chars for optimized columns: 1+1+4+1+4+1+37+1+3+1+18 = 72 + padding
    LinearLayout::vertical()
        .child(header.fixed_height(1))
        .child(
            LinearLayout::horizontal()
                .child(ResizedView::with_fixed_width(78, list_panel))
                .child(content_panel.full_width())
                .full_height()
        )
        .child(progress_bar.fixed_height(1))
        .child(footer.fixed_height(1))
}

fn get_type_color(line_type: transcript_core::LineType) -> Color {
    match line_type {
        transcript_core::LineType::User => Color::Light(BaseColor::Green),
        transcript_core::LineType::Assistant => Color::Light(BaseColor::Blue),
        transcript_core::LineType::System => Color::Light(BaseColor::Yellow),
        transcript_core::LineType::Summary => Color::Light(BaseColor::Magenta),
        transcript_core::LineType::Progress => Color::Dark(BaseColor::White),
        _ => Color::Dark(BaseColor::White),
    }
}

/// Calculate context usage percentage from token usage
fn get_context_usage(line: &TranscriptLine) -> Option<(u64, u64)> {
    const CONTEXT_SIZE: u64 = 200_000;
    let usage = line.usage()?;
    let total = usage.total();
    if total == 0 {
        return None;
    }
    let percent = (total as f64 / CONTEXT_SIZE as f64 * 100.0).round() as u64;
    Some((percent.min(100), total))
}


/// Get usage color based on percentage
fn get_usage_color(percent: u64) -> Color {
    if percent <= 50 {
        Color::Light(BaseColor::Green)
    } else if percent <= 70 {
        Color::Light(BaseColor::Yellow)
    } else {
        Color::Light(BaseColor::Red)
    }
}

fn format_list_item_styled(line: &TranscriptLine, is_bookmarked: bool, is_search_match: bool) -> StyledString {
    let mut styled = StyledString::new();

    // Search match indicator (1 char)
    if is_search_match {
        styled.append_styled("*", ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
    } else {
        styled.append_plain(" ");
    }

    // Bookmark indicator (1 char)
    if is_bookmarked {
        styled.append_styled("★", ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
    } else {
        styled.append_plain(" ");
    }

    // Line number (right-aligned, 4 chars - max 9999 lines)
    let line_num = format!("{:>4}", line.line_number.min(9999));
    styled.append_styled(&line_num, ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault));
    styled.append_plain(" ");

    // Type with color (4 chars abbreviation)
    let type_str = match line.line_type {
        transcript_core::LineType::User => "USER",
        transcript_core::LineType::Assistant => "ASST",
        transcript_core::LineType::System => "SYS ",
        transcript_core::LineType::Summary => "SUMM",
        transcript_core::LineType::Progress => "PROG",
        transcript_core::LineType::FileHistorySnapshot => "FILE",
        transcript_core::LineType::Unknown => "??? ",
    };
    styled.append_styled(type_str, ColorStyle::new(get_type_color(line.line_type), Color::TerminalDefault));
    styled.append_plain(" ");

    // Preview (37 chars)
    let preview = line.preview(37);
    let preview_padded = format!("{:<37}", preview);
    styled.append_plain(&preview_padded);

    // Context usage (3 chars: "XX%")
    if let Some((percent, _)) = get_context_usage(line) {
        let usage_color = get_usage_color(percent);
        styled.append_plain(" ");
        styled.append_styled(&format!("{:>2}%", percent), ColorStyle::new(usage_color, Color::TerminalDefault));
    } else {
        styled.append_plain("    "); // 4 spaces for alignment (space + 3 chars)
    }

    // Turn-session column (e.g., "5-loyal-whippet") - expanded to 18 chars max
    let turn_session = if let (Some(seq), Some(name)) = (line.turn_sequence, &line.session_name) {
        format!("{}-{}", seq, name)
    } else if let Some(name) = &line.session_name {
        name.clone()
    } else if let Some(seq) = line.turn_sequence {
        format!("{}", seq)
    } else {
        String::new()
    };

    if !turn_session.is_empty() {
        styled.append_plain(" ");
        // Truncate to 18 chars max
        let truncated = if turn_session.len() > 18 {
            format!("{}…", &turn_session[..17])
        } else {
            turn_session
        };
        styled.append_styled(&truncated, ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault));
    }

    styled
}

fn build_header_styled(state: &AppState) -> StyledString {
    let mut styled = StyledString::new();

    // Title
    styled.append_styled(
        &format!("Transcript: {} ", state.title()),
        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
    );

    styled.append_plain("│ ");

    // View modes
    let modes = [
        (ViewMode::Json, "1:JSON"),
        (ViewMode::Custom, "2:CUSTOM"),
    ];

    for (mode, label) in modes {
        if state.view_mode == mode {
            styled.append_styled(
                &format!("[{}]", label),
                ColorStyle::new(Color::Light(BaseColor::White), Color::Dark(BaseColor::Blue)),
            );
        } else {
            styled.append_plain(label);
        }
        styled.append_plain(" ");
    }

    styled.append_plain("│ ");
    styled.append_styled(
        &format!("v{}", VERSION),
        ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
    );

    if state.live_mode {
        styled.append_plain(" ");
        styled.append_styled(
            "LIVE",
            ColorStyle::new(Color::Light(BaseColor::Green), Color::TerminalDefault),
        );
    }

    // Project path (right-aligned, truncated if needed)
    if let Some(path) = &state.project_path {
        styled.append_plain("  ");
        // Show last folder component with emphasis, rest in dark cyan
        let path_display = format_project_path(path, 30);
        styled.append_styled(
            &path_display,
            ColorStyle::new(Color::Dark(BaseColor::Cyan), Color::TerminalDefault),
        );
    }

    styled
}

/// Format project path for display, truncated if too long
fn format_project_path(path: &str, max_len: usize) -> String {
    let path = std::path::Path::new(path);
    let path_str = path.to_string_lossy();

    if path_str.len() <= max_len {
        path_str.to_string()
    } else {
        // Truncate from the left, keeping the last component visible
        let truncate_at = path_str.len().saturating_sub(max_len - 1);
        format!("…{}", &path_str[truncate_at..])
    }
}

fn build_footer_styled(state: &AppState) -> StyledString {
    let mut styled = StyledString::new();

    // Focus indicator
    let focus_indicator = match state.focused_pane {
        FocusedPane::List => "[LIST]",
        FocusedPane::Content => "[CONTENT]",
    };
    styled.append_styled(
        focus_indicator,
        ColorStyle::new(Color::Light(BaseColor::White), Color::Dark(BaseColor::Blue)),
    );
    styled.append_plain(" ");

    // Line position
    styled.append_styled(
        &format!("Line {}/{}", state.current_index + 1, state.lines.len()),
        ColorStyle::new(Color::Light(BaseColor::White), Color::TerminalDefault),
    );

    styled.append_plain(" │ ");

    // Mode
    styled.append_plain(&format!("Mode: {} ", state.view_mode.name()));

    // Bookmarks count
    if !state.bookmarks.is_empty() {
        styled.append_plain("│ ");
        styled.append_styled(
            &format!("{}★", state.bookmarks.len()),
            ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault),
        );
        styled.append_plain(" ");
    }

    // Search results
    if !state.search_results.is_empty() {
        styled.append_plain("│ ");
        styled.append_styled(
            &format!("Match {}/{}", state.search_result_index + 1, state.search_results.len()),
            ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
        );
        styled.append_plain(" ");
    }

    styled.append_plain("│ ");
    styled.append_styled(
        "?: help  q: quit",
        ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
    );

    // Status message
    if let Some(msg) = &state.status_message {
        styled.append_plain(" │ ");
        styled.append_styled(
            msg,
            ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault),
        );
    }

    styled
}

/// Build the fixed progress bar at the bottom
fn build_progress_bar_styled(state: &AppState) -> StyledString {
    let mut styled = StyledString::new();

    if let Some(line) = state.current_line() {
        if let Some((percent, total)) = get_context_usage(line) {
            let turn_start_percent = find_turn_start_usage(&state.lines, line);

            // Use a wider bar for the fixed footer (60 chars)
            let bar_width = 50;
            let total_filled = ((percent as usize) * bar_width / 100).min(bar_width);
            let bar_color = get_usage_color(percent);

            styled.append_plain(" Context: [");

            if let Some(turn_start) = turn_start_percent {
                // Two-segment bar
                let pre_turn_filled = ((turn_start as usize) * bar_width / 100).min(bar_width);
                let turn_delta = total_filled.saturating_sub(pre_turn_filled);
                let empty = bar_width.saturating_sub(total_filled);

                let dim_color = match bar_color {
                    Color::Light(BaseColor::Green) => Color::Dark(BaseColor::Green),
                    Color::Light(BaseColor::Yellow) => Color::Dark(BaseColor::Yellow),
                    Color::Light(BaseColor::Red) => Color::Dark(BaseColor::Red),
                    _ => Color::Dark(BaseColor::White),
                };

                styled.append_styled(&"▓".repeat(pre_turn_filled), ColorStyle::new(dim_color, Color::TerminalDefault));
                styled.append_styled(&"█".repeat(turn_delta), ColorStyle::new(bar_color, Color::TerminalDefault));
                styled.append_styled(&"░".repeat(empty), ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault));
            } else {
                // Single-segment bar
                let empty = bar_width.saturating_sub(total_filled);
                styled.append_styled(&"█".repeat(total_filled), ColorStyle::new(bar_color, Color::TerminalDefault));
                styled.append_styled(&"░".repeat(empty), ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault));
            }

            styled.append_plain("] ");

            // Percentage
            styled.append_styled(
                &format!("{}%", percent),
                ColorStyle::new(bar_color, Color::TerminalDefault),
            );

            // Show turn delta if available
            if let Some(turn_start) = turn_start_percent {
                let delta = percent.saturating_sub(turn_start);
                if delta > 0 {
                    styled.append_styled(
                        &format!(" (+{}%)", delta),
                        ColorStyle::new(bar_color, Color::TerminalDefault),
                    );
                }
            }

            // Token count
            let total_k = total as f64 / 1000.0;
            let formatted = if total_k >= 1.0 {
                format!(" ({:.0}K/200K)", total_k)
            } else {
                format!(" ({}/200K)", total)
            };
            styled.append_styled(
                &formatted,
                ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
            );
        } else {
            // No usage data
            styled.append_styled(
                " Context: [no usage data]",
                ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
            );
        }
    } else {
        styled.append_styled(
            " Context: [no line selected]",
            ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
        );
    }

    styled
}

/// Extract tool name from a transcript line
fn get_tool_name(line: &TranscriptLine) -> Option<String> {
    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            let tools = msg.content.tool_uses();
            if let Some((_, name, _)) = tools.first() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Render markdown content using termimad and convert to Cursive StyledString
fn render_markdown(content: &str) -> StyledString {
    use termimad::{MadSkin, crossterm::style::Color as TermColor};

    let mut styled = StyledString::new();

    // Create a custom skin for terminal rendering
    let mut skin = MadSkin::default();

    // Customize colors
    skin.bold.set_fg(TermColor::White);
    skin.italic.set_fg(TermColor::Cyan);
    skin.strikeout.set_fg(TermColor::DarkGrey);
    skin.inline_code.set_fg(TermColor::Yellow);
    skin.code_block.set_fg(TermColor::Yellow);
    skin.headers[0].set_fg(TermColor::Magenta);
    skin.headers[1].set_fg(TermColor::Magenta);
    skin.headers[2].set_fg(TermColor::Magenta);
    skin.quote_mark.set_fg(TermColor::DarkCyan);
    skin.bullet.set_fg(TermColor::Cyan);

    // Render to text with ANSI codes
    let text = skin.term_text(content);
    let rendered = text.to_string();

    // Parse ANSI codes and convert to Cursive StyledString
    // For now, strip ANSI and apply basic styling, or use the raw output
    // Cursive doesn't natively parse ANSI, so we'll do a manual conversion
    styled.append(parse_ansi_to_styled(&rendered));

    styled
}

/// Parse ANSI escape sequences and convert to Cursive StyledString
fn parse_ansi_to_styled(text: &str) -> StyledString {
    let mut styled = StyledString::new();
    let mut current_style = ColorStyle::primary();
    let mut chars = text.chars().peekable();
    let mut current_text = String::new();

    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Flush current text
            if !current_text.is_empty() {
                styled.append_styled(&current_text, current_style);
                current_text.clear();
            }

            // Parse escape sequence
            if chars.peek() == Some(&'[') {
                chars.next(); // consume '['
                let mut seq = String::new();
                while let Some(&ch) = chars.peek() {
                    if ch.is_ascii_alphabetic() {
                        chars.next();
                        break;
                    }
                    seq.push(chars.next().unwrap());
                }

                // Parse the sequence
                current_style = parse_sgr_sequence(&seq);
            }
        } else {
            current_text.push(c);
        }
    }

    // Flush remaining text
    if !current_text.is_empty() {
        styled.append_styled(&current_text, current_style);
    }

    styled
}

/// Parse SGR (Select Graphic Rendition) sequence and return ColorStyle
fn parse_sgr_sequence(seq: &str) -> ColorStyle {
    let codes: Vec<u8> = seq.split(';')
        .filter_map(|s| s.parse().ok())
        .collect();

    let mut fg = Color::TerminalDefault;
    let mut _bold = false;
    let mut _italic = false;

    let mut i = 0;
    while i < codes.len() {
        match codes[i] {
            0 => {
                // Reset
                fg = Color::TerminalDefault;
                _bold = false;
                _italic = false;
            }
            1 => _bold = true,
            3 => _italic = true,
            30 => fg = Color::Dark(BaseColor::Black),
            31 => fg = Color::Dark(BaseColor::Red),
            32 => fg = Color::Dark(BaseColor::Green),
            33 => fg = Color::Dark(BaseColor::Yellow),
            34 => fg = Color::Dark(BaseColor::Blue),
            35 => fg = Color::Dark(BaseColor::Magenta),
            36 => fg = Color::Dark(BaseColor::Cyan),
            37 => fg = Color::Dark(BaseColor::White),
            90 => fg = Color::Light(BaseColor::Black),
            91 => fg = Color::Light(BaseColor::Red),
            92 => fg = Color::Light(BaseColor::Green),
            93 => fg = Color::Light(BaseColor::Yellow),
            94 => fg = Color::Light(BaseColor::Blue),
            95 => fg = Color::Light(BaseColor::Magenta),
            96 => fg = Color::Light(BaseColor::Cyan),
            97 => fg = Color::Light(BaseColor::White),
            38 if i + 2 < codes.len() && codes[i + 1] == 5 => {
                // 256-color mode: 38;5;n
                let color_code = codes[i + 2];
                fg = ansi_256_to_cursive(color_code);
                i += 2;
            }
            _ => {}
        }
        i += 1;
    }

    ColorStyle::new(fg, Color::TerminalDefault)
}

/// Convert ANSI 256-color code to Cursive Color
fn ansi_256_to_cursive(code: u8) -> Color {
    match code {
        0 => Color::Dark(BaseColor::Black),
        1 => Color::Dark(BaseColor::Red),
        2 => Color::Dark(BaseColor::Green),
        3 => Color::Dark(BaseColor::Yellow),
        4 => Color::Dark(BaseColor::Blue),
        5 => Color::Dark(BaseColor::Magenta),
        6 => Color::Dark(BaseColor::Cyan),
        7 => Color::Dark(BaseColor::White),
        8 => Color::Light(BaseColor::Black),
        9 => Color::Light(BaseColor::Red),
        10 => Color::Light(BaseColor::Green),
        11 => Color::Light(BaseColor::Yellow),
        12 => Color::Light(BaseColor::Blue),
        13 => Color::Light(BaseColor::Magenta),
        14 => Color::Light(BaseColor::Cyan),
        15 => Color::Light(BaseColor::White),
        // For 16-255, use a reasonable approximation
        16..=231 => {
            // 6x6x6 color cube - simplified
            let n = code - 16;
            let r = n / 36;
            let g = (n % 36) / 6;
            let b = n % 6;
            // Map to basic colors based on dominant channel
            if r >= g && r >= b {
                Color::Light(BaseColor::Red)
            } else if g >= r && g >= b {
                Color::Light(BaseColor::Green)
            } else {
                Color::Light(BaseColor::Blue)
            }
        }
        // Grayscale
        232..=255 => {
            let gray = code - 232;
            if gray < 12 {
                Color::Dark(BaseColor::Black)
            } else {
                Color::Light(BaseColor::White)
            }
        }
    }
}

/// Check if line has thinking content
fn has_thinking(line: &TranscriptLine) -> bool {
    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            return msg.content.has_thinking();
        }
    }
    false
}

/// Render thinking block with markdown formatting and magenta border
fn render_thinking(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    // Header with timestamp
    styled.append_styled(
        &format!("━━━ THINKING ━━━ {} ━━━\n",
            line.format_time()
        ),
        ColorStyle::new(Color::Light(BaseColor::Magenta), Color::TerminalDefault),
    );

    // Session info
    if let Some(name) = &line.session_name {
        styled.append_plain("Session: ");
        styled.append_styled(name, ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault));
        styled.append_plain("\n");
    }

    // Turn info with differentiated colors
    if let Some(turn_id) = &line.turn_id {
        styled.append_plain("Turn: ");
        styled.append_styled(turn_id, ColorStyle::new(Color::Light(BaseColor::Magenta), Color::TerminalDefault));
        if let Some(seq) = line.turn_sequence {
            styled.append_styled(&format!(" (seq {})", seq), ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault));
        }
        styled.append_plain("\n");
    }

    styled.append_plain("\n");

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (thinking_text, signature) in msg.content.thinking_blocks() {
                // Render thinking text as markdown with magenta border
                let rendered = render_markdown(thinking_text);
                let rendered_text = rendered.source();

                // Add magenta border to each line of rendered markdown
                for content_line in rendered_text.lines() {
                    styled.append_styled(
                        "┃ ",
                        ColorStyle::new(Color::Light(BaseColor::Magenta), Color::TerminalDefault),
                    );
                    styled.append_plain(content_line);
                    styled.append_plain("\n");
                }

                // Show signature hash (truncated)
                if let Some(sig) = signature {
                    styled.append_plain("\n");
                    styled.append_styled(
                        &format!("🔏 Signature: {}...\n", &sig[..32.min(sig.len())]),
                        ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
                    );
                }
            }
        }
    }

    // Token usage if available
    if let Some(usage) = line.usage() {
        styled.append_plain("\n");
        styled.append_styled(
            &format!("📊 Tokens: {} in / {} out = {} total\n",
                usage.input_tokens,
                usage.output_tokens,
                usage.total()
            ),
            ColorStyle::new(Color::Dark(BaseColor::Cyan), Color::TerminalDefault),
        );
    }

    styled
}

/// Render Edit tool as inline unified diff using `similar` crate
fn render_edit_diff(line: &TranscriptLine) -> StyledString {
    use similar::{ChangeTag, TextDiff};

    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "Edit" {
                    styled.append_styled(
                        "━━━ EDIT ━━━\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                        styled.append_plain("File: ");
                        styled.append_styled(file_path, ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
                        styled.append_plain("\n\n");
                    }

                    let old_string = input.get("old_string").and_then(|v| v.as_str()).unwrap_or("");
                    let new_string = input.get("new_string").and_then(|v| v.as_str()).unwrap_or("");

                    // Use similar crate for unified diff
                    let diff = TextDiff::from_lines(old_string, new_string);

                    // Show unified diff header
                    styled.append_styled(
                        &format!("@@ -{},{} +{},{} @@\n",
                            1, old_string.lines().count(),
                            1, new_string.lines().count()
                        ),
                        ColorStyle::new(Color::Dark(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    // Render each change with inline highlighting
                    for change in diff.iter_all_changes() {
                        let (prefix, line_color) = match change.tag() {
                            ChangeTag::Delete => ("-", Color::Light(BaseColor::Red)),
                            ChangeTag::Insert => ("+", Color::Light(BaseColor::Green)),
                            ChangeTag::Equal => (" ", Color::Dark(BaseColor::White)),
                        };

                        styled.append_styled(
                            prefix,
                            ColorStyle::new(line_color, Color::TerminalDefault),
                        );
                        styled.append_styled(
                            change.value(),
                            ColorStyle::new(line_color, Color::TerminalDefault),
                        );
                        // Add newline if the change doesn't end with one
                        if !change.value().ends_with('\n') {
                            styled.append_plain("\n");
                        }
                    }
                }
            }
        }
    }
    styled
}

/// Render Bash tool output with syntax highlighting
fn render_bash_output(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "Bash" {
                    styled.append_styled(
                        "━━━ BASH ━━━\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(command) = input.get("command").and_then(|v| v.as_str()) {
                        styled.append_styled("$ ", ColorStyle::new(Color::Light(BaseColor::Green), Color::TerminalDefault));
                        // Apply shell syntax highlighting
                        styled.append(highlight_shell_command(command));
                        styled.append_plain("\n\n");
                    }
                }
            }
        }

        // Show tool result if available
        if let Some(result) = &parsed.tool_use_result {
            if let Some(stdout) = result.get("stdout").and_then(|v| v.as_str()) {
                if !stdout.is_empty() {
                    styled.append_plain(stdout);
                    if !stdout.ends_with('\n') {
                        styled.append_plain("\n");
                    }
                }
            }
            if let Some(stderr) = result.get("stderr").and_then(|v| v.as_str()) {
                if !stderr.is_empty() {
                    styled.append_styled(stderr, ColorStyle::new(Color::Light(BaseColor::Red), Color::TerminalDefault));
                    if !stderr.ends_with('\n') {
                        styled.append_plain("\n");
                    }
                }
            }
        }
    }
    styled
}

/// Highlight shell command using syntect
fn highlight_shell_command(command: &str) -> StyledString {
    use syntect::easy::HighlightLines;
    use syntect::highlighting::ThemeSet;
    use syntect::parsing::SyntaxSet;
    use syntect::util::LinesWithEndings;

    let mut styled = StyledString::new();

    // Load syntax and theme sets
    let ps = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();

    // Try to find shell syntax
    let syntax = ps.find_syntax_by_extension("sh")
        .or_else(|| ps.find_syntax_by_extension("bash"))
        .unwrap_or_else(|| ps.find_syntax_plain_text());

    let theme = &ts.themes["base16-ocean.dark"];
    let mut h = HighlightLines::new(syntax, theme);

    for line in LinesWithEndings::from(command) {
        match h.highlight_line(line, &ps) {
            Ok(ranges) => {
                for (style, text) in ranges {
                    let color = syntect_to_cursive_color(style);
                    styled.append_styled(text, ColorStyle::new(color, Color::TerminalDefault));
                }
            }
            Err(_) => {
                styled.append_plain(line);
            }
        }
    }

    styled
}

/// Convert syntect Style to Cursive Color
fn syntect_to_cursive_color(style: syntect::highlighting::Style) -> Color {
    let fg = style.foreground;
    // Map to closest base color based on RGB values
    let r = fg.r;
    let g = fg.g;
    let b = fg.b;

    // Simple heuristic to map to terminal colors
    if r > 200 && g < 100 && b < 100 {
        Color::Light(BaseColor::Red)
    } else if r < 100 && g > 200 && b < 100 {
        Color::Light(BaseColor::Green)
    } else if r < 100 && g < 100 && b > 200 {
        Color::Light(BaseColor::Blue)
    } else if r > 200 && g > 200 && b < 100 {
        Color::Light(BaseColor::Yellow)
    } else if r > 200 && g < 100 && b > 200 {
        Color::Light(BaseColor::Magenta)
    } else if r < 100 && g > 200 && b > 200 {
        Color::Light(BaseColor::Cyan)
    } else if r > 200 && g > 200 && b > 200 {
        Color::Light(BaseColor::White)
    } else if r < 80 && g < 80 && b < 80 {
        Color::Dark(BaseColor::Black)
    } else {
        // Default to a reasonable color
        Color::Light(BaseColor::White)
    }
}

/// Render Read tool output with line numbers
fn render_read_output(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "Read" {
                    styled.append_styled(
                        "━━━ READ ━━━\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                        styled.append_plain("File: ");
                        styled.append_styled(file_path, ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
                        styled.append_plain("\n\n");
                    }
                }
            }
        }

        // Show file content if available
        if let Some(content) = &line.content {
            for (i, line_text) in content.lines().enumerate() {
                styled.append_styled(
                    &format!("{:>4} ", i + 1),
                    ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
                );
                styled.append_plain(line_text);
                styled.append_plain("\n");
            }
        }
    }
    styled
}

/// Render TodoWrite tool as task list
fn render_todo_list(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "TodoWrite" {
                    styled.append_styled(
                        "━━━ TODOWRITE ━━━\n\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(todos) = input.get("todos").and_then(|v| v.as_array()) {
                        let total = todos.len();
                        let mut completed = 0;

                        for todo in todos {
                            let content = todo.get("content").and_then(|v| v.as_str()).unwrap_or("");
                            let status = todo.get("status").and_then(|v| v.as_str()).unwrap_or("pending");

                            let (checkbox, color) = match status {
                                "completed" => {
                                    completed += 1;
                                    ("[✓]", Color::Light(BaseColor::Green))
                                }
                                "in_progress" => ("[→]", Color::Light(BaseColor::Yellow)),
                                _ => ("[ ]", Color::Dark(BaseColor::White)),
                            };

                            styled.append_styled(checkbox, ColorStyle::new(color, Color::TerminalDefault));
                            styled.append_plain(&format!(" {}\n", content));
                        }

                        styled.append_plain("\n");
                        let percent = if total > 0 { completed * 100 / total } else { 0 };
                        styled.append_styled(
                            &format!("Progress: {}/{} ({}%)\n", completed, total, percent),
                            ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                        );
                    }
                }
            }
        }
    }
    styled
}

/// Render Grep tool with highlighted matches
fn render_grep_output(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "Grep" {
                    styled.append_styled(
                        "━━━ GREP ━━━\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(pattern) = input.get("pattern").and_then(|v| v.as_str()) {
                        styled.append_plain("Pattern: ");
                        styled.append_styled(pattern, ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
                        styled.append_plain("\n");
                    }
                    if let Some(path) = input.get("path").and_then(|v| v.as_str()) {
                        styled.append_plain("Path: ");
                        styled.append_styled(path, ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault));
                        styled.append_plain("\n");
                    }
                    styled.append_plain("\n");
                }
            }
        }

        // Show content/matches
        if let Some(content) = &line.content {
            styled.append_plain(content);
        }
    }
    styled
}

/// Render JSON value with type-specific coloring
fn render_json_value(styled: &mut StyledString, value: &serde_json::Value, indent: usize) {
    let indent_str = "  ".repeat(indent);

    match value {
        serde_json::Value::Null => {
            styled.append_styled("null", ColorStyle::new(Color::Dark(BaseColor::Magenta), Color::TerminalDefault));
        }
        serde_json::Value::Bool(b) => {
            styled.append_styled(
                &b.to_string(),
                ColorStyle::new(Color::Light(BaseColor::Magenta), Color::TerminalDefault),
            );
        }
        serde_json::Value::Number(n) => {
            styled.append_styled(
                &n.to_string(),
                ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault),
            );
        }
        serde_json::Value::String(s) => {
            // Escape string and show in green
            let escaped = serde_json::to_string(s).unwrap_or_else(|_| format!("\"{}\"", s));
            styled.append_styled(&escaped, ColorStyle::new(Color::Light(BaseColor::Green), Color::TerminalDefault));
        }
        serde_json::Value::Array(arr) => {
            if arr.is_empty() {
                styled.append_plain("[]");
            } else {
                styled.append_plain("[\n");
                for (i, item) in arr.iter().enumerate() {
                    styled.append_plain(&format!("{}  ", indent_str));
                    render_json_value(styled, item, indent + 1);
                    if i < arr.len() - 1 {
                        styled.append_plain(",");
                    }
                    styled.append_plain("\n");
                }
                styled.append_plain(&format!("{}]", indent_str));
            }
        }
        serde_json::Value::Object(obj) => {
            if obj.is_empty() {
                styled.append_plain("{}");
            } else {
                styled.append_plain("{\n");
                let entries: Vec<_> = obj.iter().collect();
                for (i, (key, val)) in entries.iter().enumerate() {
                    styled.append_plain(&format!("{}  ", indent_str));
                    // Key in cyan
                    styled.append_styled(
                        &format!("\"{}\"", key),
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );
                    styled.append_plain(": ");
                    render_json_value(styled, val, indent + 1);
                    if i < entries.len() - 1 {
                        styled.append_plain(",");
                    }
                    styled.append_plain("\n");
                }
                styled.append_plain(&format!("{}}}", indent_str));
            }
        }
    }
}

/// Render Write tool with file content
fn render_write_output(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    if let Ok(parsed) = line.parse() {
        if let Some(msg) = &parsed.message {
            for (_, name, input) in msg.content.tool_uses() {
                if name == "Write" {
                    styled.append_styled(
                        "━━━ WRITE ━━━\n",
                        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                    );

                    if let Some(file_path) = input.get("file_path").and_then(|v| v.as_str()) {
                        styled.append_plain("File: ");
                        styled.append_styled(file_path, ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault));
                        styled.append_plain("\n\n");
                    }

                    if let Some(content) = input.get("content").and_then(|v| v.as_str()) {
                        for (i, line_text) in content.lines().enumerate() {
                            styled.append_styled(
                                &format!("{:>4} ", i + 1),
                                ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault),
                            );
                            styled.append_plain(line_text);
                            styled.append_plain("\n");
                        }
                    }
                }
            }
        }
    }
    styled
}

fn render_content_styled(line: &TranscriptLine, mode: ViewMode) -> StyledString {
    let mut styled = StyledString::new();

    match mode {
        ViewMode::Json => {
            styled.append_styled(
                "=== VIEW: JSON ===\n\n",
                ColorStyle::new(Color::Light(BaseColor::Yellow), Color::TerminalDefault),
            );

            // Parse and render with type-specific coloring
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line.raw) {
                render_json_value(&mut styled, &value, 0);
            } else {
                styled.append_plain(&line.raw);
            }
        }
        ViewMode::Custom => {
            // Check for thinking blocks first
            if has_thinking(line) {
                return render_thinking(line);
            }

            // Tool-specific rendering for Assistant messages with tools
            if let Some(tool_name) = get_tool_name(line) {
                match tool_name.as_str() {
                    "Edit" => return render_edit_diff(line),
                    "Bash" => return render_bash_output(line),
                    "Read" => return render_read_output(line),
                    "Write" => return render_write_output(line),
                    "Grep" => return render_grep_output(line),
                    "TodoWrite" => return render_todo_list(line),
                    _ => {
                        // For other tools, show tool name + raw input
                        styled.append_styled(
                            &format!("━━━ {} ━━━\n\n", tool_name.to_uppercase()),
                            ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
                        );
                        if let Some(content) = &line.content {
                            styled.append_plain(content);
                        }
                        return styled;
                    }
                }
            }

            // For User, Assistant (text), System, Summary - render as Markdown
            return render_md_view(line);
        }
    }

    styled
}

/// Find the context usage percentage at the start of the current turn
fn find_turn_start_usage(lines: &[TranscriptLine], current_line: &TranscriptLine) -> Option<u64> {
    let current_turn_id = current_line.turn_id.as_ref()?;

    // Find the first line of this turn that has usage info
    for line in lines {
        if line.turn_id.as_ref() == Some(current_turn_id) {
            if let Some((percent, _)) = get_context_usage(line) {
                return Some(percent);
            }
        }
    }
    None
}

/// Get border color for a line type
fn get_border_color(line_type: transcript_core::LineType) -> Color {
    match line_type {
        transcript_core::LineType::User => Color::Light(BaseColor::Green),
        transcript_core::LineType::Assistant => Color::Light(BaseColor::Blue),
        transcript_core::LineType::System => Color::Light(BaseColor::Yellow),
        transcript_core::LineType::Summary => Color::Light(BaseColor::Magenta),
        _ => Color::Dark(BaseColor::White),
    }
}

/// Add left border to content lines based on line type
fn add_bordered_content(styled: &mut StyledString, content: &str, border_color: Color) {
    for content_line in content.lines() {
        styled.append_styled(
            "┃ ",
            ColorStyle::new(border_color, Color::TerminalDefault),
        );
        styled.append_plain(content_line);
        styled.append_plain("\n");
    }
}

/// Render line as Markdown view (used by Custom view for non-tool content)
fn render_md_view(line: &TranscriptLine) -> StyledString {
    let mut styled = StyledString::new();

    // Metadata header
    styled.append_styled(
        &format!("━━━ {} ━━━ {} ━━━\n",
            line.line_type.to_string().to_uppercase(),
            line.format_time()
        ),
        ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault),
    );

    if let Some(name) = &line.session_name {
        styled.append_plain("Session: ");
        styled.append_styled(name, ColorStyle::new(Color::Light(BaseColor::Cyan), Color::TerminalDefault));
        styled.append_plain("\n");
    }

    // Phase 6: Differentiate Turn ID from Session Name with colors
    if let Some(turn_id) = &line.turn_id {
        styled.append_plain("Turn: ");
        styled.append_styled(turn_id, ColorStyle::new(Color::Light(BaseColor::Magenta), Color::TerminalDefault));
        if let Some(seq) = line.turn_sequence {
            styled.append_styled(&format!(" (seq {})", seq), ColorStyle::new(Color::Dark(BaseColor::White), Color::TerminalDefault));
        }
        styled.append_plain("\n");
    }

    styled.append_plain("\n");

    // Render markdown content with termimad, adding left border
    if let Some(content) = &line.content {
        let border_color = get_border_color(line.line_type);
        let rendered = render_markdown(content);
        let rendered_text = rendered.source();

        // Add border to each line of rendered content
        add_bordered_content(&mut styled, rendered_text, border_color);
    }

    // Token usage if available
    if let Some(usage) = line.usage() {
        styled.append_plain("\n");
        styled.append_styled(
            &format!("📊 Tokens: {} in / {} out = {} total\n",
                usage.input_tokens,
                usage.output_tokens,
                usage.total()
            ),
            ColorStyle::new(Color::Dark(BaseColor::Cyan), Color::TerminalDefault),
        );
    }

    styled
}

fn update_all(siv: &mut Cursive, state: &AppState) {
    update_header(siv, state);
    update_content(siv, state);
    update_progress_bar(siv, state);
    update_footer(siv, state);
    select_current(siv, state);
}

fn update_header(siv: &mut Cursive, state: &AppState) {
    siv.call_on_name("header", |view: &mut TextView| {
        view.set_content(build_header_styled(state));
    });
}

fn update_content(siv: &mut Cursive, state: &AppState) {
    if let Some(line) = state.current_line() {
        let content = render_content_styled(line, state.view_mode);
        siv.call_on_name("content", |view: &mut TextView| {
            view.set_content(content);
        });
    }
}

fn update_progress_bar(siv: &mut Cursive, state: &AppState) {
    siv.call_on_name("progress_bar", |view: &mut TextView| {
        view.set_content(build_progress_bar_styled(state));
    });
}

fn update_footer(siv: &mut Cursive, state: &AppState) {
    siv.call_on_name("footer", |view: &mut TextView| {
        view.set_content(build_footer_styled(state));
    });
}

fn select_current(siv: &mut Cursive, state: &AppState) {
    siv.call_on_name("list", |view: &mut SelectView<usize>| {
        view.set_selection(state.current_index);
    });
    // Scroll the list to show the selected item
    scroll_list_to_selection(siv, state);
}

fn scroll_list_to_selection(siv: &mut Cursive, state: &AppState) {
    use cursive::Vec2;

    let total_lines = state.lines.len();
    if total_lines == 0 {
        return;
    }

    let current_index = state.current_index;

    // Use a type-erased approach - call_on_name with the scroll view
    siv.call_on_name("list_scroll", |scroll: &mut ScrollView<cursive::views::NamedView<SelectView<usize>>>| {
        // Get the content height and viewport height
        let content_height = scroll.inner_size().y;
        let viewport_height = scroll.content_viewport().height();

        if content_height > viewport_height && total_lines > 0 {
            // Each line is 1 row in the SelectView
            let line_height = content_height / total_lines;
            let target_line_top = current_index * line_height;

            // Center the selection in the viewport
            let target_scroll = target_line_top.saturating_sub(viewport_height / 2);
            let max_scroll = content_height.saturating_sub(viewport_height);
            let clamped_scroll = target_scroll.min(max_scroll);

            scroll.set_offset(Vec2::new(0, clamped_scroll));
        }
    });
}

fn rebuild_list(siv: &mut Cursive, state: &AppState) {
    siv.call_on_name("list", |view: &mut SelectView<usize>| {
        view.clear();
        for (i, line) in state.lines.iter().enumerate() {
            let is_bookmarked = state.bookmarks.contains(&line.id);
            let is_search_match = state.search_results.contains(&i);
            let label = format_list_item_styled(line, is_bookmarked, is_search_match);
            view.add_item(label, i);
        }
        view.set_selection(state.current_index);
    });
}

fn show_search_dialog(siv: &mut Cursive, state: Arc<Mutex<AppState>>) {
    let state_submit = Arc::clone(&state);

    siv.add_layer(
        Dialog::new()
            .title("Search")
            .content(
                EditView::new()
                    .on_submit(move |s, query| {
                        {
                            let mut st = state_submit.lock().unwrap();
                            st.search_query = query.to_string();
                            st.execute_search();
                        }
                        s.pop_layer();
                        rebuild_list(s, &state_submit.lock().unwrap());
                        update_all(s, &state_submit.lock().unwrap());
                    })
                    .with_name("search_input")
                    .fixed_width(40)
            )
            .button("Search", {
                let state = Arc::clone(&state);
                move |s| {
                    let query = s.call_on_name("search_input", |view: &mut EditView| {
                        view.get_content()
                    }).unwrap();
                    {
                        let mut st = state.lock().unwrap();
                        st.search_query = query.to_string();
                        st.execute_search();
                    }
                    s.pop_layer();
                    rebuild_list(s, &state.lock().unwrap());
                    update_all(s, &state.lock().unwrap());
                }
            })
            .button("Cancel", |s| { s.pop_layer(); })
    );
}

fn poll_new_lines(state: &Arc<Mutex<AppState>>, db: &TranscriptDb, session_id: &str) -> usize {
    let last_id = state.lock().unwrap().last_max_id;

    match db.get_lines_after_id(last_id, Some(session_id)) {
        Ok(new_lines) if !new_lines.is_empty() => {
            let count = new_lines.len();
            let mut st = state.lock().unwrap();

            // Update max ID
            if let Some(max_id) = new_lines.iter().map(|l| l.id).max() {
                st.last_max_id = max_id;
            }

            // Check if we were at the end
            let was_at_end = st.current_index + 1 >= st.lines.len();

            // Add new lines
            st.lines.extend(new_lines);

            // Auto-scroll to end if we were at end
            if was_at_end {
                st.current_index = st.lines.len() - 1;
            }

            st.status_message = Some(format!("{} new line(s)", count));
            count
        }
        _ => 0,
    }
}

/// Refresh turn data for lines that are missing it
fn refresh_turn_data(state: &Arc<Mutex<AppState>>, db: &TranscriptDb) -> bool {
    // Find lines missing turn data
    let ids_missing_turn: Vec<i64> = {
        let st = state.lock().unwrap();
        st.lines
            .iter()
            .filter(|line| line.turn_sequence.is_none() && line.session_name.is_none())
            .map(|line| line.id)
            .collect()
    };

    if ids_missing_turn.is_empty() {
        return false;
    }

    // Fetch updated turn data from database
    match db.get_turn_data_for_ids(&ids_missing_turn) {
        Ok(turn_data) => {
            let mut updated = false;
            let mut st = state.lock().unwrap();

            // Build a map of id -> (turn_id, turn_sequence, session_name)
            let turn_map: std::collections::HashMap<i64, (Option<String>, Option<i64>, Option<String>)> =
                turn_data
                    .into_iter()
                    .map(|(id, turn_id, turn_seq, session_name)| (id, (turn_id, turn_seq, session_name)))
                    .collect();

            // Update lines with new turn data
            for line in &mut st.lines {
                if let Some((turn_id, turn_seq, session_name)) = turn_map.get(&line.id) {
                    // Only update if there's actually data now
                    if turn_seq.is_some() || session_name.is_some() {
                        if line.turn_id.is_none() && turn_id.is_some() {
                            line.turn_id = turn_id.clone();
                            updated = true;
                        }
                        if line.turn_sequence.is_none() && turn_seq.is_some() {
                            line.turn_sequence = *turn_seq;
                            updated = true;
                        }
                        if line.session_name.is_none() && session_name.is_some() {
                            line.session_name = session_name.clone();
                            updated = true;
                        }
                    }
                }
            }

            updated
        }
        Err(_) => false,
    }
}

fn run_screenshot(state: &AppState) -> Result<()> {
    // ANSI color codes
    const CYAN: &str = "\x1b[36m";
    const GREEN: &str = "\x1b[32m";
    const BLUE: &str = "\x1b[34m";
    const YELLOW: &str = "\x1b[33m";
    const MAGENTA: &str = "\x1b[35m";
    const RED: &str = "\x1b[31m";
    const DIM: &str = "\x1b[2m";
    const BOLD: &str = "\x1b[1m";
    const RESET: &str = "\x1b[0m";
    const REVERSE: &str = "\x1b[7m";

    // Header
    println!("{CYAN}{BOLD}Transcript: {} │ [1:JSON] 2:CUSTOM │ v{}{RESET}", state.title(), VERSION);
    println!("{CYAN}{BOLD}{}{RESET}", "─".repeat(80));

    // Show lines around current selection
    let start = state.current_index.saturating_sub(12);
    let end = (start + 24).min(state.lines.len());

    for i in start..end {
        if let Some(line) = state.lines.get(i) {
            let is_selected = i == state.current_index;
            let is_bookmarked = state.bookmarks.contains(&line.id);

            let bookmark = if is_bookmarked { format!("{YELLOW}★{RESET}") } else { " ".to_string() };

            // Line number (right-aligned, 4 chars - max 9999)
            let line_num = format!("{:>4}", line.line_number.min(9999));

            // Compact type (4 chars) with color
            let (type_str, type_color) = match line.line_type {
                transcript_core::LineType::User => ("USER", GREEN),
                transcript_core::LineType::Assistant => ("ASST", BLUE),
                transcript_core::LineType::System => ("SYS ", YELLOW),
                transcript_core::LineType::Summary => ("SUMM", MAGENTA),
                transcript_core::LineType::Progress => ("PROG", DIM),
                transcript_core::LineType::FileHistorySnapshot => ("FILE", DIM),
                transcript_core::LineType::Unknown => ("??? ", DIM),
            };

            // Preview (37 chars to match format_list_item_styled)
            let preview = line.preview(37);
            let preview_padded = format!("{:<37}", preview);

            // Context usage with color (3 chars: "XX%")
            let usage_str = if let Some((percent, _)) = get_context_usage(line) {
                let usage_color = if percent <= 50 { GREEN } else if percent <= 70 { YELLOW } else { RED };
                format!(" {usage_color}{:>2}%{RESET}", percent)
            } else {
                "    ".to_string() // 4 spaces for alignment (space + 3 chars)
            };

            // Turn-session column (18 chars max)
            let turn_session = if let (Some(seq), Some(name)) = (line.turn_sequence, &line.session_name) {
                format!("{}-{}", seq, name)
            } else if let Some(name) = &line.session_name {
                name.clone()
            } else if let Some(seq) = line.turn_sequence {
                format!("{}", seq)
            } else {
                String::new()
            };
            let turn_session_display = if !turn_session.is_empty() {
                let truncated = if turn_session.len() > 18 {
                    format!("{}…", &turn_session[..17])
                } else {
                    turn_session
                };
                format!(" {CYAN}{}{RESET}", truncated)
            } else {
                String::new()
            };

            if is_selected {
                println!("{REVERSE}{bookmark} {DIM}{line_num}{RESET}{REVERSE} {type_color}{type_str}{RESET}{REVERSE} {preview_padded}{RESET}{usage_str}{turn_session_display}");
            } else {
                println!("{bookmark} {DIM}{line_num}{RESET} {type_color}{type_str}{RESET} {preview_padded}{usage_str}{turn_session_display}");
            }
        }
    }

    // Footer
    println!("{DIM}{}{RESET}", "─".repeat(80));
    println!(
        "{DIM}[LIST] Line {}/{} │ Mode: {} │ ?: help  q: quit{RESET}",
        state.current_index + 1,
        state.lines.len(),
        state.view_mode.name()
    );

    Ok(())
}
