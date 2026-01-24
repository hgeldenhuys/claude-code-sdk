//! Line filtering utilities

use crate::types::{LineType, TranscriptLine};
use std::collections::HashSet;

/// Filter options for transcript lines
#[derive(Debug, Clone, Default)]
pub struct FilterOptions {
    /// Filter by line types
    pub types: Option<Vec<LineType>>,
    /// Filter by display types (user, assistant, tool, init, etc.)
    pub display_types: Option<Vec<String>>,
    /// Text search query
    pub search: Option<String>,
    /// Filter by session IDs
    pub session_ids: Option<Vec<String>>,
    /// Exclude types
    pub exclude_types: Option<Vec<LineType>>,
}

impl FilterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    /// Filter to only user and assistant messages
    pub fn conversations_only() -> Self {
        Self {
            types: Some(vec![LineType::User, LineType::Assistant]),
            ..Default::default()
        }
    }

    /// Exclude system and progress messages
    pub fn exclude_system() -> Self {
        Self {
            exclude_types: Some(vec![LineType::System, LineType::Progress, LineType::FileHistorySnapshot]),
            ..Default::default()
        }
    }

    pub fn with_types(mut self, types: Vec<LineType>) -> Self {
        self.types = Some(types);
        self
    }

    pub fn with_display_types(mut self, types: Vec<String>) -> Self {
        self.display_types = Some(types);
        self
    }

    pub fn with_search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }

    pub fn with_sessions(mut self, session_ids: Vec<String>) -> Self {
        self.session_ids = Some(session_ids);
        self
    }
}

/// Filter transcript lines based on options
pub fn filter_lines<'a>(
    lines: &'a [TranscriptLine],
    options: &FilterOptions,
) -> Vec<&'a TranscriptLine> {
    let mut result: Vec<&TranscriptLine> = lines.iter().collect();

    // Filter by line type
    if let Some(types) = &options.types {
        let type_set: HashSet<_> = types.iter().collect();
        result.retain(|line| type_set.contains(&line.line_type));
    }

    // Filter by display type
    if let Some(display_types) = &options.display_types {
        result.retain(|line| display_types.iter().any(|t| t == line.display_type()));
    }

    // Exclude types
    if let Some(exclude) = &options.exclude_types {
        let exclude_set: HashSet<_> = exclude.iter().collect();
        result.retain(|line| !exclude_set.contains(&line.line_type));
    }

    // Filter by session ID
    if let Some(session_ids) = &options.session_ids {
        let session_set: HashSet<_> = session_ids.iter().map(|s| s.as_str()).collect();
        result.retain(|line| session_set.contains(line.session_id.as_str()));
    }

    // Text search (case-insensitive)
    if let Some(search) = &options.search {
        let search_lower = search.to_lowercase();
        result.retain(|line| {
            if let Some(content) = &line.content {
                if content.to_lowercase().contains(&search_lower) {
                    return true;
                }
            }
            line.raw.to_lowercase().contains(&search_lower)
        });
    }

    result
}

/// Get unique session IDs from lines
pub fn get_session_ids(lines: &[TranscriptLine]) -> Vec<String> {
    let mut ids: Vec<String> = lines
        .iter()
        .map(|l| l.session_id.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    ids.sort();
    ids
}

/// Get line type statistics
pub fn get_type_counts(lines: &[TranscriptLine]) -> Vec<(LineType, usize)> {
    let mut counts = std::collections::HashMap::new();
    for line in lines {
        *counts.entry(line.line_type).or_insert(0) += 1;
    }
    let mut result: Vec<_> = counts.into_iter().collect();
    result.sort_by_key(|(t, _)| format!("{:?}", t));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_line(line_type: LineType, content: &str, session_id: &str) -> TranscriptLine {
        TranscriptLine {
            id: 1,
            line_number: 1,
            line_type,
            uuid: String::new(),
            parent_uuid: None,
            session_id: session_id.to_string(),
            timestamp: String::new(),
            cwd: None,
            slug: None,
            role: None,
            model: None,
            content: Some(content.to_string()),
            raw: String::new(),
            turn_id: None,
            turn_sequence: None,
            session_name: None,
        }
    }

    #[test]
    fn test_filter_by_type() {
        let lines = vec![
            make_line(LineType::User, "hello", "s1"),
            make_line(LineType::Assistant, "hi", "s1"),
            make_line(LineType::System, "init", "s1"),
        ];

        let opts = FilterOptions::new().with_types(vec![LineType::User]);
        let filtered = filter_lines(&lines, &opts);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].line_type, LineType::User);
    }

    #[test]
    fn test_filter_by_search() {
        let lines = vec![
            make_line(LineType::User, "hello world", "s1"),
            make_line(LineType::User, "goodbye", "s1"),
        ];

        let opts = FilterOptions::new().with_search("hello");
        let filtered = filter_lines(&lines, &opts);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].content.as_deref(), Some("hello world"));
    }
}
