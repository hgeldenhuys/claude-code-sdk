/**
 * Session Store
 *
 * Name-centric session storage where names are stable identifiers
 * and session IDs can change (e.g., on compact/clear).
 *
 * Key design decisions:
 * - Names are primary keys, session IDs are secondary
 * - Multiple session IDs can map to one name (history)
 * - Reverse index for O(1) lookups both directions
 * - Last hook event to fire "wins" the name (enables fork/snapshot pattern)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import type {
  SessionDatabase,
  SessionStoreConfig,
  NamedSession,
  SessionRecord,
  SessionInfo,
  SessionListFilter,
  TrackingResult,
} from './types';
import type { SessionSource } from '../types';
import { NameGenerator, generateUniqueName } from './namer';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STORAGE_PATH = '.claude/sessions.json';
const DATABASE_VERSION = '2.0';

// ============================================================================
// Session Store
// ============================================================================

export class SessionStore {
  private db: SessionDatabase;
  private storagePath: string;
  private nameGenerator: NameGenerator;
  private maxAge: number | null;
  private dirty = false;

  constructor(config: SessionStoreConfig = {}) {
    this.storagePath = config.storagePath ?? this.resolveStoragePath();
    this.nameGenerator = new NameGenerator();
    this.maxAge = config.maxAge ?? null;
    this.db = this.load();

    // Apply manual names if provided
    if (config.manualNames) {
      for (const [sessionId, name] of Object.entries(config.manualNames)) {
        this.setManualName(sessionId, name);
      }
    }
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Track a session - the main entry point for hook integration.
   *
   * Call this on ANY hook event to keep the name→ID mapping current.
   * The last hook event to fire "wins" the name.
   */
  track(
    sessionId: string,
    options: {
      source?: SessionSource;
      transcriptPath?: string;
      cwd?: string;
      name?: string; // Force a specific name
    } = {}
  ): TrackingResult {
    const { source = 'startup', transcriptPath, cwd, name: forcedName } = options;
    const now = new Date().toISOString();

    // Check if this session ID already has a name
    const existingName = this.db.sessionIndex[sessionId];
    if (existingName && !forcedName) {
      // Session ID already tracked - just update lastAccessed
      const session = this.db.names[existingName];
      if (session) {
        session.lastAccessed = now;
        session.currentSessionId = sessionId;
        if (cwd) session.cwd = cwd;
        this.dirty = true;
        this.save();

        return {
          name: existingName,
          sessionId,
          isNew: false,
          sessionIdChanged: false,
        };
      }
    }

    // Determine the name to use
    let name: string;
    let isNew = true;
    let sessionIdChanged = false;
    let previousSessionId: string | undefined;

    if (forcedName) {
      name = forcedName;
      // Check if this name already exists
      const existingSession = this.db.names[name];
      if (existingSession) {
        isNew = false;
        previousSessionId = existingSession.currentSessionId;
        sessionIdChanged = previousSessionId !== sessionId;
      }
    } else {
      // Generate a new unique name
      const existingNames = new Set(Object.keys(this.db.names));
      name = generateUniqueName(existingNames);
    }

    // Create or update the named session
    const record: SessionRecord = {
      sessionId,
      timestamp: now,
      source,
      transcriptPath,
    };

    const existingNamedSession = this.db.names[name];
    if (existingNamedSession) {
      // Existing name - add to history, update current
      // Remove old session ID from index if it changed
      if (existingNamedSession.currentSessionId !== sessionId) {
        delete this.db.sessionIndex[existingNamedSession.currentSessionId];
      }

      existingNamedSession.currentSessionId = sessionId;
      existingNamedSession.lastAccessed = now;
      existingNamedSession.history.push(record);
      if (cwd) existingNamedSession.cwd = cwd;
    } else {
      // New name
      this.db.names[name] = {
        name,
        currentSessionId: sessionId,
        history: [record],
        created: now,
        lastAccessed: now,
        manual: !!forcedName,
        cwd,
      };
    }

    // Update reverse index
    this.db.sessionIndex[sessionId] = name;

    this.dirty = true;
    this.save();

    return {
      name,
      sessionId,
      isNew,
      sessionIdChanged,
      previousSessionId,
    };
  }

  /**
   * Get session name by session ID
   */
  getName(sessionId: string): string | undefined {
    return this.db.sessionIndex[sessionId];
  }

  /**
   * Get current session ID by name
   */
  getSessionId(name: string): string | undefined {
    return this.db.names[name]?.currentSessionId;
  }

  /**
   * Get full session info by name
   */
  getByName(name: string): SessionInfo | undefined {
    const session = this.db.names[name];
    if (!session) return undefined;

    const latestRecord = session.history[session.history.length - 1];
    return {
      name: session.name,
      sessionId: session.currentSessionId,
      created: session.created,
      lastAccessed: session.lastAccessed,
      source: latestRecord?.source ?? 'startup',
      manual: session.manual,
      historyCount: session.history.length,
      cwd: session.cwd,
      description: session.description,
    };
  }

  /**
   * Get full session info by session ID
   */
  getBySessionId(sessionId: string): SessionInfo | undefined {
    const name = this.db.sessionIndex[sessionId];
    if (!name) return undefined;
    return this.getByName(name);
  }

  /**
   * Rename a session
   */
  rename(sessionIdOrName: string, newName: string): void {
    // Normalize new name
    newName = this.nameGenerator.normalizeName(newName);
    if (!this.nameGenerator.isValidName(newName)) {
      throw new Error(`Invalid name format: ${newName}`);
    }

    // Find the session
    let oldName: string | undefined;
    if (this.db.names[sessionIdOrName]) {
      oldName = sessionIdOrName;
    } else {
      oldName = this.db.sessionIndex[sessionIdOrName];
    }

    if (!oldName) {
      throw new Error(`Session not found: ${sessionIdOrName}`);
    }

    // Check for collision
    if (this.db.names[newName] && newName !== oldName) {
      throw new Error(`Name already exists: ${newName}`);
    }

    // Perform rename
    const session = this.db.names[oldName];
    if (!session) {
      throw new Error(`Session not found: ${oldName}`);
    }

    session.name = newName;
    session.manual = true;
    session.lastAccessed = new Date().toISOString();

    // Update data structures
    delete this.db.names[oldName];
    this.db.names[newName] = session;

    // Update reverse index for all session IDs in history
    for (const record of session.history) {
      if (this.db.sessionIndex[record.sessionId] === oldName) {
        this.db.sessionIndex[record.sessionId] = newName;
      }
    }
    this.db.sessionIndex[session.currentSessionId] = newName;

    this.dirty = true;
    this.save();
  }

  /**
   * Set a description for a session
   */
  setDescription(sessionIdOrName: string, description: string): void {
    const name = this.db.names[sessionIdOrName]
      ? sessionIdOrName
      : this.db.sessionIndex[sessionIdOrName];

    if (!name || !this.db.names[name]) {
      throw new Error(`Session not found: ${sessionIdOrName}`);
    }

    this.db.names[name].description = description;
    this.dirty = true;
    this.save();
  }

  /**
   * List all sessions with optional filtering
   */
  list(filter: SessionListFilter = {}): SessionInfo[] {
    let sessions = Object.values(this.db.names).map((session) => {
      const latestRecord = session.history[session.history.length - 1];
      return {
        name: session.name,
        sessionId: session.currentSessionId,
        created: session.created,
        lastAccessed: session.lastAccessed,
        source: latestRecord?.source ?? 'startup',
        manual: session.manual,
        historyCount: session.history.length,
        cwd: session.cwd,
        description: session.description,
      } as SessionInfo;
    });

    // Apply filters
    if (filter.namePattern) {
      const pattern = new RegExp(filter.namePattern.replace(/\*/g, '.*'));
      sessions = sessions.filter((s) => pattern.test(s.name));
    }
    if (filter.source) {
      sessions = sessions.filter((s) => s.source === filter.source);
    }
    if (filter.manual !== undefined) {
      sessions = sessions.filter((s) => s.manual === filter.manual);
    }
    if (filter.accessedAfter) {
      const cutoff = filter.accessedAfter.toISOString();
      sessions = sessions.filter((s) => s.lastAccessed >= cutoff);
    }
    if (filter.createdAfter) {
      const cutoff = filter.createdAfter.toISOString();
      sessions = sessions.filter((s) => s.created >= cutoff);
    }

    // Sort
    const sortBy = filter.sortBy ?? 'lastAccessed';
    const sortDir = filter.sortDir ?? 'desc';
    sessions.sort((a, b) => {
      const aVal = a[sortBy] ?? '';
      const bVal = b[sortBy] ?? '';
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    // Limit
    if (filter.limit) {
      sessions = sessions.slice(0, filter.limit);
    }

    return sessions;
  }

  /**
   * Delete a session by name or session ID
   */
  delete(sessionIdOrName: string): boolean {
    const name = this.db.names[sessionIdOrName]
      ? sessionIdOrName
      : this.db.sessionIndex[sessionIdOrName];

    if (!name || !this.db.names[name]) {
      return false;
    }

    const session = this.db.names[name];

    // Remove from reverse index
    for (const record of session.history) {
      delete this.db.sessionIndex[record.sessionId];
    }
    delete this.db.sessionIndex[session.currentSessionId];

    // Remove from names
    delete this.db.names[name];

    this.dirty = true;
    this.save();
    return true;
  }

  /**
   * Get session history (all session IDs that have used this name)
   */
  getHistory(name: string): SessionRecord[] {
    return this.db.names[name]?.history ?? [];
  }

  /**
   * Cleanup old sessions
   */
  cleanup(maxAge?: number): number {
    const cutoffMs = maxAge ?? this.maxAge;
    if (!cutoffMs) return 0;

    const cutoff = new Date(Date.now() - cutoffMs).toISOString();
    const toDelete: string[] = [];

    for (const [name, session] of Object.entries(this.db.names)) {
      if (session.lastAccessed < cutoff && !session.manual) {
        toDelete.push(name);
      }
    }

    for (const name of toDelete) {
      this.delete(name);
    }

    return toDelete.length;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private setManualName(sessionId: string, name: string): void {
    // Remove existing mapping if any
    const existingName = this.db.sessionIndex[sessionId];
    if (existingName) {
      delete this.db.names[existingName];
    }

    this.track(sessionId, { name, source: 'startup' });
    const namedSession = this.db.names[name];
    if (namedSession) {
      namedSession.manual = true;
    }
  }

  private resolveStoragePath(): string {
    // Try to find .claude directory
    const cwd = process.cwd();
    const localPath = join(cwd, DEFAULT_STORAGE_PATH);

    // Check if .claude exists in cwd
    if (existsSync(join(cwd, '.claude'))) {
      return localPath;
    }

    // Fallback to home directory
    const home = process.env.HOME ?? process.env.USERPROFILE ?? cwd;
    return join(home, DEFAULT_STORAGE_PATH);
  }

  private load(): SessionDatabase {
    if (!existsSync(this.storagePath)) {
      return this.createEmptyDatabase();
    }

    try {
      const content = readFileSync(this.storagePath, 'utf-8');
      const data = JSON.parse(content);

      // Migrate from old format if needed
      if (data.version !== DATABASE_VERSION) {
        return this.migrate(data);
      }

      return data as SessionDatabase;
    } catch {
      // Corrupted file - start fresh
      return this.createEmptyDatabase();
    }
  }

  private createEmptyDatabase(): SessionDatabase {
    return {
      version: DATABASE_VERSION,
      names: {},
      sessionIndex: {},
    };
  }

  private migrate(oldData: unknown): SessionDatabase {
    // Handle migration from v1.0 format
    const db = this.createEmptyDatabase();

    if (typeof oldData === 'object' && oldData !== null) {
      const old = oldData as { sessions?: Record<string, { name: string; created?: string; source?: string; manual?: boolean }> };
      if (old.sessions) {
        for (const [sessionId, info] of Object.entries(old.sessions)) {
          this.track.call({ db, dirty: false, save: () => {}, nameGenerator: this.nameGenerator } as unknown as SessionStore, sessionId, {
            name: info.name,
            source: (info.source as SessionSource) ?? 'startup',
          });
        }
      }
    }

    return db;
  }

  private save(): void {
    if (!this.dirty) return;

    // Ensure directory exists
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tempPath = `${this.storagePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(this.db, null, 2));
    renameSync(tempPath, this.storagePath);

    this.dirty = false;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultStore: SessionStore | null = null;

export function getSessionStore(config?: SessionStoreConfig): SessionStore {
  if (!defaultStore || config) {
    defaultStore = new SessionStore(config);
  }
  return defaultStore;
}

// Convenience functions
export function trackSession(
  sessionId: string,
  options?: Parameters<SessionStore['track']>[1]
): TrackingResult {
  return getSessionStore().track(sessionId, options);
}

export function getSessionName(sessionId: string): string | undefined {
  return getSessionStore().getName(sessionId);
}

export function getSessionId(name: string): string | undefined {
  return getSessionStore().getSessionId(name);
}

export function renameSession(sessionIdOrName: string, newName: string): void {
  return getSessionStore().rename(sessionIdOrName, newName);
}

export function listSessions(filter?: SessionListFilter): SessionInfo[] {
  return getSessionStore().list(filter);
}
