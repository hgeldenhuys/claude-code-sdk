/**
 * HookEventsAdapter
 *
 * Adapter for indexing Claude Code hook events.
 * Indexes ~/.claude/hooks/**\/*.hooks.jsonl files.
 *
 * This adapter refactors the existing indexHookFile logic from db.ts
 * to use the BaseAdapter architecture.
 */

import type { Database } from 'bun:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BaseAdapter, initCursorSchema } from './base';
import type { EntryContext, ProcessEntryResult, SearchableTable, WatchPath } from './types';

const DEFAULT_HOOKS_DIR = join(process.env.HOME || '~', '.claude', 'hooks');

/**
 * Find all hook event log files in a directory (recursive)
 */
function findHookFilesSync(dir: string): string[] {
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
 * HookEventsAdapter
 *
 * Indexes Claude Code hook events from ~/.claude/hooks
 */
export class HookEventsAdapter extends BaseAdapter {
  readonly name = 'hook-events';
  readonly description = 'Indexes Claude Code hook events (*.hooks.jsonl files)';
  readonly fileExtensions = ['.hooks.jsonl'];

  private hooksDir: string;
  private insertStatement: ReturnType<Database['prepare']> | null = null;

  constructor(hooksDir: string = DEFAULT_HOOKS_DIR) {
    super();
    this.hooksDir = hooksDir;
  }

  /**
   * Watch path returns all *.hooks.jsonl files
   */
  get watchPath(): WatchPath {
    return () => findHookFilesSync(this.hooksDir);
  }

  /**
   * Initialize schema - ensures hook_events table exists
   */
  override initSchema(db: Database): void {
    // Initialize cursor tracking
    initCursorSchema(db);

    // Hook events table should already exist from db.ts initSchema
    // This is for adapter-specific additions if needed
  }

  /**
   * Get or create prepared insert statement
   */
  private getInsertStatement(db: Database): ReturnType<Database['prepare']> {
    if (!this.insertStatement) {
      this.insertStatement = db.prepare(`
        INSERT INTO hook_events
        (session_id, timestamp, event_type, tool_use_id, tool_name, decision, handler_results, input_json, context_json, file_path, line_number, turn_id, turn_sequence, session_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
    }
    return this.insertStatement;
  }

  /**
   * Extract turn info from handler results
   * Handler keys include event type suffix (e.g., turn-tracker-PreToolUse, turn-tracker-PostToolUse)
   */
  private extractTurnInfo(handlerResults: Record<string, unknown>): {
    turnId: string | null;
    turnSequence: number | null;
    sessionName: string | null;
  } {
    let turnTracker: Record<string, unknown> | null = null;
    let sessionNaming: Record<string, unknown> | null = null;

    // Find turn-tracker and session-naming results with any event suffix
    for (const key of Object.keys(handlerResults)) {
      const result = handlerResults[key] as { data?: Record<string, unknown> } | undefined;
      if (key.startsWith('turn-tracker') && result?.data) {
        turnTracker = result.data;
      }
      if (key.startsWith('session-naming') && result?.data) {
        sessionNaming = result.data;
      }
    }

    const turnId = (turnTracker?.turnId as string) || null;
    const turnSequence = turnTracker?.sequence ?? turnTracker?.turnSequence ?? null;
    const sessionName = (sessionNaming?.sessionName as string) || null;

    return {
      turnId,
      turnSequence: turnSequence !== null ? Number(turnSequence) : null,
      sessionName,
    };
  }

  /**
   * Process a single hook event entry
   */
  processEntry(
    entry: Record<string, unknown>,
    db: Database,
    context: EntryContext
  ): ProcessEntryResult {
    try {
      const sessionId = (entry.sessionId as string) || context.sessionId || '';
      const timestamp = (entry.timestamp as string) || '';
      const eventType = (entry.eventType as string) || '';

      // Extract turn info from handler results
      const handlerResults = (entry.handlerResults as Record<string, unknown>) || {};
      const { turnId, turnSequence, sessionName } = this.extractTurnInfo(handlerResults);

      // Also check top-level fields (some events have these directly)
      const finalTurnId = turnId || (entry.turnId as string) || null;
      const finalTurnSequence = turnSequence ?? (entry.turnSequence as number) ?? null;
      const finalSessionName = sessionName || (entry.sessionName as string) || null;

      const insertStmt = this.getInsertStatement(db);
      insertStmt.run(
        sessionId,
        timestamp,
        eventType,
        (entry.toolUseId as string) || null,
        (entry.toolName as string) || null,
        (entry.decision as string) || null,
        Object.keys(handlerResults).length > 0 ? JSON.stringify(handlerResults) : null,
        entry.input ? JSON.stringify(entry.input) : null,
        entry.context ? JSON.stringify(entry.context) : null,
        context.filePath,
        context.lineNumber,
        finalTurnId,
        finalTurnSequence,
        finalSessionName
      );

      return {
        success: true,
        entryType: eventType,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update the hook_files tracking table after processing a file
   * (Maintains backward compatibility with existing db.ts hook_files table)
   */
  updateHookFilesTable(
    db: Database,
    filePath: string,
    sessionId: string,
    eventCount: number,
    byteOffset: number,
    firstTimestamp: string | null,
    lastTimestamp: string | null,
    isFullIndex: boolean
  ): void {
    if (isFullIndex) {
      // Full index - insert/replace
      db.run(
        `INSERT OR REPLACE INTO hook_files (file_path, session_id, event_count, byte_offset, first_timestamp, last_timestamp, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          filePath,
          sessionId || 'unknown',
          eventCount,
          byteOffset,
          firstTimestamp,
          lastTimestamp,
          new Date().toISOString(),
        ]
      );
    } else {
      // Delta update - update existing
      db.run(
        `UPDATE hook_files SET event_count = ?, byte_offset = ?, last_timestamp = ?, indexed_at = ?
         WHERE file_path = ?`,
        [eventCount, byteOffset, lastTimestamp, new Date().toISOString(), filePath]
      );
    }
  }

  /**
   * Process file with hook_files table update (backward compatible)
   */
  processFileWithHookFiles(
    filePath: string,
    db: Database,
    fromByteOffset = 0,
    startLineNumber = 1
  ): {
    eventsIndexed: number;
    byteOffset: number;
    sessionId: string;
  } {
    const result = this.processFile(filePath, db, {
      fromByteOffset,
      startLineNumber,
    });

    // Update hook_files table for backward compatibility
    if (result.sessionId || result.entriesIndexed > 0) {
      // Get the final event count
      const cursor = this.getCursor(db, filePath);
      const eventCount = cursor?.entryCount || startLineNumber - 1 + result.entriesIndexed;

      this.updateHookFilesTable(
        db,
        filePath,
        result.sessionId,
        eventCount,
        result.byteOffset,
        result.firstTimestamp,
        result.lastTimestamp,
        fromByteOffset === 0
      );
    }

    return {
      eventsIndexed: result.entriesIndexed,
      byteOffset: result.byteOffset,
      sessionId: result.sessionId,
    };
  }

  /**
   * Index all hook event files
   */
  async indexAll(
    db: Database,
    onProgress?: (file: string, current: number, total: number, eventsIndexed: number) => void
  ): Promise<{ filesIndexed: number; eventsIndexed: number }> {
    const files = findHookFilesSync(this.hooksDir);

    let totalFiles = 0;
    let totalEvents = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      try {
        const result = this.processFileWithHookFiles(file, db, 0, 1);
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
   * Update index with only new content (delta update)
   */
  async updateIndex(
    db: Database,
    onProgress?: (
      file: string,
      current: number,
      total: number,
      newEvents: number,
      skipped: boolean
    ) => void
  ): Promise<{ filesChecked: number; filesUpdated: number; newEvents: number }> {
    const files = findHookFilesSync(this.hooksDir);

    let filesChecked = 0;
    let filesUpdated = 0;
    let totalNewEvents = 0;

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
        const result = this.processFileWithHookFiles(file, db, fromOffset, startLine);

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
   * Get the hooks directory
   */
  getHooksDir(): string {
    return this.hooksDir;
  }

  /**
   * Set the hooks directory
   */
  setHooksDir(dir: string): void {
    this.hooksDir = dir;
  }

  /**
   * Get searchable tables for unified recall
   */
  getSearchableTables(): SearchableTable[] {
    return [
      {
        ftsTable: 'hook_events_fts',
        sourceTable: 'hook_events',
        contentColumn: 'content',
        joinColumn: 'id',
        selectColumns: [
          'session_id',
          'timestamp',
          'event_type',
          'tool_use_id',
          'tool_name',
          'decision',
          'input_json',
          'line_number',
          'turn_id',
          'turn_sequence',
          'session_name',
        ],
        sourceName: 'Hook Event',
        sourceIcon: '🪝',
      },
    ];
  }
}

/**
 * Create a HookEventsAdapter instance
 */
export function createHookEventsAdapter(hooksDir?: string): HookEventsAdapter {
  return new HookEventsAdapter(hooksDir);
}
