/**
 * Session Naming Types
 *
 * Name-centric schema where names are primary identifiers
 * and session IDs are secondary (can change on compact/clear).
 */

import type { SessionSource } from '../types';

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
}

/**
 * Database schema for session storage
 */
export interface SessionDatabase {
  version: '2.0';
  /** Map of name -> session info (name-centric) */
  names: Record<string, NamedSession>;
  /** Reverse index: sessionId -> name (for O(1) lookups) */
  sessionIndex: Record<string, string>;
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
