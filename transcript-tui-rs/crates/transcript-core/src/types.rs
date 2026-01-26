//! Core type definitions for transcript data

use serde::{Deserialize, Serialize};

/// Token usage statistics for a message
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_creation_input_tokens: Option<u64>,
    #[serde(default)]
    pub cache_read_input_tokens: Option<u64>,
}

impl TokenUsage {
    /// Total tokens used (input + output + cache)
    pub fn total(&self) -> u64 {
        self.input_tokens
            + self.output_tokens
            + self.cache_creation_input_tokens.unwrap_or(0)
            + self.cache_read_input_tokens.unwrap_or(0)
    }
}

/// Content block types that can appear in messages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ContentBlock {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        tool_use_id: String,
        content: serde_json::Value,
        #[serde(default)]
        is_error: bool,
    },
    Thinking {
        thinking: String,
        #[serde(default)]
        signature: Option<String>,
    },
}

/// Message structure within a transcript line
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptMessage {
    pub role: String,
    #[serde(default)]
    pub content: MessageContent,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub usage: Option<TokenUsage>,
}

/// Message content can be a string or array of content blocks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

impl Default for MessageContent {
    fn default() -> Self {
        MessageContent::Text(String::new())
    }
}

impl MessageContent {
    /// Extract text content from message
    pub fn as_text(&self) -> String {
        match self {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Blocks(blocks) => {
                let mut parts = Vec::new();
                for block in blocks {
                    if let ContentBlock::Text { text } = block {
                        parts.push(text.clone());
                    }
                }
                parts.join("\n")
            }
        }
    }

    /// Get all tool uses from content
    pub fn tool_uses(&self) -> Vec<(&str, &str, &serde_json::Value)> {
        let mut tools = Vec::new();
        if let MessageContent::Blocks(blocks) = self {
            for block in blocks {
                if let ContentBlock::ToolUse { id, name, input } = block {
                    tools.push((id.as_str(), name.as_str(), input));
                }
            }
        }
        tools
    }

    /// Get thinking blocks from content
    pub fn thinking_blocks(&self) -> Vec<(&str, Option<&str>)> {
        let mut thinking = Vec::new();
        if let MessageContent::Blocks(blocks) = self {
            for block in blocks {
                if let ContentBlock::Thinking { thinking: text, signature } = block {
                    thinking.push((text.as_str(), signature.as_deref()));
                }
            }
        }
        thinking
    }

    /// Check if content has thinking blocks
    pub fn has_thinking(&self) -> bool {
        if let MessageContent::Blocks(blocks) = self {
            for block in blocks {
                if matches!(block, ContentBlock::Thinking { .. }) {
                    return true;
                }
            }
        }
        false
    }
}

/// Line type in a transcript
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineType {
    User,
    Assistant,
    System,
    Summary,
    Progress,
    #[serde(rename = "file-history-snapshot")]
    FileHistorySnapshot,
    #[serde(other)]
    Unknown,
}

impl std::fmt::Display for LineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LineType::User => write!(f, "user"),
            LineType::Assistant => write!(f, "assistant"),
            LineType::System => write!(f, "system"),
            LineType::Summary => write!(f, "summary"),
            LineType::Progress => write!(f, "progress"),
            LineType::FileHistorySnapshot => write!(f, "file-history-snapshot"),
            LineType::Unknown => write!(f, "unknown"),
        }
    }
}

/// A single line from a transcript
#[derive(Debug, Clone)]
pub struct TranscriptLine {
    /// Database row ID
    pub id: i64,
    /// Line number in the file (1-indexed)
    pub line_number: i64,
    /// Line type
    pub line_type: LineType,
    /// Unique identifier
    pub uuid: String,
    /// Parent UUID for threading
    pub parent_uuid: Option<String>,
    /// Session ID
    pub session_id: String,
    /// ISO timestamp
    pub timestamp: String,
    /// Current working directory
    pub cwd: Option<String>,
    /// Session slug/name
    pub slug: Option<String>,
    /// Message role
    pub role: Option<String>,
    /// Model used (for assistant messages)
    pub model: Option<String>,
    /// Extracted text content
    pub content: Option<String>,
    /// Raw JSON line
    pub raw: String,
    /// Turn ID (from hooks)
    pub turn_id: Option<String>,
    /// Turn sequence number
    pub turn_sequence: Option<i64>,
    /// Session name (human-readable)
    pub session_name: Option<String>,
}

impl TranscriptLine {
    /// Get the display type (for filtering and rendering)
    pub fn display_type(&self) -> &str {
        match self.line_type {
            LineType::User => "user",
            LineType::Assistant => {
                // Check if this is a tool use or text response
                if let Ok(parsed) = self.parse() {
                    if let Some(msg) = &parsed.message {
                        if !msg.content.tool_uses().is_empty() {
                            return "tool";
                        }
                    }
                }
                "assistant"
            }
            LineType::System => {
                // Check subtype for init
                if let Ok(parsed) = self.parse() {
                    if let Some(subtype) = parsed.subtype.as_deref() {
                        if subtype == "init" {
                            return "init";
                        }
                    }
                }
                "system"
            }
            LineType::Summary => "summary",
            LineType::Progress => "progress",
            LineType::FileHistorySnapshot => "file-history",
            LineType::Unknown => "unknown",
        }
    }

    /// Parse the raw JSON and return structured data
    pub fn parse(&self) -> Result<ParsedLine, serde_json::Error> {
        serde_json::from_str(&self.raw)
    }

    /// Get message if available
    pub fn message(&self) -> Option<TranscriptMessage> {
        self.parse().ok().and_then(|p| p.message)
    }

    /// Get token usage if available
    pub fn usage(&self) -> Option<TokenUsage> {
        self.message().and_then(|m| m.usage)
    }

    /// Get preview text for list display
    pub fn preview(&self, max_len: usize) -> String {
        if let Some(content) = &self.content {
            let preview = content.lines().next().unwrap_or("").trim();
            // Use char_indices for proper unicode handling
            let chars: Vec<char> = preview.chars().collect();
            if chars.len() > max_len {
                let truncated: String = chars[..max_len.saturating_sub(3)].iter().collect();
                format!("{}...", truncated)
            } else {
                preview.to_string()
            }
        } else {
            String::new()
        }
    }

    /// Format timestamp for display (HH:MM:SS)
    pub fn format_time(&self) -> String {
        // Extract time from ISO timestamp
        if let Some(time_part) = self.timestamp.split('T').nth(1) {
            if let Some(time) = time_part.split('.').next() {
                return time.to_string();
            }
        }
        self.timestamp.clone()
    }
}

/// Parsed transcript line with all fields
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedLine {
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub uuid: Option<String>,
    #[serde(rename = "parentUuid", default)]
    pub parent_uuid: Option<String>,
    #[serde(rename = "sessionId", default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(rename = "gitBranch", default)]
    pub git_branch: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub message: Option<TranscriptMessage>,
    #[serde(rename = "toolUseResult", default)]
    pub tool_use_result: Option<serde_json::Value>,
    #[serde(default)]
    pub subtype: Option<String>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(rename = "hookInfos", default)]
    pub hook_infos: Option<Vec<serde_json::Value>>,
    #[serde(rename = "hookErrors", default)]
    pub hook_errors: Option<Vec<String>>,
    #[serde(rename = "hookCount", default)]
    pub hook_count: Option<u32>,
}

/// Session metadata
#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub session_id: String,
    pub slug: Option<String>,
    pub file_path: String,
    pub line_count: i64,
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    pub indexed_at: String,
}

/// View modes for content display
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ViewMode {
    /// Raw JSON with syntax highlighting
    Json,
    /// Smart view: MD for text, tool-specific for tools
    #[default]
    Custom,
}

impl ViewMode {
    /// Get all view modes in order
    pub fn all() -> &'static [ViewMode] {
        &[ViewMode::Json, ViewMode::Custom]
    }

    /// Get view mode from key (1-2)
    pub fn from_key(key: char) -> Option<ViewMode> {
        match key {
            '1' => Some(ViewMode::Json),
            '2' => Some(ViewMode::Custom),
            _ => None,
        }
    }

    /// Get display name
    pub fn name(&self) -> &'static str {
        match self {
            ViewMode::Json => "JSON",
            ViewMode::Custom => "CUSTOM",
        }
    }
}

/// Focus state for panes
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FocusedPane {
    #[default]
    List,
    Content,
}

impl FocusedPane {
    pub fn toggle(&self) -> Self {
        match self {
            FocusedPane::List => FocusedPane::Content,
            FocusedPane::Content => FocusedPane::List,
        }
    }
}

// ============================================================================
// Hook Event Types
// ============================================================================

/// Sort order for queries
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Order {
    #[default]
    Asc,
    Desc,
}

/// A single hook event from the database
#[derive(Debug, Clone)]
pub struct HookEvent {
    pub id: i64,
    pub session_id: String,
    pub timestamp: String,
    pub event_type: String,
    pub tool_use_id: Option<String>,
    pub tool_name: Option<String>,
    pub decision: Option<String>,
    pub handler_results_json: Option<String>,
    pub input_json: Option<String>,
    pub context_json: Option<String>,
    pub file_path: String,
    pub line_number: i64,
    pub turn_id: Option<String>,
    pub turn_sequence: Option<i64>,
    pub session_name: Option<String>,
    pub git_hash: Option<String>,
    pub git_branch: Option<String>,
    pub git_dirty: Option<bool>,
}

impl HookEvent {
    /// Format timestamp as HH:MM:SS
    pub fn format_time(&self) -> String {
        if let Some(t_pos) = self.timestamp.find('T') {
            let time_part = &self.timestamp[t_pos + 1..];
            time_part.split('.').next().unwrap_or(time_part).to_string()
        } else {
            self.timestamp.clone()
        }
    }

    /// Get abbreviated event type
    pub fn event_abbrev(&self) -> &'static str {
        match self.event_type.as_str() {
            "PreToolUse" => "Pre",
            "PostToolUse" => "Post",
            "UserPromptSubmit" => "Prompt",
            "UserPromptSubmitHook" => "Prompt",
            "SessionStart" => "Start",
            "SessionEnd" => "End",
            "Stop" => "Stop",
            "SubagentStop" => "SubStp",
            "PreSubagentToolUse" => "SubPre",
            "PostSubagentToolUse" => "SubPst",
            _ => "???",
        }
    }

    /// Calculate context usage percentage from input_json
    /// Context window is 200K tokens for current Claude models
    pub fn context_usage(&self) -> Option<(u64, u8)> {
        const CONTEXT_WINDOW: u64 = 200_000;
        let input_json = self.input_json.as_deref()?;
        let input: serde_json::Value = serde_json::from_str(input_json).ok()?;

        // Look for usage in various locations
        let usage = input.get("tool_response").and_then(|r| r.get("usage"))
            .or_else(|| input.get("usage"))
            .or_else(|| input.get("message").and_then(|m| m.get("usage")))?;

        let input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let total = input_tokens + output_tokens;
        let pct = ((total as f64 / CONTEXT_WINDOW as f64) * 100.0).round() as u8;
        Some((total, pct))
    }

    /// Get a preview of the tool input for display
    pub fn input_preview(&self, max_len: usize) -> Option<String> {
        let input_json = self.input_json.as_deref()?;
        let input: serde_json::Value = serde_json::from_str(input_json).ok()?;

        // Tool input preview
        if let Some(tool_input) = input.get("tool_input") {
            let s = serde_json::to_string(tool_input).ok()?;
            return Some(truncate_str(&s, max_len));
        }

        // Prompt preview
        if let Some(prompt) = input.get("prompt").and_then(|v| v.as_str()) {
            return Some(truncate_str(prompt, max_len));
        }

        None
    }

    /// Get tool output preview (for PostToolUse events)
    pub fn output_preview(&self, max_len: usize) -> Option<String> {
        if self.event_type != "PostToolUse" {
            return None;
        }
        let input_json = self.input_json.as_deref()?;
        let input: serde_json::Value = serde_json::from_str(input_json).ok()?;
        let response = input.get("tool_response")?;

        if let Some(stdout) = response.get("stdout").and_then(|v| v.as_str()) {
            let preview = stdout.replace('\n', "\\n");
            return Some(truncate_str(&preview, max_len));
        }
        if let Some(content) = response.get("content").and_then(|v| v.as_str()) {
            let preview = content.replace('\n', "\\n");
            return Some(truncate_str(&preview, max_len));
        }

        None
    }
}

fn truncate_str(s: &str, max_len: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() > max_len {
        let truncated: String = chars[..max_len.saturating_sub(3)].iter().collect();
        format!("{}...", truncated)
    } else {
        s.to_string()
    }
}

/// Session-level hook event metadata (from hook_files table)
#[derive(Debug, Clone)]
pub struct HookSession {
    pub session_id: String,
    pub file_path: String,
    pub event_count: i64,
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    pub indexed_at: String,
    pub session_name: Option<String>,
}

/// Filter options for querying hook events
#[derive(Debug, Clone, Default)]
pub struct HookEventFilter {
    pub session_id: Option<String>,
    pub event_types: Option<Vec<String>>,
    pub tool_names: Option<Vec<String>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub order: Order,
}

/// File edit aggregation from hook events
#[derive(Debug, Clone)]
pub struct FileEdit {
    pub file_path: String,
    pub edit_count: i64,
    pub tools_used: Vec<String>,
    pub first_timestamp: String,
    pub last_timestamp: String,
}
