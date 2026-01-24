//! List pane component showing transcript lines

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, List, ListItem, ListState},
};
use transcript_core::{LineType, TranscriptLine};

use crate::App;

/// Render the list pane
pub fn render_list_pane(frame: &mut Frame, area: Rect, app: &App) {
    let is_focused = app.focused_pane == transcript_core::FocusedPane::List;

    let block = Block::default()
        .title(" Lines ")
        .borders(Borders::ALL)
        .border_style(if is_focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let inner = block.inner(area);

    // Generate list items
    let items: Vec<ListItem> = app
        .lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let is_selected = i == app.current_index;
            let is_bookmarked = app.bookmarks.contains(&line.id);
            let is_search_match = app.search_results.contains(&i);
            format_list_item(line, is_selected, is_bookmarked, is_search_match, inner.width as usize)
        })
        .collect();

    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED));

    // Create list state for selection
    let mut state = ListState::default();
    state.select(Some(app.current_index));

    frame.render_stateful_widget(list, area, &mut state);
}

/// Format a single list item to match TypeScript TUI screenshot format:
/// [bookmark]  [time:8] [type:3] [preview]
fn format_list_item(
    line: &TranscriptLine,
    is_selected: bool,
    is_bookmarked: bool,
    _is_search_match: bool,
    width: usize,
) -> ListItem<'static> {
    // Type abbreviation (3 chars to match TypeScript screenshot)
    let type_str = match line.line_type {
        LineType::User => "USR",
        LineType::Assistant => "AST",
        LineType::System => "SYS",
        LineType::Summary => "SUM",
        LineType::Progress => "PRG",
        LineType::FileHistorySnapshot => "FHS",
        LineType::Unknown => "???",
    };

    let type_color = match line.line_type {
        LineType::User => Color::Green,
        LineType::Assistant => Color::Blue,
        LineType::System => Color::Yellow,
        LineType::Summary => Color::Magenta,
        LineType::Progress => Color::DarkGray,
        _ => Color::Gray,
    };

    let bookmark_char = if is_bookmarked { "★" } else { " " };

    // Time (HH:MM:SS from timestamp)
    let time = line.format_time();

    // Calculate preview width
    let prefix_len = 3 + 8 + 1 + 3 + 1; // "★  HH:MM:SS USR "
    let preview_width = width.saturating_sub(prefix_len);
    let preview = line.preview(preview_width);

    let style = if is_selected {
        Style::default().bg(Color::DarkGray).fg(Color::White)
    } else if is_bookmarked {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let spans = vec![
        Span::styled(
            format!("{}  ", bookmark_char),
            if is_bookmarked {
                Style::default().fg(Color::Yellow)
            } else {
                style
            },
        ),
        Span::styled(format!("{} ", time), style.fg(Color::DarkGray)),
        Span::styled(format!("{} ", type_str), style.fg(type_color)),
        Span::styled(preview, style),
    ];

    ListItem::new(Line::from(spans))
}
