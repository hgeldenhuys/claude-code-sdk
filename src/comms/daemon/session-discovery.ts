/**
 * Session Discovery
 *
 * Discovers active Claude Code sessions on the local machine by reading
 * the ~/.claude/projects/ directory structure and parsing JSONL transcript
 * files for active session IDs.
 *
 * Directory structure:
 *   ~/.claude/projects/<encoded-project-path>/<session-uuid>/
 *     transcript.jsonl
 *     ...
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

/** UUID v4 pattern used by Claude Code session IDs */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maximum age in milliseconds for a transcript file to be considered "active".
 * Sessions whose transcript was last modified more than 1 hour ago are excluded.
 */
const ACTIVE_THRESHOLD_MS = 60 * 60 * 1000;

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
 * Check whether a session directory has recent activity.
 * Looks at the modification time of transcript.jsonl.
 */
function isSessionActive(sessionDir: string): boolean {
  const transcriptPath = path.join(sessionDir, 'transcript.jsonl');
  try {
    const stat = fs.statSync(transcriptPath);
    const elapsed = Date.now() - stat.mtimeMs;
    return elapsed < ACTIVE_THRESHOLD_MS;
  } catch {
    // No transcript file or can't stat - not active
    return false;
  }
}

/**
 * Extract the session name from the last few lines of a transcript.
 * Claude Code writes session metadata at the start of the transcript.
 * The session name may appear in a SessionStart hook event or summary line.
 */
function extractSessionName(sessionDir: string): string | null {
  const transcriptPath = path.join(sessionDir, 'transcript.jsonl');
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.split('\n');

    // Scan first 50 lines for session name metadata
    const scanLimit = Math.min(lines.length, 50);
    for (let i = 0; i < scanLimit; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      try {
        const entry = JSON.parse(line);
        // Check for session name in various formats
        if (entry.sessionName && typeof entry.sessionName === 'string') {
          return entry.sessionName;
        }
        // Check in message content for session naming hook results
        if (entry.type === 'system' && entry.message?.sessionName) {
          return entry.message.sessionName;
        }
      } catch {
        // Skip malformed JSON lines
      }
    }
  } catch {
    // Can't read transcript
  }
  return null;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover active Claude Code sessions on this machine.
 *
 * Scans ~/.claude/projects/ for session directories with recently-modified
 * transcript files. Returns a LocalSession for each active session found.
 *
 * @param machineId - The machine identifier to tag sessions with (not used for discovery, but included in results)
 * @returns Array of locally-discovered sessions, may be empty
 */
export async function discoverSessions(machineId: string): Promise<LocalSession[]> {
  const sessions: LocalSession[] = [];

  // Check if the projects directory exists
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return sessions;
  }

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
    const projectPath = decodeProjectPath(projectEntry.name);

    // Read session directories within this project
    let sessionEntries: fs.Dirent[];
    try {
      sessionEntries = fs.readdirSync(projectDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;

      // Session directories are named by UUID
      if (!UUID_PATTERN.test(sessionEntry.name)) continue;

      const sessionDir = path.join(projectDir, sessionEntry.name);

      // Only include sessions with recent activity
      if (!isSessionActive(sessionDir)) continue;

      const sessionId = sessionEntry.name;
      const sessionName = extractSessionName(sessionDir);

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
