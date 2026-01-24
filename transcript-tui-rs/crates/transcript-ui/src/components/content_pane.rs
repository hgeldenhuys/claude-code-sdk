//! Content pane component for displaying selected line content

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState, Wrap},
};

use crate::{views, App};

/// Render the content pane
pub fn render_content_pane(frame: &mut Frame, area: Rect, app: &App) {
    let is_focused = app.focused_pane == transcript_core::FocusedPane::Content || app.fullscreen;

    let block = Block::default()
        .title(format!(" Content ({}) ", app.view_mode.name()))
        .borders(Borders::ALL)
        .border_style(if is_focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default().fg(Color::DarkGray)
        });

    let inner = block.inner(area);

    // Get rendered content for current line
    let content = if let Some(line) = app.current_line() {
        views::render_content(line, app.view_mode, inner.width as usize)
    } else {
        vec![Line::from("No line selected")]
    };

    let total_lines = content.len() as u16;

    // Create paragraph with scroll
    let paragraph = Paragraph::new(content.clone())
        .block(block)
        .wrap(Wrap { trim: false })
        .scroll((app.content_scroll, app.content_scroll_x));

    frame.render_widget(paragraph, area);

    // Render scrollbar if content is taller than viewport
    if total_lines > inner.height {
        let scrollbar = Scrollbar::new(ScrollbarOrientation::VerticalRight)
            .begin_symbol(Some("↑"))
            .end_symbol(Some("↓"));

        let mut scrollbar_state = ScrollbarState::new(total_lines as usize)
            .position(app.content_scroll as usize)
            .viewport_content_length(inner.height as usize);

        frame.render_stateful_widget(
            scrollbar,
            area.inner(Margin {
                vertical: 1,
                horizontal: 0,
            }),
            &mut scrollbar_state,
        );
    }
}
