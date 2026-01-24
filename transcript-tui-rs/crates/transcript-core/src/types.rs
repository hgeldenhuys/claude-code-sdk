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
