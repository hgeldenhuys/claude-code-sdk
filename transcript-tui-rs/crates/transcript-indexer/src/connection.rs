//! Read-write database connection for indexing operations

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use thiserror::Error;

use crate::schema;

/// Indexer database errors
#[derive(Error, Debug)]
pub enum IndexerError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON parse error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("File not found: {0}")]
    FileNotFound(PathBuf),

    #[error("Schema migration failed: {0}")]
    Migration(String),
}

/// Default database path
pub fn default_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "~".to_string());
    PathBuf::from(home)
        .join(".claude-code-sdk")
        .join("transcripts.db")
}

/// Read-write database connection for indexing
pub struct IndexerDb {
    pub(crate) conn: Connection,
    path: PathBuf,
}

impl IndexerDb {
    /// Open or create the database at the default path
    pub fn open_or_create_default() -> Result<Self, IndexerError> {
        Self::open_or_create(&default_db_path())
    }

    /// Open or create the database at a specific path
    pub fn open_or_create(path: &Path) -> Result<Self, IndexerError> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;

        // Set WAL mode and synchronous for better concurrent performance
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = OFF;",
        )?;

        let mut db = Self {
            conn,
            path: path.to_path_buf(),
        };

        // Initialize schema (creates tables if needed, runs migrations)
        schema::init_schema(&mut db.conn)?;

        Ok(db)
    }

    /// Get the database path
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get a reference to the underlying connection
    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    /// Get a mutable reference to the underlying connection
    pub fn connection_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    /// Execute a closure within a transaction
    pub fn transaction<F, T>(&mut self, f: F) -> Result<T, IndexerError>
    where
        F: FnOnce(&Connection) -> Result<T, IndexerError>,
    {
        let tx = self.conn.transaction()?;
        let result = f(&tx)?;
        tx.commit()?;
        Ok(result)
    }
}
