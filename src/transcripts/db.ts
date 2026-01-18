/**
 * Transcript SQLite Database
 * Fast indexed storage for transcript search
 */

import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { findTranscriptFiles } from './indexer';
import type { TranscriptLine, SearchResult } from './types';

const DB_VERSION = 4;
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
      line_number INTEGER NOT NULL
    )
  `);

  // Indexes for hook events
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_session ON hook_events(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_tool_use ON hook_events(tool_use_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_event_type ON hook_events(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_timestamp ON hook_events(timestamp)');

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
  fromByteOffset: number = 0,
  startLineNumber: number = 1,
  onProgress?: (current: number, total: number) => void
): IndexFileResult {
  // Get file size first
  const file = Bun.file(filePath);
  const fileSize = file.size;

  // If we're already at or past the file size, nothing new to index
  if (fromByteOffset >= fileSize) {
    return { linesIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  // Read only new bytes using Bun.file().slice()
  let text: string;
  try {
    if (fromByteOffset > 0) {
      // Read only from offset to end
      const slice = file.slice(fromByteOffset);
      text = new TextDecoder().decode(Bun.readableStreamToArrayBuffer(slice.stream()));
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
      bytesSkipped = Buffer.byteLength(firstLine + '\n', 'utf-8');
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
          filePath
        );

        indexedCount++;
        lineNumber++;

        if (onProgress && i % 1000 === 0) {
          onProgress(i, rawLines.length);
        }
      } catch {
        // Skip malformed lines
        lineNumber++;
        continue;
      }
    }
  });

  transaction();

  const newByteOffset = fileSize;

  // Update sessions table with new byte offset (keyed by file_path)
  // Record even files without sessionId to track byte offsets for delta updates
  if (fromByteOffset === 0) {
    // Full index - insert/replace (file_path is primary key)
    db.run(`
      INSERT OR REPLACE INTO sessions (file_path, session_id, slug, line_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [filePath, sessionId || 'unknown', slug, lineNumber - 1, newByteOffset, firstTimestamp, lastTimestamp, new Date().toISOString()]);
  } else {
    // Delta update - update existing
    db.run(`
      UPDATE sessions SET line_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
      WHERE file_path = ?
    `, [lineNumber - 1, newByteOffset, lastTimestamp, new Date().toISOString(), filePath]);
  }

  return { linesIndexed: indexedCount, byteOffset: newByteOffset, sessionId };
}

/**
 * Get the current index state for a file
 */
export function getFileIndexState(db: Database, filePath: string): { byteOffset: number; lineCount: number } | null {
  const row = db.query('SELECT byte_offset, line_count FROM sessions WHERE file_path = ?').get(filePath) as { byte_offset: number; line_count: number } | null;
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
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
    ['last_indexed', new Date().toISOString()]);

  return { filesIndexed: totalFiles, linesIndexed: totalLines };
}

/**
 * Update index with only new content (delta update)
 * Only reads bytes that haven't been indexed yet
 */
export async function updateIndex(
  db: Database,
  projectsDir?: string,
  onProgress?: (file: string, current: number, total: number, newLines: number, skipped: boolean) => void
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
  db.run('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
    ['last_indexed', new Date().toISOString()]);

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
  findTranscriptFiles(dir).then(files => {
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

    debounceTimers.set(filePath, setTimeout(() => {
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
    }, 100));
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
export function getHookFileIndexState(db: Database, filePath: string): { byteOffset: number; eventCount: number } | null {
  const row = db.query('SELECT byte_offset, event_count FROM hook_files WHERE file_path = ?').get(filePath) as { byte_offset: number; event_count: number } | null;
  if (!row) return null;
  return { byteOffset: row.byte_offset, eventCount: row.event_count };
}

/**
 * Index a single hook events file (full or delta)
 */
export function indexHookFile(
  db: Database,
  filePath: string,
  fromByteOffset: number = 0,
  startLineNumber: number = 1
): HookIndexFileResult {
  const file = Bun.file(filePath);
  const fileSize = file.size;

  if (fromByteOffset >= fileSize) {
    return { eventsIndexed: 0, byteOffset: fromByteOffset, sessionId: '' };
  }

  let text: string;
  try {
    if (fromByteOffset > 0) {
      const slice = file.slice(fromByteOffset);
      text = new TextDecoder().decode(Bun.readableStreamToArrayBuffer(slice.stream()));
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
    (session_id, timestamp, event_type, tool_use_id, tool_name, decision, handler_results, input_json, context_json, file_path, line_number)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          lineNumber
        );

        indexedCount++;
        lineNumber++;
      } catch {
        lineNumber++;
        continue;
      }
    }
  });

  transaction();

  const newByteOffset = fileSize;

  // Update hook_files tracking table
  if (sessionId || indexedCount > 0) {
    if (fromByteOffset === 0) {
      db.run(`
        INSERT OR REPLACE INTO hook_files (file_path, session_id, event_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [filePath, sessionId || 'unknown', lineNumber - 1, newByteOffset, firstTimestamp, lastTimestamp, new Date().toISOString()]);
    } else {
      db.run(`
        UPDATE hook_files SET event_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
        WHERE file_path = ?
      `, [lineNumber - 1, newByteOffset, lastTimestamp, new Date().toISOString(), filePath]);
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
  onProgress?: (file: string, current: number, total: number, newEvents: number, skipped: boolean) => void
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
  findHookFiles(dir).then(files => {
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

    debounceTimers.set(filePath, setTimeout(() => {
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
    }, 100));
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

  // Hook event stats
  let hookEventCount = 0;
  let hookFileCount = 0;
  try {
    const hookEventRow = db.query('SELECT COUNT(*) as count FROM hook_events').get() as { count: number };
    const hookFileRow = db.query('SELECT COUNT(*) as count FROM hook_files').get() as { count: number };
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
    version: versionRow ? parseInt(versionRow.value, 10) : 0,
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
export function getSessions(db: Database, options?: { recentDays?: number; projectPath?: string }): SessionInfo[] {
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
    sql += ` AND last_timestamp >= ?`;
    params.push(cutoff.toISOString());
  }

  if (options?.projectPath) {
    sql += ` AND file_path LIKE ?`;
    params.push(`%${options.projectPath}%`);
  }

  sql += ` ORDER BY last_timestamp DESC`;

  const rows = db.prepare(sql).all(...params) as Array<{
    session_id: string;
    slug: string | null;
    file_path: string;
    line_count: number;
    first_timestamp: string | null;
    last_timestamp: string | null;
    indexed_at: string;
  }>;

  return rows.map(row => ({
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
      file_path
    FROM lines
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (options.sessionId) {
    // Check if it's a slug or session ID
    const session = getSession(db, options.sessionId);
    if (session) {
      sql += ` AND session_id = ?`;
      params.push(session.sessionId);
    } else {
      sql += ` AND session_id = ?`;
      params.push(options.sessionId);
    }
  }

  if (options.types && options.types.length > 0) {
    sql += ` AND type IN (${options.types.map(() => '?').join(', ')})`;
    params.push(...options.types);
  }

  if (options.fromLine !== undefined) {
    sql += ` AND line_number >= ?`;
    params.push(options.fromLine);
  }

  if (options.toLine !== undefined) {
    sql += ` AND line_number <= ?`;
    params.push(options.toLine);
  }

  if (options.fromTime) {
    sql += ` AND timestamp >= ?`;
    params.push(options.fromTime);
  }

  if (options.toTime) {
    sql += ` AND timestamp <= ?`;
    params.push(options.toTime);
  }

  if (options.search) {
    sql += ` AND content LIKE ?`;
    params.push(`%${options.search}%`);
  }

  const order = options.order || 'asc';
  sql += ` ORDER BY line_number ${order === 'desc' ? 'DESC' : 'ASC'}`;

  if (options.limit) {
    sql += ` LIMIT ?`;
    params.push(options.limit);
  }

  if (options.offset) {
    sql += ` OFFSET ?`;
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
  }>;

  return rows.map(row => ({
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
  }));
}

/**
 * Get the maximum line ID for a session (for polling new lines)
 */
export function getMaxLineId(db: Database, sessionId?: string): number {
  let sql = `SELECT MAX(id) as max_id FROM lines`;
  const params: string[] = [];

  if (sessionId) {
    sql += ` WHERE session_id = ?`;
    params.push(sessionId);
  }

  const row = db.prepare(sql).get(...params) as { max_id: number | null };
  return row?.max_id || 0;
}

/**
 * Get lines after a specific ID (for tail mode polling)
 */
export function getLinesAfterId(db: Database, afterId: number, sessionId?: string, types?: string[]): LineResult[] {
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
      file_path
    FROM lines
    WHERE id > ?
  `;
  const params: (string | number)[] = [afterId];

  if (sessionId) {
    sql += ` AND session_id = ?`;
    params.push(sessionId);
  }

  if (types && types.length > 0) {
    sql += ` AND type IN (${types.map(() => '?').join(', ')})`;
    params.push(...types);
  }

  sql += ` ORDER BY id ASC`;

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
  }>;

  return rows.map(row => ({
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
  }));
}

/**
 * Get line count for a session
 */
export function getLineCount(db: Database, sessionId: string): number {
  const session = getSession(db, sessionId);
  if (!session) return 0;

  const row = db.prepare('SELECT COUNT(*) as count FROM lines WHERE session_id = ?').get(session.sessionId) as { count: number };
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
