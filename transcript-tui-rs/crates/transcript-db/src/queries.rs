//! Database query functions

use crate::connection::{DbError, TranscriptDb};
use transcript_core::{LineType, TranscriptLine};

/// Options for querying lines
#[derive(Debug, Clone, Default)]
pub struct GetLinesOptions {
    pub session_id: Option<String>,
    pub types: Option<Vec<String>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub from_line: Option<i64>,
    pub to_line: Option<i64>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub search: Option<String>,
    pub order: LineOrder,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum LineOrder {
    #[default]
    Asc,
    Desc,
}

impl GetLinesOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn for_session(session_id: impl Into<String>) -> Self {
        Self {
            session_id: Some(session_id.into()),
            ..Default::default()
        }
    }

    pub fn with_limit(mut self, limit: i64) -> Self {
        self.limit = Some(limit);
        self
    }

    pub fn with_order(mut self, order: LineOrder) -> Self {
        self.order = order;
        self
    }
}

impl TranscriptDb {
    /// Get all lines matching the options
    pub fn get_lines(&self, options: &GetLinesOptions) -> Result<Vec<TranscriptLine>, DbError> {
        let mut sql = String::from(
            r#"
            SELECT
                id,
                session_id,
                uuid,
                parent_uuid,
                line_number,
                type,
                subtype,
                timestamp,
                slug,
                role,
                model,
                cwd,
                content,
                raw,
                file_path,
                turn_id,
                turn_sequence,
                session_name
            FROM lines
            WHERE 1=1
            "#,
        );

        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(session_id) = &options.session_id {
            sql.push_str(" AND session_id = ?");
            params.push(Box::new(session_id.clone()));
        }

        if let Some(types) = &options.types {
            if !types.is_empty() {
                let placeholders: Vec<_> = types.iter().map(|_| "?").collect();
                sql.push_str(&format!(" AND type IN ({})", placeholders.join(",")));
                for t in types {
                    params.push(Box::new(t.clone()));
                }
            }
        }

        if let Some(from_line) = options.from_line {
            sql.push_str(" AND line_number >= ?");
            params.push(Box::new(from_line));
        }

        if let Some(to_line) = options.to_line {
            sql.push_str(" AND line_number <= ?");
            params.push(Box::new(to_line));
        }

        if let Some(from_time) = &options.from_time {
            sql.push_str(" AND timestamp >= ?");
            params.push(Box::new(from_time.clone()));
        }

        if let Some(to_time) = &options.to_time {
            sql.push_str(" AND timestamp <= ?");
            params.push(Box::new(to_time.clone()));
        }

        if let Some(search) = &options.search {
            sql.push_str(" AND content LIKE ?");
            params.push(Box::new(format!("%{}%", search)));
        }

        sql.push_str(match options.order {
            LineOrder::Asc => " ORDER BY line_number ASC",
            LineOrder::Desc => " ORDER BY line_number DESC",
        });

        if let Some(limit) = options.limit {
            sql.push_str(" LIMIT ?");
            params.push(Box::new(limit));
        }

        if let Some(offset) = options.offset {
            sql.push_str(" OFFSET ?");
            params.push(Box::new(offset));
        }

        let mut stmt = self.conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(row_to_transcript_line(row))
        })?;

        let mut lines = Vec::new();
        for row in rows {
            lines.push(row?);
        }

        Ok(lines)
    }

    /// Get lines after a specific ID (for live updates)
    pub fn get_lines_after_id(
        &self,
        after_id: i64,
        session_id: Option<&str>,
    ) -> Result<Vec<TranscriptLine>, DbError> {
        let mut lines = Vec::new();

        if let Some(sid) = session_id {
            let sql = r#"
                SELECT
                    id, session_id, uuid, parent_uuid, line_number, type, subtype,
                    timestamp, slug, role, model, cwd, content, raw, file_path,
                    turn_id, turn_sequence, session_name
                FROM lines
                WHERE id > ? AND session_id = ?
                ORDER BY id ASC
            "#;
            let mut stmt = self.conn.prepare(sql)?;
            let rows = stmt.query_map(rusqlite::params![after_id, sid], |row| {
                Ok(row_to_transcript_line(row))
            })?;
            for row in rows {
                lines.push(row?);
            }
        } else {
            let sql = r#"
                SELECT
                    id, session_id, uuid, parent_uuid, line_number, type, subtype,
                    timestamp, slug, role, model, cwd, content, raw, file_path,
                    turn_id, turn_sequence, session_name
                FROM lines
                WHERE id > ?
                ORDER BY id ASC
            "#;
            let mut stmt = self.conn.prepare(sql)?;
            let rows = stmt.query_map(rusqlite::params![after_id], |row| {
                Ok(row_to_transcript_line(row))
            })?;
            for row in rows {
                lines.push(row?);
            }
        }

        Ok(lines)
    }

    /// Get the maximum line ID
    pub fn get_max_line_id(&self, session_id: Option<&str>) -> Result<i64, DbError> {
        let id: i64 = if let Some(sid) = session_id {
            self.conn.query_row(
                "SELECT COALESCE(MAX(id), 0) FROM lines WHERE session_id = ?",
                [sid],
                |row| row.get(0),
            )?
        } else {
            self.conn.query_row(
                "SELECT COALESCE(MAX(id), 0) FROM lines",
                [],
                |row| row.get(0),
            )?
        };
        Ok(id)
    }

    /// Get line count for a session
    pub fn get_line_count(&self, session_id: &str) -> Result<i64, DbError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM lines WHERE session_id = ?",
            [session_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// Search lines using FTS
    pub fn search_lines(
        &self,
        query: &str,
        limit: i64,
        session_id: Option<&str>,
    ) -> Result<Vec<TranscriptLine>, DbError> {
        // Escape FTS special characters and build query
        let fts_query: String = query
            .split_whitespace()
            .filter(|w| !w.is_empty())
            .map(|w| format!("\"{}\"", w.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" OR ");

        let mut lines = Vec::new();

        if let Some(sid) = session_id {
            let sql = r#"
                SELECT
                    l.id, l.session_id, l.uuid, l.parent_uuid, l.line_number,
                    l.type, l.subtype, l.timestamp, l.slug, l.role, l.model,
                    l.cwd, l.content, l.raw, l.file_path,
                    l.turn_id, l.turn_sequence, l.session_name
                FROM lines_fts fts
                JOIN lines l ON fts.rowid = l.id
                WHERE lines_fts MATCH ? AND l.session_id = ?
                ORDER BY bm25(lines_fts)
                LIMIT ?
            "#;
            let mut stmt = self.conn.prepare(sql)?;
            let rows = stmt.query_map(rusqlite::params![fts_query, sid, limit], |row| {
                Ok(row_to_transcript_line(row))
            })?;
            for row in rows {
                lines.push(row?);
            }
        } else {
            let sql = r#"
                SELECT
                    l.id, l.session_id, l.uuid, l.parent_uuid, l.line_number,
                    l.type, l.subtype, l.timestamp, l.slug, l.role, l.model,
                    l.cwd, l.content, l.raw, l.file_path,
                    l.turn_id, l.turn_sequence, l.session_name
                FROM lines_fts fts
                JOIN lines l ON fts.rowid = l.id
                WHERE lines_fts MATCH ?
                ORDER BY bm25(lines_fts)
                LIMIT ?
            "#;
            let mut stmt = self.conn.prepare(sql)?;
            let rows = stmt.query_map(rusqlite::params![fts_query, limit], |row| {
                Ok(row_to_transcript_line(row))
            })?;
            for row in rows {
                lines.push(row?);
            }
        }

        Ok(lines)
    }

    /// Get turn data for lines by their IDs (for refreshing turn info)
    pub fn get_turn_data_for_ids(
        &self,
        ids: &[i64],
    ) -> Result<Vec<(i64, Option<String>, Option<i64>, Option<String>)>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders: Vec<_> = ids.iter().map(|_| "?").collect();
        let sql = format!(
            "SELECT id, turn_id, turn_sequence, session_name FROM lines WHERE id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = self.conn.prepare(&sql)?;
        let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();

        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row?);
        }
        Ok(results)
    }
}

/// Convert a database row to a TranscriptLine
fn row_to_transcript_line(row: &rusqlite::Row) -> TranscriptLine {
    let type_str: String = row.get(5).unwrap_or_default();
    let line_type = match type_str.as_str() {
        "user" => LineType::User,
        "assistant" => LineType::Assistant,
        "system" => LineType::System,
        "summary" => LineType::Summary,
        "progress" => LineType::Progress,
        "file-history-snapshot" => LineType::FileHistorySnapshot,
        _ => LineType::Unknown,
    };

    TranscriptLine {
        id: row.get(0).unwrap_or(0),
        session_id: row.get(1).unwrap_or_default(),
        uuid: row.get(2).unwrap_or_default(),
        parent_uuid: row.get(3).ok(),
        line_number: row.get(4).unwrap_or(0),
        line_type,
        timestamp: row.get(7).unwrap_or_default(),
        slug: row.get(8).ok(),
        role: row.get(9).ok(),
        model: row.get(10).ok(),
        cwd: row.get(11).ok(),
        content: row.get(12).ok(),
        raw: row.get(13).unwrap_or_default(),
        turn_id: row.get(15).ok(),
        turn_sequence: row.get(16).ok(),
        session_name: row.get(17).ok(),
    }
}
