//! Database schema creation and migration
//!
//! Creates all tables matching the TypeScript schema exactly (v10).

use rusqlite::Connection;

use crate::connection::IndexerError;

/// Current database schema version
pub const DB_VERSION: i32 = 10;

/// Initialize the database schema (create tables + run migrations)
pub fn init_schema(conn: &mut Connection) -> Result<(), IndexerError> {
    // Metadata table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
    )?;

    // Main lines table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            uuid TEXT NOT NULL,
            parent_uuid TEXT,
            line_number INTEGER NOT NULL,
            type TEXT NOT NULL,
            subtype TEXT,
            timestamp TEXT NOT NULL,
            slug TEXT,
            role TEXT,
            model TEXT,
            cwd TEXT,
            content TEXT,
            raw TEXT NOT NULL,
            file_path TEXT NOT NULL,
            turn_id TEXT,
            turn_sequence INTEGER,
            session_name TEXT,
            git_hash TEXT,
            git_branch TEXT,
            git_dirty INTEGER,
            UNIQUE(session_id, uuid)
        )",
    )?;

    // Indexes for common queries
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_session_id ON lines(session_id);
         CREATE INDEX IF NOT EXISTS idx_type ON lines(type);
         CREATE INDEX IF NOT EXISTS idx_timestamp ON lines(timestamp);
         CREATE INDEX IF NOT EXISTS idx_slug ON lines(slug);
         CREATE INDEX IF NOT EXISTS idx_line_number ON lines(line_number);
         CREATE INDEX IF NOT EXISTS idx_lines_turn_id ON lines(turn_id);
         CREATE INDEX IF NOT EXISTS idx_lines_session_name ON lines(session_name);
         CREATE INDEX IF NOT EXISTS idx_lines_git_hash ON lines(git_hash);",
    )?;

    // FTS5 virtual table for full-text search on lines
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS lines_fts USING fts5(
            content,
            session_id UNINDEXED,
            slug UNINDEXED,
            type UNINDEXED,
            content='lines',
            content_rowid='id'
        )",
    )?;

    // Triggers to keep lines_fts in sync
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS lines_ai AFTER INSERT ON lines BEGIN
            INSERT INTO lines_fts(rowid, content, session_id, slug, type)
            VALUES (new.id, new.content, new.session_id, new.slug, new.type);
        END;

        CREATE TRIGGER IF NOT EXISTS lines_ad AFTER DELETE ON lines BEGIN
            INSERT INTO lines_fts(lines_fts, rowid, content, session_id, slug, type)
            VALUES ('delete', old.id, old.content, old.session_id, old.slug, old.type);
        END;

        CREATE TRIGGER IF NOT EXISTS lines_au AFTER UPDATE ON lines BEGIN
            INSERT INTO lines_fts(lines_fts, rowid, content, session_id, slug, type)
            VALUES ('delete', old.id, old.content, old.session_id, old.slug, old.type);
            INSERT INTO lines_fts(rowid, content, session_id, slug, type)
            VALUES (new.id, new.content, new.session_id, new.slug, new.type);
        END;",
    )?;

    // Sessions table for quick lookups and delta tracking
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            file_path TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            slug TEXT,
            line_count INTEGER NOT NULL,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            first_timestamp TEXT,
            last_timestamp TEXT,
            indexed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);",
    )?;

    // Hook events table
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS hook_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            tool_use_id TEXT,
            tool_name TEXT,
            decision TEXT,
            handler_results TEXT,
            input_json TEXT,
            context_json TEXT,
            file_path TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            turn_id TEXT,
            turn_sequence INTEGER,
            session_name TEXT,
            git_hash TEXT,
            git_branch TEXT,
            git_dirty INTEGER
        )",
    )?;

    // Indexes for hook events
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_hook_session ON hook_events(session_id);
         CREATE INDEX IF NOT EXISTS idx_hook_tool_use ON hook_events(tool_use_id);
         CREATE INDEX IF NOT EXISTS idx_hook_event_type ON hook_events(event_type);
         CREATE INDEX IF NOT EXISTS idx_hook_timestamp ON hook_events(timestamp);
         CREATE INDEX IF NOT EXISTS idx_hook_turn_id ON hook_events(turn_id);
         CREATE INDEX IF NOT EXISTS idx_hook_session_name ON hook_events(session_name);
         CREATE INDEX IF NOT EXISTS idx_hook_git_hash ON hook_events(git_hash);",
    )?;

    // Standalone FTS table for hook events
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS hook_events_fts USING fts5(
            content
        )",
    )?;

    // Triggers to keep hook_events_fts in sync
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS hook_events_ai AFTER INSERT ON hook_events BEGIN
            INSERT INTO hook_events_fts(rowid, content)
            VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS hook_events_ad AFTER DELETE ON hook_events BEGIN
            INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
            VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
        END;

        CREATE TRIGGER IF NOT EXISTS hook_events_au AFTER UPDATE ON hook_events BEGIN
            INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
            VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
            INSERT INTO hook_events_fts(rowid, content)
            VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
        END;",
    )?;

    // Hook files tracking table (for delta updates)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS hook_files (
            file_path TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            event_count INTEGER NOT NULL,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            first_timestamp TEXT,
            last_timestamp TEXT,
            indexed_at TEXT NOT NULL
        )",
    )?;

    // Adapter cursors table (for external adapter delta tracking)
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS adapter_cursors (
            file_path TEXT NOT NULL,
            adapter_name TEXT NOT NULL,
            byte_offset INTEGER NOT NULL DEFAULT 0,
            line_count INTEGER NOT NULL DEFAULT 0,
            last_processed TEXT,
            PRIMARY KEY (file_path, adapter_name)
        )",
    )?;

    // Run migrations if needed
    migrate_schema(conn)?;

    // Set version
    conn.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('version', ?1)",
        [&DB_VERSION.to_string()],
    )?;

    Ok(())
}

/// Migrate schema from older versions to current
pub fn migrate_schema(conn: &Connection) -> Result<(), IndexerError> {
    // Check current version
    let current_version: i32 = match conn.query_row(
        "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
        [],
        |row| row.get(0),
    ) {
        Ok(v) => v,
        Err(_) => {
            // metadata table might not exist yet or no version row - schema is fresh
            return Ok(());
        }
    };

    let mut version = current_version;

    // Migration v4 -> v5: Add turn_id, turn_sequence, session_name columns
    if version == 4 {
        eprintln!("[db] Migrating schema from v4 to v5...");

        let columns = ["turn_id TEXT", "turn_sequence INTEGER", "session_name TEXT"];
        for col in &columns {
            // lines table
            let _ = conn.execute(&format!("ALTER TABLE lines ADD COLUMN {}", col), []);
            // hook_events table
            let _ = conn.execute(&format!("ALTER TABLE hook_events ADD COLUMN {}", col), []);
        }

        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_lines_turn_id ON lines(turn_id);
             CREATE INDEX IF NOT EXISTS idx_lines_session_name ON lines(session_name);
             CREATE INDEX IF NOT EXISTS idx_hook_turn_id ON hook_events(turn_id);
             CREATE INDEX IF NOT EXISTS idx_hook_session_name ON hook_events(session_name);",
        )?;

        eprintln!("[db] Migration v4->v5 complete");
        version = 5;
    }

    // Migration v5 -> v6: (broken FTS, just bump version)
    if version == 5 {
        eprintln!("[db] Migrating schema from v5 to v6...");
        eprintln!("[db] Migration v5->v6 complete (will be fixed in v7)");
        version = 6;
    }

    // Migration v6 -> v7: Fix hook_events_fts (standalone instead of content table)
    if version == 6 {
        eprintln!("[db] Migrating schema from v6 to v7...");

        conn.execute_batch(
            "DROP TRIGGER IF EXISTS hook_events_ai;
             DROP TRIGGER IF EXISTS hook_events_ad;
             DROP TRIGGER IF EXISTS hook_events_au;
             DROP TABLE IF EXISTS hook_events_fts;",
        )?;

        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS hook_events_fts USING fts5(
                content
            )",
        )?;

        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS hook_events_ai AFTER INSERT ON hook_events BEGIN
                INSERT INTO hook_events_fts(rowid, content)
                VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
            END;

            CREATE TRIGGER IF NOT EXISTS hook_events_ad AFTER DELETE ON hook_events BEGIN
                INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
                VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
            END;

            CREATE TRIGGER IF NOT EXISTS hook_events_au AFTER UPDATE ON hook_events BEGIN
                INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
                VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
                INSERT INTO hook_events_fts(rowid, content)
                VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
            END;",
        )?;

        // Populate FTS from existing data
        eprintln!("[db] Populating hook_events_fts from existing data...");
        conn.execute_batch(
            "INSERT INTO hook_events_fts(rowid, content)
             SELECT id, COALESCE(event_type, '') || ' ' || COALESCE(tool_name, '') || ' ' || COALESCE(input_json, '')
             FROM hook_events",
        )?;

        eprintln!("[db] Migration v6->v7 complete");
        version = 7;
    }

    // Migration v7 -> v8: Add git tracking columns
    if version == 7 {
        eprintln!("[db] Migrating schema from v7 to v8...");

        let git_columns = ["git_hash TEXT", "git_branch TEXT", "git_dirty INTEGER"];
        for col in &git_columns {
            let _ = conn.execute(&format!("ALTER TABLE lines ADD COLUMN {}", col), []);
            let _ = conn.execute(&format!("ALTER TABLE hook_events ADD COLUMN {}", col), []);
        }

        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_lines_git_hash ON lines(git_hash);
             CREATE INDEX IF NOT EXISTS idx_hook_git_hash ON hook_events(git_hash);",
        );

        eprintln!("[db] Migration v7->v8 complete");
        version = 8;
    }

    // Migration v8 -> v9: Content trimming (no schema change, data convention change)
    // The indexed data now stores trimmed previews instead of full blobs.
    // Run "transcript index rebuild" to apply trimming to historical data.
    if version == 8 {
        eprintln!("[db] Migrating schema from v8 to v9 (content trimming convention)...");
        eprintln!("[db] Note: Run 'transcript index rebuild' to re-index with trimmed content");
        version = 9;
    }

    // Migration v9 -> v10: Drop non-searchable line types
    // Removes progress, file-history-snapshot, and queue-operation rows (~44% of DB size).
    // These types have zero searchable content but consume ~623 MB of raw storage.
    if version == 9 {
        eprintln!("[db] Migrating schema from v9 to v10 (drop non-searchable line types)...");

        // Delete non-searchable line types
        let deleted = conn.execute(
            "DELETE FROM lines WHERE type IN ('progress', 'file-history-snapshot', 'queue-operation')",
            [],
        )?;
        eprintln!("[db] Deleted {} non-searchable rows", deleted);

        // Rebuild FTS to remove orphaned entries
        eprintln!("[db] Rebuilding lines_fts...");
        conn.execute_batch("DELETE FROM lines_fts")?;
        conn.execute_batch(
            "INSERT INTO lines_fts(rowid, content, session_id, slug, type)
             SELECT id, content, session_id, slug, type FROM lines",
        )?;

        // Update session line counts (now stale after DELETE)
        conn.execute_batch(
            "UPDATE sessions SET line_count = (
                SELECT COUNT(*) FROM lines WHERE lines.file_path = sessions.file_path
            )",
        )?;

        eprintln!("[db] Migration v9->v10 complete");
        eprintln!("[db] Tip: Run VACUUM to reclaim disk space");
        version = 10;
    }

    // Suppress unused variable warning
    let _ = version;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_fresh_schema_creates_all_tables() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&mut conn).unwrap();

        // Check all tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"metadata".to_string()));
        assert!(tables.contains(&"lines".to_string()));
        assert!(tables.contains(&"sessions".to_string()));
        assert!(tables.contains(&"hook_events".to_string()));
        assert!(tables.contains(&"hook_files".to_string()));
        assert!(tables.contains(&"adapter_cursors".to_string()));

        // Check version
        let version: i32 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, DB_VERSION);
    }

    #[test]
    fn test_schema_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&mut conn).unwrap();
        // Running again should not error
        init_schema(&mut conn).unwrap();

        let version: i32 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, DB_VERSION);
    }

    #[test]
    fn test_fts_tables_exist() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&mut conn).unwrap();

        // Check FTS tables
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%fts%' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.iter().any(|t| t.contains("lines_fts")));
        assert!(tables.iter().any(|t| t.contains("hook_events_fts")));
    }

    #[test]
    fn test_lines_table_columns() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema(&mut conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(lines)").unwrap();
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        let expected = vec![
            "id", "session_id", "uuid", "parent_uuid", "line_number",
            "type", "subtype", "timestamp", "slug", "role", "model",
            "cwd", "content", "raw", "file_path", "turn_id",
            "turn_sequence", "session_name", "git_hash", "git_branch", "git_dirty",
        ];

        for col in &expected {
            assert!(
                columns.contains(&col.to_string()),
                "Missing column: {}",
                col
            );
        }
    }
}
