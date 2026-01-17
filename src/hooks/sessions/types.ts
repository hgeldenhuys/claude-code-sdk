/**
 * Session Naming Types
 *
 * Name-centric schema where names are primary identifiers
 * and session IDs are secondary (can change on compact/clear).
 *
 * v3.0 adds:
 * - Machine namespacing for multi-machine support
 * - Centralized storage at ~/.claude/global-sessions.json
 * - Explicit transcriptId field
 */

import type { SessionSource } from '../types';

// ============================================================================
// Machine Types (v3.0)
// ============================================================================

/**
 * Information about a registered machine
 */
export interface MachineInfo {
  /** Unique machine ID (UUID stored in ~/.claude/machine-id) */
  id: string;
  /** Optional human-friendly alias (e.g., "macbook-pro", "work-desktop") */
  alias?: string;
  /** Hostname of the machine */
  hostname: string;
  /** When this machine was first registered */
  registeredAt: string;
  /** Last time this machine accessed the database */
  lastSeen: string;
}

// ============================================================================
// Core Types
// ============================================================================

/**
 * A record of a session ID associated with a name
 */
export interface SessionRecord {
  /** The UUID session ID */
  sessionId: string;
  /** When this session ID was first seen */
  timestamp: string;
  /** How the session was initiated */
  source: SessionSource;
  /** Path to the transcript file */
  transcriptPath?: string;
  /** Explicit transcript UUID (v3.0) - not parsed from path */
  transcriptId?: string;
}

/**
 * A named session entry (name-centric)
 *
 * Names are stable across compactions; session IDs change.
 * Multiple session IDs can be associated with one name.
 */
export interface NamedSession {
  /** Human-friendly name (e.g., "brave-elephant") */
  name: string;
  /** Current active session ID for this name */
  currentSessionId: string;
  /** History of all session IDs that have used this name */
  history: SessionRecord[];
  /** When this name was first created */
  created: string;
  /** Last time this name was accessed */
  lastAccessed: string;
  /** Whether this was manually assigned */
  manual: boolean;
  /** Optional description/notes */
  description?: string;
  /** Working directory where this session runs */
  cwd?: string;
  /** Machine ID that owns this session (v3.0) */
  machineId: string;
}

/**
 * Database schema for session storage (v2.0 - legacy, per-project)
 */
export interface SessionDatabase {
  version: '2.0';
  /** Map of name -> session info (name-centric) */
  names: Record<string, NamedSession>;
  /** Reverse index: sessionId -> name (for O(1) lookups) */
  sessionIndex: Record<string, string>;
  /**
   * Track the latest session name per working directory.
   * Enables recovery after /clear creates a new session ID.
   * Key: normalized cwd path, Value: session name
   */
  latestByDirectory?: Record<string, string>;
}

/**
 * Global session database schema (v3.0 - centralized at ~/.claude/global-sessions.json)
 *
 * Key changes from v2.0:
 * - Machine registry for multi-machine support
 * - Directory index for efficient project-based queries
 * - All sessions stored centrally with machine namespacing
 */
export interface GlobalSessionDatabase {
  version: '3.0';
  /** Registry of all machines that have accessed this database */
  machines: Record<string, MachineInfo>;
  /** ID of the current machine (matches a key in machines) */
  currentMachineId: string;
  /** Map of name -> session info (name-centric, includes machineId) */
  names: Record<string, NamedSession>;
  /** Reverse index: sessionId -> name (for O(1) lookups) */
  sessionIndex: Record<string, string>;
  /**
   * Index of sessions by directory path.
   * Key: normalized cwd path, Value: array of session names in that directory
   */
  directoryIndex: Record<string, string[]>;
  /**
   * Track the latest session name per working directory.
   * Enables recovery after /clear creates a new session ID.
   * Key: normalized cwd path, Value: session name
   */
  latestByDirectory?: Record<string, string>;
}

// ============================================================================
// Configuration
// ============================================================================

export interface SessionStoreConfig {
  /** Path to sessions.json file */
  storagePath?: string;
  /** Custom name generator function */
  nameGenerator?: () => string;
  /** Max age for sessions before cleanup (ms) */
  maxAge?: number;
  /** Pre-defined manual names: sessionId -> name */
  manualNames?: Record<string, string>;
  /**
   * Skip machine registration on load (performance optimization).
   * Use this in read-only scenarios or when you know the machine is already registered.
   * Avoids a disk write on every SessionStore creation.
   * @default false
   */
  skipMachineRegistration?: boolean;
}

export interface NameGeneratorConfig {
  /** Adjectives dictionary */
  adjectives?: string[];
  /** Nouns dictionary (animals by default) */
  nouns?: string[];
  /** Separator between words */
  separator?: string;
  /** Max collision attempts before using timestamp */
  maxCollisionAttempts?: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface SessionInfo {
  name: string;
  sessionId: string;
  created: string;
  lastAccessed: string;
  source: SessionSource;
  manual: boolean;
  historyCount: number;
  cwd?: string;
  description?: string;
  /** Machine ID that owns this session (v3.0) */
  machineId?: string;
  /** Path to the transcript file */
  transcriptPath?: string;
}

export interface SessionListFilter {
  /** Filter by name pattern (glob) */
  namePattern?: string;
  /** Filter by source type */
  source?: SessionSource;
  /** Filter by manual/auto */
  manual?: boolean;
  /** Only sessions accessed after this date */
  accessedAfter?: Date;
  /** Only sessions created after this date */
  createdAfter?: Date;
  /** Sort by field */
  sortBy?: 'name' | 'created' | 'lastAccessed';
  /** Sort direction */
  sortDir?: 'asc' | 'desc';
  /** Limit results */
  limit?: number;
}

export interface TrackingResult {
  /** The session name */
  name: string;
  /** The current session ID */
  sessionId: string;
  /** Whether this was a new name or existing */
  isNew: boolean;
  /** Whether the session ID changed (e.g., after compact) */
  sessionIdChanged: boolean;
  /** Previous session ID if changed */
  previousSessionId?: string;
}

/**
 * Result of migrating sessions from a project
 */
export interface MigrationResult {
  /** Number of sessions successfully imported */
  imported: number;
  /** Number of sessions skipped (already exist) */
  skipped: number;
  /** Number of sessions that failed to import */
  errors: number;
  /** Details of each migration attempt */
  details: Array<{
    name: string;
    status: 'imported' | 'skipped' | 'error';
    reason?: string;
  }>;
}
