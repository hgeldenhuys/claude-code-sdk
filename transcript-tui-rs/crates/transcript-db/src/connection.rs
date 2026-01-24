//! Database connection management

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Database errors
#[derive(Error, Debug)]
pub enum DbError {
    #[error("Database not found at {0}")]
    NotFound(PathBuf),

    #[error("Database error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Database not initialized (run: transcript index build)")]
    NotInitialized,

    #[error("Database version mismatch: expected {expected}, found {found}")]
    VersionMismatch { expected: i32, found: i32 },
}

/// Expected database version
pub const DB_VERSION: i32 = 8;

/// Default database path
pub fn default_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home)
        .join(".claude-code-sdk")
        .join("transcripts.db")
}

/// Database connection wrapper
pub struct TranscriptDb {
    pub(crate) conn: Connection,
    path: PathBuf,
}

impl TranscriptDb {
    /// Open the database at the default path
    pub fn open_default() -> Result<Self, DbError> {
        Self::open(&default_db_path())
    }

    /// Open the database at a specific path
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, DbError> {
        let path = path.as_ref().to_path_buf();

        if !path.exists() {
            return Err(DbError::NotFound(path));
        }

        // Open read-only with URI mode for better compatibility
        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        // Check version
        let db = Self { conn, path };
        db.check_version()?;

        Ok(db)
    }

    /// Check database version
    fn check_version(&self) -> Result<(), DbError> {
        let version: Option<i32> = self
            .conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .ok();

        match version {
            None => Err(DbError::NotInitialized),
            Some(v) if v < DB_VERSION => Err(DbError::VersionMismatch {
                expected: DB_VERSION,
                found: v,
            }),
            Some(_) => Ok(()),
        }
    }

    /// Get the database path
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get the underlying connection (for custom queries)
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Get database statistics
    pub fn stats(&self) -> Result<DbStats, DbError> {
        let version: i32 = self
            .conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let line_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))?;

        let session_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))?;

        let hook_event_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM hook_events", [], |row| row.get(0))
            .unwrap_or(0);

        let last_indexed: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM metadata WHERE key = 'last_indexed'",
                [],
                |row| row.get(0),
            )
            .ok();

        let db_size = std::fs::metadata(&self.path)
            .map(|m| m.len())
            .unwrap_or(0);

        Ok(DbStats {
            version,
            line_count,
            session_count,
            hook_event_count,
            last_indexed,
            db_path: self.path.clone(),
            db_size_bytes: db_size,
        })
    }
}

/// Database statistics
#[derive(Debug, Clone)]
pub struct DbStats {
    pub version: i32,
    pub line_count: i64,
    pub session_count: i64,
    pub hook_event_count: i64,
    pub last_indexed: Option<String>,
    pub db_path: PathBuf,
    pub db_size_bytes: u64,
}

impl DbStats {
    /// Format database size as human-readable string
    pub fn format_size(&self) -> String {
        let bytes = self.db_size_bytes as f64;
        if bytes < 1024.0 {
            format!("{} B", bytes)
        } else if bytes < 1024.0 * 1024.0 {
            format!("{:.1} KB", bytes / 1024.0)
        } else if bytes < 1024.0 * 1024.0 * 1024.0 {
            format!("{:.1} MB", bytes / (1024.0 * 1024.0))
        } else {
            format!("{:.1} GB", bytes / (1024.0 * 1024.0 * 1024.0))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_path() {
        let path = default_db_path();
        assert!(path.to_string_lossy().contains(".claude-code-sdk"));
        assert!(path.to_string_lossy().ends_with("transcripts.db"));
    }
}
