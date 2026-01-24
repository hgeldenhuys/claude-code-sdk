//! Header component

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::App;

/// Render the header
pub fn render_header(frame: &mut Frame, area: Rect, app: &App) {
    let title = app.title();

    let view_modes = ["1:JSON", "2:CUSTOM"];
    let current_mode = match app.view_mode {
        transcript_core::ViewMode::Json => 0,
        transcript_core::ViewMode::Custom => 1,
    };

    let modes_display: String = view_modes
        .iter()
        .enumerate()
        .map(|(i, m)| {
            if i == current_mode {
                format!("[{}]", m)
            } else {
                m.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let live_indicator = if app.live_mode { " LIVE" } else { "" };

    let header_text = format!(
        "{} │ {} │ v0.1.0{}",
        title, modes_display, live_indicator
    );

    let header = Paragraph::new(header_text)
        .style(Style::default().fg(Color::Cyan).bold())
        .block(Block::default().borders(Borders::BOTTOM));

    frame.render_widget(header, area);
}
