#!/usr/bin/env bun
/**
 * sesh - Claude Code Session Name Manager
 *
 * A CLI tool for managing human-friendly session names.
 * Converts between session IDs and names for easy session resumption.
 *
 * Usage:
 *   sesh <name-or-id>           Auto-detect and convert
 *   sesh id <name>              Get session ID for a name
 *   sesh name <session-id>      Get name for a session ID
 *   sesh list [options]         List all sessions
 *   sesh info <name-or-id>      Show session details
 *   sesh rename <old> <new>     Rename a session
 *   sesh help                   Show help
 *
 * Examples:
 *   claude --resume $(sesh my-project)
 *   sesh jolly-squid
 *   sesh list --limit 5
 */

import { getSessionStore } from '../src/hooks/sessions';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0';

// UUID v4 pattern (used by Claude Code)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Helpers
// ============================================================================

function isUUID(input: string): boolean {
  return UUID_PATTERN.test(input);
}

function printError(message: string): void {
  console.error(`error: ${message}`);
}

function printHelp(): void {
  console.log(`sesh v${VERSION} - Claude Code Session Name Manager

Usage:
  sesh <name-or-id>           Auto-detect and convert (for shell substitution)
  sesh id <name>              Get session ID for a name
  sesh name <session-id>      Get name for a session ID
  sesh list [options]         List all sessions
  sesh info <name-or-id>      Show session details
  sesh rename <old> <new>     Rename a session
  sesh describe <name> <text> Set session description
  sesh delete <name-or-id>    Delete a session
  sesh history <name>         Show session ID history
  sesh help                   Show this help
  sesh version                Show version

List options:
  --pattern, -p <glob>        Filter by name pattern
  --limit, -n <count>         Limit results
  --json                      Output as JSON
  --names                     Output names only (one per line)
  --ids                       Output session IDs only (one per line)

Examples:
  # Resume a session by name
  claude --resume $(sesh my-project)

  # Convert between formats
  sesh jolly-squid                    # → session ID
  sesh abc12345-1234-1234-1234-...    # → name

  # List recent sessions
  sesh list --limit 10

  # Find sessions matching pattern
  sesh list --pattern "feature-*"

  # Rename for easier recall
  sesh rename brave-elephant auth-feature`);
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

// ============================================================================
// Commands
// ============================================================================

function cmdAutoDetect(input: string): number {
  const store = getSessionStore();

  if (isUUID(input)) {
    // Input is a session ID, return name
    const name = store.getName(input);
    if (!name) {
      printError(`session not found: ${input.slice(0, 8)}...`);
      return 1;
    }
    console.log(name);
  } else {
    // Input is a name, return session ID
    const sessionId = store.getSessionId(input);
    if (!sessionId) {
      printError(`session not found: ${input}`);
      return 1;
    }
    console.log(sessionId);
  }

  return 0;
}

function cmdGetId(name: string): number {
  const store = getSessionStore();
  const sessionId = store.getSessionId(name);

  if (!sessionId) {
    printError(`session not found: ${name}`);
    return 1;
  }

  console.log(sessionId);
  return 0;
}

function cmdGetName(sessionId: string): number {
  const store = getSessionStore();
  const name = store.getName(sessionId);

  if (!name) {
    printError(`session not found: ${sessionId.slice(0, 8)}...`);
    return 1;
  }

  console.log(name);
  return 0;
}

function cmdList(args: string[]): number {
  const store = getSessionStore();

  // Parse options
  let pattern: string | undefined;
  let limit: number | undefined;
  let format: 'table' | 'json' | 'names' | 'ids' = 'table';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--pattern':
      case '-p':
        pattern = args[++i];
        break;
      case '--limit':
      case '-n': {
        const val = args[++i];
        if (val) limit = parseInt(val, 10);
        break;
      }
      case '--json':
        format = 'json';
        break;
      case '--names':
        format = 'names';
        break;
      case '--ids':
        format = 'ids';
        break;
    }
  }

  const sessions = store.list({
    namePattern: pattern,
    limit,
    sortBy: 'lastAccessed',
    sortDir: 'desc',
  });

  if (sessions.length === 0) {
    if (format === 'json') {
      console.log('[]');
    } else {
      console.log('No sessions found');
    }
    return 0;
  }

  switch (format) {
    case 'json':
      console.log(JSON.stringify(sessions, null, 2));
      break;
    case 'names':
      for (const s of sessions) {
        console.log(s.name);
      }
      break;
    case 'ids':
      for (const s of sessions) {
        console.log(s.sessionId);
      }
      break;
    case 'table':
    default: {
      const header = 'NAME                 SESSION ID                           LAST ACCESSED';
      console.log(header);
      console.log('-'.repeat(header.length));
      for (const s of sessions) {
        const name = s.name.padEnd(20).slice(0, 20);
        const id = s.sessionId.slice(0, 36).padEnd(36);
        const date = formatDate(s.lastAccessed);
        console.log(`${name} ${id} ${date}`);
      }
      break;
    }
  }

  return 0;
}

function cmdInfo(sessionIdOrName: string): number {
  const store = getSessionStore();
  const info = store.getByName(sessionIdOrName) ?? store.getBySessionId(sessionIdOrName);

  if (!info) {
    printError(`session not found: ${sessionIdOrName}`);
    return 1;
  }

  console.log(`Name:         ${info.name}`);
  console.log(`Session ID:   ${info.sessionId}`);
  console.log(`Created:      ${formatDate(info.created)}`);
  console.log(`Last Access:  ${formatDate(info.lastAccessed)}`);
  console.log(`Source:       ${info.source}`);
  console.log(`Manual:       ${info.manual ? 'Yes' : 'No'}`);
  console.log(`History:      ${info.historyCount} session(s)`);
  if (info.cwd) console.log(`Directory:    ${info.cwd}`);
  if (info.description) console.log(`Description:  ${info.description}`);

  return 0;
}

function cmdRename(oldName: string, newName: string): number {
  const store = getSessionStore();

  try {
    store.rename(oldName, newName);
    console.log(`Renamed '${oldName}' → '${newName}'`);
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function cmdDescribe(sessionIdOrName: string, description: string): number {
  const store = getSessionStore();

  try {
    store.setDescription(sessionIdOrName, description);
    console.log(`Description set for: ${sessionIdOrName}`);
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

function cmdDelete(sessionIdOrName: string): number {
  const store = getSessionStore();
  const deleted = store.delete(sessionIdOrName);

  if (!deleted) {
    printError(`session not found: ${sessionIdOrName}`);
    return 1;
  }

  console.log(`Deleted: ${sessionIdOrName}`);
  return 0;
}

function cmdHistory(name: string): number {
  const store = getSessionStore();
  const history = store.getHistory(name);

  if (history.length === 0) {
    printError(`no history for: ${name}`);
    return 1;
  }

  console.log(`History for '${name}':`);
  for (let i = 0; i < history.length; i++) {
    const record = history[i];
    const date = formatDate(record.timestamp);
    console.log(`  ${i + 1}. ${record.sessionId.slice(0, 8)}... (${record.source}) - ${date}`);
  }

  return 0;
}

// ============================================================================
// Main
// ============================================================================

function main(): number {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    return 0;
  }

  const command = args[0];

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;

    case 'version':
    case '--version':
    case '-v':
      console.log(`sesh v${VERSION}`);
      return 0;

    case 'id':
      if (!args[1]) {
        printError('usage: sesh id <name>');
        return 1;
      }
      return cmdGetId(args[1]);

    case 'name':
      if (!args[1]) {
        printError('usage: sesh name <session-id>');
        return 1;
      }
      return cmdGetName(args[1]);

    case 'list':
    case 'ls':
      return cmdList(args.slice(1));

    case 'info':
      if (!args[1]) {
        printError('usage: sesh info <name-or-id>');
        return 1;
      }
      return cmdInfo(args[1]);

    case 'rename':
    case 'mv':
      if (!args[1] || !args[2]) {
        printError('usage: sesh rename <old> <new>');
        return 1;
      }
      return cmdRename(args[1], args[2]);

    case 'describe':
      if (!args[1] || !args[2]) {
        printError('usage: sesh describe <name-or-id> <description>');
        return 1;
      }
      return cmdDescribe(args[1], args.slice(2).join(' '));

    case 'delete':
    case 'rm':
      if (!args[1]) {
        printError('usage: sesh delete <name-or-id>');
        return 1;
      }
      return cmdDelete(args[1]);

    case 'history':
      if (!args[1]) {
        printError('usage: sesh history <name>');
        return 1;
      }
      return cmdHistory(args[1]);

    default:
      // Auto-detect mode: input is either a name or session ID
      return cmdAutoDetect(command);
  }
}

process.exit(main());
