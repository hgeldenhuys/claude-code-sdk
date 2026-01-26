//! Hook event query functions

use crate::connection::{DbError, TranscriptDb};
use transcript_core::{HookEvent, HookEventFilter, HookSession, Order};

impl TranscriptDb {
    /// Get hook events with filtering
    pub fn get_hook_events(&self, filter: &HookEventFilter) -> Result<Vec<HookEvent>, DbError> {
        let mut sql = String::from(
            r#"
            SELECT
                id, session_id, timestamp, event_type, tool_use_id, tool_name,
                decision, handler_results, input_json, context_json,
                file_path, line_number, turn_id, turn_sequence, session_name,
                git_hash, git_branch, git_dirty
            FROM hook_events
            WHERE 1=1
            "#,
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(session_id) = &filter.session_id {
            sql.push_str(" AND session_id = ?");
            params.push(Box::new(session_id.clone()));
        }

        if let Some(event_types) = &filter.event_types {
            if !event_types.is_empty() {
                let placeholders: Vec<_> = event_types.iter().map(|_| "?").collect();
                sql.push_str(&format!(" AND event_type IN ({})", placeholders.join(",")));
                for t in event_types {
                    params.push(Box::new(t.clone()));
                }
            }
        }

        if let Some(tool_names) = &filter.tool_names {
            if !tool_names.is_empty() {
                let placeholders: Vec<_> = tool_names.iter().map(|_| "?").collect();
                sql.push_str(&format!(" AND tool_name IN ({})", placeholders.join(",")));
                for t in tool_names {
                    params.push(Box::new(t.clone()));
                }
            }
        }

        if let Some(from_time) = &filter.from_time {
            sql.push_str(" AND timestamp >= ?");
            params.push(Box::new(from_time.clone()));
        }

        if let Some(to_time) = &filter.to_time {
            sql.push_str(" AND timestamp <= ?");
            params.push(Box::new(to_time.clone()));
        }

        let order_str = match filter.order {
            Order::Asc => "ASC",
            Order::Desc => "DESC",
        };
        sql.push_str(&format!(
            " ORDER BY timestamp {}, id {}",
            order_str, order_str
        ));

        if let Some(limit) = filter.limit {
            sql.push_str(" LIMIT ?");
            params.push(Box::new(limit));
        }

        if let Some(offset) = filter.offset {
            sql.push_str(" OFFSET ?");
            params.push(Box::new(offset));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| Ok(row_to_hook_event(row)))?;

        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }

    /// Get sessions that have hook events (from hook_files table)
    pub fn get_hook_sessions(
        &self,
        recent_days: Option<i64>,
        names_only: bool,
    ) -> Result<Vec<HookSession>, DbError> {
        let mut sql = String::from(
            r#"
            SELECT
                hf.session_id,
                hf.file_path,
                hf.event_count,
                hf.first_timestamp,
                hf.last_timestamp,
                hf.indexed_at
            FROM hook_files hf
            WHERE 1=1
            "#,
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(days) = recent_days {
            sql.push_str(" AND hf.last_timestamp >= datetime('now', ? || ' days')");
            params.push(Box::new(format!("-{}", days)));
        }

        sql.push_str(" ORDER BY hf.last_timestamp DESC");

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(HookSession {
                session_id: row.get(0)?,
                file_path: row.get(1)?,
                event_count: row.get(2)?,
                first_timestamp: row.get(3).ok(),
                last_timestamp: row.get(4).ok(),
                indexed_at: row.get(5)?,
                session_name: None, // Will be filled below if not names_only
            })
        })?;

        let mut sessions: Vec<HookSession> = Vec::new();
        for row in rows {
            sessions.push(row?);
        }

        // Look up session names from hook_events if needed
        if !names_only {
            for session in &mut sessions {
                let name: Option<String> = self
                    .conn
                    .query_row(
                        r#"
                        SELECT session_name FROM hook_events
                        WHERE session_id = ? AND session_name IS NOT NULL
                        ORDER BY timestamp DESC LIMIT 1
                        "#,
                        [&session.session_id],
                        |row| row.get(0),
                    )
                    .ok();
                session.session_name = name;
            }
        }

        Ok(sessions)
    }

    /// Get hook event statistics for a session (event type counts, tool counts)
    pub fn get_hook_session_info(
        &self,
        session_id: &str,
    ) -> Result<Option<HookSessionInfoResult>, DbError> {
        // Get event type counts
        let event_sql = r#"
            SELECT event_type, COUNT(*) as cnt
            FROM hook_events
            WHERE session_id = ?
            GROUP BY event_type
            ORDER BY cnt DESC
        "#;

        let mut stmt = self.conn.prepare(event_sql)?;
        let event_rows = stmt.query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
            ))
        })?;

        let mut event_counts = Vec::new();
        for row in event_rows {
            event_counts.push(row?);
        }

        if event_counts.is_empty() {
            return Ok(None);
        }

        // Get tool counts
        let tool_sql = r#"
            SELECT tool_name, COUNT(*) as cnt
            FROM hook_events
            WHERE session_id = ? AND tool_name IS NOT NULL
            GROUP BY tool_name
            ORDER BY cnt DESC
        "#;

        let mut stmt = self.conn.prepare(tool_sql)?;
        let tool_rows = stmt.query_map([session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
            ))
        })?;

        let mut tool_counts = Vec::new();
        for row in tool_rows {
            tool_counts.push(row?);
        }

        // Get time range and session info
        let meta_sql = r#"
            SELECT
                MIN(timestamp) as first_ts,
                MAX(timestamp) as last_ts,
                COUNT(*) as total,
                file_path
            FROM hook_events
            WHERE session_id = ?
        "#;

        let (first_timestamp, last_timestamp, total_events, file_path): (
            Option<String>,
            Option<String>,
            i64,
            String,
        ) = self.conn.query_row(meta_sql, [session_id], |row| {
            Ok((
                row.get(0).ok(),
                row.get(1).ok(),
                row.get(2)?,
                row.get(3)?,
            ))
        })?;

        // Get session name
        let session_name: Option<String> = self
            .conn
            .query_row(
                r#"
                SELECT session_name FROM hook_events
                WHERE session_id = ? AND session_name IS NOT NULL
                ORDER BY timestamp DESC LIMIT 1
                "#,
                [session_id],
                |row| row.get(0),
            )
            .ok();

        Ok(Some(HookSessionInfoResult {
            session_id: session_id.to_string(),
            file_path,
            total_events,
            first_timestamp,
            last_timestamp,
            session_name,
            event_counts,
            tool_counts,
        }))
    }

    /// Search hook events using FTS
    pub fn search_hook_events(
        &self,
        query: &str,
        limit: i64,
    ) -> Result<Vec<HookEvent>, DbError> {
        // Build FTS query
        let fts_query: String = query
            .split_whitespace()
            .filter(|w| !w.is_empty())
            .map(|w| format!("\"{}\"", w.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR ");

        let sql = r#"
            SELECT
                he.id, he.session_id, he.timestamp, he.event_type, he.tool_use_id,
                he.tool_name, he.decision, he.handler_results, he.input_json,
                he.context_json, he.file_path, he.line_number,
                he.turn_id, he.turn_sequence, he.session_name,
                he.git_hash, he.git_branch, he.git_dirty
            FROM hook_events_fts fts
            JOIN hook_events he ON fts.rowid = he.id
            WHERE hook_events_fts MATCH ?
            ORDER BY bm25(hook_events_fts)
            LIMIT ?
        "#;

        let mut stmt = self.conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params![fts_query, limit], |row| {
            Ok(row_to_hook_event(row))
        })?;

        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }

    /// Get hook events after a specific ID (for tail/live mode)
    pub fn get_hook_events_after_id(
        &self,
        after_id: i64,
        session_id: Option<&str>,
        event_types: Option<&[String]>,
        tool_names: Option<&[String]>,
    ) -> Result<Vec<HookEvent>, DbError> {
        let mut sql = String::from(
            r#"
            SELECT
                id, session_id, timestamp, event_type, tool_use_id, tool_name,
                decision, handler_results, input_json, context_json,
                file_path, line_number, turn_id, turn_sequence, session_name,
                git_hash, git_branch, git_dirty
            FROM hook_events
            WHERE id > ?
            "#,
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        params.push(Box::new(after_id));

        if let Some(sid) = session_id {
            sql.push_str(" AND session_id = ?");
            params.push(Box::new(sid.to_string()));
        }

        if let Some(types) = event_types {
            if !types.is_empty() {
                let placeholders: Vec<_> = types.iter().map(|_| "?").collect();
                sql.push_str(&format!(" AND event_type IN ({})", placeholders.join(",")));
                for t in types {
                    params.push(Box::new(t.clone()));
                }
            }
        }

        if let Some(names) = tool_names {
            if !names.is_empty() {
                let placeholders: Vec<_> = names.iter().map(|_| "?").collect();
                sql.push_str(&format!(" AND tool_name IN ({})", placeholders.join(",")));
                for n in names {
                    params.push(Box::new(n.clone()));
                }
            }
        }

        sql.push_str(" ORDER BY id ASC");

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| Ok(row_to_hook_event(row)))?;

        let mut events = Vec::new();
        for row in rows {
            events.push(row?);
        }
        Ok(events)
    }

    /// Get maximum hook event ID for a session
    pub fn get_max_hook_event_id(&self, session_id: Option<&str>) -> Result<i64, DbError> {
        let id: i64 = if let Some(sid) = session_id {
            self.conn.query_row(
                "SELECT COALESCE(MAX(id), 0) FROM hook_events WHERE session_id = ?",
                [sid],
                |row| row.get(0),
            )?
        } else {
            self.conn.query_row(
                "SELECT COALESCE(MAX(id), 0) FROM hook_events",
                [],
                |row| row.get(0),
            )?
        };
        Ok(id)
    }

    /// Get hook event count for a session
    pub fn get_hook_event_count(&self, session_id: Option<&str>) -> Result<i64, DbError> {
        let count: i64 = if let Some(sid) = session_id {
            self.conn.query_row(
                "SELECT COUNT(*) FROM hook_events WHERE session_id = ?",
                [sid],
                |row| row.get(0),
            )?
        } else {
            self.conn
                .query_row("SELECT COUNT(*) FROM hook_events", [], |row| row.get(0))?
        };
        Ok(count)
    }

    /// Get file edits for a session (parses PostToolUse events for Edit/Write/NotebookEdit)
    pub fn get_session_file_edits(
        &self,
        session_ids: &[String],
    ) -> Result<Vec<FileEditResult>, DbError> {
        use std::collections::HashMap;

        let mut file_map: HashMap<String, FileEditResult> = HashMap::new();

        for session_id in session_ids {
            let events = self.get_hook_events(&HookEventFilter {
                session_id: Some(session_id.clone()),
                event_types: Some(vec!["PostToolUse".to_string()]),
                tool_names: Some(vec![
                    "Edit".to_string(),
                    "Write".to_string(),
                    "NotebookEdit".to_string(),
                ]),
                limit: Some(10000),
                ..Default::default()
            })?;

            for event in &events {
                let file_path = extract_file_path(event);
                if let Some(path) = file_path {
                    let tool = event.tool_name.clone().unwrap_or_else(|| "unknown".to_string());
                    let entry = file_map.entry(path.clone()).or_insert_with(|| FileEditResult {
                        file_path: path,
                        edit_count: 0,
                        tools_used: Vec::new(),
                        first_timestamp: event.timestamp.clone(),
                        last_timestamp: event.timestamp.clone(),
                    });
                    entry.edit_count += 1;
                    if !entry.tools_used.contains(&tool) {
                        entry.tools_used.push(tool);
                    }
                    if event.timestamp < entry.first_timestamp {
                        entry.first_timestamp = event.timestamp.clone();
                    }
                    if event.timestamp > entry.last_timestamp {
                        entry.last_timestamp = event.timestamp.clone();
                    }
                }
            }
        }

        let mut files: Vec<FileEditResult> = file_map.into_values().collect();
        files.sort_by(|a, b| a.file_path.cmp(&b.file_path));
        Ok(files)
    }

    /// Resolve a session identifier to a session ID
    /// Supports "." (most recent hook session), session name, or raw session ID
    pub fn resolve_hook_session(&self, name_or_id: &str) -> Result<Option<String>, DbError> {
        if name_or_id == "." {
            // Get most recent session from hook_files
            let sid: Option<String> = self
                .conn
                .query_row(
                    "SELECT session_id FROM hook_files ORDER BY last_timestamp DESC LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .ok();
            return Ok(sid);
        }

        // Try direct match in hook_files
        let direct: Option<String> = self
            .conn
            .query_row(
                "SELECT session_id FROM hook_files WHERE session_id = ? LIMIT 1",
                [name_or_id],
                |row| row.get(0),
            )
            .ok();

        if direct.is_some() {
            return Ok(direct);
        }

        // Try session name lookup in hook_events
        let by_name: Option<String> = self
            .conn
            .query_row(
                "SELECT session_id FROM hook_events WHERE session_name = ? ORDER BY timestamp DESC LIMIT 1",
                [name_or_id],
                |row| row.get(0),
            )
            .ok();

        if by_name.is_some() {
            return Ok(by_name);
        }

        // Try via transcript session resolution (falls back to sessions table)
        if let Some(session) = self.resolve_session(name_or_id)? {
            // Verify this session has hook events
            let has_events: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM hook_events WHERE session_id = ?)",
                    [&session.session_id],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if has_events {
                return Ok(Some(session.session_id));
            }
        }

        // Use as-is (raw session ID that might exist in hook_events)
        let exists: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM hook_events WHERE session_id = ?)",
                [name_or_id],
                |row| row.get(0),
            )
            .unwrap_or(false);

        if exists {
            Ok(Some(name_or_id.to_string()))
        } else {
            Ok(None)
        }
    }
}

/// Detailed session info with event/tool counts
#[derive(Debug, Clone)]
pub struct HookSessionInfoResult {
    pub session_id: String,
    pub file_path: String,
    pub total_events: i64,
    pub first_timestamp: Option<String>,
    pub last_timestamp: Option<String>,
    pub session_name: Option<String>,
    pub event_counts: Vec<(String, i64)>,
    pub tool_counts: Vec<(String, i64)>,
}

/// File edit result from aggregating hook events
#[derive(Debug, Clone)]
pub struct FileEditResult {
    pub file_path: String,
    pub edit_count: i64,
    pub tools_used: Vec<String>,
    pub first_timestamp: String,
    pub last_timestamp: String,
}

/// Extract file path from a hook event's input_json
fn extract_file_path(event: &HookEvent) -> Option<String> {
    let input_json = event.input_json.as_deref()?;
    let input: serde_json::Value = serde_json::from_str(input_json).ok()?;

    // Try tool_input.file_path
    if let Some(path) = input
        .get("tool_input")
        .and_then(|ti| ti.get("file_path"))
        .and_then(|v| v.as_str())
    {
        return Some(path.to_string());
    }

    // Try file_path directly
    if let Some(path) = input.get("file_path").and_then(|v| v.as_str()) {
        return Some(path.to_string());
    }

    // Try tool_input.notebook_path
    if let Some(path) = input
        .get("tool_input")
        .and_then(|ti| ti.get("notebook_path"))
        .and_then(|v| v.as_str())
    {
        return Some(path.to_string());
    }

    // Try notebook_path directly
    if let Some(path) = input.get("notebook_path").and_then(|v| v.as_str()) {
        return Some(path.to_string());
    }

    None
}

/// Convert a database row to a HookEvent
fn row_to_hook_event(row: &rusqlite::Row) -> HookEvent {
    let git_dirty_raw: Option<i64> = row.get(17).ok();
    HookEvent {
        id: row.get(0).unwrap_or(0),
        session_id: row.get(1).unwrap_or_default(),
        timestamp: row.get(2).unwrap_or_default(),
        event_type: row.get(3).unwrap_or_default(),
        tool_use_id: row.get(4).ok(),
        tool_name: row.get(5).ok(),
        decision: row.get(6).ok(),
        handler_results_json: row.get(7).ok(),
        input_json: row.get(8).ok(),
        context_json: row.get(9).ok(),
        file_path: row.get(10).unwrap_or_default(),
        line_number: row.get(11).unwrap_or(0),
        turn_id: row.get(12).ok(),
        turn_sequence: row.get(13).ok(),
        session_name: row.get(14).ok(),
        git_hash: row.get(15).ok(),
        git_branch: row.get(16).ok(),
        git_dirty: git_dirty_raw.map(|v| v == 1),
    }
}
