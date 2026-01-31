/**
 * TranscriptLinesAdapter
 *
 * Adapter for indexing Claude Code session transcripts.
 * Indexes ~/.claude/projects/**\/transcript.jsonl files.
 *
 * This adapter refactors the existing indexTranscriptFile logic from db.ts
 * to use the BaseAdapter architecture.
 */

import type { Database } from 'bun:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BaseAdapter, initCursorSchema } from './base';
import { trimRawTranscriptLine } from './content-trimmer';
import type { EntryContext, ProcessEntryResult, SearchableTable, WatchPath } from './types';

const DEFAULT_PROJECTS_DIR = join(process.env.HOME || '~', '.claude', 'projects');

/**
 * Line types that have zero searchable content and only consume raw storage.
 * Skipped during indexing to save ~44% of database size.
 * - progress: streaming tool execution updates (partial stdout, elapsed time)
 * - file-history-snapshot: git file snapshots
 * - queue-operation: internal queue operations
 */
const SKIP_TYPES = new Set(['progress', 'file-history-snapshot', 'queue-operation']);

/**
 * Extract searchable text from a parsed transcript entry
 * (Ported from db.ts extractTextFromParsed)
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
 * Find all transcript files in a directory (recursive)
 * Finds all .jsonl files EXCEPT those ending in .hooks.jsonl
 */
function findTranscriptFilesSync(dir: string): string[] {
  const files: string[] = [];

  if (!existsSync(dir)) {
    return files;
  }

  function scanDir(currentDir: string): void {
    try {
      const entries = readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = join(currentDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.endsWith('.jsonl') && !entry.endsWith('.hooks.jsonl')) {
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
 * TranscriptLinesAdapter
 *
 * Indexes Claude Code session transcripts from ~/.claude/projects
 */
export class TranscriptLinesAdapter extends BaseAdapter {
  readonly name = 'transcript-lines';
  readonly description = 'Indexes Claude Code session transcripts (transcript.jsonl files)';
  readonly fileExtensions = ['.jsonl'];

  private projectsDir: string;
  private insertStatement: ReturnType<Database['prepare']> | null = null;

  constructor(projectsDir: string = DEFAULT_PROJECTS_DIR) {
    super();
    this.projectsDir = projectsDir;
  }

  /**
   * Watch path returns all transcript.jsonl files
   */
  get watchPath(): WatchPath {
    return () => findTranscriptFilesSync(this.projectsDir);
  }

  /**
   * Initialize schema - ensures lines table and FTS exists
   */
  override initSchema(db: Database): void {
    // Initialize cursor tracking
    initCursorSchema(db);

    // Lines table should already exist from db.ts initSchema
    // This is for adapter-specific additions if needed
  }

  /**
   * Get or create prepared insert statement
   */
  private getInsertStatement(db: Database): ReturnType<Database['prepare']> {
    if (!this.insertStatement) {
      this.insertStatement = db.prepare(`
        INSERT OR REPLACE INTO lines
        (session_id, uuid, parent_uuid, line_number, type, subtype, timestamp, slug, role, model, cwd, content, raw, file_path, turn_id, turn_sequence, session_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return this.insertStatement;
  }

  /**
   * Process a single transcript entry
   */
  processEntry(
    entry: Record<string, unknown>,
    db: Database,
    context: EntryContext
  ): ProcessEntryResult {
    try {
      const sessionId = (entry.sessionId as string) || context.sessionId || '';
      const slug = (entry.slug as string) || null;
      const type = (entry.type as string) || 'unknown';

      // Skip non-searchable types (no content, only raw blob)
      if (SKIP_TYPES.has(type)) {
        return { success: true, entryType: type };
      }

      const timestamp = (entry.timestamp as string) || '';
      const content = extractTextFromParsed(entry);

      const message = entry.message as { role?: string; model?: string } | undefined;

      const insertStmt = this.getInsertStatement(db);
      insertStmt.run(
        sessionId,
        (entry.uuid as string) || `line-${context.lineNumber}`,
        (entry.parentUuid as string) || null,
        context.lineNumber,
        type,
        (entry.subtype as string) || null,
        timestamp,
        slug,
        message?.role || null,
        message?.model || null,
        (entry.cwd as string) || null,
        content,
        trimRawTranscriptLine(entry),
        context.filePath,
        null, // turn_id - will be correlated later
        null, // turn_sequence - will be correlated later
        null // session_name - will be correlated later
      );

      return {
        success: true,
        entryType: type,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update the sessions tracking table after processing a file
   * (Maintains backward compatibility with existing db.ts sessions table)
   */
  updateSessionsTable(
    db: Database,
    filePath: string,
    sessionId: string,
    slug: string | null,
    lineCount: number,
    byteOffset: number,
    firstTimestamp: string | null,
    lastTimestamp: string | null,
    isFullIndex: boolean
  ): void {
    if (isFullIndex) {
      // Full index - insert/replace
      db.run(
        `INSERT OR REPLACE INTO sessions (file_path, session_id, slug, line_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          filePath,
          sessionId || 'unknown',
          slug,
          lineCount,
          byteOffset,
          firstTimestamp,
          lastTimestamp,
          new Date().toISOString(),
        ]
      );
    } else {
      // Delta update - update existing
      db.run(
        `UPDATE sessions SET line_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
         WHERE file_path = ?`,
        [lineCount, byteOffset, lastTimestamp, new Date().toISOString(), filePath]
      );
    }
  }

  /**
   * Process file with sessions table update (backward compatible)
   */
  processFileWithSessions(
    filePath: string,
    db: Database,
    fromByteOffset = 0,
    startLineNumber = 1
  ): {
    linesIndexed: number;
    byteOffset: number;
    sessionId: string;
  } {
    const result = this.processFile(filePath, db, {
      fromByteOffset,
      startLineNumber,
    });

    // Update sessions table for backward compatibility
    if (result.sessionId || result.entriesIndexed > 0) {
      // Get the final line count
      const cursor = this.getCursor(db, filePath);
      const lineCount = cursor?.entryCount || startLineNumber - 1 + result.entriesIndexed;

      // Get slug from first entry if available
      let slug: string | null = null;
      try {
        const firstLine = db
          .query('SELECT slug FROM lines WHERE file_path = ? AND slug IS NOT NULL LIMIT 1')
          .get(filePath) as { slug: string } | null;
        slug = firstLine?.slug || null;
      } catch {
        // Ignore
      }

      this.updateSessionsTable(
        db,
        filePath,
        result.sessionId,
        slug,
        lineCount,
        result.byteOffset,
        result.firstTimestamp,
        result.lastTimestamp,
        fromByteOffset === 0
      );
    }

    return {
      linesIndexed: result.entriesIndexed,
      byteOffset: result.byteOffset,
      sessionId: result.sessionId,
    };
  }

  /**
   * Index all transcript files
   */
  async indexAll(
    db: Database,
    onProgress?: (file: string, current: number, total: number, linesIndexed: number) => void
  ): Promise<{ filesIndexed: number; linesIndexed: number }> {
    const files = findTranscriptFilesSync(this.projectsDir);

    let totalFiles = 0;
    let totalLines = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const result = this.processFileWithSessions(file, db, 0, 1);
        totalFiles++;
        totalLines += result.linesIndexed;

        if (onProgress) {
          onProgress(file, i + 1, files.length, result.linesIndexed);
        }
      } catch (err) {
        console.error(`Error indexing ${file}:`, err);
      }
    }

    return { filesIndexed: totalFiles, linesIndexed: totalLines };
  }

  /**
   * Update index with only new content (delta update)
   */
  async updateIndex(
    db: Database,
    onProgress?: (
      file: string,
      current: number,
      total: number,
      newLines: number,
      skipped: boolean
    ) => void
  ): Promise<{ filesChecked: number; filesUpdated: number; newLines: number }> {
    const files = findTranscriptFilesSync(this.projectsDir);

    let filesChecked = 0;
    let filesUpdated = 0;
    let totalNewLines = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      filesChecked++;

      try {
        // Get current cursor state
        const cursor = this.getCursor(db, file);

        // Get current file size
        const fileSize = Bun.file(file).size;

        // Skip if file hasn't grown
        if (cursor && cursor.byteOffset >= fileSize) {
          if (onProgress) {
            onProgress(file, i + 1, files.length, 0, true);
          }
          continue;
        }

        // Index new content only
        const fromOffset = cursor?.byteOffset || 0;
        const startLine = cursor ? cursor.entryCount + 1 : 1;
        const result = this.processFileWithSessions(file, db, fromOffset, startLine);

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

    return { filesChecked, filesUpdated, newLines: totalNewLines };
  }

  /**
   * Get the projects directory
   */
  getProjectsDir(): string {
    return this.projectsDir;
  }

  /**
   * Set the projects directory
   */
  setProjectsDir(dir: string): void {
    this.projectsDir = dir;
  }

  /**
   * Get searchable tables for unified recall
   */
  getSearchableTables(): SearchableTable[] {
    return [
      {
        ftsTable: 'lines_fts',
        sourceTable: 'lines',
        contentColumn: 'content',
        joinColumn: 'id',
        selectColumns: [
          'session_id',
          'slug',
          'line_number',
          'type',
          'timestamp',
          'content',
          'raw',
          'turn_id',
          'turn_sequence',
          'session_name',
        ],
        sourceName: 'Transcript',
        sourceIcon: '📝',
      },
    ];
  }
}

/**
 * Create a TranscriptLinesAdapter instance
 */
export function createTranscriptLinesAdapter(projectsDir?: string): TranscriptLinesAdapter {
  return new TranscriptLinesAdapter(projectsDir);
}
