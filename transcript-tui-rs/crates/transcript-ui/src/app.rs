//! Application state and logic

use std::collections::HashSet;
use transcript_core::{FilterOptions, FocusedPane, TranscriptLine, ViewMode};
use transcript_db::TranscriptDb;

/// Application state
pub struct App {
    /// All loaded lines (unfiltered)
    pub all_lines: Vec<TranscriptLine>,
    /// Filtered lines for display
    pub lines: Vec<TranscriptLine>,
    /// Current selection index
    pub current_index: usize,
    /// Current view mode
    pub view_mode: ViewMode,
    /// Search query
    pub search_query: String,
    /// Search results (line indices)
    pub search_results: Vec<usize>,
    /// Current search result index
    pub search_result_index: usize,
    /// Is search mode active
    pub search_mode: bool,
    /// Session ID
    pub session_id: String,
    /// Session name (human-readable)
    pub session_name: Option<String>,
    /// Focused pane
    pub focused_pane: FocusedPane,
    /// Fullscreen content mode
    pub fullscreen: bool,
    /// Content scroll offset (vertical)
    pub content_scroll: u16,
    /// Content horizontal scroll
    pub content_scroll_x: u16,
    /// Bookmarked line IDs
    pub bookmarks: HashSet<i64>,
    /// Show help overlay
    pub show_help: bool,
    /// Show usage graph overlay
    pub show_usage_graph: bool,
    /// Live mode (auto-refresh)
    pub live_mode: bool,
    /// Last max line ID for delta updates
    pub last_max_id: i64,
    /// Filter options
    pub filter_opts: FilterOptions,
    /// Error message to display
    pub error_message: Option<String>,
    /// Status message
    pub status_message: Option<String>,
}

impl App {
    /// Create a new app with loaded lines
    pub fn new(lines: Vec<TranscriptLine>, session_id: String) -> Self {
        // Find session name from any line that has it (like TypeScript TUI)
        let session_name = lines.iter()
            .find_map(|l| l.session_name.clone());
        let last_max_id = lines.iter().map(|l| l.id).max().unwrap_or(0);
        // Start at last line (like TypeScript TUI)
        let initial_index = if lines.is_empty() { 0 } else { lines.len() - 1 };

        Self {
            all_lines: lines.clone(),
            lines,
            current_index: initial_index,
            view_mode: ViewMode::Custom,
            search_query: String::new(),
            search_results: Vec::new(),
            search_result_index: 0,
            search_mode: false,
            session_id,
            session_name,
            focused_pane: FocusedPane::List,
            fullscreen: false,
            content_scroll: 0,
            content_scroll_x: 0,
            bookmarks: HashSet::new(),
            show_help: false,
            show_usage_graph: false,
            live_mode: false,
            last_max_id,
            filter_opts: FilterOptions::default(),
            error_message: None,
            status_message: None,
        }
    }

    /// Get the currently selected line
    pub fn current_line(&self) -> Option<&TranscriptLine> {
        self.lines.get(self.current_index)
    }

    /// Move selection up
    pub fn select_prev(&mut self) {
        if self.current_index > 0 {
            self.current_index -= 1;
            self.content_scroll = 0;
            self.content_scroll_x = 0;
        }
    }

    /// Move selection down
    pub fn select_next(&mut self) {
        if self.current_index + 1 < self.lines.len() {
            self.current_index += 1;
            self.content_scroll = 0;
            self.content_scroll_x = 0;
        }
    }

    /// Go to first line
    pub fn select_first(&mut self) {
        self.current_index = 0;
        self.content_scroll = 0;
        self.content_scroll_x = 0;
    }

    /// Go to last line
    pub fn select_last(&mut self) {
        if !self.lines.is_empty() {
            self.current_index = self.lines.len() - 1;
            self.content_scroll = 0;
            self.content_scroll_x = 0;
        }
    }

    /// Page up
    pub fn page_up(&mut self, page_size: usize) {
        self.current_index = self.current_index.saturating_sub(page_size);
        self.content_scroll = 0;
    }

    /// Page down
    pub fn page_down(&mut self, page_size: usize) {
        self.current_index = (self.current_index + page_size).min(self.lines.len().saturating_sub(1));
        self.content_scroll = 0;
    }

    /// Scroll content up
    pub fn scroll_content_up(&mut self) {
        self.content_scroll = self.content_scroll.saturating_sub(1);
    }

    /// Scroll content down
    pub fn scroll_content_down(&mut self) {
        self.content_scroll = self.content_scroll.saturating_add(1);
    }

    /// Scroll content left
    pub fn scroll_content_left(&mut self) {
        self.content_scroll_x = self.content_scroll_x.saturating_sub(4);
    }

    /// Scroll content right
    pub fn scroll_content_right(&mut self) {
        self.content_scroll_x = self.content_scroll_x.saturating_add(4);
    }

    /// Toggle focused pane
    pub fn toggle_pane(&mut self) {
        self.focused_pane = self.focused_pane.toggle();
    }

    /// Set view mode
    pub fn set_view_mode(&mut self, mode: ViewMode) {
        self.view_mode = mode;
        self.content_scroll = 0;
        self.content_scroll_x = 0;
    }

    /// Toggle fullscreen mode
    pub fn toggle_fullscreen(&mut self) {
        self.fullscreen = !self.fullscreen;
    }

    /// Toggle bookmark for current line
    pub fn toggle_bookmark(&mut self) {
        if let Some(line) = self.current_line() {
            let id = line.id;
            if self.bookmarks.contains(&id) {
                self.bookmarks.remove(&id);
            } else {
                self.bookmarks.insert(id);
            }
        }
    }

    /// Jump to next bookmark
    pub fn next_bookmark(&mut self) {
        if self.bookmarks.is_empty() {
            return;
        }

        // Find next bookmarked line after current
        for (i, line) in self.lines.iter().enumerate().skip(self.current_index + 1) {
            if self.bookmarks.contains(&line.id) {
                self.current_index = i;
                self.content_scroll = 0;
                return;
            }
        }

        // Wrap around to beginning
        for (i, line) in self.lines.iter().enumerate() {
            if self.bookmarks.contains(&line.id) {
                self.current_index = i;
                self.content_scroll = 0;
                return;
            }
        }
    }

    /// Jump to previous bookmark
    pub fn prev_bookmark(&mut self) {
        if self.bookmarks.is_empty() {
            return;
        }

        // Find previous bookmarked line before current
        for i in (0..self.current_index).rev() {
            if let Some(line) = self.lines.get(i) {
                if self.bookmarks.contains(&line.id) {
                    self.current_index = i;
                    self.content_scroll = 0;
                    return;
                }
            }
        }

        // Wrap around to end
        for i in (0..self.lines.len()).rev() {
            if let Some(line) = self.lines.get(i) {
                if self.bookmarks.contains(&line.id) {
                    self.current_index = i;
                    self.content_scroll = 0;
                    return;
                }
            }
        }
    }

    /// Check if current line is bookmarked
    pub fn is_current_bookmarked(&self) -> bool {
        self.current_line()
            .map(|l| self.bookmarks.contains(&l.id))
            .unwrap_or(false)
    }

    /// Toggle live mode
    pub fn toggle_live_mode(&mut self) {
        self.live_mode = !self.live_mode;
        if self.live_mode {
            self.status_message = Some("Live mode ON".to_string());
        } else {
            self.status_message = Some("Live mode OFF".to_string());
        }
    }

    /// Apply filter and update lines
    pub fn apply_filter(&mut self, filter: FilterOptions) {
        self.filter_opts = filter.clone();

        // Apply filter to all_lines
        let filtered: Vec<TranscriptLine> = if filter.types.is_some()
            || filter.display_types.is_some()
            || filter.search.is_some()
            || filter.session_ids.is_some()
        {
            let refs = transcript_core::filter_lines(&self.all_lines, &filter);
            refs.into_iter().cloned().collect()
        } else {
            self.all_lines.clone()
        };

        self.lines = filtered;
        self.current_index = 0;
        self.content_scroll = 0;
    }

    /// Clear filter
    pub fn clear_filter(&mut self) {
        self.filter_opts = FilterOptions::default();
        self.lines = self.all_lines.clone();
        self.current_index = 0;
        self.content_scroll = 0;
    }

    /// Start search mode
    pub fn start_search(&mut self) {
        self.search_mode = true;
        self.search_query.clear();
        self.search_results.clear();
    }

    /// Cancel search
    pub fn cancel_search(&mut self) {
        self.search_mode = false;
        self.search_query.clear();
        self.search_results.clear();
    }

    /// Execute search
    pub fn execute_search(&mut self) {
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
        self.search_mode = false;

        if let Some(&idx) = self.search_results.first() {
            self.current_index = idx;
            self.content_scroll = 0;
            self.status_message = Some(format!(
                "Found {} matches",
                self.search_results.len()
            ));
        } else {
            self.status_message = Some("No matches found".to_string());
        }
    }

    /// Next search result
    pub fn next_search_result(&mut self) {
        if self.search_results.is_empty() {
            return;
        }

        self.search_result_index = (self.search_result_index + 1) % self.search_results.len();
        self.current_index = self.search_results[self.search_result_index];
        self.content_scroll = 0;
    }

    /// Previous search result
    pub fn prev_search_result(&mut self) {
        if self.search_results.is_empty() {
            return;
        }

        if self.search_result_index == 0 {
            self.search_result_index = self.search_results.len() - 1;
        } else {
            self.search_result_index -= 1;
        }
        self.current_index = self.search_results[self.search_result_index];
        self.content_scroll = 0;
    }

    /// Poll for new lines (for live mode)
    pub fn poll_new_lines(&mut self, db: &TranscriptDb) -> Result<usize, transcript_db::DbError> {
        let new_lines = db.get_lines_after_id(self.last_max_id, Some(&self.session_id))?;

        if new_lines.is_empty() {
            return Ok(0);
        }

        let count = new_lines.len();
        let was_at_end = self.current_index + 1 >= self.lines.len();

        // Update max ID
        if let Some(max_id) = new_lines.iter().map(|l| l.id).max() {
            self.last_max_id = max_id;
        }

        // Add new lines
        self.all_lines.extend(new_lines.iter().cloned());

        // Re-apply filter
        if self.filter_opts.types.is_some()
            || self.filter_opts.display_types.is_some()
            || self.filter_opts.search.is_some()
        {
            let refs = transcript_core::filter_lines(&self.all_lines, &self.filter_opts);
            self.lines = refs.into_iter().cloned().collect();
        } else {
            self.lines.extend(new_lines);
        }

        // Auto-scroll to end if we were at end
        if was_at_end && !self.lines.is_empty() {
            self.current_index = self.lines.len() - 1;
        }

        self.status_message = Some(format!("{} new line(s)", count));

        Ok(count)
    }

    /// Get display title for the app
    pub fn title(&self) -> String {
        if let Some(name) = &self.session_name {
            format!("Transcript: {}", name)
        } else {
            format!("Transcript: {}", &self.session_id[..8.min(self.session_id.len())])
        }
    }

    /// Get status line info
    pub fn status_info(&self) -> String {
        let mut parts = vec![
            format!("Line {}/{}", self.current_index + 1, self.lines.len()),
            format!("Mode: {}", self.view_mode.name()),
        ];

        if self.live_mode {
            parts.push("LIVE".to_string());
        }

        if !self.bookmarks.is_empty() {
            parts.push(format!("{} bookmarks", self.bookmarks.len()));
        }

        if !self.search_results.is_empty() {
            parts.push(format!(
                "Match {}/{}",
                self.search_result_index + 1,
                self.search_results.len()
            ));
        }

        parts.join(" | ")
    }
}
