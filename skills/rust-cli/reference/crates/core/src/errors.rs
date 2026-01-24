//! Error types for the core crate

use std::path::PathBuf;
use thiserror::Error;

/// Core errors
#[derive(Error, Debug)]
pub enum CoreError {
    #[error("File not found: {0}")]
    NotFound(PathBuf),

    #[error("Invalid format: expected {expected}, got {actual}")]
    InvalidFormat { expected: String, actual: String },

    #[error("Not initialized (run: example init)")]
    NotInitialized,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
