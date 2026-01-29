/**
 * Session Discovery
 *
 * Discovers active Claude Code sessions on the local machine by reading
 * the ~/.claude/projects/ directory structure and parsing JSONL transcript
 * files for active session IDs.
 *
 * Actual directory structure:
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl
 *   ~/.claude/global-sessions.json  (contains session names)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LocalSession } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Root directory for Claude Code project data */
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

/** Global sessions file containing session names */
const GLOBAL_SESSIONS_PATH = path.join(os.homedir(), '.claude', 'global-sessions.json');

/** UUID v4 pattern used by Claude Code session IDs */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maximum age in milliseconds for a transcript file to be considered "active".
 * Sessions whose transcript was last modified more than 1 hour ago are excluded.
 */
const ACTIVE_THRESHOLD_MS = 60 * 60 * 1000;

// ============================================================================
// Session Names Store
// ============================================================================

interface GlobalSessionEntry {
  name: string;
  currentSessionId: string;
  machineId?: string;
  cwd?: string;
  history?: Array<{ sessionId: string; timestamp: string; source: string }>;
}

interface GlobalSessionsFile {
  version: string;
  names: Record<string, GlobalSessionEntry>;
}

/** Session metadata returned from global-sessions.json */
interface SessionMetadata {
  name: string;
  cwd: string | null;
}

/**
 * Load session metadata from ~/.claude/global-sessions.json
 * Returns a map of sessionId -> { name, cwd }
 */
function loadSessionMetadata(): Map<string, SessionMetadata> {
  const metaMap = new Map<string, SessionMetadata>();

  try {
    if (!fs.existsSync(GLOBAL_SESSIONS_PATH)) {
      return metaMap;
    }

    const content = fs.readFileSync(GLOBAL_SESSIONS_PATH, 'utf-8');
    const data = JSON.parse(content) as GlobalSessionsFile;

    if (data.names && typeof data.names === 'object') {
      for (const [name, entry] of Object.entries(data.names)) {
        const cwd = entry.cwd ?? null;
        if (entry.currentSessionId) {
          metaMap.set(entry.currentSessionId, { name, cwd });
        }
        // Also check history for past session IDs
        if (Array.isArray(entry.history)) {
          for (const historyEntry of entry.history) {
            if (historyEntry.sessionId) {
              metaMap.set(historyEntry.sessionId, { name, cwd });
            }
          }
        }
      }
    }
  } catch {
    // Can't read or parse global sessions file
  }

  return metaMap;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Decode the encoded project path from the directory name.
 * Claude Code encodes project paths by replacing "/" with "-" and
 * prefixing each segment. The raw directory name is used as a fallback.
 */
function decodeProjectPath(encodedName: string): string {
  // Claude Code uses URL-safe encoding: replaces / with -
  // The directory name often looks like: -Users-name-project
  // Convert back to /Users/name/project
  if (encodedName.startsWith('-')) {
    return encodedName.replace(/-/g, '/');
  }
  return encodedName;
}

/**
 * Check whether a transcript file has recent activity.
 * Looks at the modification time of the .jsonl file.
 */
function isTranscriptActive(transcriptPath: string): boolean {
  try {
    const stat = fs.statSync(transcriptPath);
    const elapsed = Date.now() - stat.mtimeMs;
    return elapsed < ACTIVE_THRESHOLD_MS;
  } catch {
    // Can't stat file - not active
    return false;
  }
}

/**
 * Extract session ID from a transcript filename.
 * Transcript files are named: <session-uuid>.jsonl
 */
function extractSessionId(filename: string): string | null {
  if (!filename.endsWith('.jsonl')) return null;

  const sessionId = filename.slice(0, -6); // Remove .jsonl
  if (!UUID_PATTERN.test(sessionId)) return null;

  return sessionId;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover active Claude Code sessions on this machine.
 *
 * Scans ~/.claude/projects/ for .jsonl transcript files with recent modification
 * times. Returns a LocalSession for each active session found.
 *
 * @param machineId - The machine identifier to tag sessions with
 * @returns Array of locally-discovered sessions, may be empty
 */
export async function discoverSessions(machineId: string): Promise<LocalSession[]> {
  const sessions: LocalSession[] = [];

  // Check if the projects directory exists
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return sessions;
  }

  // Load session metadata (name + cwd) from global sessions file
  const sessionMeta = loadSessionMetadata();

  // Read project directories
  let projectEntries: fs.Dirent[];
  try {
    projectEntries = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return sessions;
  }

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, projectEntry.name);
    // Fallback decoded path (may be incorrect for hyphenated directories)
    const fallbackProjectPath = decodeProjectPath(projectEntry.name);

    // Read files within this project directory
    let fileEntries: fs.Dirent[];
    try {
      fileEntries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const fileEntry of fileEntries) {
      // Look for .jsonl files (not directories)
      if (!fileEntry.isFile()) continue;
      if (!fileEntry.name.endsWith('.jsonl')) continue;

      // Skip non-UUID files like sessions-index.json
      const sessionId = extractSessionId(fileEntry.name);
      if (!sessionId) continue;

      const transcriptPath = path.join(projectDir, fileEntry.name);

      // Only include sessions with recent activity
      if (!isTranscriptActive(transcriptPath)) continue;

      // Look up session metadata from global sessions store
      const meta = sessionMeta.get(sessionId);
      const sessionName = meta?.name ?? null;
      // Prefer cwd from global-sessions.json (accurate) over decoded path (may be wrong)
      const projectPath = meta?.cwd ?? fallbackProjectPath;

      sessions.push({
        sessionId,
        sessionName,
        projectPath,
        agentId: null, // Populated after SignalDB registration
      });
    }
  }

  return sessions;
}
