//! Core type definitions

use serde::{Deserialize, Serialize};

/// Configuration for the application
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Path to data directory
    pub data_dir: std::path::PathBuf,

    /// Enable verbose output
    #[serde(default)]
    pub verbose: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            data_dir: std::path::PathBuf::from("."),
            verbose: false,
        }
    }
}

/// Status for diagnostic checks
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticStatus {
    Pass,
    Warn,
    Fail,
}

/// Result of a diagnostic check
#[derive(Debug, Clone)]
pub struct DiagnosticResult {
    pub name: String,
    pub status: DiagnosticStatus,
    pub message: String,
    pub fix: Option<String>,
}

/// Filter options with builder pattern
#[derive(Debug, Clone, Default)]
pub struct FilterOptions {
    pub types: Option<Vec<String>>,
    pub search: Option<String>,
    pub limit: Option<usize>,
}

impl FilterOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_types(mut self, types: Vec<String>) -> Self {
        self.types = Some(types);
        self
    }

    pub fn with_search(mut self, search: impl Into<String>) -> Self {
        self.search = Some(search.into());
        self
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit);
        self
    }
}
