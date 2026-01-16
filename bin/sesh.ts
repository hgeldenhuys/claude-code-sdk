#!/usr/bin/env bun
/**
 * sesh - Claude Code Session Name Manager
 *
 * A CLI tool for managing human-friendly session names.
 * Converts between session IDs and names for easy session resumption.
 *
 * v3.0 features:
 * - Centralized storage at ~/.claude/global-sessions.json
 * - Machine namespacing for multi-machine support
 * - Project-based session filtering
 * - Migration from per-project sessions.json
 *
 * Usage:
 *   sesh <name-or-id>           Auto-detect and convert
 *   sesh id <name>              Get session ID for a name
 *   sesh name <session-id>      Get name for a session ID
 *   sesh list [options]         List all sessions
 *   sesh info <name-or-id>      Show session details
 *   sesh rename <old> <new>     Rename a session
 *   sesh machines               List registered machines
 *   sesh machines alias <name>  Set alias for current machine
 *   sesh migrate [path]         Migrate sessions from project path
 *   sesh help                   Show help
 *
 * Examples:
 *   claude --resume $(sesh my-project)
 *   sesh jolly-squid
 *   sesh list --limit 5
 *   sesh list --project /path/to/project
 *   sesh list --all-machines
 *   sesh migrate /path/to/project
 */

import { getSessionStore } from '../src/hooks/sessions';
import {
  getMachineId,
  getMachineAlias,
  getMachineDisplayName,
  setMachineAlias,
  listMachines,
} from '../src/hooks/sessions/machine';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '3.0.0';

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

Centralized session storage with multi-machine support.
Sessions are stored at ~/.claude/global-sessions.json

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
  sesh transcript <name>      Get transcript file path for a session
  sesh machines               List registered machines
  sesh machines alias <name>  Set alias for current machine
  sesh migrate [path]         Migrate sessions from project's .claude/sessions.json
  sesh help                   Show this help
  sesh version                Show version

List options:
  --pattern, -p <glob>        Filter by name pattern
  --limit, -n <count>         Limit results
  --project <path>            Filter by project directory
  --machine <id>              Filter by machine ID
  --all-machines              Show sessions from all machines (default: current only)
  --json                      Output as JSON
  --names                     Output names only (one per line)
  --ids                       Output session IDs only (one per line)

Examples:
  # Resume a session by name
  claude --resume $(sesh my-project)

  # Convert between formats
  sesh jolly-squid                    # -> session ID
  sesh abc12345-1234-1234-1234-...    # -> name

  # List recent sessions
  sesh list --limit 10

  # Find sessions matching pattern
  sesh list --pattern "feature-*"

  # List sessions for a specific project
  sesh list --project /path/to/project

  # List sessions from all machines
  sesh list --all-machines

  # Rename for easier recall
  sesh rename brave-elephant auth-feature

  # Manage machines
  sesh machines                       # List all machines
  sesh machines alias my-laptop       # Set alias for this machine

  # Migrate from old per-project storage
  sesh migrate /path/to/project       # Migrate project's sessions
  sesh migrate                        # Migrate current directory's sessions`);
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
  let projectPath: string | undefined;
  let machineId: string | undefined;
  let allMachines = false;
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
        if (val) limit = Number.parseInt(val, 10);
        break;
      }
      case '--project':
        projectPath = args[++i];
        break;
      case '--machine':
        machineId = args[++i];
        break;
      case '--all-machines':
        allMachines = true;
        break;
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

  // Get sessions based on filters
  let sessions;
  if (projectPath) {
    // Filter by project directory
    sessions = store.listByDirectory(projectPath);
  } else if (machineId) {
    // Filter by specific machine
    sessions = store.listByMachine(machineId);
  } else if (!allMachines) {
    // Default: current machine only
    sessions = store.listByMachine();
  } else {
    // All machines
    sessions = store.list({
      namePattern: pattern,
      sortBy: 'lastAccessed',
      sortDir: 'desc',
    });
  }

  // Apply pattern filter if using listByDirectory or listByMachine
  if (pattern && (projectPath || machineId || !allMachines)) {
    const patternRegex = new RegExp(pattern.replace(/\*/g, '.*'));
    sessions = sessions.filter((s) => patternRegex.test(s.name));
  }

  // Apply limit
  if (limit && sessions.length > limit) {
    sessions = sessions.slice(0, limit);
  }

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
    default: {
      const showMachine = allMachines || machineId;
      const header = showMachine
        ? 'NAME                 SESSION ID                           LAST ACCESSED        MACHINE'
        : 'NAME                 SESSION ID                           LAST ACCESSED';
      console.log(header);
      console.log('-'.repeat(header.length));
      for (const s of sessions) {
        const name = s.name.padEnd(20).slice(0, 20);
        const id = s.sessionId.slice(0, 36).padEnd(36);
        const date = formatDate(s.lastAccessed);
        if (showMachine) {
          const machine = (s.machineId?.slice(0, 8) ?? 'unknown').padEnd(12);
          console.log(`${name} ${id} ${date}  ${machine}`);
        } else {
          console.log(`${name} ${id} ${date}`);
        }
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
  if (info.transcriptPath) console.log(`Transcript:   ${info.transcriptPath}`);

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
    if (!record) continue;
    const date = formatDate(record.timestamp);
    console.log(`  ${i + 1}. ${record.sessionId.slice(0, 8)}... (${record.source}) - ${date}`);
  }

  return 0;
}

function cmdTranscript(sessionIdOrName: string): number {
  const store = getSessionStore();
  const info = store.getByName(sessionIdOrName) ?? store.getBySessionId(sessionIdOrName);

  if (!info) {
    printError(`session not found: ${sessionIdOrName}`);
    return 1;
  }

  if (!info.transcriptPath) {
    printError(`no transcript path recorded for: ${info.name}`);
    return 1;
  }

  // Output just the path for easy shell usage: cat $(sesh transcript my-session)
  console.log(info.transcriptPath);
  return 0;
}

function cmdCleanup(maxAgeHours?: number): number {
  const store = getSessionStore();
  const maxAge = maxAgeHours ? maxAgeHours * 60 * 60 * 1000 : undefined;
  const deleted = store.cleanup(maxAge);

  if (deleted > 0) {
    console.log(`Cleaned up ${deleted} session(s)`);
  } else {
    console.log('No sessions to clean up');
  }

  return 0;
}

function cmdMachines(args: string[]): number {
  const store = getSessionStore();
  const db = store.getDatabase();

  // Handle subcommands
  if (args[0] === 'alias') {
    if (!args[1]) {
      // Show current alias
      const alias = getMachineAlias();
      if (alias) {
        console.log(`Current machine alias: ${alias}`);
      } else {
        console.log(`No alias set. Machine ID: ${getMachineId().slice(0, 8)}...`);
      }
      return 0;
    }

    // Set alias
    try {
      setMachineAlias(args[1]);
      console.log(`Machine alias set to: ${args[1]}`);
      return 0;
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  // List all machines
  const machines = listMachines(db);
  const currentId = getMachineId();

  if (machines.length === 0) {
    console.log('No machines registered yet.');
    return 0;
  }

  console.log('Registered machines:');
  console.log('');
  const header = 'MACHINE ID   ALIAS                HOSTNAME             LAST SEEN';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const machine of machines) {
    const isCurrent = machine.id === currentId;
    const idDisplay = machine.id.slice(0, 8) + (isCurrent ? ' *' : '  ');
    const alias = (machine.alias ?? '-').padEnd(20).slice(0, 20);
    const hostname = machine.hostname.padEnd(20).slice(0, 20);
    const lastSeen = formatDate(machine.lastSeen);
    console.log(`${idDisplay.padEnd(12)} ${alias} ${hostname} ${lastSeen}`);
  }

  console.log('');
  console.log(`Current machine: ${getMachineDisplayName()} (${currentId.slice(0, 8)}...)`);

  return 0;
}

function cmdMigrate(projectPath?: string): number {
  const store = getSessionStore();
  const targetPath = projectPath ?? process.cwd();

  console.log(`Migrating sessions from: ${targetPath}`);

  const result = store.migrateFromProject(targetPath);

  if (result.imported === 0 && result.skipped === 0 && result.errors === 0) {
    console.log('No sessions.json found or no sessions to migrate.');
    return 0;
  }

  console.log('');
  console.log('Migration results:');
  console.log(`  Imported: ${result.imported}`);
  console.log(`  Skipped:  ${result.skipped}`);
  console.log(`  Errors:   ${result.errors}`);

  if (result.details.length > 0 && result.details.length <= 20) {
    console.log('');
    console.log('Details:');
    for (const detail of result.details) {
      const statusIcon = detail.status === 'imported' ? '+' : detail.status === 'skipped' ? '-' : '!';
      const reason = detail.reason ? ` (${detail.reason})` : '';
      console.log(`  ${statusIcon} ${detail.name}${reason}`);
    }
  }

  return result.errors > 0 ? 1 : 0;
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

  const command = args[0] as string;

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

    case 'transcript':
      if (!args[1]) {
        printError('usage: sesh transcript <name-or-id>');
        return 1;
      }
      return cmdTranscript(args[1]);

    case 'cleanup':
      return cmdCleanup(args[1] ? Number.parseInt(args[1], 10) : undefined);

    case 'machines':
      return cmdMachines(args.slice(1));

    case 'migrate':
      return cmdMigrate(args[1]);

    default:
      // Auto-detect mode: input is either a name or session ID
      return cmdAutoDetect(command);
  }
}

process.exit(main());
