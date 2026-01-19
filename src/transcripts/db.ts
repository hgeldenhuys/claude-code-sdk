/**
 * Transcript SQLite Database
 * Fast indexed storage for transcript search
 */

import { Database } from 'bun:sqlite';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { findTranscriptFiles } from './indexer';
import type { SearchResult, TranscriptLine } from './types';
import type { SearchableTable, UnifiedSearchResult } from './adapters/types';

const DB_VERSION = 7;
const DEFAULT_DB_PATH = join(process.env.HOME || '~', '.claude-code-sdk', 'transcripts.db');

export interface DbStats {
  version: number;
  lineCount: number;
  sessionCount: number;
  hookEventCount: number;
  hookFileCount: number;
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
      turn_id TEXT,
      turn_sequence INTEGER,
      session_name TEXT,
      UNIQUE(session_id, uuid)
    )
  `);

  // Indexes for common queries
  db.run('CREATE INDEX IF NOT EXISTS idx_session_id ON lines(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_type ON lines(type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_timestamp ON lines(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_slug ON lines(slug)');
  db.run('CREATE INDEX IF NOT EXISTS idx_line_number ON lines(line_number)');
  db.run('CREATE INDEX IF NOT EXISTS idx_lines_turn_id ON lines(turn_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_lines_session_name ON lines(session_name)');

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

  // Sessions table for quick lookups and delta tracking
  // Uses file_path as primary key since we track byte offsets per file
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      slug TEXT,
      line_count INTEGER NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT NOT NULL
    )
  `);

  // Index on session_id for session-based queries
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)');

  // Hook events table for storing hook event logs
  db.run(`
    CREATE TABLE IF NOT EXISTS hook_events (
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
      session_name TEXT
    )
  `);

  // Indexes for hook events
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_session ON hook_events(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_tool_use ON hook_events(tool_use_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_event_type ON hook_events(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_timestamp ON hook_events(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_turn_id ON hook_events(turn_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_session_name ON hook_events(session_name)');

  // FTS table for hook events (standalone - stores content directly)
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS hook_events_fts USING fts5(
      content
    )
  `);

  // Triggers to keep hook_events_fts in sync
  db.run(`
    CREATE TRIGGER IF NOT EXISTS hook_events_ai AFTER INSERT ON hook_events BEGIN
      INSERT INTO hook_events_fts(rowid, content)
      VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS hook_events_ad AFTER DELETE ON hook_events BEGIN
      INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
      VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
    END
  `);

  db.run(`
    CREATE TRIGGER IF NOT EXISTS hook_events_au AFTER UPDATE ON hook_events BEGIN
      INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
      VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
      INSERT INTO hook_events_fts(rowid, content)
      VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
    END
  `);

  // Hook files tracking table (for delta updates)
  db.run(`
    CREATE TABLE IF NOT EXISTS hook_files (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT NOT NULL
    )
  `);

  // Run migrations if needed
  migrateSchema(db);

  // Set version
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [
    'version',
    String(DB_VERSION),
  ]);
}

/**
 * Migrate schema from older versions
 */
function migrateSchema(db: Database): void {
  // Check current version
  let currentVersion = 0;
  try {
    const row = db.query('SELECT value FROM metadata WHERE key = ?').get('version') as {
      value: string;
    } | null;
    currentVersion = row ? Number.parseInt(row.value, 10) : 0;
  } catch {
    // metadata table might not exist yet - that's fine, schema will be created fresh
    return;
  }

  // Migration from v4 to v5: Add turn_id, turn_sequence, session_name columns
  if (currentVersion === 4) {
    console.error('[db] Migrating schema from v4 to v5...');

    // Add columns to lines table (if not exists - use try/catch for idempotency)
    const lineColumns = ['turn_id TEXT', 'turn_sequence INTEGER', 'session_name TEXT'];
    for (const col of lineColumns) {
      try {
        db.run(`ALTER TABLE lines ADD COLUMN ${col}`);
      } catch {
        // Column might already exist
      }
    }

    // Add columns to hook_events table
    const hookColumns = ['turn_id TEXT', 'turn_sequence INTEGER', 'session_name TEXT'];
    for (const col of hookColumns) {
      try {
        db.run(`ALTER TABLE hook_events ADD COLUMN ${col}`);
      } catch {
        // Column might already exist
      }
    }

    // Add new indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_lines_turn_id ON lines(turn_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_lines_session_name ON lines(session_name)');
    db.run('CREATE INDEX IF NOT EXISTS idx_hook_turn_id ON hook_events(turn_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_hook_session_name ON hook_events(session_name)');

    console.error('[db] Migration v4→v5 complete');
    currentVersion = 5;
  }

  // Migration from v5 to v6: Add hook_events_fts table (broken content table)
  if (currentVersion === 5) {
    console.error('[db] Migrating schema from v5 to v6...');
    // This migration created a broken FTS table with content= mode
    // The fix is in v6→v7 migration
    console.error('[db] Migration v5→v6 complete (will be fixed in v7)');
    currentVersion = 6;
  }

  // Migration from v6 to v7: Fix hook_events_fts table (standalone instead of content table)
  if (currentVersion === 6) {
    console.error('[db] Migrating schema from v6 to v7...');

    // Drop the broken FTS table and triggers from v6
    db.run('DROP TRIGGER IF EXISTS hook_events_ai');
    db.run('DROP TRIGGER IF EXISTS hook_events_ad');
    db.run('DROP TRIGGER IF EXISTS hook_events_au');
    db.run('DROP TABLE IF EXISTS hook_events_fts');

    // Create standalone FTS table (no content= mode)
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS hook_events_fts USING fts5(
        content
      )
    `);

    // Recreate triggers
    db.run(`
      CREATE TRIGGER IF NOT EXISTS hook_events_ai AFTER INSERT ON hook_events BEGIN
        INSERT INTO hook_events_fts(rowid, content)
        VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS hook_events_ad AFTER DELETE ON hook_events BEGIN
        INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
        VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS hook_events_au AFTER UPDATE ON hook_events BEGIN
        INSERT INTO hook_events_fts(hook_events_fts, rowid, content)
        VALUES ('delete', old.id, COALESCE(old.event_type, '') || ' ' || COALESCE(old.tool_name, '') || ' ' || COALESCE(old.input_json, ''));
        INSERT INTO hook_events_fts(rowid, content)
        VALUES (new.id, COALESCE(new.event_type, '') || ' ' || COALESCE(new.tool_name, '') || ' ' || COALESCE(new.input_json, ''));
      END
    `);

    // Populate FTS table from existing data
    console.error('[db] Populating hook_events_fts from existing data...');
    db.run(`
      INSERT INTO hook_events_fts(rowid, content)
      SELECT id, COALESCE(event_type, '') || ' ' || COALESCE(tool_name, '') || ' ' || COALESCE(input_json, '')
      FROM hook_events
    `);

    console.error('[db] Migration v6→v7 complete');
  }
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

export interface IndexFileResult {
  linesIndexed: number;
  byteOffset: number;
  sessionId: string;
}

/**
 * Index a single transcript file (full or delta)
 * @param db - Database instance
 * @param filePath - Path to the transcript file
 * @param fromByteOffset - Start reading from this byte offset (0 for full index)
 * @param startLineNumber - Line number to start from (1 for full index)
 * @param onProgress - Progress callback
 */
export function indexTranscriptFile(
  db: Database,
  filePath: string,
  fromByteOffset = 0,
  startLineNumber = 1,
  onProgress?: (current: number, total: number) => void
): IndexFileResult {
  // Get file size first
  const file = Bun.file(filePath);
  const fileSize = file.size;

  // If we're already at or past the file size, nothing new to index
  if (fromByteOffset >= fileSize) {
    return { linesIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  // Read only new bytes
  let text: string;
  try {
    if (fromByteOffset > 0) {
      // Read only from offset to end using sync file operations
      const bytesToRead = fileSize - fromByteOffset;
      const buffer = Buffer.alloc(bytesToRead);
      const fd = openSync(filePath, 'r');
      try {
        const bytesRead = readSync(fd, buffer, 0, bytesToRead, fromByteOffset);
        text = buffer.toString('utf-8', 0, bytesRead);
      } finally {
        closeSync(fd);
      }
    } else {
      // Read entire file
      text = readFileSync(filePath, 'utf-8');
    }
  } catch {
    return { linesIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  if (!text.trim()) {
    return { linesIndexed: 0, byteOffset: fileSize, sessionId: '' };
  }

  // Handle partial line at start (if reading from offset, first "line" may be incomplete)
  let rawLines = text.split('\n');
  let bytesSkipped = 0;

  if (fromByteOffset > 0 && rawLines.length > 0) {
    // First chunk might be a partial line from the previous read
    // Check if it starts with '{' (valid JSON start)
    const firstLine = rawLines[0] || '';
    if (!firstLine.startsWith('{')) {
      // Skip this partial line
      bytesSkipped = Buffer.byteLength(`${firstLine}\n`, 'utf-8');
      rawLines = rawLines.slice(1);
    }
  }

  // Remove empty last line if exists
  if (rawLines.length > 0 && !rawLines[rawLines.length - 1]?.trim()) {
    rawLines.pop();
  }

  let indexedCount = 0;
  let sessionId = '';
  let slug: string | null = null;
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let lineNumber = startLineNumber;

  const insertLine = db.prepare(`
    INSERT OR REPLACE INTO lines
    (session_id, uuid, parent_uuid, line_number, type, subtype, timestamp, slug, role, model, cwd, content, raw, file_path, turn_id, turn_sequence, session_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          parsed.uuid || `line-${lineNumber}`,
          parsed.parentUuid || null,
          lineNumber,
          type,
          parsed.subtype || null,
          timestamp,
          slug,
          parsed.message?.role || null,
          parsed.message?.model || null,
          parsed.cwd || null,
          content,
          rawLine,
          filePath,
          null, // turn_id - will be correlated later
          null, // turn_sequence - will be correlated later
          null // session_name - will be correlated later
        );

        indexedCount++;
        lineNumber++;

        if (onProgress && i % 1000 === 0) {
          onProgress(i, rawLines.length);
        }
      } catch {
        // Skip malformed lines
        lineNumber++;
      }
    }
  });

  transaction();

  const newByteOffset = fileSize;

  // Update sessions table with new byte offset (keyed by file_path)
  // Record even files without sessionId to track byte offsets for delta updates
  if (fromByteOffset === 0) {
    // Full index - insert/replace (file_path is primary key)
    db.run(
      `
      INSERT OR REPLACE INTO sessions (file_path, session_id, slug, line_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        filePath,
        sessionId || 'unknown',
        slug,
        lineNumber - 1,
        newByteOffset,
        firstTimestamp,
        lastTimestamp,
        new Date().toISOString(),
      ]
    );
  } else {
    // Delta update - update existing
    db.run(
      `
      UPDATE sessions SET line_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
      WHERE file_path = ?
    `,
      [lineNumber - 1, newByteOffset, lastTimestamp, new Date().toISOString(), filePath]
    );
  }

  return { linesIndexed: indexedCount, byteOffset: newByteOffset, sessionId };
}

/**
 * Get the current index state for a file
 */
export function getFileIndexState(
  db: Database,
  filePath: string
): { byteOffset: number; lineCount: number } | null {
  const row = db
    .query('SELECT byte_offset, line_count FROM sessions WHERE file_path = ?')
    .get(filePath) as { byte_offset: number; line_count: number } | null;
  if (!row) return null;
  return { byteOffset: row.byte_offset, lineCount: row.line_count };
}

/**
 * Index all transcript files (full rebuild)
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
      const result = indexTranscriptFile(db, file, 0, 1);
      totalFiles++;
      totalLines += result.linesIndexed;

      if (onProgress) {
        onProgress(file, i + 1, files.length, result.linesIndexed);
      }
    } catch (err) {
      // Log and continue
      console.error(`Error indexing ${file}:`, err);
    }
  }

  // Update last indexed timestamp
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [
    'last_indexed',
    new Date().toISOString(),
  ]);

  return { filesIndexed: totalFiles, linesIndexed: totalLines };
}

/**
 * Update index with only new content (delta update)
 * Only reads bytes that haven't been indexed yet
 */
export async function updateIndex(
  db: Database,
  projectsDir?: string,
  onProgress?: (
    file: string,
    current: number,
    total: number,
    newLines: number,
    skipped: boolean
  ) => void
): Promise<{ filesChecked: number; filesUpdated: number; newLines: number }> {
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');
  const files = await findTranscriptFiles(dir);

  let filesChecked = 0;
  let filesUpdated = 0;
  let totalNewLines = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    filesChecked++;

    try {
      // Get current index state for this file
      const state = getFileIndexState(db, file);

      // Get current file size
      const fileSize = Bun.file(file).size;

      // Skip if file hasn't grown
      if (state && state.byteOffset >= fileSize) {
        if (onProgress) {
          onProgress(file, i + 1, files.length, 0, true);
        }
        continue;
      }

      // Index new content only
      const fromOffset = state?.byteOffset || 0;
      const startLine = state ? state.lineCount + 1 : 1;
      const result = indexTranscriptFile(db, file, fromOffset, startLine);

      if (result.linesIndexed > 0) {
        filesUpdated++;
        totalNewLines += result.linesIndexed;
      }

      if (onProgress) {
        onProgress(file, i + 1, files.length, result.linesIndexed, false);
      }
    } catch (err) {
      console.error(`Error updating ${file}:`, err);
    }
  }

  // Update last indexed timestamp
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)', [
    'last_indexed',
    new Date().toISOString(),
  ]);

  return { filesChecked, filesUpdated, newLines: totalNewLines };
}

/**
 * Watch for transcript changes and update index in real-time
 */
export function watchTranscripts(
  db: Database,
  projectsDir?: string,
  onUpdate?: (file: string, newLines: number) => void
): () => void {
  const { watch } = require('node:fs');
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');

  // Track file states to detect changes
  const fileStates = new Map<string, number>();

  // Initialize with current state
  findTranscriptFiles(dir).then((files) => {
    for (const file of files) {
      const state = getFileIndexState(db, file);
      if (state) {
        fileStates.set(file, state.byteOffset);
      }
    }
  });

  // Debounce map for rapid changes
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(dir, { recursive: true }, (eventType: string, filename: string | null) => {
    if (!filename || !filename.endsWith('.jsonl')) return;

    const filePath = join(dir, filename);

    // Debounce rapid changes
    const existingTimer = debounceTimers.get(filePath);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);

        try {
          const file = Bun.file(filePath);
          if (!existsSync(filePath)) return;

          const currentSize = file.size;
          const lastOffset = fileStates.get(filePath) || 0;

          // Only process if file has grown
          if (currentSize > lastOffset) {
            const state = getFileIndexState(db, filePath);
            const fromOffset = state?.byteOffset || 0;
            const startLine = state ? state.lineCount + 1 : 1;

            const result = indexTranscriptFile(db, filePath, fromOffset, startLine);

            if (result.linesIndexed > 0) {
              fileStates.set(filePath, result.byteOffset);
              if (onUpdate) {
                onUpdate(filePath, result.linesIndexed);
              }
            }
          }
        } catch {
          // Ignore errors during watch
        }
      }, 100)
    );
  });

  // Return cleanup function
  return () => {
    watcher.close();
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
  };
}

// ============================================================================
// Hook Event Indexing
// ============================================================================

const DEFAULT_HOOKS_DIR = join(process.env.HOME || '~', '.claude', 'hooks');

export interface HookIndexFileResult {
  eventsIndexed: number;
  byteOffset: number;
  sessionId: string;
}

/**
 * Find all hook event log files
 */
export async function findHookFiles(hooksDir?: string): Promise<string[]> {
  const dir = hooksDir || DEFAULT_HOOKS_DIR;
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  const { readdirSync, statSync } = require('node:fs');

  function scanDir(currentDir: string) {
    try {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.endsWith('.hooks.jsonl')) {
            files.push(fullPath);
          }
        } catch {
          // Skip inaccessible files
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  scanDir(dir);
  return files;
}

/**
 * Get hook file index state
 */
export function getHookFileIndexState(
  db: Database,
  filePath: string
): { byteOffset: number; eventCount: number } | null {
  const row = db
    .query('SELECT byte_offset, event_count FROM hook_files WHERE file_path = ?')
    .get(filePath) as { byte_offset: number; event_count: number } | null;
  if (!row) return null;
  return { byteOffset: row.byte_offset, eventCount: row.event_count };
}

/**
 * Index a single hook events file (full or delta)
 */
export function indexHookFile(
  db: Database,
  filePath: string,
  fromByteOffset = 0,
  startLineNumber = 1
): HookIndexFileResult {
  const file = Bun.file(filePath);
  const fileSize = file.size;

  if (fromByteOffset >= fileSize) {
    return { eventsIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  let text: string;
  try {
    if (fromByteOffset > 0) {
      // Read only from offset to end using sync file operations
      const bytesToRead = fileSize - fromByteOffset;
      const buffer = Buffer.alloc(bytesToRead);
      const fd = openSync(filePath, 'r');
      try {
        const bytesRead = readSync(fd, buffer, 0, bytesToRead, fromByteOffset);
        text = buffer.toString('utf-8', 0, bytesRead);
      } finally {
        closeSync(fd);
      }
    } else {
      text = readFileSync(filePath, 'utf-8');
    }
  } catch {
    return { eventsIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  if (!text.trim()) {
    return { eventsIndexed: 0, byteOffset: fileSize, sessionId: '' };
  }

  let rawLines = text.split('\n');

  // Handle partial line at start
  if (fromByteOffset > 0 && rawLines.length > 0) {
    const firstLine = rawLines[0] || '';
    if (!firstLine.startsWith('{')) {
      rawLines = rawLines.slice(1);
    }
  }

  if (rawLines.length > 0 && !rawLines[rawLines.length - 1]?.trim()) {
    rawLines.pop();
  }

  let indexedCount = 0;
  let sessionId = '';
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let lineNumber = startLineNumber;

  const insertEvent = db.prepare(`
    INSERT INTO hook_events
    (session_id, timestamp, event_type, tool_use_id, tool_name, decision, handler_results, input_json, context_json, file_path, line_number, turn_id, turn_sequence, session_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      if (!rawLine?.trim()) continue;

      try {
        const parsed = JSON.parse(rawLine);

        sessionId = parsed.sessionId || sessionId;
        const timestamp = parsed.timestamp || '';
        if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
        if (timestamp) lastTimestamp = timestamp;

        // Extract turn info from handler results
        // Handler keys include event type suffix (e.g., turn-tracker-PreToolUse, turn-tracker-PostToolUse)
        const handlerResults = parsed.handlerResults || {};
        let turnTracker = null;
        let sessionNaming = null;

        // Find turn-tracker and session-naming results with any event suffix
        for (const key of Object.keys(handlerResults)) {
          if (key.startsWith('turn-tracker') && handlerResults[key]?.data) {
            turnTracker = handlerResults[key].data;
          }
          if (key.startsWith('session-naming') && handlerResults[key]?.data) {
            sessionNaming = handlerResults[key].data;
          }
        }

        const turnId = turnTracker?.turnId || parsed.turnId || null;
        const turnSequence =
          turnTracker?.sequence ?? turnTracker?.turnSequence ?? parsed.turnSequence ?? null;
        const sessionName = sessionNaming?.sessionName || parsed.sessionName || null;

        insertEvent.run(
          parsed.sessionId || '',
          timestamp,
          parsed.eventType || '',
          parsed.toolUseId || null,
          parsed.toolName || null,
          parsed.decision || null,
          parsed.handlerResults ? JSON.stringify(parsed.handlerResults) : null,
          parsed.input ? JSON.stringify(parsed.input) : null,
          parsed.context ? JSON.stringify(parsed.context) : null,
          filePath,
          lineNumber,
          turnId,
          turnSequence,
          sessionName
        );

        indexedCount++;
        lineNumber++;
      } catch {
        lineNumber++;
      }
    }
  });

  transaction();

  const newByteOffset = fileSize;

  // Update hook_files tracking table
  if (sessionId || indexedCount > 0) {
    if (fromByteOffset === 0) {
      db.run(
        `
        INSERT OR REPLACE INTO hook_files (file_path, session_id, event_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        [
          filePath,
          sessionId || 'unknown',
          lineNumber - 1,
          newByteOffset,
          firstTimestamp,
          lastTimestamp,
          new Date().toISOString(),
        ]
      );
    } else {
      db.run(
        `
        UPDATE hook_files SET event_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
        WHERE file_path = ?
      `,
        [lineNumber - 1, newByteOffset, lastTimestamp, new Date().toISOString(), filePath]
      );
    }
  }

  return { eventsIndexed: indexedCount, byteOffset: newByteOffset, sessionId };
}

/**
 * Index all hook event files
 */
export async function indexAllHookFiles(
  db: Database,
  hooksDir?: string,
  onProgress?: (file: string, current: number, total: number, eventsIndexed: number) => void
): Promise<{ filesIndexed: number; eventsIndexed: number }> {
  const files = await findHookFiles(hooksDir);

  let totalFiles = 0;
  let totalEvents = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    try {
      const result = indexHookFile(db, file, 0, 1);
      totalFiles++;
      totalEvents += result.eventsIndexed;

      if (onProgress) {
        onProgress(file, i + 1, files.length, result.eventsIndexed);
      }
    } catch (err) {
      console.error(`Error indexing hook file ${file}:`, err);
    }
  }

  return { filesIndexed: totalFiles, eventsIndexed: totalEvents };
}

/**
 * Update hook index with only new content (delta update)
 */
export async function updateHookIndex(
  db: Database,
  hooksDir?: string,
  onProgress?: (
    file: string,
    current: number,
    total: number,
    newEvents: number,
    skipped: boolean
  ) => void
): Promise<{ filesChecked: number; filesUpdated: number; newEvents: number }> {
  const files = await findHookFiles(hooksDir);

  let filesChecked = 0;
  let filesUpdated = 0;
  let totalNewEvents = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    filesChecked++;

    try {
      const state = getHookFileIndexState(db, file);
      const fileSize = Bun.file(file).size;

      if (state && state.byteOffset >= fileSize) {
        if (onProgress) {
          onProgress(file, i + 1, files.length, 0, true);
        }
        continue;
      }

      const fromOffset = state?.byteOffset || 0;
      const startLine = state ? state.eventCount + 1 : 1;
      const result = indexHookFile(db, file, fromOffset, startLine);

      if (result.eventsIndexed > 0) {
        filesUpdated++;
        totalNewEvents += result.eventsIndexed;
      }

      if (onProgress) {
        onProgress(file, i + 1, files.length, result.eventsIndexed, false);
      }
    } catch (err) {
      console.error(`Error updating hook file ${file}:`, err);
    }
  }

  return { filesChecked, filesUpdated, newEvents: totalNewEvents };
}

/**
 * Watch for hook file changes and update index in real-time
 */
export function watchHookFiles(
  db: Database,
  hooksDir?: string,
  onUpdate?: (file: string, newEvents: number) => void
): () => void {
  const { watch } = require('node:fs');
  const dir = hooksDir || DEFAULT_HOOKS_DIR;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const fileStates = new Map<string, number>();

  // Initialize with current state
  findHookFiles(dir).then((files) => {
    for (const file of files) {
      const state = getHookFileIndexState(db, file);
      if (state) {
        fileStates.set(file, state.byteOffset);
      }
    }
  });

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const watcher = watch(dir, { recursive: true }, (eventType: string, filename: string | null) => {
    if (!filename || !filename.endsWith('.hooks.jsonl')) return;

    const filePath = join(dir, filename);

    const existingTimer = debounceTimers.get(filePath);
    if (existingTimer) clearTimeout(existingTimer);

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);

        try {
          if (!existsSync(filePath)) return;

          const currentSize = Bun.file(filePath).size;
          const lastOffset = fileStates.get(filePath) || 0;

          if (currentSize > lastOffset) {
            const state = getHookFileIndexState(db, filePath);
            const fromOffset = state?.byteOffset || 0;
            const startLine = state ? state.eventCount + 1 : 1;

            const result = indexHookFile(db, filePath, fromOffset, startLine);

            if (result.eventsIndexed > 0) {
              fileStates.set(filePath, result.byteOffset);
              if (onUpdate) {
                onUpdate(filePath, result.eventsIndexed);
              }
            }
          }
        } catch {
          // Ignore errors during watch
        }
      }, 100)
    );
  });

  return () => {
    watcher.close();
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
  };
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
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"`)
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

  sql += ' ORDER BY bm25(lines_fts) LIMIT ?';
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

  return rows.map((row) => ({
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
 * Options for unified search across all adapter sources
 */
export interface UnifiedSearchOptions {
  /** Search query */
  query: string;
  /** Maximum results per source (default: 50) */
  limitPerSource?: number;
  /** Total maximum results (default: 100) */
  totalLimit?: number;
  /** Filter by session IDs */
  sessionIds?: string[];
  /** Sources to include (adapter names). If not specified, searches all */
  sources?: string[];
}

/**
 * Search across all adapter sources using FTS
 *
 * This function queries all registered adapters that have searchable tables,
 * merges results, and returns a unified result set sorted by relevance.
 *
 * @param db - Database instance
 * @param searchableTables - Array of searchable table configs from adapters
 * @param options - Search options
 * @returns Unified search results from all sources
 */
export function searchUnified(
  db: Database,
  searchableTables: Array<SearchableTable & { adapterName: string }>,
  options: UnifiedSearchOptions
): UnifiedSearchResult[] {
  const { query, limitPerSource = 50, totalLimit = 100, sessionIds, sources } = options;

  if (!query.trim()) {
    return [];
  }

  // Build the FTS query - escape special FTS characters
  const ftsQuery = query
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"`)
    .join(' OR ');

  const allResults: UnifiedSearchResult[] = [];

  // Query each searchable table
  for (const table of searchableTables) {
    // Skip if sources filter is specified and this source isn't included
    if (sources && !sources.includes(table.adapterName)) {
      continue;
    }

    try {
      // Check if the FTS table exists
      const tableExists = db
        .query(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table.ftsTable);

      if (!tableExists) {
        continue;
      }

      // Build query based on source table type
      let sql: string;
      const params: (string | number)[] = [ftsQuery];

      if (table.sourceTable === 'lines') {
        // Transcript lines query
        sql = `
          SELECT
            l.session_id,
            l.slug,
            l.line_number,
            l.type as entry_type,
            l.timestamp,
            l.content,
            snippet(${table.ftsTable}, 0, '>>>>', '<<<<', '...', 64) as matched_text,
            l.raw,
            l.turn_id,
            l.turn_sequence,
            l.session_name
          FROM ${table.ftsTable} fts
          JOIN ${table.sourceTable} l ON fts.rowid = l.${table.joinColumn}
          WHERE ${table.ftsTable} MATCH ?
        `;

        if (sessionIds && sessionIds.length > 0) {
          sql += ` AND l.session_id IN (${sessionIds.map(() => '?').join(', ')})`;
          params.push(...sessionIds);
        }

        sql += ` ORDER BY bm25(${table.ftsTable}) LIMIT ?`;
        params.push(limitPerSource);

        const rows = db.prepare(sql).all(...params) as Array<{
          session_id: string;
          slug: string | null;
          line_number: number;
          entry_type: string;
          timestamp: string;
          content: string;
          matched_text: string;
          raw: string;
          turn_id: string | null;
          turn_sequence: number | null;
          session_name: string | null;
        }>;

        for (const row of rows) {
          allResults.push({
            adapterName: table.adapterName,
            sourceName: table.sourceName,
            sourceIcon: table.sourceIcon,
            sessionId: row.session_id,
            slug: row.slug || row.session_name,
            timestamp: row.timestamp,
            entryType: row.entry_type,
            lineNumber: row.line_number,
            matchedText: row.matched_text.replace(/>>>>/g, '').replace(/<<<<'/g, ''),
            content: row.content,
            raw: row.raw,
            extra: {
              turnId: row.turn_id,
              turnSequence: row.turn_sequence,
              sessionName: row.session_name,
            },
          });
        }
      } else if (table.sourceTable === 'hook_events') {
        // Hook events query - use highlight() instead of snippet() for content tables
        sql = `
          SELECT
            h.session_id,
            h.timestamp,
            h.event_type,
            h.tool_name,
            h.line_number,
            h.input_json,
            highlight(${table.ftsTable}, 0, '>>>>', '<<<<') as matched_text,
            h.turn_id,
            h.turn_sequence,
            h.session_name
          FROM ${table.ftsTable} fts
          JOIN ${table.sourceTable} h ON fts.rowid = h.${table.joinColumn}
          WHERE ${table.ftsTable} MATCH ?
        `;

        if (sessionIds && sessionIds.length > 0) {
          sql += ` AND h.session_id IN (${sessionIds.map(() => '?').join(', ')})`;
          params.push(...sessionIds);
        }

        sql += ` ORDER BY bm25(${table.ftsTable}) LIMIT ?`;
        params.push(limitPerSource);

        const rows = db.prepare(sql).all(...params) as Array<{
          session_id: string;
          timestamp: string;
          event_type: string;
          tool_name: string | null;
          line_number: number;
          input_json: string | null;
          matched_text: string;
          turn_id: string | null;
          turn_sequence: number | null;
          session_name: string | null;
        }>;

        for (const row of rows) {
          // Build content from event data
          let content = row.event_type;
          if (row.tool_name) {
            content += ` [${row.tool_name}]`;
          }

          allResults.push({
            adapterName: table.adapterName,
            sourceName: table.sourceName,
            sourceIcon: table.sourceIcon,
            sessionId: row.session_id,
            slug: row.session_name,
            timestamp: row.timestamp,
            entryType: row.event_type,
            lineNumber: row.line_number,
            matchedText: row.matched_text.replace(/>>>>/g, '').replace(/<<<<'/g, ''),
            content,
            raw: row.input_json || undefined,
            extra: {
              toolName: row.tool_name,
              turnId: row.turn_id,
              turnSequence: row.turn_sequence,
              sessionName: row.session_name,
            },
          });
        }
      }
      // Additional source table types can be added here
    } catch (err) {
      // Skip tables that fail (might not exist or have different schema)
      console.error(`[searchUnified] Error querying ${table.ftsTable}:`, err);
    }
  }

  // Sort all results by timestamp (most recent first)
  allResults.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply total limit
  return allResults.slice(0, totalLimit);
}

/**
 * Get database statistics
 */
export function getDbStats(db: Database, dbPath: string = DEFAULT_DB_PATH): DbStats {
  const versionRow = db.query('SELECT value FROM metadata WHERE key = ?').get('version') as {
    value: string;
  } | null;
  const lastIndexedRow = db
    .query('SELECT value FROM metadata WHERE key = ?')
    .get('last_indexed') as { value: string } | null;
  const lineCountRow = db.query('SELECT COUNT(*) as count FROM lines').get() as { count: number };
  const sessionCountRow = db.query('SELECT COUNT(*) as count FROM sessions').get() as {
    count: number;
  };

  // Hook event stats
  let hookEventCount = 0;
  let hookFileCount = 0;
  try {
    const hookEventRow = db.query('SELECT COUNT(*) as count FROM hook_events').get() as {
      count: number;
    };
    const hookFileRow = db.query('SELECT COUNT(*) as count FROM hook_files').get() as {
      count: number;
    };
    hookEventCount = hookEventRow?.count || 0;
    hookFileCount = hookFileRow?.count || 0;
  } catch {
    // Tables might not exist yet
  }

  let dbSizeBytes = 0;
  try {
    const file = Bun.file(dbPath);
    dbSizeBytes = file.size;
  } catch {
    // Ignore
  }

  return {
    version: versionRow ? Number.parseInt(versionRow.value, 10) : 0,
    lineCount: lineCountRow?.count || 0,
    sessionCount: sessionCountRow?.count || 0,
    hookEventCount,
    hookFileCount,
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

// ============================================================================
// Turn Correlation Functions
// ============================================================================

/**
 * Correlate transcript lines with turn information from hook events.
 *
 * This function updates transcript lines with turn_id, turn_sequence, and session_name
 * by looking up corresponding hook events (Stop events mark turn boundaries).
 *
 * Should be called after both transcripts and hook events have been indexed.
 */
export function correlateLinesToTurns(db: Database): { updated: number; sessions: number } {
  // Get all unique session IDs that have lines without turn info
  const sessionsToProcess = db
    .query(
      `
    SELECT DISTINCT session_id FROM lines
    WHERE turn_id IS NULL AND session_id != ''
  `
    )
    .all() as { session_id: string }[];

  let totalUpdated = 0;

  for (const { session_id } of sessionsToProcess) {
    // Get session_name from the most recent SessionStart event for this session
    const sessionNameRow = db
      .query(
        `
      SELECT session_name FROM hook_events
      WHERE session_id = ? AND event_type = 'SessionStart' AND session_name IS NOT NULL
      ORDER BY timestamp DESC LIMIT 1
    `
      )
      .get(session_id) as { session_name: string } | null;

    const sessionName = sessionNameRow?.session_name || null;

    // Get all Stop events for this session (turn boundaries) ordered by timestamp
    const stopEvents = db
      .query(
        `
      SELECT timestamp, turn_id, turn_sequence FROM hook_events
      WHERE session_id = ? AND event_type = 'Stop' AND turn_id IS NOT NULL
      ORDER BY timestamp ASC
    `
      )
      .all(session_id) as { timestamp: string; turn_id: string; turn_sequence: number }[];

    if (stopEvents.length === 0) {
      // No Stop events with turn_id - try using tool events instead
      // Get distinct turns from tool events (PreToolUse/PostToolUse)
      const toolTurns = db
        .query(
          `
        SELECT DISTINCT turn_id, turn_sequence,
               MIN(timestamp) as start_time, MAX(timestamp) as end_time
        FROM hook_events
        WHERE session_id = ? AND turn_id IS NOT NULL
          AND event_type IN ('PreToolUse', 'PostToolUse')
        GROUP BY turn_id, turn_sequence
        ORDER BY turn_sequence ASC
      `
        )
        .all(session_id) as {
        turn_id: string;
        turn_sequence: number;
        start_time: string;
        end_time: string;
      }[];

      if (toolTurns.length > 0) {
        // Use tool event timestamps to correlate lines to turns
        for (let i = 0; i < toolTurns.length; i++) {
          const turn = toolTurns[i]!;
          const nextTurn = i + 1 < toolTurns.length ? toolTurns[i + 1] : null;

          // Update lines from this turn's start to next turn's start (or end of session)
          if (nextTurn) {
            const result = db.run(
              `
              UPDATE lines SET turn_id = ?, turn_sequence = ?, session_name = ?
              WHERE session_id = ? AND timestamp >= ? AND timestamp < ?
              AND turn_id IS NULL
            `,
              [
                turn.turn_id,
                turn.turn_sequence,
                sessionName,
                session_id,
                turn.start_time,
                nextTurn.start_time,
              ]
            );
            totalUpdated += result.changes;
          } else {
            // Last turn - update all remaining lines
            const result = db.run(
              `
              UPDATE lines SET turn_id = ?, turn_sequence = ?, session_name = ?
              WHERE session_id = ? AND timestamp >= ?
              AND turn_id IS NULL
            `,
              [turn.turn_id, turn.turn_sequence, sessionName, session_id, turn.start_time]
            );
            totalUpdated += result.changes;
          }
        }
        continue;
      }

      // No turn info at all - just update session_name if we have it
      if (sessionName) {
        db.run(
          `
          UPDATE lines SET session_name = ?
          WHERE session_id = ? AND session_name IS NULL
        `,
          [sessionName, session_id]
        );
      }
      continue;
    }

    // For each Stop event, update lines between this Stop and the previous Stop
    // (or session start if this is the first Stop)
    for (let i = 0; i < stopEvents.length; i++) {
      const currentStop = stopEvents[i]!;
      const prevStop = i > 0 ? stopEvents[i - 1] : null;

      // Update lines from prevStop.timestamp (or beginning) up to currentStop.timestamp
      if (prevStop) {
        const result = db.run(
          `
          UPDATE lines SET turn_id = ?, turn_sequence = ?, session_name = ?
          WHERE session_id = ? AND timestamp > ? AND timestamp <= ?
          AND turn_id IS NULL
        `,
          [
            currentStop.turn_id,
            currentStop.turn_sequence,
            sessionName,
            session_id,
            prevStop.timestamp,
            currentStop.timestamp,
          ]
        );
        totalUpdated += result.changes;
      } else {
        // First turn - update lines from beginning up to first Stop
        const result = db.run(
          `
          UPDATE lines SET turn_id = ?, turn_sequence = ?, session_name = ?
          WHERE session_id = ? AND timestamp <= ?
          AND turn_id IS NULL
        `,
          [
            currentStop.turn_id,
            currentStop.turn_sequence,
            sessionName,
            session_id,
            currentStop.timestamp,
          ]
        );
        totalUpdated += result.changes;
      }
    }

    // Update any remaining lines after the last Stop (current in-progress turn)
    const lastStop = stopEvents[stopEvents.length - 1]!;
    if (sessionName) {
      const result = db.run(
        `
        UPDATE lines SET session_name = ?
        WHERE session_id = ? AND timestamp > ? AND session_name IS NULL
      `,
        [sessionName, session_id, lastStop.timestamp]
      );
      totalUpdated += result.changes;
    }
  }

  return { updated: totalUpdated, sessions: sessionsToProcess.length };
}

/**
 * Get turn summary for a session
 */
export function getSessionTurns(
  db: Database,
  sessionId: string
): {
  turnId: string;
  turnSequence: number;
  lineCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
}[] {
  return db
    .query(
      `
    SELECT
      turn_id as turnId,
      turn_sequence as turnSequence,
      COUNT(*) as lineCount,
      MIN(timestamp) as firstTimestamp,
      MAX(timestamp) as lastTimestamp
    FROM lines
    WHERE session_id = ? AND turn_id IS NOT NULL
    GROUP BY turn_id, turn_sequence
    ORDER BY turn_sequence ASC
  `
    )
    .all(sessionId) as {
    turnId: string;
    turnSequence: number;
    lineCount: number;
    firstTimestamp: string;
    lastTimestamp: string;
  }[];
}

/**
 * Get lines for a specific turn
 */
export function getTurnLines(db: Database, turnId: string): Partial<TranscriptLine>[] {
  const rows = db
    .query(
      `
    SELECT session_id, uuid, parent_uuid, line_number, type, subtype, timestamp, slug, cwd, content, raw
    FROM lines
    WHERE turn_id = ?
    ORDER BY line_number ASC
  `
    )
    .all(turnId) as {
    session_id: string;
    uuid: string;
    parent_uuid: string | null;
    line_number: number;
    type: string;
    subtype: string | null;
    timestamp: string;
    slug: string | null;
    cwd: string | null;
    content: string;
    raw: string;
  }[];

  return rows.map((row) => ({
    sessionId: row.session_id,
    uuid: row.uuid,
    parentUuid: row.parent_uuid,
    lineNumber: row.line_number,
    type: row.type as TranscriptLine['type'],
    subtype: row.subtype ?? undefined,
    timestamp: row.timestamp,
    slug: row.slug ?? undefined,
    cwd: row.cwd ?? '',
    raw: row.raw,
  }));
}

// ============================================================================
// Query Functions for CLI/TUI
// ============================================================================

export interface SessionInfo {
  sessionId: string;
  slug: string | null;
  filePath: string;
  lineCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  indexedAt: string;
}

export interface LineResult {
  id: number;
  sessionId: string;
  uuid: string;
  parentUuid: string | null;
  lineNumber: number;
  type: string;
  subtype: string | null;
  timestamp: string;
  slug: string | null;
  role: string | null;
  model: string | null;
  cwd: string | null;
  content: string | null;
  raw: string;
  filePath: string;
  // Turn tracking (v5 schema)
  turnId: string | null;
  turnSequence: number | null;
  sessionName: string | null;
}

export interface GetLinesOptions {
  sessionId?: string;
  types?: string[];
  limit?: number;
  offset?: number;
  fromLine?: number;
  toLine?: number;
  fromTime?: string;
  toTime?: string;
  search?: string;
  order?: 'asc' | 'desc';
}

/**
 * Get all sessions with metadata
 */
export function getSessions(
  db: Database,
  options?: { recentDays?: number; projectPath?: string }
): SessionInfo[] {
  let sql = `
    SELECT
      session_id,
      slug,
      file_path,
      line_count,
      first_timestamp,
      last_timestamp,
      indexed_at
    FROM sessions
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (options?.recentDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.recentDays);
    sql += ' AND last_timestamp >= ?';
    params.push(cutoff.toISOString());
  }

  if (options?.projectPath) {
    sql += ' AND file_path LIKE ?';
    params.push(`%${options.projectPath}%`);
  }

  sql += ' ORDER BY last_timestamp DESC';

  const rows = db.prepare(sql).all(...params) as Array<{
    session_id: string;
    slug: string | null;
    file_path: string;
    line_count: number;
    first_timestamp: string | null;
    last_timestamp: string | null;
    indexed_at: string;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    slug: row.slug,
    filePath: row.file_path,
    lineCount: row.line_count,
    firstTimestamp: row.first_timestamp,
    lastTimestamp: row.last_timestamp,
    indexedAt: row.indexed_at,
  }));
}

/**
 * Get a single session by ID or slug
 */
export function getSession(db: Database, idOrSlug: string): SessionInfo | null {
  const sql = `
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
  `;

  const row = db.prepare(sql).get(idOrSlug, idOrSlug) as {
    session_id: string;
    slug: string | null;
    file_path: string;
    line_count: number;
    first_timestamp: string | null;
    last_timestamp: string | null;
    indexed_at: string;
  } | null;

  if (!row) return null;

  return {
    sessionId: row.session_id,
    slug: row.slug,
    filePath: row.file_path,
    lineCount: row.line_count,
    firstTimestamp: row.first_timestamp,
    lastTimestamp: row.last_timestamp,
    indexedAt: row.indexed_at,
  };
}

/**
 * Get lines for a session with filtering and pagination
 */
export function getLines(db: Database, options: GetLinesOptions = {}): LineResult[] {
  let sql = `
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
  `;
  const params: (string | number)[] = [];

  if (options.sessionId) {
    // Check if it's a slug or session ID
    const session = getSession(db, options.sessionId);
    if (session) {
      sql += ' AND session_id = ?';
      params.push(session.sessionId);
    } else {
      sql += ' AND session_id = ?';
      params.push(options.sessionId);
    }
  }

  if (options.types && options.types.length > 0) {
    sql += ` AND type IN (${options.types.map(() => '?').join(', ')})`;
    params.push(...options.types);
  }

  if (options.fromLine !== undefined) {
    sql += ' AND line_number >= ?';
    params.push(options.fromLine);
  }

  if (options.toLine !== undefined) {
    sql += ' AND line_number <= ?';
    params.push(options.toLine);
  }

  if (options.fromTime) {
    sql += ' AND timestamp >= ?';
    params.push(options.fromTime);
  }

  if (options.toTime) {
    sql += ' AND timestamp <= ?';
    params.push(options.toTime);
  }

  if (options.search) {
    sql += ' AND content LIKE ?';
    params.push(`%${options.search}%`);
  }

  const order = options.order || 'asc';
  sql += ` ORDER BY line_number ${order === 'desc' ? 'DESC' : 'ASC'}`;

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    session_id: string;
    uuid: string;
    parent_uuid: string | null;
    line_number: number;
    type: string;
    subtype: string | null;
    timestamp: string;
    slug: string | null;
    role: string | null;
    model: string | null;
    cwd: string | null;
    content: string | null;
    raw: string;
    file_path: string;
    turn_id: string | null;
    turn_sequence: number | null;
    session_name: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    uuid: row.uuid,
    parentUuid: row.parent_uuid,
    lineNumber: row.line_number,
    type: row.type,
    subtype: row.subtype,
    timestamp: row.timestamp,
    slug: row.slug,
    role: row.role,
    model: row.model,
    cwd: row.cwd,
    content: row.content,
    raw: row.raw,
    filePath: row.file_path,
    turnId: row.turn_id,
    turnSequence: row.turn_sequence,
    sessionName: row.session_name,
  }));
}

/**
 * Get the maximum line ID for a session (for polling new lines)
 */
export function getMaxLineId(db: Database, sessionId?: string): number {
  let sql = 'SELECT MAX(id) as max_id FROM lines';
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  const row = db.prepare(sql).get(...params) as { max_id: number | null };
  return row?.max_id || 0;
}

/**
 * Get lines after a specific ID (for tail mode polling)
 */
export function getLinesAfterId(
  db: Database,
  afterId: number,
  sessionId?: string,
  types?: string[]
): LineResult[] {
  let sql = `
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
    WHERE id > ?
  `;
  const params: (string | number)[] = [afterId];

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }

  if (types && types.length > 0) {
    sql += ` AND type IN (${types.map(() => '?').join(', ')})`;
    params.push(...types);
  }

  sql += ' ORDER BY id ASC';

  const rows = db.prepare(sql).all(...params) as Array<{
    id: number;
    session_id: string;
    uuid: string;
    parent_uuid: string | null;
    line_number: number;
    type: string;
    subtype: string | null;
    timestamp: string;
    slug: string | null;
    role: string | null;
    model: string | null;
    cwd: string | null;
    content: string | null;
    raw: string;
    file_path: string;
    turn_id: string | null;
    turn_sequence: number | null;
    session_name: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    uuid: row.uuid,
    parentUuid: row.parent_uuid,
    lineNumber: row.line_number,
    type: row.type,
    subtype: row.subtype,
    timestamp: row.timestamp,
    slug: row.slug,
    role: row.role,
    model: row.model,
    cwd: row.cwd,
    content: row.content,
    raw: row.raw,
    filePath: row.file_path,
    turnId: row.turn_id,
    turnSequence: row.turn_sequence,
    sessionName: row.session_name,
  }));
}

/**
 * Get line count for a session
 */
export function getLineCount(db: Database, sessionId: string): number {
  const session = getSession(db, sessionId);
  if (!session) return 0;

  const row = db
    .prepare('SELECT COUNT(*) as count FROM lines WHERE session_id = ?')
    .get(session.sessionId) as { count: number };
  return row?.count || 0;
}

// ============================================================================
// Hook Event Query Functions
// ============================================================================

export interface HookEventResult {
  id: number;
  sessionId: string;
  timestamp: string;
  eventType: string;
  toolUseId: string | null;
  toolName: string | null;
  decision: string | null;
  handlerResults: string | null;
  inputJson: string | null;
  contextJson: string | null;
  filePath: string;
  lineNumber: number;
  // Turn tracking (v5 schema)
  turnId: string | null;
  turnSequence: number | null;
  sessionName: string | null;
}

export interface HookSessionInfo {
  sessionId: string;
  filePath: string;
  eventCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  indexedAt: string;
}

export interface GetHookEventsOptions {
  sessionId?: string;
  eventTypes?: string[];
  toolNames?: string[];
  limit?: number;
  offset?: number;
  fromTime?: string;
  toTime?: string;
  order?: 'asc' | 'desc';
}

/**
 * Get hook events with filtering
 */
export function getHookEvents(db: Database, options: GetHookEventsOptions = {}): HookEventResult[] {
  let sql = `
    SELECT
      id,
      session_id,
      timestamp,
      event_type,
      tool_use_id,
      tool_name,
      decision,
      handler_results,
      input_json,
      context_json,
      file_path,
      line_number,
      turn_id,
      turn_sequence,
      session_name
    FROM hook_events
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (options.sessionId) {
    sql += ' AND session_id = ?';
    params.push(options.sessionId);
  }

  if (options.eventTypes && options.eventTypes.length > 0) {
    const placeholders = options.eventTypes.map(() => '?').join(',');
    sql += ` AND event_type IN (${placeholders})`;
    params.push(...options.eventTypes);
  }

  if (options.toolNames && options.toolNames.length > 0) {
    const placeholders = options.toolNames.map(() => '?').join(',');
    sql += ` AND tool_name IN (${placeholders})`;
    params.push(...options.toolNames);
  }

  if (options.fromTime) {
    sql += ' AND timestamp >= ?';
    params.push(options.fromTime);
  }

  if (options.toTime) {
    sql += ' AND timestamp <= ?';
    params.push(options.toTime);
  }

  sql += ` ORDER BY timestamp ${options.order === 'desc' ? 'DESC' : 'ASC'}, id ${options.order === 'desc' ? 'DESC' : 'ASC'}`;

  if (options.limit) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    id: number;
    session_id: string;
    timestamp: string;
    event_type: string;
    tool_use_id: string | null;
    tool_name: string | null;
    decision: string | null;
    handler_results: string | null;
    input_json: string | null;
    context_json: string | null;
    file_path: string;
    line_number: number;
    turn_id: string | null;
    turn_sequence: number | null;
    session_name: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    toolUseId: row.tool_use_id,
    toolName: row.tool_name,
    decision: row.decision,
    handlerResults: row.handler_results,
    inputJson: row.input_json,
    contextJson: row.context_json,
    filePath: row.file_path,
    lineNumber: row.line_number,
    turnId: row.turn_id,
    turnSequence: row.turn_sequence,
    sessionName: row.session_name,
  }));
}

/**
 * Get sessions with hook events
 */
export function getHookSessions(
  db: Database,
  options?: { recentDays?: number }
): HookSessionInfo[] {
  let sql = `
    SELECT
      session_id,
      file_path,
      event_count,
      first_timestamp,
      last_timestamp,
      indexed_at
    FROM hook_files
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (options?.recentDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - options.recentDays);
    sql += ' AND last_timestamp >= ?';
    params.push(cutoff.toISOString());
  }

  sql += ' ORDER BY last_timestamp DESC';

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    session_id: string;
    file_path: string;
    event_count: number;
    first_timestamp: string | null;
    last_timestamp: string | null;
    indexed_at: string;
  }>;

  return rows.map((row) => ({
    sessionId: row.session_id,
    filePath: row.file_path,
    eventCount: row.event_count,
    firstTimestamp: row.first_timestamp,
    lastTimestamp: row.last_timestamp,
    indexedAt: row.indexed_at,
  }));
}

/**
 * Get maximum hook event ID for a session (for delta updates)
 */
export function getMaxHookEventId(db: Database, sessionId?: string): number {
  let sql = 'SELECT MAX(id) as max_id FROM hook_events';
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  const row = db.prepare(sql).get(...params) as { max_id: number | null };
  return row?.max_id || 0;
}

/**
 * Get hook events after a given ID (for live updates)
 */
export function getHookEventsAfterId(
  db: Database,
  afterId: number,
  sessionId?: string,
  eventTypes?: string[],
  toolNames?: string[]
): HookEventResult[] {
  let sql = `
    SELECT
      id,
      session_id,
      timestamp,
      event_type,
      tool_use_id,
      tool_name,
      decision,
      handler_results,
      input_json,
      context_json,
      file_path,
      line_number,
      turn_id,
      turn_sequence,
      session_name
    FROM hook_events
    WHERE id > ?
  `;
  const params: (string | number)[] = [afterId];

  if (sessionId) {
    sql += ' AND session_id = ?';
    params.push(sessionId);
  }

  if (eventTypes && eventTypes.length > 0) {
    const placeholders = eventTypes.map(() => '?').join(',');
    sql += ` AND event_type IN (${placeholders})`;
    params.push(...eventTypes);
  }

  if (toolNames && toolNames.length > 0) {
    const placeholders = toolNames.map(() => '?').join(',');
    sql += ` AND tool_name IN (${placeholders})`;
    params.push(...toolNames);
  }

  sql += ' ORDER BY id ASC';

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as Array<{
    id: number;
    session_id: string;
    timestamp: string;
    event_type: string;
    tool_use_id: string | null;
    tool_name: string | null;
    decision: string | null;
    handler_results: string | null;
    input_json: string | null;
    context_json: string | null;
    file_path: string;
    line_number: number;
    turn_id: string | null;
    turn_sequence: number | null;
    session_name: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    toolUseId: row.tool_use_id,
    toolName: row.tool_name,
    decision: row.decision,
    handlerResults: row.handler_results,
    inputJson: row.input_json,
    contextJson: row.context_json,
    filePath: row.file_path,
    lineNumber: row.line_number,
    turnId: row.turn_id,
    turnSequence: row.turn_sequence,
    sessionName: row.session_name,
  }));
}

/**
 * Get hook event count for a session
 */
export function getHookEventCount(db: Database, sessionId?: string): number {
  let sql = 'SELECT COUNT(*) as count FROM hook_events';
  const params: string[] = [];

  if (sessionId) {
    sql += ' WHERE session_id = ?';
    params.push(sessionId);
  }

  const row = db.prepare(sql).get(...params) as { count: number };
  return row?.count || 0;
}

/**
 * Clear and rebuild the entire index
 * Also drops and recreates the sessions and hook tables to ensure schema is current
 */
export function rebuildIndex(db: Database): void {
  // Clear transcript tables
  db.run('DELETE FROM lines');
  db.run('DELETE FROM lines_fts');

  // Drop and recreate sessions table to ensure correct schema
  db.run('DROP TABLE IF EXISTS sessions');
  db.run(`
    CREATE TABLE sessions (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      slug TEXT,
      line_count INTEGER NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT NOT NULL
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)');

  // Clear hook tables
  db.run('DELETE FROM hook_events');
  db.run('DROP TABLE IF EXISTS hook_files');
  db.run(`
    CREATE TABLE hook_files (
      file_path TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      event_count INTEGER NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT NOT NULL
    )
  `);

  db.run("DELETE FROM metadata WHERE key = 'last_indexed'");
}

export { DEFAULT_DB_PATH };
