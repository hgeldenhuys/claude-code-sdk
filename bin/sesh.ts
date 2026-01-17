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
 * v3.1 features:
 * - Subagent tracking and discovery
 * - Model, message count, tool usage metrics
 * - Task summary extraction
 *
 * Usage:
 *   sesh <name-or-id>           Auto-detect and convert
 *   sesh id <name>              Get session ID for a name
 *   sesh name <session-id>      Get name for a session ID
 *   sesh list [options]         List all sessions
 *   sesh info <name-or-id>      Show session details
 *   sesh rename <old> <new>     Rename a session
 *   sesh agents                  List subagents with metadata
 *   sesh agents describe <name>  Show detailed subagent info
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
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================================================
// Subagent Types
// ============================================================================

interface SubagentInfo {
  agentId: string;
  slug: string; // Human-friendly name
  sessionId: string; // Parent session ID
  model?: string;
  version?: string;
  cwd?: string;
  gitBranch?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  messageCount: number;
  toolCount: number;
  taskSummary?: string; // First 100 chars of first user prompt
  transcriptPath: string;
}

// ============================================================================
// Constants
// ============================================================================

const VERSION = '3.1.0';

// UUID v4 pattern (used by Claude Code)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Helpers
// ============================================================================

function isUUID(input: string): boolean {
  return UUID_PATTERN.test(input);
}

// ============================================================================
// Subagent Helpers
// ============================================================================

function getClaudeProjectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function discoverSubagents(sessionFilter?: string): SubagentInfo[] {
  const projectsDir = getClaudeProjectsDir();
  const subagents: SubagentInfo[] = [];

  if (!fs.existsSync(projectsDir)) {
    return subagents;
  }

  // Iterate through all project directories
  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true });

  for (const projectDir of projectDirs) {
    if (!projectDir.isDirectory()) continue;

    const projectPath = path.join(projectsDir, projectDir.name);

    // Check each session directory for subagents
    const sessionDirs = fs.readdirSync(projectPath, { withFileTypes: true });

    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;

      // Check if this matches sessionFilter
      if (sessionFilter && sessionDir.name !== sessionFilter) continue;

      const subagentsPath = path.join(projectPath, sessionDir.name, 'subagents');

      if (!fs.existsSync(subagentsPath)) continue;

      // Find all agent-*.jsonl files
      const agentFiles = fs.readdirSync(subagentsPath).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));

      for (const agentFile of agentFiles) {
        const transcriptPath = path.join(subagentsPath, agentFile);
        const agentInfo = parseSubagentTranscript(transcriptPath, sessionDir.name);
        if (agentInfo) {
          subagents.push(agentInfo);
        }
      }
    }
  }

  // Sort by lastTimestamp descending
  subagents.sort((a, b) => {
    const dateA = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
    const dateB = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
    return dateB - dateA;
  });

  return subagents;
}

function parseSubagentTranscript(transcriptPath: string, sessionId: string): SubagentInfo | null {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length === 0) return null;

    let agentId = '';
    let slug = '';
    let model: string | undefined;
    let version: string | undefined;
    let cwd: string | undefined;
    let gitBranch: string | undefined;
    let firstTimestamp: string | undefined;
    let lastTimestamp: string | undefined;
    let messageCount = 0;
    let toolCount = 0;
    let taskSummary: string | undefined;

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // Extract metadata from first entry
        if (!agentId && entry.agentId) {
          agentId = entry.agentId;
        }
        if (!slug && entry.slug) {
          slug = entry.slug;
        }
        if (!version && entry.version) {
          version = entry.version;
        }
        if (!cwd && entry.cwd) {
          cwd = entry.cwd;
        }
        if (!gitBranch && entry.gitBranch) {
          gitBranch = entry.gitBranch;
        }

        // Track timestamps
        if (entry.timestamp) {
          if (!firstTimestamp) {
            firstTimestamp = entry.timestamp;
          }
          lastTimestamp = entry.timestamp;
        }

        // Count messages and extract model
        if (entry.type === 'user') {
          messageCount++;
          // Extract task summary from first user message
          if (!taskSummary && entry.message?.content) {
            const content =
              typeof entry.message.content === 'string'
                ? entry.message.content
                : JSON.stringify(entry.message.content);
            taskSummary = content.slice(0, 100).replace(/\n/g, ' ').trim();
            if (content.length > 100) taskSummary += '...';
          }
        } else if (entry.type === 'assistant') {
          messageCount++;
          // Extract model from assistant messages
          if (!model && entry.message?.model) {
            model = entry.message.model;
          }
          // Count tool uses
          if (entry.message?.content && Array.isArray(entry.message.content)) {
            for (const block of entry.message.content) {
              if (block.type === 'tool_use') {
                toolCount++;
              }
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!agentId) return null;

    return {
      agentId,
      slug: slug || `agent-${agentId}`,
      sessionId,
      model,
      version,
      cwd,
      gitBranch,
      firstTimestamp,
      lastTimestamp,
      messageCount,
      toolCount,
      taskSummary,
      transcriptPath,
    };
  } catch {
    return null;
  }
}

function findSubagentByNameOrId(nameOrId: string): SubagentInfo | null {
  const allAgents = discoverSubagents();

  // Try exact slug match first
  for (const agent of allAgents) {
    if (agent.slug === nameOrId || agent.agentId === nameOrId) {
      return agent;
    }
  }

  // Try partial slug match
  for (const agent of allAgents) {
    if (agent.slug.includes(nameOrId) || agent.agentId.startsWith(nameOrId)) {
      return agent;
    }
  }

  return null;
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
  sesh agents [subcommand]    Manage subagents (list, describe, transcript)
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

Agents subcommands:
  sesh agents                       List all subagents (alias: sesh agents list)
  sesh agents list [options]        List subagents with model, messages, tools
  sesh agents describe <name-or-id> Show detailed subagent info
  sesh agents transcript <name>     Get transcript file path
  sesh agents <name-or-id>          Shorthand for describe

Agents list options:
  --session, -s <id>          Filter by parent session ID
  --limit, -n <count>         Limit results
  --json                      Output as JSON
  --names                     Output slugs only (one per line)
  --ids                       Output agent IDs only (one per line)

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

  # Manage subagents
  sesh agents                         # List all subagents
  sesh agents list --limit 5          # Recent 5 subagents
  sesh agents describe floating-puffin # Detailed subagent info
  sesh agents floating-puffin         # Shorthand for describe

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

function cmdAgents(args: string[]): number {
  const subCommand = args[0];

  // If first arg is an option, treat as list
  if (!subCommand || subCommand.startsWith('-')) {
    return cmdAgentsList(args);
  }

  switch (subCommand) {
    case 'list':
    case 'ls':
      return cmdAgentsList(args.slice(1));
    case 'describe':
    case 'info':
      if (!args[1]) {
        printError('usage: sesh agents describe <name-or-id>');
        return 1;
      }
      return cmdAgentsDescribe(args[1]);
    case 'transcript':
      if (!args[1]) {
        printError('usage: sesh agents transcript <name-or-id>');
        return 1;
      }
      return cmdAgentsTranscript(args[1]);
    default:
      // Try to treat as name/id for describe
      return cmdAgentsDescribe(subCommand);
  }
}

function cmdAgentsList(args: string[]): number {
  // Parse options
  let sessionFilter: string | undefined;
  let limit: number | undefined;
  let format: 'table' | 'json' | 'names' | 'ids' = 'table';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--session':
      case '-s':
        sessionFilter = args[++i];
        break;
      case '--limit':
      case '-n': {
        const val = args[++i];
        if (val) limit = Number.parseInt(val, 10);
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

  let agents = discoverSubagents(sessionFilter);

  if (limit && agents.length > limit) {
    agents = agents.slice(0, limit);
  }

  if (agents.length === 0) {
    if (format === 'json') {
      console.log('[]');
    } else {
      console.log('No subagents found');
    }
    return 0;
  }

  switch (format) {
    case 'json': {
      const store = getSessionStore();
      const agentsWithSessionName = agents.map((a) => ({
        ...a,
        sessionName: store.getName(a.sessionId) ?? null,
      }));
      console.log(JSON.stringify(agentsWithSessionName, null, 2));
      break;
    }
    case 'names':
      for (const a of agents) {
        console.log(a.slug);
      }
      break;
    case 'ids':
      for (const a of agents) {
        console.log(a.agentId);
      }
      break;
    default: {
      const store = getSessionStore();

      console.log('SLUG                           SESSION              ID       MODEL            MSGS  TOOLS  LAST ACTIVITY');
      console.log('-'.repeat(115));

      for (const a of agents) {
        const slug = a.slug.padEnd(30).slice(0, 30);
        // Try to get session name from store
        const sessionName = store.getName(a.sessionId);
        const sessionDisplay = (sessionName ?? a.sessionId.slice(0, 8)).padEnd(20).slice(0, 20);
        const agentIdShort = a.agentId.padEnd(8).slice(0, 8);
        // Shorten model name for display
        const modelShort = (a.model ?? 'unknown')
          .replace('claude-', '')
          .replace('-20251101', '')
          .replace('-20251001', '')
          .padEnd(16)
          .slice(0, 16);
        const msgs = String(a.messageCount).padStart(4);
        const tools = String(a.toolCount).padStart(6);
        const lastActivity = a.lastTimestamp ? formatDate(a.lastTimestamp) : 'unknown';
        console.log(`${slug} ${sessionDisplay} ${agentIdShort} ${modelShort} ${msgs} ${tools}  ${lastActivity}`);
      }

      console.log('');
      console.log(`Total: ${agents.length} subagent(s)`);
      break;
    }
  }

  return 0;
}

function cmdAgentsDescribe(nameOrId: string): number {
  const agent = findSubagentByNameOrId(nameOrId);

  if (!agent) {
    printError(`subagent not found: ${nameOrId}`);
    return 1;
  }

  console.log(`Slug:           ${agent.slug}`);
  console.log(`Agent ID:       ${agent.agentId}`);
  console.log(`Session ID:     ${agent.sessionId}`);
  console.log(`Model:          ${agent.model ?? 'unknown'}`);
  console.log(`Claude Version: ${agent.version ?? 'unknown'}`);
  console.log(`Messages:       ${agent.messageCount}`);
  console.log(`Tool Uses:      ${agent.toolCount}`);
  if (agent.firstTimestamp) console.log(`Started:        ${formatDate(agent.firstTimestamp)}`);
  if (agent.lastTimestamp) console.log(`Last Activity:  ${formatDate(agent.lastTimestamp)}`);
  if (agent.cwd) console.log(`Directory:      ${agent.cwd}`);
  if (agent.gitBranch) console.log(`Git Branch:     ${agent.gitBranch}`);
  if (agent.taskSummary) console.log(`Task:           ${agent.taskSummary}`);
  console.log(`Transcript:     ${agent.transcriptPath}`);

  // Show resume command hint
  console.log('');
  console.log('To resume this agent (via parent session):');
  console.log(`  claude --resume ${agent.sessionId}`);
  console.log(`  [then use Task tool with resume: "${agent.agentId}"]`);

  return 0;
}

function cmdAgentsTranscript(nameOrId: string): number {
  const agent = findSubagentByNameOrId(nameOrId);

  if (!agent) {
    printError(`subagent not found: ${nameOrId}`);
    return 1;
  }

  // Output just the path for easy shell usage
  console.log(agent.transcriptPath);
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

    case 'agents':
      return cmdAgents(args.slice(1));

    default:
      // Auto-detect mode: input is either a name or session ID
      return cmdAutoDetect(command);
  }
}

process.exit(main());
