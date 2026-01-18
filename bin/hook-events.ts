#!/usr/bin/env bun
/**
 * hook-events - Claude Code Hook Events Viewer CLI
 *
 * View, filter, and query Claude Code hook event logs.
 *
 * Usage:
 *   hook-events <session> [options]           View hook events with filters
 *   hook-events list [options]                List sessions with hook events
 *   hook-events search <query> [options]      Search across hook events
 *   hook-events info <session>                Show hook event metadata
 *   hook-events help                          Show help
 *
 * Examples:
 *   hook-events . --last 10 --event PreToolUse
 *   hook-events list --recent 7
 *   hook-events search "Bash" --limit 20
 */

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import {
  getDatabase,
  getHookEvents,
  getHookSessions,
  getMaxHookEventId,
  getHookEventsAfterId,
  getHookEventCount,
  DEFAULT_DB_PATH,
  type HookEventResult,
  type HookSessionInfo,
} from '../src/transcripts/db';
import { getSessionStore } from '../src/hooks/sessions/store';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0';
const DAEMON_DIR = join(process.env.HOME || '~', '.claude-code-sdk');
const PID_FILE = join(DAEMON_DIR, 'transcript-daemon.pid');

// Context window size for current Claude models
const CONTEXT_WINDOW_SIZE = 200000;

// Valid event types
const VALID_EVENT_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStop',
  'PreSubagentToolUse',
  'PostSubagentToolUse',
  'UserPromptSubmitHook',
];

// Common tool names
const COMMON_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'Task',
  'WebFetch',
  'WebSearch',
  'TodoWrite',
  'AskUserQuestion',
];

// ============================================================================
// Database Access
// ============================================================================

let _db: ReturnType<typeof getDatabase> | null = null;

function getDb(): ReturnType<typeof getDatabase> {
  if (_db) return _db;

  if (!existsSync(DEFAULT_DB_PATH)) {
    console.error('error: Index not built. Run: transcript index build');
    process.exit(1);
  }

  _db = getDatabase(DEFAULT_DB_PATH);

  // Check if daemon is running
  if (existsSync(PID_FILE)) {
    try {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 0);
      } catch {
        console.error('\x1b[33mwarning: Daemon not running. Data may be stale. Run: transcript index daemon start\x1b[0m\n');
      }
    } catch {
      // Ignore
    }
  } else {
    console.error('\x1b[33mwarning: Daemon not running. Data may be stale. Run: transcript index daemon start\x1b[0m\n');
  }

  return _db;
}

// ============================================================================
// Helpers
// ============================================================================

function printError(message: string): void {
  console.error(`error: ${message}`);
}

function printHelp(): void {
  console.log(`hook-events v${VERSION} - Claude Code Hook Events Viewer

Usage:
  hook-events <session> [options]           View hook events with filters
  hook-events list [options]                List sessions with hook events
  hook-events search <query> [options]      Search across hook events
  hook-events info <session>                Show hook event metadata
  hook-events help                          Show this help

View Options:
  --event, -e <types>     Filter by event type (comma-separated)
                          Valid: ${VALID_EVENT_TYPES.join(', ')}
  --tool, -t <names>      Filter by tool name (comma-separated)
                          Common: ${COMMON_TOOLS.join(', ')}
  --last, -n <count>      Show last N events
  --first <count>         Show first N events
  --from-time <time>      Filter events after timestamp (ISO or "1h ago")
  --to-time <time>        Filter events before timestamp (ISO or "2d ago")
  --limit <n>             Limit to N events
  --offset <n>            Skip first N events

Output Formats:
  --json                  Raw JSON (one per line)
  --human, -h             Human-readable format (default)
  --minimal, -m           Compact format: timestamp event tool [context%]
  --pretty                Pretty-print JSON
  --output, -o <file>     Write output to file

Live Modes:
  --tail                  Stream new events as they are added
  --watch                 Show last event, update on change

List Options:
  --recent <days>         Show sessions from last N days
  --names                 Show session IDs only

Examples:
  # View last 10 events from current session
  hook-events . --last 10

  # View only tool events
  hook-events my-session --event PreToolUse,PostToolUse

  # View only Bash tool calls
  hook-events . --tool Bash --human

  # Stream new events in real-time
  hook-events my-session --tail

  # List recent sessions with hook events
  hook-events list --recent 7`);
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function parseTimestamp(input: string): Date {
  // Try ISO format first
  const date = new Date(input);
  if (!isNaN(date.getTime())) {
    return date;
  }

  // Try relative format like "1h ago", "2d ago"
  const match = input.match(/^(\d+)([hdwm])\s*ago$/i);
  if (match) {
    const amount = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();
    const now = new Date();

    switch (unit) {
      case 'h':
        now.setHours(now.getHours() - amount);
        break;
      case 'd':
        now.setDate(now.getDate() - amount);
        break;
      case 'w':
        now.setDate(now.getDate() - amount * 7);
        break;
      case 'm':
        now.setMonth(now.getMonth() - amount);
        break;
    }
    return now;
  }

  throw new Error(`Invalid timestamp: ${input}`);
}

function getEventColor(eventType: string): string {
  switch (eventType) {
    case 'UserPromptSubmit':
    case 'UserPromptSubmitHook':
      return '\x1b[32m'; // green
    case 'PreToolUse':
    case 'PreSubagentToolUse':
      return '\x1b[33m'; // yellow
    case 'PostToolUse':
    case 'PostSubagentToolUse':
      return '\x1b[36m'; // cyan
    case 'SessionStart':
      return '\x1b[35m'; // magenta
    case 'SessionEnd':
    case 'Stop':
    case 'SubagentStop':
      return '\x1b[31m'; // red
    default:
      return '\x1b[37m'; // white
  }
}

function resetColor(): string {
  return '\x1b[0m';
}

/**
 * Calculate context usage percentage from hook event input
 * Context window is 200K tokens for current Claude models
 */
export function getContextUsage(event: HookEventResult): { tokens: number; percentage: number } | null {
  if (!event.inputJson) return null;

  try {
    const input = JSON.parse(event.inputJson);
    // Look for usage info in various places
    const usage = input.tool_response?.usage || input.usage || input.message?.usage;
    if (usage) {
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const percentage = Math.round((totalTokens / CONTEXT_WINDOW_SIZE) * 100);
      return { tokens: totalTokens, percentage };
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

// ============================================================================
// Formatters
// ============================================================================

type OutputFormat = 'human' | 'minimal' | 'json' | 'raw';

function formatEventHuman(event: HookEventResult): string {
  const lines: string[] = [];
  const color = getEventColor(event.eventType);
  const reset = resetColor();

  // Header line
  const toolInfo = event.toolName ? ` [${event.toolName}]` : '';
  const decisionInfo = event.decision ? ` → ${event.decision}` : '';
  lines.push(`${color}[${formatTime(event.timestamp)}] ${event.eventType}${toolInfo}${decisionInfo}${reset}`);

  // Context usage if available
  const usage = getContextUsage(event);
  if (usage) {
    lines.push(`  Context: ${usage.tokens.toLocaleString()} tokens [${usage.percentage}%]`);
  }

  // Tool input preview
  if (event.inputJson) {
    try {
      const input = JSON.parse(event.inputJson);
      if (input.tool_input) {
        const preview = JSON.stringify(input.tool_input).slice(0, 100);
        lines.push(`  Input: ${preview}${preview.length >= 100 ? '...' : ''}`);
      } else if (input.prompt) {
        const preview = String(input.prompt).slice(0, 100);
        lines.push(`  Prompt: ${preview}${preview.length >= 100 ? '...' : ''}`);
      }
    } catch {
      // Ignore
    }
  }

  // Tool output preview for PostToolUse
  if (event.eventType === 'PostToolUse' && event.inputJson) {
    try {
      const input = JSON.parse(event.inputJson);
      if (input.tool_response) {
        const response = input.tool_response;
        if (response.stdout) {
          const preview = String(response.stdout).slice(0, 80).replace(/\n/g, '\\n');
          lines.push(`  Output: ${preview}${preview.length >= 80 ? '...' : ''}`);
        } else if (response.content) {
          const preview = String(response.content).slice(0, 80).replace(/\n/g, '\\n');
          lines.push(`  Output: ${preview}${preview.length >= 80 ? '...' : ''}`);
        }
      }
    } catch {
      // Ignore
    }
  }

  return lines.join('\n');
}

function formatEventMinimal(event: HookEventResult): string {
  const toolInfo = event.toolName ? ` ${event.toolName}` : '';
  const decisionInfo = event.decision && event.decision !== 'allow' ? ` [${event.decision}]` : '';
  const usage = getContextUsage(event);
  const usageStr = usage ? ` [${usage.percentage}%]` : '';
  return `${formatTime(event.timestamp)} ${event.eventType.padEnd(16)}${toolInfo}${decisionInfo}${usageStr}`;
}

function formatEventJson(event: HookEventResult, pretty?: boolean): string {
  const obj: Record<string, unknown> = {
    id: event.id,
    sessionId: event.sessionId,
    timestamp: event.timestamp,
    eventType: event.eventType,
    toolName: event.toolName,
    decision: event.decision,
    lineNumber: event.lineNumber,
  };

  // Add context usage
  const usage = getContextUsage(event);
  if (usage) {
    obj.contextUsage = usage;
  }

  if (event.inputJson) {
    try {
      obj.input = JSON.parse(event.inputJson);
    } catch {
      obj.inputJson = event.inputJson;
    }
  }

  if (event.contextJson) {
    try {
      obj.context = JSON.parse(event.contextJson);
    } catch {
      obj.contextJson = event.contextJson;
    }
  }

  if (event.handlerResults) {
    try {
      obj.handlerResults = JSON.parse(event.handlerResults);
    } catch {
      obj.handlerResults = event.handlerResults;
    }
  }

  return pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
}

// ============================================================================
// Commands
// ============================================================================

interface ViewArgs {
  sessionId: string;
  eventTypes?: string[];
  toolNames?: string[];
  last?: number;
  first?: number;
  fromTime?: string;
  toTime?: string;
  limit?: number;
  offset?: number;
  format: OutputFormat;
  pretty?: boolean;
  output?: string;
  tail?: boolean;
  watch?: boolean;
}

async function cmdView(args: ViewArgs): Promise<number> {
  const db = getDb();

  // Resolve "." to current session
  let sessionId = args.sessionId;
  if (sessionId === '.') {
    // Find most recent session for current project
    const sessions = getHookSessions(db, { recentDays: 1 });
    if (sessions.length === 0) {
      printError('No recent hook events found');
      return 1;
    }
    sessionId = sessions[0]!.sessionId;
  } else {
    // Try to resolve session name to session ID
    // Session names are like "peaceful-osprey", IDs are UUIDs
    const isLikelyName = !sessionId.includes('-') || sessionId.split('-').length <= 3;
    if (isLikelyName) {
      try {
        const store = getSessionStore();
        const resolvedId = store.getSessionId(sessionId);
        if (resolvedId) {
          sessionId = resolvedId;
        }
      } catch {
        // Ignore - will try as literal session ID
      }
    }
  }

  // Parse timestamp filters
  let fromTime: string | undefined;
  let toTime: string | undefined;
  if (args.fromTime) {
    try {
      fromTime = parseTimestamp(args.fromTime).toISOString();
    } catch (err) {
      printError(`invalid --from-time: ${args.fromTime}`);
      return 1;
    }
  }
  if (args.toTime) {
    try {
      toTime = parseTimestamp(args.toTime).toISOString();
    } catch (err) {
      printError(`invalid --to-time: ${args.toTime}`);
      return 1;
    }
  }

  // Handle --tail mode
  if (args.tail) {
    return tailMode(db, sessionId, args.eventTypes, args.toolNames, args.format, args.pretty);
  }

  // Handle --watch mode
  if (args.watch) {
    return watchMode(db, sessionId, args.eventTypes, args.toolNames, args.format, args.pretty);
  }

  // Standard view mode
  let queryLimit = args.limit;
  let order: 'asc' | 'desc' = 'asc';

  if (args.last) {
    order = 'desc';
    queryLimit = args.last;
  }

  if (args.first) {
    queryLimit = args.first;
  }

  const events = getHookEvents(db, {
    sessionId,
    eventTypes: args.eventTypes,
    toolNames: args.toolNames,
    fromTime,
    toTime,
    limit: queryLimit,
    offset: args.offset,
    order,
  });

  // Reverse if we used desc order for --last
  const sortedEvents = order === 'desc' ? events.reverse() : events;

  if (sortedEvents.length === 0) {
    console.log('No matching events found.');
    return 0;
  }

  // Build output
  const outputLines: string[] = [];
  for (const event of sortedEvents) {
    switch (args.format) {
      case 'json':
        outputLines.push(formatEventJson(event, args.pretty));
        break;
      case 'minimal':
        outputLines.push(formatEventMinimal(event));
        break;
      case 'human':
      default:
        outputLines.push(formatEventHuman(event));
        outputLines.push('');
        break;
    }
  }

  const output = outputLines.join('\n');

  if (args.output) {
    await Bun.write(args.output, output);
    console.log(`Output written to: ${args.output}`);
  } else {
    console.log(output);
  }

  return 0;
}

async function tailMode(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  eventTypes?: string[],
  toolNames?: string[],
  format: OutputFormat = 'human',
  pretty?: boolean
): Promise<number> {
  // Print last 10 events
  const initialEvents = getHookEvents(db, {
    sessionId,
    eventTypes,
    toolNames,
    limit: 10,
    order: 'desc',
  }).reverse();

  for (const event of initialEvents) {
    if (format === 'json') {
      console.log(formatEventJson(event, pretty));
    } else if (format === 'minimal') {
      console.log(formatEventMinimal(event));
    } else {
      console.log(formatEventHuman(event));
      console.log('');
    }
  }

  let lastId = getMaxHookEventId(db, sessionId);
  console.log('\n--- Watching for new events (Ctrl+C to stop) ---\n');

  // Poll every 500ms
  const pollInterval = setInterval(() => {
    try {
      const newEvents = getHookEventsAfterId(db, lastId, sessionId, eventTypes, toolNames);
      for (const event of newEvents) {
        if (format === 'json') {
          console.log(formatEventJson(event, pretty));
        } else if (format === 'minimal') {
          console.log(formatEventMinimal(event));
        } else {
          console.log(formatEventHuman(event));
          console.log('');
        }
        if (event.id > lastId) {
          lastId = event.id;
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, 500);

  process.on('SIGINT', () => {
    clearInterval(pollInterval);
    process.exit(0);
  });

  await new Promise(() => {});
  return 0;
}

async function watchMode(
  db: ReturnType<typeof getDatabase>,
  sessionId: string,
  eventTypes?: string[],
  toolNames?: string[],
  format: OutputFormat = 'human',
  pretty?: boolean
): Promise<number> {
  let lastContent = '';

  const renderLast = () => {
    const events = getHookEvents(db, {
      sessionId,
      eventTypes,
      toolNames,
      limit: 1,
      order: 'desc',
    });

    if (events.length > 0) {
      const event = events[0]!;
      let content = '';

      if (format === 'json') {
        content = formatEventJson(event, pretty);
      } else if (format === 'minimal') {
        content = formatEventMinimal(event);
      } else {
        content = formatEventHuman(event);
      }

      if (content !== lastContent) {
        lastContent = content;
        process.stdout.write('\x1b[2J\x1b[H');
        console.log(content);
        console.log('\n--- Watching for updates (Ctrl+C to stop) ---');
      }
    } else if (lastContent === '') {
      process.stdout.write('\x1b[2J\x1b[H');
      console.log('No matching events found.');
      console.log('\n--- Watching for updates (Ctrl+C to stop) ---');
      lastContent = '__empty__';
    }
  };

  renderLast();

  const pollInterval = setInterval(renderLast, 500);

  process.on('SIGINT', () => {
    clearInterval(pollInterval);
    process.exit(0);
  });

  await new Promise(() => {});
  return 0;
}

async function cmdList(args: { recent?: number; names?: boolean; json?: boolean }): Promise<number> {
  const db = getDb();
  const sessions = getHookSessions(db, { recentDays: args.recent });

  if (sessions.length === 0) {
    console.log('No hook event sessions found.');
    return 0;
  }

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return 0;
  }

  if (args.names) {
    for (const session of sessions) {
      console.log(session.sessionId);
    }
    return 0;
  }

  // Table format
  console.log('SESSION ID                             EVENTS   LAST MODIFIED');
  console.log('-'.repeat(70));

  for (const session of sessions) {
    const id = session.sessionId.slice(0, 36).padEnd(36);
    const events = String(session.eventCount).padStart(6);
    const date = formatDate(session.lastTimestamp || '');
    console.log(`${id} ${events}   ${date}`);
  }

  console.log(`\nTotal: ${sessions.length} session(s)`);
  return 0;
}

async function cmdInfo(sessionId: string): Promise<number> {
  const db = getDb();

  // Resolve "." to most recent session
  if (sessionId === '.') {
    const sessions = getHookSessions(db, { recentDays: 1 });
    if (sessions.length === 0) {
      printError('No recent hook events found');
      return 1;
    }
    sessionId = sessions[0]!.sessionId;
  } else {
    // Try to resolve session name to session ID
    const isLikelyName = !sessionId.includes('-') || sessionId.split('-').length <= 3;
    if (isLikelyName) {
      try {
        const store = getSessionStore();
        const resolvedId = store.getSessionId(sessionId);
        if (resolvedId) {
          sessionId = resolvedId;
        }
      } catch {
        // Ignore - will try as literal session ID
      }
    }
  }

  const events = getHookEvents(db, { sessionId });
  if (events.length === 0) {
    printError(`No hook events found for session: ${sessionId}`);
    printError('Tip: Use "." for most recent session, or provide a full session ID');
    return 1;
  }

  // Calculate stats
  const eventTypeCounts: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  let maxContextTokens = 0;
  let contextSamples = 0;

  for (const event of events) {
    eventTypeCounts[event.eventType] = (eventTypeCounts[event.eventType] || 0) + 1;
    if (event.toolName) {
      toolCounts[event.toolName] = (toolCounts[event.toolName] || 0) + 1;
    }
    const usage = getContextUsage(event);
    if (usage) {
      maxContextTokens = Math.max(maxContextTokens, usage.tokens);
      contextSamples++;
    }
  }

  const firstEvent = events[0]!;
  const lastEvent = events[events.length - 1]!;

  console.log('Hook Events Information\n');
  console.log(`Session ID:     ${sessionId}`);
  console.log(`File:           ${firstEvent.filePath}`);
  console.log(`Event Count:    ${events.length}`);
  console.log(`First Event:    ${formatDate(firstEvent.timestamp)}`);
  console.log(`Last Event:     ${formatDate(lastEvent.timestamp)}`);

  if (contextSamples > 0) {
    const percentage = Math.round((maxContextTokens / CONTEXT_WINDOW_SIZE) * 100);
    console.log(`\nMax Context:    ${maxContextTokens.toLocaleString()} tokens [${percentage}%]`);
  }

  console.log('\nEvent Types:');
  const sortedEventTypes = Object.entries(eventTypeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedEventTypes) {
    console.log(`  ${type.padEnd(24)} ${count}`);
  }

  if (Object.keys(toolCounts).length > 0) {
    console.log('\nTool Usage:');
    const sortedTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    for (const [tool, count] of sortedTools) {
      console.log(`  ${tool.padEnd(24)} ${count}`);
    }
  }

  return 0;
}

async function cmdSearch(query: string, args: { limit?: number; json?: boolean }): Promise<number> {
  const db = getDb();

  // Simple search across all events
  const allEvents = getHookEvents(db, { limit: 10000 });
  const queryLower = query.toLowerCase();

  const matches: HookEventResult[] = [];
  for (const event of allEvents) {
    const searchText = [
      event.eventType,
      event.toolName || '',
      event.inputJson || '',
      event.contextJson || '',
    ].join(' ').toLowerCase();

    if (searchText.includes(queryLower)) {
      matches.push(event);
      if (matches.length >= (args.limit || 50)) break;
    }
  }

  if (matches.length === 0) {
    console.log(`No results found for "${query}"`);
    return 0;
  }

  if (args.json) {
    console.log(JSON.stringify(matches, null, 2));
    return 0;
  }

  console.log(`Found ${matches.length} result(s) for "${query}":\n`);

  for (const event of matches) {
    const sessionShort = event.sessionId.slice(0, 8);
    const date = formatDate(event.timestamp);
    const toolInfo = event.toolName ? ` [${event.toolName}]` : '';
    const usage = getContextUsage(event);
    const usageStr = usage ? ` [${usage.percentage}%]` : '';
    console.log(`[${sessionShort}] ${event.eventType}${toolInfo}${usageStr} - ${date}`);
  }

  return 0;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args: string[]): {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean | number | string[]>;
} {
  const flags: Record<string, string | boolean | number | string[]> = {};
  const positional: string[] = [];
  let command = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === 'help' || arg === '--help' || arg === '-h') {
      command = 'help';
      continue;
    }

    if (arg === 'list' || arg === 'ls') {
      command = 'list';
      continue;
    }

    if (arg === 'search') {
      command = 'search';
      continue;
    }

    if (arg === 'info') {
      command = 'info';
      continue;
    }

    // Flags with values
    if (arg === '--event' || arg === '-e') {
      flags.eventTypes = args[++i]?.split(',').map((s) => s.trim()) || [];
      continue;
    }
    if (arg === '--tool' || arg === '-t') {
      flags.toolNames = args[++i]?.split(',').map((s) => s.trim()) || [];
      continue;
    }
    if (arg === '--last' || arg === '-n') {
      flags.last = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--first') {
      flags.first = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--limit') {
      flags.limit = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--offset') {
      flags.offset = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--from-time') {
      flags.fromTime = args[++i] || '';
      continue;
    }
    if (arg === '--to-time') {
      flags.toTime = args[++i] || '';
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      flags.output = args[++i] || '';
      continue;
    }
    if (arg === '--recent') {
      flags.recent = parseInt(args[++i]!, 10);
      continue;
    }

    // Boolean flags
    if (arg === '--json') {
      flags.json = true;
      flags.format = 'json';
      continue;
    }
    if (arg === '--human') {
      flags.format = 'human';
      continue;
    }
    if (arg === '--minimal' || arg === '-m') {
      flags.format = 'minimal';
      continue;
    }
    if (arg === '--pretty') {
      flags.pretty = true;
      continue;
    }
    if (arg === '--names') {
      flags.names = true;
      continue;
    }
    if (arg === '--tail') {
      flags.tail = true;
      continue;
    }
    if (arg === '--watch') {
      flags.watch = true;
      continue;
    }

    // Positional argument
    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Default command is view if we have a positional arg
  if (!command && positional.length > 0) {
    command = 'view';
  }

  return { command, positional, flags };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'help':
      printHelp();
      return 0;

    case 'view':
      if (positional.length === 0) {
        printError('usage: hook-events <session> [options]');
        return 1;
      }
      return cmdView({
        sessionId: positional[0]!,
        eventTypes: flags.eventTypes as string[] | undefined,
        toolNames: flags.toolNames as string[] | undefined,
        last: flags.last as number | undefined,
        first: flags.first as number | undefined,
        fromTime: flags.fromTime as string | undefined,
        toTime: flags.toTime as string | undefined,
        limit: flags.limit as number | undefined,
        offset: flags.offset as number | undefined,
        format: (flags.format as OutputFormat) || 'human',
        pretty: flags.pretty as boolean | undefined,
        output: flags.output as string | undefined,
        tail: flags.tail as boolean | undefined,
        watch: flags.watch as boolean | undefined,
      });

    case 'list':
      return cmdList({
        recent: flags.recent as number | undefined,
        names: flags.names as boolean | undefined,
        json: flags.json as boolean | undefined,
      });

    case 'info':
      if (positional.length === 0) {
        printError('usage: hook-events info <session>');
        return 1;
      }
      return cmdInfo(positional[0]!);

    case 'search':
      if (positional.length === 0) {
        printError('usage: hook-events search <query> [options]');
        return 1;
      }
      return cmdSearch(positional.join(' '), {
        limit: flags.limit as number | undefined,
        json: flags.json as boolean | undefined,
      });

    default:
      printHelp();
      return 0;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
