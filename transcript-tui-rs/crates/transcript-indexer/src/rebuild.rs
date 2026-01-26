//! Index rebuild operations
//!
//! Clears and recreates the index from scratch.

use rusqlite::Connection;

use crate::connection::IndexerError;
use crate::schema;

/// Clear and rebuild the entire index
///
/// This drops all tables (except metadata) and recreates them,
/// ensuring the schema is current and all data is cleared.
pub fn rebuild_index(conn: &mut Connection) -> Result<(), IndexerError> {
    // Drop triggers first (they reference tables)
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS lines_ai;
         DROP TRIGGER IF EXISTS lines_ad;
         DROP TRIGGER IF EXISTS lines_au;
         DROP TRIGGER IF EXISTS hook_events_ai;
         DROP TRIGGER IF EXISTS hook_events_ad;
         DROP TRIGGER IF EXISTS hook_events_au;",
    )?;

    // Drop FTS tables
    conn.execute_batch(
        "DROP TABLE IF EXISTS lines_fts;
         DROP TABLE IF EXISTS hook_events_fts;",
    )?;

    // Drop data tables
    conn.execute_batch(
        "DROP TABLE IF EXISTS lines;
         DROP TABLE IF EXISTS sessions;
         DROP TABLE IF EXISTS hook_events;
         DROP TABLE IF EXISTS hook_files;
         DROP TABLE IF EXISTS adapter_cursors;",
    )?;

    // Clear last_indexed from metadata (keep the table itself)
    conn.execute(
        "DELETE FROM metadata WHERE key = 'last_indexed'",
        [],
    )?;

    // Recreate everything via init_schema
    schema::init_schema(conn)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn test_rebuild_clears_all_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::init_schema(&mut conn).unwrap();

        // Insert some test data
        conn.execute_batch(
            "INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content)
             VALUES ('s1', 'u1', 1, 'user', '2024-01-01T00:00:00Z', '{}', '/test', 'hello');
             INSERT INTO sessions (file_path, session_id, line_count, byte_offset, indexed_at)
             VALUES ('/test', 's1', 1, 100, '2024-01-01');
             INSERT INTO hook_events (session_id, timestamp, event_type, file_path, line_number)
             VALUES ('s1', '2024-01-01T00:00:00Z', 'PreToolUse', '/hooks', 1);
             INSERT INTO hook_files (file_path, session_id, event_count, byte_offset, indexed_at)
             VALUES ('/hooks', 's1', 1, 100, '2024-01-01');
             INSERT INTO metadata (key, value) VALUES ('last_indexed', '2024-01-01');",
        )
        .unwrap();

        rebuild_index(&mut conn).unwrap();

        // Verify everything is cleared
        let line_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM lines", [], |row| row.get(0))
            .unwrap();
        assert_eq!(line_count, 0);

        let session_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(session_count, 0);

        let hook_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hook_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(hook_count, 0);

        let hook_file_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM hook_files", [], |row| row.get(0))
            .unwrap();
        assert_eq!(hook_file_count, 0);

        // Version should still exist
        let version: i32 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM metadata WHERE key = 'version'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, crate::schema::DB_VERSION);
    }
}
