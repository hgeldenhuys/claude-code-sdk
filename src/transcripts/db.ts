/**
 * Transcript SQLite Database
 * Fast indexed storage for transcript search
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { findTranscriptFiles } from './indexer';
import type { TranscriptLine, SearchResult } from './types';

const DB_VERSION = 1;
const DEFAULT_DB_PATH = join(process.env.HOME || '~', '.claude-code-sdk', 'transcripts.db');

export interface DbStats {
  version: number;
  lineCount: number;
  sessionCount: number;
  lastIndexed: string | null;
  dbPath: string;
  dbSizeBytes: number;
}

export interface DbSearchOptions {
  query: string;
  limit?: number;
  types?: string[];
  sessionIds?: string[];
  sessionName?: string;
}

export interface DbSearchResult {
  sessionId: string;
  slug: string | null;
  lineNumber: number;
  type: string;
  timestamp: string;
  content: string;
  matchedText: string;
  raw: string;
}

/**
 * Get or create the transcript database
 */
export function getDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  // Ensure directory exists
  const dir = join(dbPath, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent performance
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');

  return db;
}

/**
 * Initialize the database schema
 */
export function initSchema(db: Database): void {
  // Metadata table
  db.run(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Main lines table
  db.run(`
    CREATE TABLE IF NOT EXISTS lines (
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
      UNIQUE(session_id, uuid)
    )
  `);

  // Indexes for common queries
  db.run('CREATE INDEX IF NOT EXISTS idx_session_id ON lines(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_type ON lines(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON lines(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_slug ON lines(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_line_number ON lines(line_number)');

  // Full-text search virtual table
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS lines_fts USING fts5(
      content,
      session_id UNINDEXED,
      slug UNINDEXED,
      type UNINDEXED,
      content='lines',
      content_rowid='id'
    )
  `);

  // Triggers to keep FTS in sync
  db.run(`
    CREATE TRIGGER IF NOT EXISTS lines_ai AFTER INSERT ON lines BEGIN
      INSERT INTO lines_fts(rowid, content, session_id, slug, type)
      VALUES (new.id, new.content, new.session_id, new.slug, new.type);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS lines_ad AFTER DELETE ON lines BEGIN
      INSERT INTO lines_fts(lines_fts, rowid, content, session_id, slug, type)
      VALUES ('delete', old.id, old.content, old.session_id, old.slug, old.type);
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS lines_au AFTER UPDATE ON lines BEGIN
      INSERT INTO lines_fts(lines_fts, rowid, content, session_id, slug, type)
      VALUES ('delete', old.id, old.content, old.session_id, old.slug, old.type);
      INSERT INTO lines_fts(rowid, content, session_id, slug, type)
      VALUES (new.id, new.content, new.session_id, new.slug, new.type);
    END
  `);

  // Sessions table for quick lookups
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      slug TEXT,
      file_path TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT NOT NULL
    )
  `);

  // Set version
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', ['version', String(DB_VERSION)]);
}

/**
 * Extract searchable text from a parsed transcript entry
 */
function extractTextFromParsed(parsed: Record<string, unknown>): string {
  const parts: string[] = [];

  // Extract from message content
  const message = parsed.message as { content?: unknown; role?: string } | undefined;
  if (message?.content) {
    if (typeof message.content === 'string') {
      parts.push(message.content);
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block === 'object') {
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            parts.push(b.text);
          } else if (b.type === 'tool_use' && typeof b.name === 'string') {
            parts.push(`[Tool: ${b.name}]`);
            if (b.input && typeof b.input === 'object') {
              const input = b.input as Record<string, unknown>;
              // Include key input fields for searchability
              for (const [key, value] of Object.entries(input)) {
                if (typeof value === 'string' && value.length < 500) {
                  parts.push(`${key}: ${value}`);
                }
              }
            }
          } else if (b.type === 'tool_result' && typeof b.content === 'string') {
            parts.push(b.content.slice(0, 1000)); // Limit tool results
          }
        }
      }
    }
  }

  // Extract from summary
  if (typeof parsed.summary === 'string') {
    parts.push(parsed.summary);
  }

  // Extract from data
  if (parsed.data && typeof parsed.data === 'object') {
    const data = parsed.data as Record<string, unknown>;
    if (typeof data.text === 'string') {
      parts.push(data.text);
    }
  }

  return parts.join('\n');
}

/**
 * Index a single transcript file
 */
export function indexTranscriptFile(
  db: Database,
  filePath: string,
  onProgress?: (current: number, total: number) => void
): number {
  // Read file synchronously
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return 0;
  }

  if (!text.trim()) {
    return 0;
  }

  const rawLines = text.trim().split('\n');
  let indexedCount = 0;
  let sessionId = '';
  let slug: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;

  const insertLine = db.prepare(`
    INSERT OR REPLACE INTO lines
    (session_id, uuid, parent_uuid, line_number, type, subtype, timestamp, slug, role, model, cwd, content, raw, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      if (!rawLine?.trim()) continue;

      try {
        const parsed = JSON.parse(rawLine);

        sessionId = parsed.sessionId || sessionId;
        slug = parsed.slug || slug;

        const timestamp = parsed.timestamp || '';
        if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
        if (timestamp) lastTimestamp = timestamp;

        const type = parsed.type || 'unknown';
        const content = extractTextFromParsed(parsed);

        insertLine.run(
          sessionId,
          parsed.uuid || `line-${i}`,
          parsed.parentUuid || null,
          i + 1,
          type,
          parsed.subtype || null,
          timestamp,
          slug,
          parsed.message?.role || null,
          parsed.message?.model || null,
          parsed.cwd || null,
          content,
          rawLine,
          filePath
        );

        indexedCount++;

        if (onProgress && i % 1000 === 0) {
          onProgress(i, rawLines.length);
        }
      } catch {
        // Skip malformed lines
        continue;
      }
    }
  });

  transaction();

  // Update sessions table
  if (sessionId) {
    db.run(`
      INSERT OR REPLACE INTO sessions (session_id, slug, file_path, line_count, first_timestamp, last_timestamp, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [sessionId, slug, filePath, indexedCount, firstTimestamp, lastTimestamp, new Date().toISOString()]);
  }

  return indexedCount;
}

/**
 * Index all transcript files
 */
export async function indexAllTranscripts(
  db: Database,
  projectsDir?: string,
  onProgress?: (file: string, current: number, total: number, linesIndexed: number) => void
): Promise<{ filesIndexed: number; linesIndexed: number }> {
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');
  const files = await findTranscriptFiles(dir);

  let totalFiles = 0;
  let totalLines = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const linesIndexed = indexTranscriptFile(db, file);
      totalFiles++;
      totalLines += linesIndexed;

      if (onProgress) {
        onProgress(file, i + 1, files.length, linesIndexed);
      }
    } catch (err) {
      // Log and continue
      console.error(`Error indexing ${file}:`, err);
    }
  }

  // Update last indexed timestamp
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
    ['last_indexed', new Date().toISOString()]);

  return { filesIndexed: totalFiles, linesIndexed: totalLines };
}

/**
 * Search transcripts using FTS
 */
export function searchDb(db: Database, options: DbSearchOptions): DbSearchResult[] {
  const { query, limit = 50, types, sessionIds } = options;

  if (!query.trim()) {
    return [];
  }

  // Build the FTS query - escape special FTS characters
  const ftsQuery = query
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .map(w => `"${w}"`)
    .join(' OR ');

  let sql = `
    SELECT
      l.session_id,
      l.slug,
      l.line_number,
      l.type,
      l.timestamp,
      l.content,
      snippet(lines_fts, 0, '>>>>', '<<<<', '...', 64) as matched_text,
      l.raw
    FROM lines_fts fts
    JOIN lines l ON fts.rowid = l.id
    WHERE lines_fts MATCH ?
  `;

  const params: (string | number)[] = [ftsQuery];

  // Add type filter
  if (types && types.length > 0) {
    sql += ` AND l.type IN (${types.map(() => '?').join(', ')})`;
    params.push(...types);
  }

  // Add session filter
  if (sessionIds && sessionIds.length > 0) {
    sql += ` AND l.session_id IN (${sessionIds.map(() => '?').join(', ')})`;
    params.push(...sessionIds);
  }

  sql += ` ORDER BY bm25(lines_fts) LIMIT ?`;
  params.push(limit);

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    session_id: string;
    slug: string | null;
    line_number: number;
    type: string;
    timestamp: string;
    content: string;
    matched_text: string;
    raw: string;
  }>;

  return rows.map(row => ({
    sessionId: row.session_id,
    slug: row.slug,
    lineNumber: row.line_number,
    type: row.type,
    timestamp: row.timestamp,
    content: row.content,
    matchedText: row.matched_text,
    raw: row.raw,
  }));
}

/**
 * Get database statistics
 */
export function getDbStats(db: Database, dbPath: string = DEFAULT_DB_PATH): DbStats {
  const versionRow = db.query('SELECT value FROM metadata WHERE key = ?').get('version') as { value: string } | null;
  const lastIndexedRow = db.query('SELECT value FROM metadata WHERE key = ?').get('last_indexed') as { value: string } | null;
  const lineCountRow = db.query('SELECT COUNT(*) as count FROM lines').get() as { count: number };
  const sessionCountRow = db.query('SELECT COUNT(*) as count FROM sessions').get() as { count: number };

  let dbSizeBytes = 0;
  try {
    const file = Bun.file(dbPath);
    dbSizeBytes = file.size;
  } catch {
    // Ignore
  }

  return {
    version: versionRow ? parseInt(versionRow.value, 10) : 0,
    lineCount: lineCountRow?.count || 0,
    sessionCount: sessionCountRow?.count || 0,
    lastIndexed: lastIndexedRow?.value || null,
    dbPath,
    dbSizeBytes,
  };
}

/**
 * Check if database exists and is initialized
 */
export function isDatabaseReady(dbPath: string = DEFAULT_DB_PATH): boolean {
  if (!existsSync(dbPath)) {
    return false;
  }

  try {
    const db = getDatabase(dbPath);
    const stats = getDbStats(db, dbPath);
    db.close();
    return stats.version === DB_VERSION && stats.lineCount > 0;
  } catch {
    return false;
  }
}

/**
 * Clear and rebuild the entire index
 */
export function rebuildIndex(db: Database): void {
  db.run('DELETE FROM lines');
  db.run('DELETE FROM lines_fts');
  db.run('DELETE FROM sessions');
  db.run("DELETE FROM metadata WHERE key = 'last_indexed'");
}

export { DEFAULT_DB_PATH };
