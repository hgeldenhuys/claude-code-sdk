/**
 * Session Namer - User-friendly session naming for Claude Code
 *
 * Automatically generates and persists memorable names for Claude Code sessions.
 * Names are generated using the pattern: adjective-animal (e.g., "brave-elephant")
 *
 * Features:
 * - Auto-generation on SessionStart
 * - Persistent storage in .claude/sessions.json
 * - Manual name overrides via config
 * - Collision handling (appends -2, -3, etc.)
 * - Bidirectional lookup (name ↔ session ID)
 */

import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';
import * as fs from 'fs';
import * as path from 'path';

export interface SessionInfo {
  name: string;
  created: string;
  source: 'startup' | 'resume' | 'clear' | 'compact';
  manual: boolean;
}

export interface SessionsDatabase {
  version: string;
  sessions: Record<string, SessionInfo>;
}

const SESSIONS_FILE = '.claude/sessions.json';
const DB_VERSION = '1.0';

/**
 * SessionNamer - Manages session name generation and storage
 */
export class SessionNamer {
  private sessionsPath: string;
  private db: SessionsDatabase;
  private manualNames: Record<string, string>; // From config

  constructor(options: { manualNames?: Record<string, string> } = {}) {
    this.sessionsPath = path.join(process.cwd(), SESSIONS_FILE);
    this.manualNames = options.manualNames || {};
    this.db = this.loadDatabase();
  }

  /**
   * Load sessions database from disk
   */
  private loadDatabase(): SessionsDatabase {
    try {
      if (fs.existsSync(this.sessionsPath)) {
        const content = fs.readFileSync(this.sessionsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn('[session-namer] Failed to load sessions.json:', error);
    }

    // Return empty database
    return {
      version: DB_VERSION,
      sessions: {},
    };
  }

  /**
   * Save sessions database to disk (atomic write)
   */
  private saveDatabase(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.sessionsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Atomic write (write to temp file, then rename)
      const tempPath = `${this.sessionsPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.db, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.sessionsPath);
    } catch (error) {
      console.error('[session-namer] Failed to save sessions.json:', error);
      throw error;
    }
  }

  /**
   * Generate a unique session name
   */
  private generateName(): string {
    const name = uniqueNamesGenerator({
      dictionaries: [adjectives, animals],
      separator: '-',
      length: 2,
      style: 'lowerCase',
    });

    return name;
  }

  /**
   * Check if a name is already in use
   */
  private isNameTaken(name: string): boolean {
    return Object.values(this.db.sessions).some((session) => session.name === name);
  }

  /**
   * Generate a unique name (handles collisions)
   */
  private generateUniqueName(): string {
    let name = this.generateName();
    let counter = 2;

    // Handle collisions by appending -2, -3, etc.
    while (this.isNameTaken(name)) {
      const baseName = this.generateName();
      name = `${baseName}-${counter}`;
      counter++;

      // Safety: prevent infinite loop
      if (counter > 100) {
        name = `${baseName}-${Date.now()}`;
        break;
      }
    }

    return name;
  }

  /**
   * Get or create a session name
   */
  public getOrCreateName(
    sessionId: string,
    source: 'startup' | 'resume' | 'clear' | 'compact' = 'startup'
  ): string {
    // Check if session already has a name
    if (this.db.sessions[sessionId]) {
      return this.db.sessions[sessionId].name;
    }

    // Check if manual name override exists in config
    if (this.manualNames[sessionId]) {
      const manualName = this.manualNames[sessionId];

      // Save manual name
      this.db.sessions[sessionId] = {
        name: manualName,
        created: new Date().toISOString(),
        source,
        manual: true,
      };
      this.saveDatabase();

      return manualName;
    }

    // Generate new unique name
    const name = this.generateUniqueName();

    // Save to database
    this.db.sessions[sessionId] = {
      name,
      created: new Date().toISOString(),
      source,
      manual: false,
    };
    this.saveDatabase();

    return name;
  }

  /**
   * Get session name by ID (returns undefined if not found)
   */
  public getSessionName(sessionId: string): string | undefined {
    return this.db.sessions[sessionId]?.name;
  }

  /**
   * Get session ID by name (returns undefined if not found)
   */
  public getSessionId(name: string): string | undefined {
    for (const [sessionId, info] of Object.entries(this.db.sessions)) {
      if (info.name === name) {
        return sessionId;
      }
    }
    return undefined;
  }

  /**
   * Rename a session
   */
  public renameSession(sessionId: string, newName: string): void {
    // Check if session exists
    if (!this.db.sessions[sessionId]) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Check if new name is already taken
    if (this.isNameTaken(newName)) {
      throw new Error(`Name "${newName}" is already in use`);
    }

    // Update name
    this.db.sessions[sessionId].name = newName;
    this.db.sessions[sessionId].manual = true;
    this.saveDatabase();
  }

  /**
   * List all sessions
   */
  public listSessions(): Array<{ sessionId: string; info: SessionInfo }> {
    return Object.entries(this.db.sessions).map(([sessionId, info]) => ({
      sessionId,
      info,
    }));
  }

  /**
   * Get session info
   */
  public getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.db.sessions[sessionId];
  }
}

// Global instance (singleton pattern for convenience)
let globalNamer: SessionNamer | null = null;

/**
 * Initialize the global SessionNamer instance
 */
export function initSessionNamer(options?: { manualNames?: Record<string, string> }): void {
  globalNamer = new SessionNamer(options);
}

/**
 * Get session name by ID (convenience function)
 */
export function getSessionName(sessionId: string): string | undefined {
  if (!globalNamer) {
    globalNamer = new SessionNamer();
  }
  return globalNamer.getSessionName(sessionId);
}

/**
 * Get session ID by name (convenience function)
 */
export function getSessionId(name: string): string | undefined {
  if (!globalNamer) {
    globalNamer = new SessionNamer();
  }
  return globalNamer.getSessionId(name);
}

/**
 * Rename a session (convenience function)
 */
export function renameSession(sessionId: string, newName: string): void {
  if (!globalNamer) {
    globalNamer = new SessionNamer();
  }
  globalNamer.renameSession(sessionId, newName);
}

/**
 * List all sessions (convenience function)
 */
export function listSessions(): Array<{ sessionId: string; info: SessionInfo }> {
  if (!globalNamer) {
    globalNamer = new SessionNamer();
  }
  return globalNamer.listSessions();
}
