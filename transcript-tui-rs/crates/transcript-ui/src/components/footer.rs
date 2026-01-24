//! Footer/status bar component

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Paragraph},
};

use crate::App;

/// Render the footer/status bar
pub fn render_footer(frame: &mut Frame, area: Rect, app: &App) {
    let status = app.status_info();

    let help_hint = "?: help  q: quit";

    let message = if let Some(msg) = &app.status_message {
        format!("{} │ {} │ {}", status, msg, help_hint)
    } else if let Some(err) = &app.error_message {
        format!("{} │ ERROR: {} │ {}", status, err, help_hint)
    } else {
        format!("{} │ {}", status, help_hint)
    };

    let style = if app.error_message.is_some() {
        Style::default().fg(Color::Red)
    } else if app.live_mode {
        Style::default().fg(Color::Green)
    } else {
        Style::default().fg(Color::DarkGray)
    };

    let footer = Paragraph::new(message)
        .style(style)
        .block(Block::default().borders(Borders::TOP));

    frame.render_widget(footer, area);
}
