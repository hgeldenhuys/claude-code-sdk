//! Session management and lookup

use crate::connection::{DbError, TranscriptDb};
use transcript_core::SessionInfo;

impl TranscriptDb {
    /// Get all sessions
    pub fn get_sessions(&self, recent_days: Option<i64>) -> Result<Vec<SessionInfo>, DbError> {
        let sql = if recent_days.is_some() {
            r#"
                SELECT
                    session_id,
                    slug,
                    file_path,
                    line_count,
                    first_timestamp,
                    last_timestamp,
                    indexed_at
                FROM sessions
                WHERE last_timestamp >= datetime('now', ? || ' days')
                ORDER BY last_timestamp DESC
            "#
        } else {
            r#"
                SELECT
                    session_id,
                    slug,
                    file_path,
                    line_count,
                    first_timestamp,
                    last_timestamp,
                    indexed_at
                FROM sessions
                ORDER BY last_timestamp DESC
            "#
        };

        let mut stmt = self.conn.prepare(sql)?;
        let rows = if let Some(days) = recent_days {
            stmt.query_map([format!("-{}", days)], row_to_session_info)?
        } else {
            stmt.query_map([], row_to_session_info)?
        };

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Get a session by ID or slug
    pub fn get_session(&self, id_or_slug: &str) -> Result<Option<SessionInfo>, DbError> {
        let sql = r#"
            SELECT
                session_id,
                slug,
                file_path,
                line_count,
                first_timestamp,
                last_timestamp,
                indexed_at
            FROM sessions
            WHERE session_id = ? OR slug = ?
            LIMIT 1
        "#;

        let result = self
            .conn
            .query_row(sql, [id_or_slug, id_or_slug], row_to_session_info);

        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Find sessions matching a pattern (partial match on slug or session_id)
    pub fn find_sessions(&self, pattern: &str) -> Result<Vec<SessionInfo>, DbError> {
        let sql = r#"
            SELECT
                session_id,
                slug,
                file_path,
                line_count,
                first_timestamp,
                last_timestamp,
                indexed_at
            FROM sessions
            WHERE session_id LIKE ? OR slug LIKE ?
            ORDER BY last_timestamp DESC
            LIMIT 20
        "#;

        let pattern_like = format!("%{}%", pattern);
        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([&pattern_like, &pattern_like], row_to_session_info)?;

        let mut sessions = Vec::new();
        for row in rows {
            sessions.push(row?);
        }
        Ok(sessions)
    }

    /// Resolve a session ID from name using the session store
    /// This tries multiple lookup strategies:
    /// 1. Direct session ID match
    /// 2. Slug match
    /// 3. Session name match (in hook_events)
    pub fn resolve_session(&self, name_or_id: &str) -> Result<Option<SessionInfo>, DbError> {
        // First try direct lookup
        if let Some(session) = self.get_session(name_or_id)? {
            return Ok(Some(session));
        }

        // Try looking up by session_name in lines table
        let sql = r#"
            SELECT DISTINCT
                s.session_id,
                s.slug,
                s.file_path,
                s.line_count,
                s.first_timestamp,
                s.last_timestamp,
                s.indexed_at
            FROM sessions s
            JOIN lines l ON s.session_id = l.session_id
            WHERE l.session_name = ?
            LIMIT 1
        "#;

        let result = self
            .conn
            .query_row(sql, [name_or_id], row_to_session_info);

        match result {
            Ok(session) => Ok(Some(session)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// Get session IDs by session name from hook_events
    pub fn get_session_ids_by_name(&self, name: &str) -> Result<Vec<String>, DbError> {
        let sql = r#"
            SELECT DISTINCT session_id
            FROM hook_events
            WHERE session_name = ?
            ORDER BY timestamp DESC
        "#;

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map([name], |row| row.get(0))?;

        let mut ids = Vec::new();
        for row in rows {
            ids.push(row?);
        }
        Ok(ids)
    }
}

fn row_to_session_info(row: &rusqlite::Row) -> Result<SessionInfo, rusqlite::Error> {
    Ok(SessionInfo {
        session_id: row.get(0)?,
        slug: row.get(1).ok(),
        file_path: row.get(2)?,
        line_count: row.get(3)?,
        first_timestamp: row.get(4).ok(),
        last_timestamp: row.get(5).ok(),
        indexed_at: row.get(6)?,
    })
}
