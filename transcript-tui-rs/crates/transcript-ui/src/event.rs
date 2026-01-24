//! Event handling for the TUI

use crossterm::event::{Event, KeyCode, KeyEvent, KeyModifiers};

/// Actions that can be triggered by events
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppAction {
    /// Quit the application
    Quit,
    /// Move selection up
    SelectPrev,
    /// Move selection down
    SelectNext,
    /// Go to first line
    SelectFirst,
    /// Go to last line
    SelectLast,
    /// Page up
    PageUp,
    /// Page down
    PageDown,
    /// Toggle focused pane
    TogglePane,
    /// Set view mode
    SetViewMode(u8),
    /// Toggle fullscreen
    ToggleFullscreen,
    /// Scroll content up
    ScrollUp,
    /// Scroll content down
    ScrollDown,
    /// Scroll content left
    ScrollLeft,
    /// Scroll content right
    ScrollRight,
    /// Toggle bookmark
    ToggleBookmark,
    /// Jump to next bookmark
    NextBookmark,
    /// Jump to previous bookmark
    PrevBookmark,
    /// Start search
    StartSearch,
    /// Cancel search
    CancelSearch,
    /// Submit search
    SubmitSearch,
    /// Search input character
    SearchInput(char),
    /// Search backspace
    SearchBackspace,
    /// Next search result
    NextSearchResult,
    /// Previous search result
    PrevSearchResult,
    /// Toggle help overlay
    ToggleHelp,
    /// Toggle usage graph
    ToggleUsageGraph,
    /// Toggle live mode
    ToggleLiveMode,
    /// Redraw screen
    Redraw,
    /// No action
    None,
}

/// Handle a terminal event and return the corresponding action
pub fn handle_event(event: Event, search_mode: bool, fullscreen: bool) -> AppAction {
    match event {
        Event::Key(key) => handle_key(key, search_mode, fullscreen),
        Event::Resize(_, _) => AppAction::Redraw,
        _ => AppAction::None,
    }
}

/// Handle a key event
fn handle_key(key: KeyEvent, search_mode: bool, fullscreen: bool) -> AppAction {
    // Search mode has different bindings
    if search_mode {
        return handle_search_key(key);
    }

    // Check for Ctrl modifiers
    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return match key.code {
            KeyCode::Char('c') | KeyCode::Char('q') => AppAction::Quit,
            KeyCode::Char('l') => AppAction::Redraw,
            KeyCode::Char('u') => AppAction::PageUp,
            KeyCode::Char('d') => AppAction::PageDown,
            _ => AppAction::None,
        };
    }

    // Normal mode bindings
    match key.code {
        // Quit
        KeyCode::Char('q') | KeyCode::Esc => AppAction::Quit,

        // Navigation (vim-style)
        KeyCode::Char('j') | KeyCode::Down => {
            if fullscreen {
                AppAction::ScrollDown
            } else {
                AppAction::SelectNext
            }
        }
        KeyCode::Char('k') | KeyCode::Up => {
            if fullscreen {
                AppAction::ScrollUp
            } else {
                AppAction::SelectPrev
            }
        }
        KeyCode::Char('h') | KeyCode::Left => AppAction::ScrollLeft,
        KeyCode::Char('l') | KeyCode::Right => {
            if !fullscreen {
                AppAction::ScrollRight
            } else {
                AppAction::ScrollRight
            }
        }
        KeyCode::Char('g') => AppAction::SelectFirst,
        KeyCode::Char('G') => AppAction::SelectLast,
        KeyCode::PageUp => AppAction::PageUp,
        KeyCode::PageDown => AppAction::PageDown,
        KeyCode::Home => AppAction::SelectFirst,
        KeyCode::End => AppAction::SelectLast,

        // Pane switching
        KeyCode::Tab => AppAction::TogglePane,

        // View modes (1-5)
        KeyCode::Char('1') => AppAction::SetViewMode(1),
        KeyCode::Char('2') => AppAction::SetViewMode(2),
        KeyCode::Char('3') => AppAction::SetViewMode(3),
        KeyCode::Char('4') => AppAction::SetViewMode(4),
        KeyCode::Char('5') => AppAction::SetViewMode(5),

        // Fullscreen
        KeyCode::Char('f') => AppAction::ToggleFullscreen,

        // Bookmarks
        KeyCode::Char(' ') => AppAction::ToggleBookmark,
        KeyCode::Char(']') => AppAction::NextBookmark,
        KeyCode::Char('[') => AppAction::PrevBookmark,

        // Search
        KeyCode::Char('/') => AppAction::StartSearch,
        KeyCode::Char('n') => AppAction::NextSearchResult,
        KeyCode::Char('N') => AppAction::PrevSearchResult,

        // Overlays
        KeyCode::Char('?') => AppAction::ToggleHelp,
        KeyCode::Char('u') => AppAction::ToggleUsageGraph,
        KeyCode::Char('L') => AppAction::ToggleLiveMode,

        // Redraw
        KeyCode::Char('r') => AppAction::Redraw,

        _ => AppAction::None,
    }
}

/// Handle key events in search mode
fn handle_search_key(key: KeyEvent) -> AppAction {
    match key.code {
        KeyCode::Esc => AppAction::CancelSearch,
        KeyCode::Enter => AppAction::SubmitSearch,
        KeyCode::Backspace => AppAction::SearchBackspace,
        KeyCode::Char(c) => {
            if key.modifiers.contains(KeyModifiers::CONTROL) {
                match c {
                    'c' | 'g' => AppAction::CancelSearch,
                    _ => AppAction::None,
                }
            } else {
                AppAction::SearchInput(c)
            }
        }
        _ => AppAction::None,
    }
}

/// Key binding help text
pub const HELP_TEXT: &str = r#"
╭─────────────────────────────────────────╮
│           transcript-tui-rs             │
│              Key Bindings               │
├─────────────────────────────────────────┤
│                                         │
│  Navigation                             │
│  ─────────                              │
│  j/k, ↑/↓    Move selection up/down     │
│  g/G         Go to first/last line      │
│  PgUp/PgDn   Page up/down               │
│  Tab         Switch panes               │
│  h/l, ←/→    Scroll content left/right  │
│                                         │
│  View Modes                             │
│  ──────────                             │
│  1           Raw JSON                   │
│  2           Human-readable             │
│  3           Minimal (text only)        │
│  4           Conversation context       │
│  5           Markdown rendered          │
│  f           Toggle fullscreen          │
│                                         │
│  Search                                 │
│  ──────                                 │
│  /           Start search               │
│  n/N         Next/prev search result    │
│  Esc         Cancel search              │
│                                         │
│  Bookmarks                              │
│  ─────────                              │
│  Space       Toggle bookmark            │
│  [/]         Prev/next bookmark         │
│                                         │
│  Other                                  │
│  ─────                                  │
│  u           Usage graph                │
│  L           Toggle live mode           │
│  r           Redraw screen              │
│  ?           Show this help             │
│  q, Esc      Quit                       │
│                                         │
╰─────────────────────────────────────────╯
"#;
