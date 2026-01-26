//! Turn correlation - links transcript lines to turn information from hook events
//!
//! Ported from TypeScript `correlateLinesToTurns` in db.ts

use rusqlite::Connection;

use crate::connection::IndexerError;

/// Result of turn correlation
#[derive(Debug, Default)]
pub struct CorrelationResult {
    pub updated: usize,
    pub sessions: usize,
}

/// Correlate transcript lines with turn information from hook events.
///
/// Updates transcript lines with turn_id, turn_sequence, and session_name
/// by looking up corresponding hook events (Stop events mark turn boundaries).
///
/// Should be called after both transcripts and hook events have been indexed.
pub fn correlate_lines_to_turns(conn: &Connection) -> Result<CorrelationResult, IndexerError> {
    // Get all unique session IDs that have lines without turn info
    let mut stmt = conn.prepare(
        "SELECT DISTINCT session_id FROM lines
         WHERE turn_id IS NULL AND session_id != ''",
    )?;

    let sessions: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut total_updated: usize = 0;
    let session_count = sessions.len();

    for session_id in &sessions {
        // Get session_name from the most recent SessionStart event
        let session_name: Option<String> = conn
            .query_row(
                "SELECT session_name FROM hook_events
                 WHERE session_id = ?1 AND event_type = 'SessionStart' AND session_name IS NOT NULL
                 ORDER BY timestamp DESC LIMIT 1",
                [session_id],
                |row| row.get(0),
            )
            .ok();

        // Get all Stop events for this session (turn boundaries) ordered by timestamp
        let mut stop_stmt = conn.prepare(
            "SELECT timestamp, turn_id, turn_sequence FROM hook_events
             WHERE session_id = ?1 AND event_type = 'Stop' AND turn_id IS NOT NULL
             ORDER BY timestamp ASC",
        )?;

        let stop_events: Vec<(String, String, i64)> = stop_stmt
            .query_map([session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        if stop_events.is_empty() {
            // No Stop events - try using tool events instead
            let mut tool_stmt = conn.prepare(
                "SELECT DISTINCT turn_id, turn_sequence,
                        MIN(timestamp) as start_time, MAX(timestamp) as end_time
                 FROM hook_events
                 WHERE session_id = ?1 AND turn_id IS NOT NULL
                   AND event_type IN ('PreToolUse', 'PostToolUse')
                 GROUP BY turn_id, turn_sequence
                 ORDER BY turn_sequence ASC",
            )?;

            let tool_turns: Vec<(String, i64, String, String)> = tool_stmt
                .query_map([session_id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                })?
                .filter_map(|r| r.ok())
                .collect();

            if !tool_turns.is_empty() {
                // Use tool event timestamps to correlate lines
                for i in 0..tool_turns.len() {
                    let (ref turn_id, turn_seq, ref start_time, _) = tool_turns[i];

                    if i + 1 < tool_turns.len() {
                        let (_, _, ref next_start, _) = tool_turns[i + 1];
                        let changes = conn.execute(
                            "UPDATE lines SET turn_id = ?1, turn_sequence = ?2, session_name = ?3
                             WHERE session_id = ?4 AND timestamp >= ?5 AND timestamp < ?6
                             AND turn_id IS NULL",
                            rusqlite::params![
                                turn_id,
                                turn_seq,
                                session_name,
                                session_id,
                                start_time,
                                next_start,
                            ],
                        )?;
                        total_updated += changes;
                    } else {
                        // Last turn - update all remaining
                        let changes = conn.execute(
                            "UPDATE lines SET turn_id = ?1, turn_sequence = ?2, session_name = ?3
                             WHERE session_id = ?4 AND timestamp >= ?5
                             AND turn_id IS NULL",
                            rusqlite::params![
                                turn_id,
                                turn_seq,
                                session_name,
                                session_id,
                                start_time,
                            ],
                        )?;
                        total_updated += changes;
                    }
                }
                continue;
            }

            // No turn info at all - just update session_name if we have it
            if let Some(ref name) = session_name {
                conn.execute(
                    "UPDATE lines SET session_name = ?1
                     WHERE session_id = ?2 AND session_name IS NULL",
                    rusqlite::params![name, session_id],
                )?;
            }
            continue;
        }

        // Process Stop events as turn boundaries
        for i in 0..stop_events.len() {
            let (ref current_ts, ref current_turn_id, current_seq) = stop_events[i];

            if i > 0 {
                let (ref prev_ts, _, _) = stop_events[i - 1];
                let changes = conn.execute(
                    "UPDATE lines SET turn_id = ?1, turn_sequence = ?2, session_name = ?3
                     WHERE session_id = ?4 AND timestamp > ?5 AND timestamp <= ?6
                     AND turn_id IS NULL",
                    rusqlite::params![
                        current_turn_id,
                        current_seq,
                        session_name,
                        session_id,
                        prev_ts,
                        current_ts,
                    ],
                )?;
                total_updated += changes;
            } else {
                // First turn - from beginning up to first Stop
                let changes = conn.execute(
                    "UPDATE lines SET turn_id = ?1, turn_sequence = ?2, session_name = ?3
                     WHERE session_id = ?4 AND timestamp <= ?5
                     AND turn_id IS NULL",
                    rusqlite::params![
                        current_turn_id,
                        current_seq,
                        session_name,
                        session_id,
                        current_ts,
                    ],
                )?;
                total_updated += changes;
            }
        }

        // Update remaining lines after the last Stop (current in-progress turn)
        if let Some(ref name) = session_name {
            let (ref last_ts, _, _) = stop_events[stop_events.len() - 1];
            conn.execute(
                "UPDATE lines SET session_name = ?1
                 WHERE session_id = ?2 AND timestamp > ?3 AND session_name IS NULL",
                rusqlite::params![name, session_id, last_ts],
            )?;
        }
    }

    Ok(CorrelationResult {
        updated: total_updated,
        sessions: session_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        schema::init_schema(&mut conn).unwrap();
        conn
    }

    #[test]
    fn test_correlation_with_stop_events() {
        let conn = setup_db();

        // Insert transcript lines
        conn.execute_batch(
            "INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content)
             VALUES ('s1', 'u1', 1, 'user', '2024-01-01T00:00:00Z', '{}', '/test', 'hello');
             INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content)
             VALUES ('s1', 'u2', 2, 'assistant', '2024-01-01T00:00:01Z', '{}', '/test', 'hi');
             INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content)
             VALUES ('s1', 'u3', 3, 'user', '2024-01-01T00:00:05Z', '{}', '/test', 'next');",
        )
        .unwrap();

        // Insert Stop hook events (turn boundaries)
        conn.execute_batch(
            "INSERT INTO hook_events (session_id, timestamp, event_type, file_path, line_number, turn_id, turn_sequence, session_name)
             VALUES ('s1', '2024-01-01T00:00:02Z', 'Stop', '/hooks', 1, 's1:1', 1, 'test-session');
             INSERT INTO hook_events (session_id, timestamp, event_type, file_path, line_number, turn_id, turn_sequence, session_name)
             VALUES ('s1', '2024-01-01T00:00:06Z', 'Stop', '/hooks', 2, 's1:2', 2, 'test-session');",
        )
        .unwrap();

        // Insert SessionStart event
        conn.execute_batch(
            "INSERT INTO hook_events (session_id, timestamp, event_type, file_path, line_number, session_name)
             VALUES ('s1', '2024-01-01T00:00:00Z', 'SessionStart', '/hooks', 0, 'test-session');",
        )
        .unwrap();

        let result = correlate_lines_to_turns(&conn).unwrap();
        assert_eq!(result.sessions, 1);
        assert!(result.updated > 0);

        // Verify turn assignments
        let turn1: (String, i64) = conn
            .query_row(
                "SELECT turn_id, turn_sequence FROM lines WHERE uuid = 'u1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(turn1.0, "s1:1");
        assert_eq!(turn1.1, 1);

        let turn3: (String, i64) = conn
            .query_row(
                "SELECT turn_id, turn_sequence FROM lines WHERE uuid = 'u3'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(turn3.0, "s1:2");
        assert_eq!(turn3.1, 2);
    }

    #[test]
    fn test_correlation_session_name_only() {
        let conn = setup_db();

        // Lines without any turn info available
        conn.execute_batch(
            "INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content)
             VALUES ('s2', 'u1', 1, 'user', '2024-01-01T00:00:00Z', '{}', '/test', 'hello');",
        )
        .unwrap();

        // Only a SessionStart event, no Stop events
        conn.execute_batch(
            "INSERT INTO hook_events (session_id, timestamp, event_type, file_path, line_number, session_name)
             VALUES ('s2', '2024-01-01T00:00:00Z', 'SessionStart', '/hooks', 0, 'lonely-cat');",
        )
        .unwrap();

        correlate_lines_to_turns(&conn).unwrap();

        let name: Option<String> = conn
            .query_row(
                "SELECT session_name FROM lines WHERE uuid = 'u1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(name.unwrap(), "lonely-cat");
    }

    #[test]
    fn test_correlation_idempotent() {
        let conn = setup_db();

        conn.execute_batch(
            "INSERT INTO lines (session_id, uuid, line_number, type, timestamp, raw, file_path, content, turn_id, turn_sequence, session_name)
             VALUES ('s3', 'u1', 1, 'user', '2024-01-01T00:00:00Z', '{}', '/test', 'hello', 's3:1', 1, 'done');",
        )
        .unwrap();

        // Should find nothing to correlate
        let result = correlate_lines_to_turns(&conn).unwrap();
        assert_eq!(result.sessions, 0);
        assert_eq!(result.updated, 0);
    }
}
