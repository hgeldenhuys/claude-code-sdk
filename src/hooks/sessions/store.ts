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
 *
 * v3.0 changes:
 * - Centralized storage at ~/.claude/global-sessions.json
 * - Machine namespacing for multi-machine support
 * - Directory index for efficient project-based queries
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SessionSource } from '../types';
import { getMachineId, registerCurrentMachine } from './machine';
import { NameGenerator, generateUniqueName } from './namer';
import type {
  GlobalSessionDatabase,
  MigrationResult,
  NamedSession,
  SessionDatabase,
  SessionInfo,
  SessionListFilter,
  SessionRecord,
  SessionStoreConfig,
  TrackingResult,
} from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_STORAGE_PATH = 'global-sessions.json';
const DATABASE_VERSION = '3.0';
const LEGACY_DATABASE_VERSION = '2.0';

// ============================================================================
// Session Store
// ============================================================================

export class SessionStore {
  private db: GlobalSessionDatabase;
  private storagePath: string;
  private nameGenerator: NameGenerator;
  private maxAge: number | null;
  private dirty = false;
  private machineId: string;

  constructor(config: SessionStoreConfig = {}) {
    this.storagePath = config.storagePath ?? this.resolveStoragePath();
    this.nameGenerator = new NameGenerator();
    this.maxAge = config.maxAge ?? null;
    this.machineId = getMachineId();
    this.db = this.load();

    // Register current machine
    registerCurrentMachine(this.db);
    this.dirty = true;
    this.save();

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
   * Call this on ANY hook event to keep the name->ID mapping current.
   * The last hook event to fire "wins" the name.
   */
  track(
    sessionId: string,
    options: {
      source?: SessionSource;
      transcriptPath?: string;
      transcriptId?: string;
      cwd?: string;
      name?: string; // Force a specific name
    } = {}
  ): TrackingResult {
    const { source = 'startup', transcriptPath, transcriptId, cwd, name: forcedName } = options;
    const now = new Date().toISOString();

    // Check if this session ID already has a name
    const existingName = this.db.sessionIndex[sessionId];
    if (existingName && !forcedName) {
      // Session ID already tracked - just update lastAccessed
      const session = this.db.names[existingName];
      if (session) {
        session.lastAccessed = now;
        session.currentSessionId = sessionId;
        if (cwd) {
          session.cwd = cwd;
          this.updateDirectoryIndex(existingName, cwd);
        }
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
      transcriptId,
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
      if (cwd) {
        existingNamedSession.cwd = cwd;
        this.updateDirectoryIndex(name, cwd);
      }
    } else {
      // New name - include machineId
      this.db.names[name] = {
        name,
        currentSessionId: sessionId,
        history: [record],
        created: now,
        lastAccessed: now,
        manual: !!forcedName,
        cwd,
        machineId: this.machineId,
      };

      // Add to directory index
      if (cwd) {
        this.updateDirectoryIndex(name, cwd);
      }
    }

    // Update reverse index
    this.db.sessionIndex[sessionId] = name;

    // Track latest session per directory (for recovery after /clear)
    if (cwd) {
      if (!this.db.latestByDirectory) {
        this.db.latestByDirectory = {};
      }
      this.db.latestByDirectory[cwd] = name;
    }

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
   * Update the directory index for a session
   */
  private updateDirectoryIndex(name: string, cwd: string): void {
    if (!this.db.directoryIndex[cwd]) {
      this.db.directoryIndex[cwd] = [];
    }

    // Add if not already in the list
    if (!this.db.directoryIndex[cwd].includes(name)) {
      this.db.directoryIndex[cwd].push(name);
    }
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
      machineId: session.machineId,
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
    const normalizedName = this.nameGenerator.normalizeName(newName);
    if (!this.nameGenerator.isValidName(normalizedName)) {
      throw new Error(`Invalid name format: ${normalizedName}`);
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
    if (this.db.names[normalizedName] && normalizedName !== oldName) {
      throw new Error(`Name already exists: ${normalizedName}`);
    }

    // Perform rename
    const session = this.db.names[oldName];
    if (!session) {
      throw new Error(`Session not found: ${oldName}`);
    }

    session.name = normalizedName;
    session.manual = true;
    session.lastAccessed = new Date().toISOString();

    // Update data structures
    delete this.db.names[oldName];
    this.db.names[normalizedName] = session;

    // Update reverse index for all session IDs in history
    for (const record of session.history) {
      if (this.db.sessionIndex[record.sessionId] === oldName) {
        this.db.sessionIndex[record.sessionId] = normalizedName;
      }
    }
    this.db.sessionIndex[session.currentSessionId] = normalizedName;

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
        machineId: session.machineId,
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
   * Get the latest session name used in a directory.
   * Useful for recovery after /clear creates a new session ID.
   */
  getLatestForDirectory(cwd: string): string | undefined {
    return this.db.latestByDirectory?.[cwd];
  }

  /**
   * Resume the latest session for a directory.
   * Call this after /clear to reconnect the new session ID to the existing name.
   */
  resumeLatestForDirectory(
    sessionId: string,
    cwd: string,
    source: SessionSource = 'clear'
  ): TrackingResult | undefined {
    const latestName = this.getLatestForDirectory(cwd);
    if (!latestName) {
      return undefined;
    }

    // Track with the existing name - this will add the new session ID to its history
    return this.track(sessionId, {
      name: latestName,
      source,
      cwd,
    });
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
  // Query Methods (v3.0)
  // ==========================================================================

  /**
   * List sessions by directory path
   *
   * @param cwd - The directory path to filter by
   * @returns Array of SessionInfo for sessions in that directory
   */
  listByDirectory(cwd: string): SessionInfo[] {
    const names = this.db.directoryIndex[cwd];
    if (!names || names.length === 0) {
      return [];
    }

    const sessions: SessionInfo[] = [];
    for (const name of names) {
      const info = this.getByName(name);
      if (info) {
        sessions.push(info);
      }
    }

    // Sort by lastAccessed, most recent first
    sessions.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));

    return sessions;
  }

  /**
   * List sessions by machine ID
   *
   * @param machineId - The machine ID to filter by. If undefined, uses current machine.
   * @returns Array of SessionInfo for sessions on that machine
   */
  listByMachine(machineId?: string): SessionInfo[] {
    const targetMachineId = machineId ?? this.machineId;

    const sessions: SessionInfo[] = [];
    for (const session of Object.values(this.db.names)) {
      if (session.machineId === targetMachineId) {
        const latestRecord = session.history[session.history.length - 1];
        sessions.push({
          name: session.name,
          sessionId: session.currentSessionId,
          created: session.created,
          lastAccessed: session.lastAccessed,
          source: latestRecord?.source ?? 'startup',
          manual: session.manual,
          historyCount: session.history.length,
          cwd: session.cwd,
          description: session.description,
          machineId: session.machineId,
        });
      }
    }

    // Sort by lastAccessed, most recent first
    sessions.sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));

    return sessions;
  }

  /**
   * Get the current machine ID
   */
  getMachineId(): string {
    return this.machineId;
  }

  /**
   * Get the global database (for advanced queries)
   */
  getDatabase(): GlobalSessionDatabase {
    return this.db;
  }

  // ==========================================================================
  // Migration Methods (v3.0)
  // ==========================================================================

  /**
   * Migrate sessions from a project's local .claude/sessions.json file
   *
   * @param projectPath - Path to the project directory containing .claude/sessions.json
   * @returns MigrationResult with stats about imported/skipped/error counts
   */
  migrateFromProject(projectPath: string): MigrationResult {
    const result: MigrationResult = {
      imported: 0,
      skipped: 0,
      errors: 0,
      details: [],
    };

    const sessionFilePath = join(projectPath, '.claude', 'sessions.json');

    if (!existsSync(sessionFilePath)) {
      return result;
    }

    try {
      const content = readFileSync(sessionFilePath, 'utf-8');
      const data = JSON.parse(content);

      // Check version
      if (!data || typeof data !== 'object') {
        return result;
      }

      const oldDb = data as {
        version?: string;
        sessions?: Record<
          string,
          { name: string; created?: string; source?: string; manual?: boolean }
        >;
        names?: Record<string, NamedSession>;
        sessionIndex?: Record<string, string>;
      };

      // Handle v1.0 format
      if (oldDb.sessions) {
        for (const [sessionId, info] of Object.entries(oldDb.sessions)) {
          try {
            // Check if name already exists
            if (this.db.names[info.name]) {
              result.skipped++;
              result.details.push({
                name: info.name,
                status: 'skipped',
                reason: 'Name already exists in global database',
              });
              continue;
            }

            const now = new Date().toISOString();
            const record: SessionRecord = {
              sessionId,
              timestamp: info.created ?? now,
              source: (info.source as SessionSource) ?? 'startup',
            };

            this.db.names[info.name] = {
              name: info.name,
              currentSessionId: sessionId,
              history: [record],
              created: info.created ?? now,
              lastAccessed: now,
              manual: info.manual ?? false,
              cwd: projectPath,
              machineId: this.machineId,
            };

            this.db.sessionIndex[sessionId] = info.name;
            this.updateDirectoryIndex(info.name, projectPath);

            result.imported++;
            result.details.push({
              name: info.name,
              status: 'imported',
            });
          } catch (err) {
            result.errors++;
            result.details.push({
              name: info.name,
              status: 'error',
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Handle v2.0 format
      if (oldDb.version === LEGACY_DATABASE_VERSION && oldDb.names) {
        for (const [name, session] of Object.entries(oldDb.names)) {
          try {
            // Check if name already exists
            if (this.db.names[name]) {
              result.skipped++;
              result.details.push({
                name,
                status: 'skipped',
                reason: 'Name already exists in global database',
              });
              continue;
            }

            // Import the session with current machine ID
            this.db.names[name] = {
              ...session,
              cwd: session.cwd ?? projectPath,
              machineId: this.machineId,
            };

            // Update session index
            this.db.sessionIndex[session.currentSessionId] = name;
            for (const record of session.history) {
              this.db.sessionIndex[record.sessionId] = name;
            }

            // Update directory index
            const cwd = session.cwd ?? projectPath;
            this.updateDirectoryIndex(name, cwd);

            result.imported++;
            result.details.push({
              name,
              status: 'imported',
            });
          } catch (err) {
            result.errors++;
            result.details.push({
              name,
              status: 'error',
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      if (result.imported > 0) {
        this.dirty = true;
        this.save();
      }
    } catch (err) {
      // File read/parse error - return empty result
      result.errors++;
      result.details.push({
        name: '<file>',
        status: 'error',
        reason: err instanceof Error ? err.message : String(err),
      });
    }

    return result;
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

  /**
   * Resolve storage path - always use centralized global storage
   */
  private resolveStoragePath(): string {
    // Always use centralized storage at ~/.claude/global-sessions.json
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    return join(home, '.claude', DEFAULT_STORAGE_PATH);
  }

  private load(): GlobalSessionDatabase {
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

      return data as GlobalSessionDatabase;
    } catch {
      // Corrupted file - start fresh
      return this.createEmptyDatabase();
    }
  }

  private createEmptyDatabase(): GlobalSessionDatabase {
    return {
      version: DATABASE_VERSION as '3.0',
      machines: {},
      currentMachineId: this.machineId,
      names: {},
      sessionIndex: {},
      directoryIndex: {},
    };
  }

  private migrate(oldData: unknown): GlobalSessionDatabase {
    const db = this.createEmptyDatabase();

    if (typeof oldData !== 'object' || oldData === null) {
      return db;
    }

    const old = oldData as {
      version?: string;
      sessions?: Record<
        string,
        { name: string; created?: string; source?: string; manual?: boolean }
      >;
      names?: Record<string, NamedSession>;
      sessionIndex?: Record<string, string>;
      latestByDirectory?: Record<string, string>;
    };

    // Handle v1.0 format (old sessions map)
    if (old.sessions) {
      for (const [sessionId, info] of Object.entries(old.sessions)) {
        const now = new Date().toISOString();
        const name = info.name;
        const record: SessionRecord = {
          sessionId,
          timestamp: info.created ?? now,
          source: (info.source as SessionSource) ?? 'startup',
        };

        db.names[name] = {
          name,
          currentSessionId: sessionId,
          history: [record],
          created: info.created ?? now,
          lastAccessed: now,
          manual: info.manual ?? false,
          machineId: this.machineId,
        };

        db.sessionIndex[sessionId] = name;
      }
    }

    // Handle v2.0 format (names-centric without machine namespacing)
    if (old.version === LEGACY_DATABASE_VERSION && old.names) {
      for (const [name, session] of Object.entries(old.names)) {
        // Add machineId to existing sessions
        db.names[name] = {
          ...session,
          machineId: session.machineId ?? this.machineId,
        };

        // Build directory index
        if (session.cwd) {
          const cwd = session.cwd;
          if (!db.directoryIndex[cwd]) {
            db.directoryIndex[cwd] = [];
          }
          db.directoryIndex[cwd]!.push(name);
        }
      }

      // Copy session index
      if (old.sessionIndex) {
        db.sessionIndex = { ...old.sessionIndex };
      }

      // Copy latestByDirectory
      if (old.latestByDirectory) {
        db.latestByDirectory = { ...old.latestByDirectory };
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
  getSessionStore().rename(sessionIdOrName, newName);
}

export function listSessions(filter?: SessionListFilter): SessionInfo[] {
  return getSessionStore().list(filter);
}

export function getLatestForDirectory(cwd: string): string | undefined {
  return getSessionStore().getLatestForDirectory(cwd);
}

export function resumeLatestForDirectory(
  sessionId: string,
  cwd: string,
  source?: SessionSource
): TrackingResult | undefined {
  return getSessionStore().resumeLatestForDirectory(sessionId, cwd, source);
}
