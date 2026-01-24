//! Overlay components (help, usage graph)

use ratatui::{
    prelude::*,
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};

use crate::{event::HELP_TEXT, App};

/// Render the help overlay
pub fn render_help_overlay(frame: &mut Frame) {
    let area = centered_rect(50, 80, frame.area());

    // Clear background
    frame.render_widget(Clear, area);

    let help = Paragraph::new(HELP_TEXT)
        .style(Style::default().fg(Color::White))
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        );

    frame.render_widget(help, area);
}

/// Render the usage graph overlay
pub fn render_usage_graph(frame: &mut Frame, app: &App) {
    let area = centered_rect(70, 60, frame.area());

    // Clear background
    frame.render_widget(Clear, area);

    // Collect usage data
    let mut usage_data: Vec<(String, f64)> = Vec::new();
    let context_size = 200_000u64; // 200K tokens

    for line in &app.lines {
        if let Some(usage) = line.usage() {
            let total = usage.total();
            let percent = (total as f64 / context_size as f64) * 100.0;
            let time = line.format_time();
            usage_data.push((time, percent));
        }
    }

    // Create a simple text-based visualization
    let mut lines: Vec<Line> = vec![
        Line::from(Span::styled(
            "Context Usage Over Time",
            Style::default().fg(Color::Cyan).bold(),
        )),
        Line::from(""),
    ];

    if usage_data.is_empty() {
        lines.push(Line::from("No usage data available"));
    } else {
        // Find max for scaling
        let max_percent = usage_data
            .iter()
            .map(|(_, p)| *p)
            .fold(0.0f64, f64::max)
            .max(1.0);

        let bar_width = (area.width as usize).saturating_sub(20);

        for (time, percent) in usage_data.iter().take(30) {
            // Limit to 30 entries
            let bar_len = ((percent / max_percent) * bar_width as f64) as usize;
            let bar = "█".repeat(bar_len);

            let color = if *percent < 50.0 {
                Color::Green
            } else if *percent < 70.0 {
                Color::Yellow
            } else {
                Color::Red
            };

            lines.push(Line::from(vec![
                Span::styled(format!("{} ", time), Style::default().fg(Color::DarkGray)),
                Span::styled(bar, Style::default().fg(color)),
                Span::styled(format!(" {:.1}%", percent), Style::default().fg(color)),
            ]));
        }

        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("Green: <50% ", Style::default().fg(Color::Green)),
            Span::styled("Yellow: 50-70% ", Style::default().fg(Color::Yellow)),
            Span::styled("Red: >70%", Style::default().fg(Color::Red)),
        ]));
    }

    let paragraph = Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .block(
            Block::default()
                .title(" Usage Graph (u to close) ")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        );

    frame.render_widget(paragraph, area);
}

/// Helper to create a centered rect with percentage width and height
fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let width = r.width * percent_x / 100;
    let height = r.height * percent_y / 100;
    let x = (r.width - width) / 2;
    let y = (r.height - height) / 2;

    Rect::new(r.x + x, r.y + y, width, height)
}
