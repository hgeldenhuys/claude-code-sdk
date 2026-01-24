//! Search input component

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Paragraph},
};

use crate::App;

/// Render the search input popup
pub fn render_search_input(frame: &mut Frame, app: &App) {
    if !app.search_mode {
        return;
    }

    // Center the popup
    let area = centered_rect(60, 3, frame.area());

    // Clear the background
    frame.render_widget(Clear, area);

    let block = Block::default()
        .title(" Search ")
        .borders(Borders::ALL)
        .border_style(Style::default().fg(Color::Cyan));

    let input = Paragraph::new(format!("/{}_", app.search_query))
        .style(Style::default().fg(Color::Yellow))
        .block(block);

    frame.render_widget(input, area);

    // Position cursor at end of input
    let cursor_x = area.x + 2 + app.search_query.len() as u16;
    let cursor_y = area.y + 1;
    frame.set_cursor_position(Position::new(cursor_x, cursor_y));
}

/// Helper to create a centered rect
fn centered_rect(percent_x: u16, height: u16, r: Rect) -> Rect {
    let width = r.width * percent_x / 100;
    let x = (r.width - width) / 2;
    let y = r.height / 2 - height / 2;

    Rect::new(r.x + x, r.y + y, width, height)
}
