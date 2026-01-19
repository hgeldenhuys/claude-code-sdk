/**
 * Transcript Adapter Types
 *
 * Pluggable adapter architecture for the transcript daemon that allows
 * multiple data sources to be indexed into SQLite.
 */

import type { Database } from 'bun:sqlite';

/**
 * Result from processing a single entry
 */
export interface ProcessEntryResult {
  /** Whether the entry was successfully processed */
  success: boolean;
  /** Error message if processing failed */
  error?: string;
  /** Type of entry processed (for metrics) */
  entryType?: string;
}

/**
 * Metrics collected during adapter processing
 */
export interface AdapterMetrics {
  /** Total entries processed successfully */
  entriesProcessed: number;
  /** Total entries that failed processing */
  entriesFailed: number;
  /** Breakdown by entry type */
  entriesByType: Record<string, number>;
  /** Total bytes processed */
  bytesProcessed: number;
  /** Processing start time */
  startTime: Date;
  /** Processing end time */
  endTime?: Date;
  /** Files processed in this run */
  filesProcessed: number;
}

/**
 * Cursor state for tracking progress through a file
 */
export interface AdapterCursor {
  /** Path to the file being tracked */
  filePath: string;
  /** Adapter name that owns this cursor */
  adapterName: string;
  /** Byte offset in the file (for delta updates) */
  byteOffset: number;
  /** Line/entry count processed */
  entryCount: number;
  /** First timestamp encountered */
  firstTimestamp: string | null;
  /** Last timestamp encountered */
  lastTimestamp: string | null;
  /** When this cursor was last updated */
  updatedAt: string;
}

/**
 * Result from processing a file
 */
export interface ProcessFileResult {
  /** Number of entries indexed */
  entriesIndexed: number;
  /** New byte offset after processing */
  byteOffset: number;
  /** Session ID if applicable */
  sessionId: string;
  /** First timestamp in processed content */
  firstTimestamp: string | null;
  /** Last timestamp in processed content */
  lastTimestamp: string | null;
  /** Per-type breakdown */
  entriesByType: Record<string, number>;
}

/**
 * Options for processing a file
 */
export interface ProcessFileOptions {
  /** Byte offset to start reading from (0 for full index) */
  fromByteOffset?: number;
  /** Line number to start from (1 for full index) */
  startLineNumber?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number) => void;
}

/**
 * Watch path configuration - can be a static string or a function that returns paths
 */
export type WatchPath = string | (() => string[]) | (() => Promise<string[]>);

/**
 * TranscriptAdapter interface
 *
 * Adapters implement this interface to provide custom data sources
 * that can be indexed into the transcript SQLite database.
 *
 * Built-in adapters:
 * - transcript-lines: Indexes ~/.claude/projects/**\/transcript.jsonl
 * - hook-events: Indexes ~/.claude/hooks/**\/*.hooks.jsonl
 *
 * Custom adapters can index any JSONL or similar data source.
 */
export interface TranscriptAdapter {
  /**
   * Unique name for this adapter (e.g., 'transcript-lines', 'hook-events', 'weave-knowledge')
   */
  readonly name: string;

  /**
   * Human-readable description of what this adapter indexes
   */
  readonly description: string;

  /**
   * Watch path(s) for file discovery.
   * Can be:
   * - A glob pattern string (e.g., '~/.claude/projects/**\/transcript.jsonl')
   * - A function returning an array of file paths
   * - An async function returning an array of file paths
   */
  readonly watchPath: WatchPath;

  /**
   * File extension(s) this adapter handles (for file filtering)
   */
  readonly fileExtensions: string[];

  /**
   * Process a single entry from a file.
   * Called for each line/entry in the file.
   *
   * @param entry - Parsed JSON entry from the file
   * @param db - Database instance for inserting data
   * @param context - Processing context (file path, line number, etc.)
   * @returns Result indicating success/failure
   */
  processEntry(
    entry: Record<string, unknown>,
    db: Database,
    context: EntryContext
  ): ProcessEntryResult;

  /**
   * Process an entire file (optional optimization).
   * If not implemented, the base class will call processEntry for each line.
   *
   * @param filePath - Path to the file
   * @param db - Database instance
   * @param options - Processing options (byte offset, etc.)
   * @returns Result with entries indexed and new byte offset
   */
  processFile?(filePath: string, db: Database, options?: ProcessFileOptions): ProcessFileResult;

  /**
   * Initialize adapter-specific schema (optional).
   * Called once when the adapter is registered.
   *
   * @param db - Database instance
   */
  initSchema?(db: Database): void;

  /**
   * Called when the adapter is registered
   */
  onRegister?(): void;

  /**
   * Called when the adapter is unregistered
   */
  onUnregister?(): void;

  /**
   * Get current metrics for this adapter
   */
  getMetrics(): AdapterMetrics;

  /**
   * Reset metrics to initial state
   */
  resetMetrics(): void;

  /**
   * Get cursor state for a file (optional).
   * Used by daemon for delta updates.
   *
   * @param db - Database instance
   * @param filePath - Path to the file
   * @returns Cursor state or null if not tracked
   */
  getCursor?(db: Database, filePath: string): AdapterCursor | null;

  /**
   * Get searchable tables for unified recall (optional).
   * Adapters declare their FTS tables so the recall command can
   * search across all data sources.
   *
   * @returns Array of searchable table configurations
   */
  getSearchableTables?(): SearchableTable[];
}

/**
 * Context provided to processEntry
 */
export interface EntryContext {
  /** Path to the file being processed */
  filePath: string;
  /** Line number within the file (1-based) */
  lineNumber: number;
  /** Raw line content */
  rawLine: string;
  /** Session ID if known */
  sessionId?: string;
  /** Timestamp of processing */
  processedAt: string;
}

/**
 * Adapter registration options
 */
export interface AdapterRegistrationOptions {
  /** Whether to initialize schema on registration (default: true) */
  initSchema?: boolean;
  /** Whether to enable this adapter by default (default: true) */
  enabled?: boolean;
}

/**
 * Registered adapter with metadata
 */
export interface RegisteredAdapter {
  /** The adapter instance */
  adapter: TranscriptAdapter;
  /** Registration options */
  options: Required<AdapterRegistrationOptions>;
  /** When the adapter was registered */
  registeredAt: Date;
  /** Whether the adapter is currently enabled */
  enabled: boolean;
}

/**
 * Daemon configuration for running adapters
 */
export interface DaemonConfig {
  /** Debounce delay in milliseconds for file changes (default: 100) */
  debounceMs?: number;
  /** Interval for polling file changes in milliseconds (default: 1000) */
  pollIntervalMs?: number;
  /** Maximum concurrent file processing (default: 4) */
  maxConcurrency?: number;
  /** Adapters to run (default: all registered) */
  adapterNames?: string[];
  /** Callback when an adapter processes new content */
  onUpdate?: (adapterName: string, filePath: string, entriesIndexed: number) => void;
  /** Callback for errors */
  onError?: (adapterName: string, error: Error) => void;
}

/**
 * Daemon state
 */
export interface DaemonState {
  /** Whether the daemon is running */
  running: boolean;
  /** When the daemon was started */
  startedAt: Date | null;
  /** Adapters being watched */
  activeAdapters: string[];
  /** File watchers by adapter */
  watchers: Map<string, () => void>;
  /** Total entries indexed since start */
  totalEntriesIndexed: number;
  /** Total errors since start */
  totalErrors: number;
}

/**
 * Searchable table configuration for unified recall.
 * Adapters declare their FTS tables so recall can search across all sources.
 */
export interface SearchableTable {
  /** FTS table name (e.g., 'lines_fts', 'hook_events_fts') */
  ftsTable: string;
  /** Source table with full data (e.g., 'lines', 'hook_events') */
  sourceTable: string;
  /** Column in FTS table containing searchable content */
  contentColumn: string;
  /** Column mapping: FTS rowid join column in source table */
  joinColumn: string;
  /** Columns to select from source table */
  selectColumns: string[];
  /** Human-readable source name for display (e.g., 'Transcript', 'Hook Event') */
  sourceName: string;
  /** Icon for display */
  sourceIcon: string;
}

/**
 * Unified search result from any adapter source
 */
export interface UnifiedSearchResult {
  /** Source adapter name */
  adapterName: string;
  /** Human-readable source name */
  sourceName: string;
  /** Source icon */
  sourceIcon: string;
  /** Session ID */
  sessionId: string;
  /** Session slug/name if available */
  slug: string | null;
  /** Timestamp of the entry */
  timestamp: string;
  /** Type of entry (e.g., 'user', 'assistant', 'PreToolUse') */
  entryType: string;
  /** Line number or entry ID */
  lineNumber: number;
  /** Matched text snippet with highlights */
  matchedText: string;
  /** Full content */
  content: string;
  /** Raw JSON if available */
  raw?: string;
  /** Additional adapter-specific data */
  extra?: Record<string, unknown>;
}
