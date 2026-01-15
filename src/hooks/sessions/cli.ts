/**
 * Session CLI Utilities
 *
 * Command-line interface for managing named sessions.
 * Can be used directly or as helpers in hook scripts.
 */

import { SessionStore, getSessionStore } from './store';
import type { SessionInfo, SessionListFilter } from './types';

// ============================================================================
// CLI Commands
// ============================================================================

export interface CLIResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Get session ID by name
 */
export function cmdGetId(name: string): CLIResult {
  const store = getSessionStore();
  const sessionId = store.getSessionId(name);

  if (!sessionId) {
    return {
      success: false,
      message: `Session not found: ${name}`,
    };
  }

  return {
    success: true,
    message: sessionId,
    data: { name, sessionId },
  };
}

/**
 * Get session name by session ID
 */
export function cmdGetName(sessionId: string): CLIResult {
  const store = getSessionStore();
  const name = store.getName(sessionId);

  if (!name) {
    return {
      success: false,
      message: `Session not found: ${sessionId}`,
    };
  }

  return {
    success: true,
    message: name,
    data: { name, sessionId },
  };
}

/**
 * List sessions with optional filters
 */
export function cmdList(
  options: {
    pattern?: string;
    source?: string;
    manual?: boolean;
    limit?: number;
    format?: 'table' | 'json' | 'names';
  } = {}
): CLIResult {
  const store = getSessionStore();

  const filter: SessionListFilter = {};
  if (options.pattern) filter.namePattern = options.pattern;
  if (options.source) filter.source = options.source as SessionListFilter['source'];
  if (options.manual !== undefined) filter.manual = options.manual;
  if (options.limit) filter.limit = options.limit;

  const sessions = store.list(filter);

  if (sessions.length === 0) {
    return {
      success: true,
      message: 'No sessions found',
      data: [],
    };
  }

  let message: string;
  switch (options.format) {
    case 'json':
      message = JSON.stringify(sessions, null, 2);
      break;
    case 'names':
      message = sessions.map((s) => s.name).join('\n');
      break;
    default:
      message = formatTable(sessions);
      break;
  }

  return {
    success: true,
    message,
    data: sessions,
  };
}

/**
 * Rename a session
 */
export function cmdRename(sessionIdOrName: string, newName: string): CLIResult {
  const store = getSessionStore();

  try {
    store.rename(sessionIdOrName, newName);
    return {
      success: true,
      message: `Renamed '${sessionIdOrName}' to '${newName}'`,
      data: { oldName: sessionIdOrName, newName },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a session
 */
export function cmdDelete(sessionIdOrName: string): CLIResult {
  const store = getSessionStore();
  const deleted = store.delete(sessionIdOrName);

  if (!deleted) {
    return {
      success: false,
      message: `Session not found: ${sessionIdOrName}`,
    };
  }

  return {
    success: true,
    message: `Deleted session: ${sessionIdOrName}`,
    data: { deleted: sessionIdOrName },
  };
}

/**
 * Get session info
 */
export function cmdInfo(sessionIdOrName: string): CLIResult {
  const store = getSessionStore();
  const info = store.getByName(sessionIdOrName) ?? store.getBySessionId(sessionIdOrName);

  if (!info) {
    return {
      success: false,
      message: `Session not found: ${sessionIdOrName}`,
    };
  }

  const lines = [
    `Name:         ${info.name}`,
    `Session ID:   ${info.sessionId}`,
    `Created:      ${formatDate(info.created)}`,
    `Last Access:  ${formatDate(info.lastAccessed)}`,
    `Source:       ${info.source}`,
    `Manual:       ${info.manual ? 'Yes' : 'No'}`,
    `History:      ${info.historyCount} session(s)`,
  ];

  if (info.cwd) lines.push(`Directory:    ${info.cwd}`);
  if (info.description) lines.push(`Description:  ${info.description}`);

  return {
    success: true,
    message: lines.join('\n'),
    data: info,
  };
}

/**
 * Get session history
 */
export function cmdHistory(name: string): CLIResult {
  const store = getSessionStore();
  const history = store.getHistory(name);

  if (history.length === 0) {
    return {
      success: false,
      message: `No history found for: ${name}`,
    };
  }

  const lines = history.map((record, i) => {
    const date = formatDate(record.timestamp);
    return `${i + 1}. ${record.sessionId.slice(0, 8)}... (${record.source}) - ${date}`;
  });

  return {
    success: true,
    message: `History for '${name}':\n${lines.join('\n')}`,
    data: history,
  };
}

/**
 * Set session description
 */
export function cmdDescribe(sessionIdOrName: string, description: string): CLIResult {
  const store = getSessionStore();

  try {
    store.setDescription(sessionIdOrName, description);
    return {
      success: true,
      message: `Description set for: ${sessionIdOrName}`,
      data: { session: sessionIdOrName, description },
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cleanup old sessions
 */
export function cmdCleanup(maxAgeHours?: number): CLIResult {
  const store = getSessionStore();
  const maxAge = maxAgeHours ? maxAgeHours * 60 * 60 * 1000 : undefined;
  const deleted = store.cleanup(maxAge);

  return {
    success: true,
    message: deleted > 0 ? `Cleaned up ${deleted} session(s)` : 'No sessions to clean up',
    data: { deleted },
  };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

export function runCLI(args: string[]): CLIResult {
  const [command, ...rest] = args;

  switch (command) {
    case 'get-id':
      if (!rest[0]) return { success: false, message: 'Usage: get-id <name>' };
      return cmdGetId(rest[0]);

    case 'get-name':
      if (!rest[0]) return { success: false, message: 'Usage: get-name <session-id>' };
      return cmdGetName(rest[0]);

    case 'list':
      return cmdList(parseListOptions(rest));

    case 'rename':
      if (!rest[0] || !rest[1]) return { success: false, message: 'Usage: rename <old> <new>' };
      return cmdRename(rest[0], rest[1]);

    case 'delete':
      if (!rest[0]) return { success: false, message: 'Usage: delete <name-or-id>' };
      return cmdDelete(rest[0]);

    case 'info':
      if (!rest[0]) return { success: false, message: 'Usage: info <name-or-id>' };
      return cmdInfo(rest[0]);

    case 'history':
      if (!rest[0]) return { success: false, message: 'Usage: history <name>' };
      return cmdHistory(rest[0]);

    case 'describe':
      if (!rest[0] || !rest[1])
        return { success: false, message: 'Usage: describe <name-or-id> <description>' };
      return cmdDescribe(rest[0], rest.slice(1).join(' '));

    case 'cleanup':
      return cmdCleanup(rest[0] ? Number.parseInt(rest[0], 10) : undefined);

    default:
      return {
        success: true,
        message: getHelpText(),
      };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function formatTable(sessions: SessionInfo[]): string {
  const header =
    'NAME                 SESSION ID                               LAST ACCESSED        SOURCE';
  const divider = '-'.repeat(header.length);

  const rows = sessions.map((s) => {
    const name = s.name.padEnd(20).slice(0, 20);
    const id = s.sessionId.slice(0, 36).padEnd(40);
    const date = formatDate(s.lastAccessed).padEnd(20);
    const source = s.source;
    return `${name} ${id} ${date} ${source}`;
  });

  return [header, divider, ...rows].join('\n');
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseListOptions(args: string[]): Parameters<typeof cmdList>[0] {
  const options: Parameters<typeof cmdList>[0] = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--pattern':
      case '-p':
        options.pattern = args[++i];
        break;
      case '--source':
      case '-s':
        options.source = args[++i];
        break;
      case '--manual':
        options.manual = true;
        break;
      case '--auto':
        options.manual = false;
        break;
      case '--limit':
      case '-n': {
        const limitValue = args[++i];
        if (limitValue) {
          options.limit = Number.parseInt(limitValue, 10);
        }
        break;
      }
      case '--json':
        options.format = 'json';
        break;
      case '--names':
        options.format = 'names';
        break;
    }
  }

  return options;
}

function getHelpText(): string {
  return `Session Manager - Human-friendly names for Claude Code sessions

Usage: session <command> [options]

Commands:
  get-id <name>              Get session ID for a name
  get-name <session-id>      Get name for a session ID
  list [options]             List all sessions
  rename <old> <new>         Rename a session
  delete <name-or-id>        Delete a session
  info <name-or-id>          Show session details
  history <name>             Show session ID history
  describe <name> <text>     Set session description
  cleanup [hours]            Remove old sessions (default: use store maxAge)
  help                       Show this help

List options:
  --pattern, -p <glob>       Filter by name pattern
  --source, -s <type>        Filter by source (startup, resume, clear, compact)
  --manual                   Show only manually named sessions
  --auto                     Show only auto-named sessions
  --limit, -n <count>        Limit number of results
  --json                     Output as JSON
  --names                    Output names only (one per line)

Examples:
  session get-id brave-elephant
  session list --limit 10
  session list --pattern "brave-*" --json
  session rename brave-elephant my-feature
  session describe my-feature "Working on auth feature"
  session cleanup 168    # Remove sessions older than 7 days`;
}
