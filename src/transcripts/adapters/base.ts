/**
 * BaseAdapter Abstract Class
 *
 * Provides common functionality for transcript adapters including:
 * - Cursor tracking (byte offset per file, stored in adapter_cursors SQLite table)
 * - Metrics collection
 * - Common JSONL parsing logic
 */

import type { Database } from 'bun:sqlite';
import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import type {
  AdapterCursor,
  AdapterMetrics,
  EntryContext,
  ProcessEntryResult,
  ProcessFileOptions,
  ProcessFileResult,
  TranscriptAdapter,
  WatchPath,
} from './types';

/**
 * Initialize the adapter_cursors table for cursor tracking
 */
export function initCursorSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS adapter_cursors (
      file_path TEXT NOT NULL,
      adapter_name TEXT NOT NULL,
      byte_offset INTEGER NOT NULL DEFAULT 0,
      entry_count INTEGER NOT NULL DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (file_path, adapter_name)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_adapter_cursors_adapter ON adapter_cursors(adapter_name)');
}

/**
 * BaseAdapter - Abstract base class for transcript adapters
 *
 * Provides:
 * - Cursor tracking for delta updates
 * - JSONL file parsing with partial line handling
 * - Metrics collection
 * - File processing with transaction support
 */
export abstract class BaseAdapter implements TranscriptAdapter {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly watchPath: WatchPath;
  abstract readonly fileExtensions: string[];

  protected metrics: AdapterMetrics = this.createEmptyMetrics();

  /**
   * Process a single entry - must be implemented by subclasses
   */
  abstract processEntry(
    entry: Record<string, unknown>,
    db: Database,
    context: EntryContext
  ): ProcessEntryResult;

  /**
   * Create empty metrics object
   */
  protected createEmptyMetrics(): AdapterMetrics {
    return {
      entriesProcessed: 0,
      entriesFailed: 0,
      entriesByType: {},
      bytesProcessed: 0,
      startTime: new Date(),
      endTime: undefined,
      filesProcessed: 0,
    };
  }

  /**
   * Get current metrics
   */
  getMetrics(): AdapterMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = this.createEmptyMetrics();
  }

  /**
   * Initialize adapter schema - subclasses can override
   */
  initSchema(db: Database): void {
    initCursorSchema(db);
  }

  /**
   * Get cursor state for a file
   */
  getCursor(db: Database, filePath: string): AdapterCursor | null {
    const row = db
      .query(
        `SELECT file_path, adapter_name, byte_offset, entry_count, first_timestamp, last_timestamp, updated_at
         FROM adapter_cursors
         WHERE file_path = ? AND adapter_name = ?`
      )
      .get(filePath, this.name) as {
      file_path: string;
      adapter_name: string;
      byte_offset: number;
      entry_count: number;
      first_timestamp: string | null;
      last_timestamp: string | null;
      updated_at: string;
    } | null;

    if (!row) return null;

    return {
      filePath: row.file_path,
      adapterName: row.adapter_name,
      byteOffset: row.byte_offset,
      entryCount: row.entry_count,
      firstTimestamp: row.first_timestamp,
      lastTimestamp: row.last_timestamp,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Save cursor state for a file
   */
  saveCursor(db: Database, cursor: Omit<AdapterCursor, 'adapterName'>): void {
    db.run(
      `INSERT OR REPLACE INTO adapter_cursors
       (file_path, adapter_name, byte_offset, entry_count, first_timestamp, last_timestamp, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        cursor.filePath,
        this.name,
        cursor.byteOffset,
        cursor.entryCount,
        cursor.firstTimestamp,
        cursor.lastTimestamp,
        cursor.updatedAt,
      ]
    );
  }

  /**
   * Delete cursor for a file
   */
  deleteCursor(db: Database, filePath: string): void {
    db.run('DELETE FROM adapter_cursors WHERE file_path = ? AND adapter_name = ?', [
      filePath,
      this.name,
    ]);
  }

  /**
   * Read file content from a byte offset
   *
   * @param filePath - Path to the file
   * @param fromByteOffset - Byte offset to start reading from
   * @returns Object with text content and file size, or null on error
   */
  protected readFileFromOffset(
    filePath: string,
    fromByteOffset: number
  ): { text: string; fileSize: number } | null {
    const file = Bun.file(filePath);
    const fileSize = file.size;

    // If we're already at or past the file size, nothing new to index
    if (fromByteOffset >= fileSize) {
      return { text: '', fileSize };
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
        // Read entire file
        text = readFileSync(filePath, 'utf-8');
      }
    } catch {
      return null;
    }

    return { text, fileSize };
  }

  /**
   * Parse JSONL content into lines, handling partial lines at the start
   *
   * @param text - Raw text content
   * @param fromByteOffset - Whether reading from an offset (affects partial line handling)
   * @returns Array of raw JSON lines
   */
  protected parseJsonlLines(text: string, fromByteOffset: number): string[] {
    if (!text.trim()) {
      return [];
    }

    let rawLines = text.split('\n');

    // Handle partial line at start (if reading from offset, first "line" may be incomplete)
    if (fromByteOffset > 0 && rawLines.length > 0) {
      // First chunk might be a partial line from the previous read
      // Check if it starts with '{' (valid JSON start)
      const firstLine = rawLines[0] || '';
      if (!firstLine.startsWith('{')) {
        // Skip this partial line
        rawLines = rawLines.slice(1);
      }
    }

    // Remove empty last line if exists
    if (rawLines.length > 0 && !rawLines[rawLines.length - 1]?.trim()) {
      rawLines.pop();
    }

    return rawLines;
  }

  /**
   * Process a file with common JSONL handling
   * Subclasses can override for custom behavior
   */
  processFile(filePath: string, db: Database, options: ProcessFileOptions = {}): ProcessFileResult {
    const fromByteOffset = options.fromByteOffset ?? 0;
    const startLineNumber = options.startLineNumber ?? 1;

    // Read file content
    const content = this.readFileFromOffset(filePath, fromByteOffset);
    if (!content) {
      return {
        entriesIndexed: 0,
        byteOffset: fromByteOffset,
        sessionId: '',
        firstTimestamp: null,
        lastTimestamp: null,
        entriesByType: {},
      };
    }

    const { text, fileSize } = content;

    // If no new content, return early
    if (!text.trim()) {
      return {
        entriesIndexed: 0,
        byteOffset: fileSize,
        sessionId: '',
        firstTimestamp: null,
        lastTimestamp: null,
        entriesByType: {},
      };
    }

    // Parse JSONL lines
    const rawLines = this.parseJsonlLines(text, fromByteOffset);

    let indexedCount = 0;
    let sessionId = '';
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let lineNumber = startLineNumber;
    const entriesByType: Record<string, number> = {};

    // Process in a transaction for performance
    const transaction = db.transaction(() => {
      for (let i = 0; i < rawLines.length; i++) {
        const rawLine = rawLines[i];
        if (!rawLine?.trim()) continue;

        try {
          const parsed = JSON.parse(rawLine);

          // Track session ID and timestamps
          if (parsed.sessionId) {
            sessionId = parsed.sessionId;
          }
          const timestamp = parsed.timestamp || '';
          if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
          if (timestamp) lastTimestamp = timestamp;

          // Process the entry
          const context: EntryContext = {
            filePath,
            lineNumber,
            rawLine,
            sessionId,
            processedAt: new Date().toISOString(),
          };

          const result = this.processEntry(parsed, db, context);

          if (result.success) {
            indexedCount++;
            this.metrics.entriesProcessed++;

            // Track by type
            const entryType = result.entryType || parsed.type || 'unknown';
            entriesByType[entryType] = (entriesByType[entryType] || 0) + 1;
            this.metrics.entriesByType[entryType] =
              (this.metrics.entriesByType[entryType] || 0) + 1;
          } else {
            this.metrics.entriesFailed++;
          }

          lineNumber++;

          if (options.onProgress && i % 1000 === 0) {
            options.onProgress(i, rawLines.length);
          }
        } catch {
          // Skip malformed lines
          this.metrics.entriesFailed++;
          lineNumber++;
        }
      }
    });

    transaction();

    // Update cursor
    this.saveCursor(db, {
      filePath,
      byteOffset: fileSize,
      entryCount: lineNumber - 1,
      firstTimestamp: fromByteOffset === 0 ? firstTimestamp : undefined,
      lastTimestamp,
      updatedAt: new Date().toISOString(),
    });

    // Update metrics
    this.metrics.bytesProcessed += fileSize - fromByteOffset;
    this.metrics.filesProcessed++;

    return {
      entriesIndexed: indexedCount,
      byteOffset: fileSize,
      sessionId,
      firstTimestamp,
      lastTimestamp,
      entriesByType,
    };
  }

  /**
   * Process a file with delta detection (only new content)
   */
  processFileDelta(
    filePath: string,
    db: Database,
    options?: Omit<ProcessFileOptions, 'fromByteOffset' | 'startLineNumber'>
  ): ProcessFileResult {
    // Get current cursor state
    const cursor = this.getCursor(db, filePath);

    // Get current file size
    const fileSize = Bun.file(filePath).size;

    // Skip if file hasn't grown
    if (cursor && cursor.byteOffset >= fileSize) {
      return {
        entriesIndexed: 0,
        byteOffset: cursor.byteOffset,
        sessionId: '',
        firstTimestamp: null,
        lastTimestamp: null,
        entriesByType: {},
      };
    }

    // Process from last offset
    const fromOffset = cursor?.byteOffset || 0;
    const startLine = cursor ? cursor.entryCount + 1 : 1;

    return this.processFile(filePath, db, {
      ...options,
      fromByteOffset: fromOffset,
      startLineNumber: startLine,
    });
  }

  /**
   * Resolve watch paths to actual file paths
   */
  async resolveWatchPaths(): Promise<string[]> {
    const watchPath = this.watchPath;

    if (typeof watchPath === 'string') {
      // Glob pattern - use Bun.glob
      const { Glob } = await import('bun');
      const glob = new Glob(watchPath);
      const files: string[] = [];
      for await (const file of glob.scan()) {
        files.push(file);
      }
      return files;
    }

    // Function that returns paths
    const result = watchPath();
    if (result instanceof Promise) {
      return result;
    }
    return result;
  }

  /**
   * Check if this adapter handles a specific file
   */
  handlesFile(filePath: string): boolean {
    for (const ext of this.fileExtensions) {
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      if (filePath.endsWith(normalizedExt)) {
        return true;
      }
    }
    return false;
  }
}
