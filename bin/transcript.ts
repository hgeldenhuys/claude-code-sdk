#!/usr/bin/env bun
/**
 * transcript - Claude Code Transcript Viewer CLI
 *
 * View, filter, and query Claude Code session transcripts.
 *
 * Usage:
 *   transcript <file|session> [options]     View transcript with filters
 *   transcript list [options]               List available transcripts
 *   transcript search <query> [options]     Search across transcripts
 *   transcript info <file|session>          Show transcript metadata
 *   transcript help                         Show help
 *
 * Examples:
 *   transcript my-session --last 10 --user-prompts
 *   transcript ./session.jsonl --type assistant --human
 *   transcript list --recent 7
 *   transcript search "error handling" --limit 20
 */

import { join } from 'node:path';
import { watch, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseTranscriptFile } from '../src/transcripts/parser';
import type { TranscriptLine } from '../src/transcripts/types';
import {
  findTranscriptFiles,
  getSessionInfo,
  indexTranscripts,
} from '../src/transcripts/indexer';
import { searchTranscripts } from '../src/transcripts/search';
import {
  getDatabase,
  initSchema,
  indexAllTranscripts,
  rebuildIndex,
  getDbStats,
  isDatabaseReady,
  searchDb,
  updateIndex,
  watchTranscripts,
  indexAllHookFiles,
  updateHookIndex,
  watchHookFiles,
  DEFAULT_DB_PATH,
} from '../src/transcripts/db';
import {
  filterLines,
  formatJson,
  formatMinimal,
  formatTailLine,
  getSessionMetadata,
  parseTimestamp,
  renderLine,
  type ExtendedLineType,
  type FilterOptions,
  type OutputFormat,
} from '../src/transcripts/viewer';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0';
const PROJECTS_DIR = join(process.env.HOME || '~', '.claude', 'projects');
const DAEMON_DIR = join(process.env.HOME || '~', '.claude-code-sdk');
const PID_FILE = join(DAEMON_DIR, 'transcript-daemon.pid');
const LOG_FILE = join(DAEMON_DIR, 'transcript-daemon.log');

// Valid line types for filtering
const VALID_TYPES: ExtendedLineType[] = [
  'user',
  'assistant',
  'tool_use',
  'tool_result',
  'system',
  'thinking',
  'text',
  'file-history-snapshot',
  'summary',
  'progress',
  'hook_progress',
  'message',
  'create',
  'update',
  'queue-operation',
];

// ============================================================================
// Helpers
// ============================================================================

function printError(message: string): void {
  console.error(`error: ${message}`);
}

function printHelp(): void {
  console.log(`transcript v${VERSION} - Claude Code Transcript Viewer

Usage:
  transcript <file|session> [options]     View transcript with filters
  transcript list [options]               List available transcripts
  transcript search <query> [options]     Search across transcripts
  transcript index [build|status|rebuild] Manage SQLite search index
  transcript info <file|session>          Show transcript metadata
  transcript doctor                       Diagnose transcript indexing configuration
  transcript help                         Show this help

View Options:
  --type, -t <types>      Filter by type (comma-separated)
                          Valid: ${VALID_TYPES.join(', ')}
  --last, -n <count>      Show last N entries
  --first <count>         Show first N entries
  --from <line>           Start from line number
  --to <line>             End at line number
  --from-time <time>      Filter entries after timestamp (ISO or "1h ago")
  --to-time <time>        Filter entries before timestamp (ISO or "2d ago")
  --offset <n>            Skip first N entries
  --limit <n>             Limit to N entries

Convenience Filters:
  --user-prompts, -u      Only user prompts
  --assistant, -a         Only assistant responses
  --tools                 Only tool use/result entries
  --thinking              Only thinking blocks

Output Formats:
  --json                  Raw JSON (one per line)
  --human, -h             Human-readable format
  --minimal, -m           Just the text content
  --pretty                Pretty-print JSON
  --output, -o <file>     Write output to file instead of stdout

Live Modes:
  --tail                  Stream new entries as they are added
  --watch                 Show last entry, update on change

Search Options:
  --search <query>        Filter lines containing query

Session Filters:
  --session <ids>         Filter by session ID(s) (comma-separated)
  --session-name <name>   Filter by session name (uses sesh lookup)

List Options:
  --recent <days>         Show transcripts from last N days
  --project <path>        Filter by project path
  --names                 Show session names only

Index Commands:
  transcript index build    Build SQLite index from all transcripts
  transcript index update   Update index with only new content (fast delta)
  transcript index watch    Watch for changes and update index in real-time
  transcript index status   Show index status and statistics
  transcript index rebuild  Clear and rebuild entire index
  --use-index              Force search to use SQLite index (auto-detected)

Daemon Commands:
  transcript index daemon start   Start background indexer daemon
  transcript index daemon stop    Stop the background daemon
  transcript index daemon status  Show daemon status
  transcript index daemon logs    Show daemon logs

Doctor Command:
  transcript doctor               Check indexing pipeline configuration
                                  - Daemon status (running/stopped)
                                  - Database health and freshness
                                  - Hook event logging configuration
                                  - Claude Code hooks integration

Examples:
  # View last 10 user prompts from a session
  transcript my-session --last 10 --user-prompts

  # View all assistant responses in human format
  transcript ./file.jsonl --assistant --human

  # Filter by timestamp (last 2 hours)
  transcript my-session --from-time "2h ago" --assistant

  # Stream new entries in real-time
  transcript my-session --tail

  # Watch for updates to the last entry
  transcript my-session --watch --assistant

  # Export to file
  transcript my-session --assistant --human --output report.txt

  # Search for error handling discussions
  transcript search "error handling" --limit 20

  # List recent transcripts
  transcript list --recent 7

  # Pipe tool results to jq
  transcript ./file.jsonl --tools --json | jq '.message.content'

  # Get session info
  transcript info cryptic-crunching-candle`);
}

function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Resolve a file path or session identifier to an actual file path
 */
async function resolveTranscriptPath(input: string): Promise<string | null> {
  // If it looks like a file path and exists, use it directly
  const file = Bun.file(input);
  if (await file.exists()) {
    return input;
  }

  // Try as absolute path
  if (input.startsWith('/')) {
    return null; // Already checked, doesn't exist
  }

  // Try as relative path from current directory
  const relativePath = join(process.cwd(), input);
  const relativeFile = Bun.file(relativePath);
  if (await relativeFile.exists()) {
    return relativePath;
  }

  // Try to find by session ID or name
  const files = await findTranscriptFiles(PROJECTS_DIR);

  // Check for exact session ID match in filename
  for (const filePath of files) {
    if (filePath.includes(input)) {
      return filePath;
    }
  }

  // Check for slug match in file content (more expensive)
  for (const filePath of files) {
    try {
      const info = await getSessionInfo(filePath);
      if (info.slug === input || info.sessionId === input) {
        return filePath;
      }
    } catch {
      continue;
    }
  }

  // Try sesh integration if available
  try {
    const { getSessionStore } = await import('../src/hooks/sessions');
    const store = getSessionStore();
    const sessionId = store.getSessionId(input);
    if (sessionId) {
      // Find file with this session ID
      for (const filePath of files) {
        if (filePath.includes(sessionId)) {
          return filePath;
        }
      }
    }
  } catch {
    // sesh not available, continue
  }

  return null;
}

// ============================================================================
// Commands
// ============================================================================

interface ViewArgs {
  file: string;
  types?: string;
  last?: number;
  first?: number;
  from?: number;
  to?: number;
  fromTime?: string;
  toTime?: string;
  offset?: number;
  limit?: number;
  userPrompts?: boolean;
  assistant?: boolean;
  tools?: boolean;
  thinking?: boolean;
  search?: string;
  sessionIds?: string[];
  sessionNameLookup?: string;
  format: OutputFormat;
  pretty?: boolean;
  output?: string;
  tail?: boolean;
  watch?: boolean;
}

async function cmdView(args: ViewArgs): Promise<number> {
  let filePath: string | null = null;

  // If we have a session name but no file, resolve the transcript from session name
  if (!args.file && args.sessionNameLookup) {
    try {
      const { getSessionStore } = await import('../src/hooks/sessions');
      const store = getSessionStore();
      const session = store.getByName(args.sessionNameLookup);
      if (session?.transcriptPath) {
        filePath = session.transcriptPath;
      } else {
        // Try to find by session ID lookup
        const sessionId = store.getSessionId(args.sessionNameLookup);
        if (sessionId) {
          // Search for transcript with this session ID
          const files = await findTranscriptFiles(PROJECTS_DIR);
          for (const fp of files) {
            if (fp.includes(sessionId)) {
              filePath = fp;
              break;
            }
          }
        }
      }
    } catch {
      // Session store not available
    }
  } else if (args.file) {
    filePath = await resolveTranscriptPath(args.file);
  }

  if (!filePath) {
    printError(`transcript not found: ${args.sessionNameLookup || args.file}`);
    return 1;
  }

  try {
    // Build filter options
    const filterOpts: FilterOptions = {
      last: args.last,
      first: args.first,
      fromLine: args.from,
      toLine: args.to,
      offset: args.offset,
      limit: args.limit,
      userPrompts: args.userPrompts,
      assistant: args.assistant,
      tools: args.tools,
      thinking: args.thinking,
      search: args.search,
      sessionIds: args.sessionIds,
    };

    // Handle session name lookup
    if (args.sessionNameLookup) {
      try {
        const { getSessionStore } = await import('../src/hooks/sessions');
        const store = getSessionStore();
        const sessionId = store.getSessionId(args.sessionNameLookup);
        if (sessionId) {
          filterOpts.sessionIds = filterOpts.sessionIds || [];
          filterOpts.sessionIds.push(sessionId);
        } else {
          printError(`Session name not found: ${args.sessionNameLookup}`);
          return 1;
        }
      } catch {
        printError(`Session name lookup failed: ${args.sessionNameLookup}`);
        return 1;
      }
    }

    // Parse timestamp filters
    if (args.fromTime) {
      try {
        filterOpts.fromTime = parseTimestamp(args.fromTime);
      } catch (err) {
        printError(`invalid --from-time: ${args.fromTime}`);
        return 1;
      }
    }
    if (args.toTime) {
      try {
        filterOpts.toTime = parseTimestamp(args.toTime);
      } catch (err) {
        printError(`invalid --to-time: ${args.toTime}`);
        return 1;
      }
    }

    // Parse types
    if (args.types) {
      const typeList = args.types.split(',').map((t) => t.trim()) as ExtendedLineType[];
      const invalidTypes = typeList.filter((t) => !VALID_TYPES.includes(t));
      if (invalidTypes.length > 0) {
        printError(`invalid types: ${invalidTypes.join(', ')}`);
        return 1;
      }
      filterOpts.types = typeList;
    }

    // Handle --tail mode (live streaming)
    if (args.tail) {
      return tailMode(filePath, filterOpts, args.format, args.pretty);
    }

    // Handle --watch mode (live update last entry)
    if (args.watch) {
      return watchMode(filePath, filterOpts, args.format, args.pretty);
    }

    // Standard view mode
    const lines = await parseTranscriptFile(filePath);

    // Filter lines
    const filtered = filterLines(lines, filterOpts);

    if (filtered.length === 0) {
      console.log('No matching lines found.');
      return 0;
    }

    // Build output
    const outputLines: string[] = [];
    for (const line of filtered) {
      switch (args.format) {
        case 'json':
          outputLines.push(formatJson(line, args.pretty));
          break;
        case 'minimal':
          const minimal = formatMinimal(line);
          if (minimal) outputLines.push(minimal);
          break;
        case 'human':
          const rendered = renderLine(line);
          outputLines.push(rendered.fullContent);
          outputLines.push('');
          break;
        default:
          // Raw format - just the JSON line
          outputLines.push(line.raw);
      }
    }

    const output = outputLines.join('\n');

    // Write to file or stdout
    if (args.output) {
      await Bun.write(args.output, output);
      console.log(`Output written to: ${args.output}`);
    } else {
      console.log(output);
    }

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/**
 * Tail mode: stream new entries as they are added
 */
async function tailMode(
  filePath: string,
  filterOpts: FilterOptions,
  format: OutputFormat,
  pretty?: boolean
): Promise<number> {
  let lastLineCount = 0;

  // Helper to format a line based on the selected format
  const formatLine = (line: TranscriptLine): string | null => {
    switch (format) {
      case 'json':
        return formatJson(line, pretty);
      case 'minimal':
        return formatMinimal(line);
      case 'human': {
        const rendered = renderLine(line);
        return rendered.fullContent + '\n';
      }
      default:
        return formatTailLine(line);
    }
  };

  // Print existing last few lines
  const initialLines = await parseTranscriptFile(filePath);
  const initialFiltered = filterLines(initialLines, { ...filterOpts, last: 10 });
  for (const line of initialFiltered) {
    const formatted = formatLine(line);
    if (formatted) console.log(formatted);
  }
  lastLineCount = initialLines.length;

  // Watch for changes
  console.log('\n--- Watching for new entries (Ctrl+C to stop) ---\n');

  let debounce: ReturnType<typeof setTimeout> | null = null;

  watch(filePath, async (event) => {
    if (event === 'change') {
      // Debounce rapid changes (macOS can fire multiple events)
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        try {
          const allLines = await parseTranscriptFile(filePath);
          if (allLines.length > lastLineCount) {
            // Get only new lines
            const newLines = allLines.slice(lastLineCount);
            const filtered = filterLines(newLines, filterOpts);
            for (const line of filtered) {
              const formatted = formatLine(line);
              if (formatted) console.log(formatted);
            }
            lastLineCount = allLines.length;
          }
        } catch (err) {
          // Ignore transient read errors during writes
        }
      }, 100);
    }
  });

  // Keep process alive
  await new Promise(() => {});
  return 0;
}

/**
 * Watch mode: show last entry, update on change
 */
async function watchMode(
  filePath: string,
  filterOpts: FilterOptions,
  format: OutputFormat,
  pretty?: boolean
): Promise<number> {
  const renderLast = async () => {
    // Clear screen
    process.stdout.write('\x1b[2J\x1b[H');

    const lines = await parseTranscriptFile(filePath);
    const filtered = filterLines(lines, filterOpts);

    if (filtered.length > 0) {
      const last = filtered[filtered.length - 1]!;
      if (format === 'json') {
        console.log(formatJson(last, pretty));
      } else if (format === 'minimal') {
        const minimal = formatMinimal(last);
        if (minimal) console.log(minimal);
      } else if (format === 'human') {
        const rendered = renderLine(last);
        console.log(rendered.fullContent);
      } else {
        // Raw/default
        console.log(last.raw);
      }
      console.log('\n--- Watching for updates (Ctrl+C to stop) ---');
    } else {
      console.log('No matching entries found.');
      console.log('\n--- Watching for updates (Ctrl+C to stop) ---');
    }
  };

  await renderLast();

  let debounce: ReturnType<typeof setTimeout> | null = null;

  watch(filePath, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(renderLast, 100); // Debounce for macOS
  });

  // Keep process alive
  await new Promise(() => {});
  return 0;
}

interface ListArgs {
  recent?: number;
  project?: string;
  names?: boolean;
  json?: boolean;
}

async function cmdList(args: ListArgs): Promise<number> {
  try {
    const index = await indexTranscripts(PROJECTS_DIR);

    let files = index.files;

    // Filter by recent days
    if (args.recent) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - args.recent);
      files = files.filter((f) => {
        const date = new Date(f.lastTimestamp);
        return date >= cutoff;
      });
    }

    // Filter by project
    if (args.project) {
      files = files.filter((f) => f.path.includes(args.project!));
    }

    if (files.length === 0) {
      console.log('No transcripts found.');
      return 0;
    }

    if (args.json) {
      console.log(JSON.stringify(files, null, 2));
      return 0;
    }

    if (args.names) {
      for (const file of files) {
        console.log(file.slug || file.sessionId);
      }
      return 0;
    }

    // Table format
    console.log('SESSION                   LINES   LAST MODIFIED');
    console.log('-'.repeat(60));

    for (const file of files) {
      const name = (file.slug || file.sessionId.slice(0, 8)).padEnd(24).slice(0, 24);
      const lines = String(file.lineCount).padStart(6);
      const date = formatDate(file.lastTimestamp);
      console.log(`${name} ${lines}   ${date}`);
    }

    console.log(`\nTotal: ${files.length} transcript(s)`);

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

interface SearchArgs {
  query: string;
  limit?: number;
  types?: string;
  json?: boolean;
  sessionIds?: string[];
  sessionName?: string;
}

async function cmdSearch(args: SearchArgs): Promise<number> {
  try {
    const types = args.types
      ? (args.types.split(',').map((t) => t.trim()) as ExtendedLineType[])
      : undefined;

    const results = await searchTranscripts({
      query: args.query,
      limit: args.limit || 50,
      types: types as any,
      sessionIds: args.sessionIds,
      sessionName: args.sessionName,
    });

    if (results.length === 0) {
      console.log(`No results found for "${args.query}"`);
      return 0;
    }

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
      return 0;
    }

    console.log(`Found ${results.length} result(s) for "${args.query}":\n`);

    for (const result of results) {
      const slug = result.line.slug || result.sessionId.slice(0, 8);
      const date = formatDate(result.line.timestamp);
      console.log(`[${slug}] Line ${result.line.lineNumber} (${result.line.type}) - ${date}`);
      console.log(`  ${result.matchedText}`);
      console.log('');
    }

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function cmdInfo(input: string): Promise<number> {
  const filePath = await resolveTranscriptPath(input);
  if (!filePath) {
    printError(`transcript not found: ${input}`);
    return 1;
  }

  try {
    const lines = await parseTranscriptFile(filePath);
    const metadata = getSessionMetadata(lines);
    const info = await getSessionInfo(filePath);

    console.log('Transcript Information\n');
    console.log(`File:           ${filePath}`);
    console.log(`Session ID:     ${info.sessionId}`);
    if (info.slug) console.log(`Session Name:   ${info.slug}`);
    console.log(`Line Count:     ${info.lineCount}`);
    console.log(`First Entry:    ${formatDate(info.firstTimestamp)}`);
    console.log(`Last Entry:     ${formatDate(info.lastTimestamp)}`);

    if (metadata.version) console.log(`Version:        ${metadata.version}`);
    if (metadata.cwd) console.log(`Working Dir:    ${metadata.cwd}`);
    if (metadata.gitBranch) console.log(`Git Branch:     ${metadata.gitBranch}`);

    console.log('\nMessage Types:');
    for (const [type, count] of Object.entries(info.messageTypes)) {
      console.log(`  ${type.padEnd(20)} ${count}`);
    }

    return 0;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

interface IndexArgs {
  subcommand: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Daemon Functions
// ============================================================================

function getDaemonPid(): number | null {
  try {
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      if (!isNaN(pid) && pid > 0) {
        // Check if process is actually running
        try {
          process.kill(pid, 0); // Signal 0 just checks if process exists
          return pid;
        } catch {
          // Process doesn't exist, clean up stale PID file
          unlinkSync(PID_FILE);
          return null;
        }
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function writeDaemonPid(pid: number): void {
  writeFileSync(PID_FILE, String(pid));
}

function removeDaemonPid(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE);
    }
  } catch {
    // Ignore
  }
}

function appendLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  try {
    const fd = Bun.file(LOG_FILE);
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf-8') : '';
    writeFileSync(LOG_FILE, existing + logLine);
  } catch {
    // Ignore logging errors
  }
}

async function startDaemon(): Promise<number> {
  const existingPid = getDaemonPid();
  if (existingPid) {
    console.log(`Daemon already running (PID: ${existingPid})`);
    return 0;
  }

  if (!isDatabaseReady()) {
    console.log('No existing index found. Run "transcript index build" first.');
    return 1;
  }

  // Spawn detached child process
  const child = spawn('bun', [process.argv[1]!, 'index', 'daemon', '--run'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, TRANSCRIPT_DAEMON: '1' },
  });

  child.unref();

  if (child.pid) {
    writeDaemonPid(child.pid);
    console.log(`Daemon started (PID: ${child.pid})`);
    console.log(`Logs: ${LOG_FILE}`);
    return 0;
  } else {
    console.log('Failed to start daemon');
    return 1;
  }
}

async function stopDaemon(): Promise<number> {
  const pid = getDaemonPid();
  if (!pid) {
    console.log('Daemon is not running');
    return 0;
  }

  try {
    process.kill(pid, 'SIGTERM');
    removeDaemonPid();
    console.log(`Daemon stopped (PID: ${pid})`);
    return 0;
  } catch (err) {
    console.log(`Failed to stop daemon: ${err}`);
    return 1;
  }
}

function showDaemonStatus(): number {
  const pid = getDaemonPid();
  if (pid) {
    console.log(`Daemon is running (PID: ${pid})`);
    console.log(`PID file: ${PID_FILE}`);
    console.log(`Log file: ${LOG_FILE}`);
  } else {
    console.log('Daemon is not running');
  }
  return 0;
}

function showDaemonLogs(lines: number = 50): number {
  if (!existsSync(LOG_FILE)) {
    console.log('No logs found');
    return 0;
  }

  try {
    const content = readFileSync(LOG_FILE, 'utf-8');
    const allLines = content.trim().split('\n');
    const lastLines = allLines.slice(-lines);
    console.log(lastLines.join('\n'));
  } catch (err) {
    console.log(`Failed to read logs: ${err}`);
    return 1;
  }
  return 0;
}

async function runDaemonProcess(): Promise<number> {
  // This runs in the background as the actual daemon
  appendLog('Daemon started');

  const db = getDatabase();
  initSchema(db);

  // Do an initial update for transcripts
  const transcriptResult = await updateIndex(db);
  appendLog(`Initial transcript update: ${transcriptResult.filesUpdated} files, +${transcriptResult.newLines} lines`);

  // Do an initial update for hook events
  const hookResult = await updateHookIndex(db);
  appendLog(`Initial hook update: ${hookResult.filesUpdated} files, +${hookResult.newEvents} events`);

  // Start watching transcripts
  const cleanupTranscripts = watchTranscripts(db, undefined, (file, newLines) => {
    const fileName = file.split('/').pop() || file;
    appendLog(`[transcript] ${fileName}: +${newLines} lines indexed`);
  });

  // Start watching hook events
  const cleanupHooks = watchHookFiles(db, undefined, (file, newEvents) => {
    const fileName = file.split('/').pop() || file;
    appendLog(`[hooks] ${fileName}: +${newEvents} events indexed`);
  });

  // Handle shutdown signals
  const shutdown = () => {
    appendLog('Daemon stopping...');
    cleanupTranscripts();
    cleanupHooks();
    db.close();
    removeDaemonPid();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Keep alive
  await new Promise(() => {});
  return 0;
}

async function cmdIndex(args: IndexArgs): Promise<number> {
  const { subcommand } = args;

  try {
    switch (subcommand) {
      case 'status': {
        if (!isDatabaseReady()) {
          console.log('SQLite index not found or empty.');
          console.log(`\nRun 'transcript index build' to create the index.`);
          return 0;
        }

        const db = getDatabase();
        const stats = getDbStats(db);
        db.close();

        console.log('SQLite Index Status\n');
        console.log(`Database:       ${stats.dbPath}`);
        console.log(`Size:           ${formatBytes(stats.dbSizeBytes)}`);
        console.log(`Version:        ${stats.version}`);
        console.log('');
        console.log('Transcripts:');
        console.log(`  Lines indexed:  ${stats.lineCount.toLocaleString()}`);
        console.log(`  Sessions:       ${stats.sessionCount.toLocaleString()}`);
        console.log('');
        console.log('Hook Events:');
        console.log(`  Events indexed: ${stats.hookEventCount.toLocaleString()}`);
        console.log(`  Hook files:     ${stats.hookFileCount.toLocaleString()}`);
        console.log('');
        console.log(`Last indexed:   ${stats.lastIndexed ? formatDate(stats.lastIndexed) : 'never'}`);
        return 0;
      }

      case 'build': {
        console.log('Building SQLite index...\n');

        const db = getDatabase();
        initSchema(db);

        const startTime = Date.now();

        // Index transcripts
        console.log('Indexing transcripts...');
        const transcriptResult = await indexAllTranscripts(db, undefined, (file, current, total, lines) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
          process.stdout.write(`\r  [${current}/${total}] ${shortName.padEnd(40)} (${lines} lines)`);
        });
        console.log(`\n  Indexed ${transcriptResult.filesIndexed} files, ${transcriptResult.linesIndexed.toLocaleString()} lines`);

        // Index hook events
        console.log('\nIndexing hook events...');
        const hookResult = await indexAllHookFiles(db, undefined, (file, current, total, events) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
          process.stdout.write(`\r  [${current}/${total}] ${shortName.padEnd(40)} (${events} events)`);
        });
        console.log(`\n  Indexed ${hookResult.filesIndexed} files, ${hookResult.eventsIndexed.toLocaleString()} events`);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\nTotal time: ${elapsed}s`);

        const stats = getDbStats(db);
        console.log(`Database size: ${formatBytes(stats.dbSizeBytes)}`);
        db.close();
        return 0;
      }

      case 'rebuild': {
        console.log('Rebuilding SQLite index (clearing existing data)...\n');

        const db = getDatabase();
        initSchema(db);
        rebuildIndex(db);

        const startTime = Date.now();

        // Index transcripts
        console.log('Indexing transcripts...');
        const transcriptResult = await indexAllTranscripts(db, undefined, (file, current, total, lines) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
          process.stdout.write(`\r  [${current}/${total}] ${shortName.padEnd(40)} (${lines} lines)`);
        });
        console.log(`\n  Indexed ${transcriptResult.filesIndexed} files, ${transcriptResult.linesIndexed.toLocaleString()} lines`);

        // Index hook events
        console.log('\nIndexing hook events...');
        const hookResult = await indexAllHookFiles(db, undefined, (file, current, total, events) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
          process.stdout.write(`\r  [${current}/${total}] ${shortName.padEnd(40)} (${events} events)`);
        });
        console.log(`\n  Indexed ${hookResult.filesIndexed} files, ${hookResult.eventsIndexed.toLocaleString()} events`);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\nTotal time: ${elapsed}s`);

        const stats = getDbStats(db);
        console.log(`Database size: ${formatBytes(stats.dbSizeBytes)}`);
        db.close();
        return 0;
      }

      case 'update': {
        if (!isDatabaseReady()) {
          console.log('No existing index found. Run "transcript index build" first.');
          return 1;
        }

        console.log('Updating index with new content...\n');

        const db = getDatabase();
        initSchema(db);

        const startTime = Date.now();

        // Update transcripts
        console.log('Transcripts:');
        let transcriptSkipped = 0;
        const transcriptResult = await updateIndex(db, undefined, (file, current, total, newLines, skipped) => {
          if (skipped) {
            transcriptSkipped++;
          } else if (newLines > 0) {
            const fileName = file.split('/').pop() || file;
            const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
            console.log(`  ${shortName}: +${newLines} lines`);
          }
        });
        console.log(`  Checked ${transcriptResult.filesChecked} files, updated ${transcriptResult.filesUpdated}, +${transcriptResult.newLines.toLocaleString()} lines`);

        // Update hook events
        console.log('\nHook Events:');
        let hookSkipped = 0;
        const hookResult = await updateHookIndex(db, undefined, (file, current, total, newEvents, skipped) => {
          if (skipped) {
            hookSkipped++;
          } else if (newEvents > 0) {
            const fileName = file.split('/').pop() || file;
            const shortName = fileName.length > 40 ? fileName.slice(0, 37) + '...' : fileName;
            console.log(`  ${shortName}: +${newEvents} events`);
          }
        });
        console.log(`  Checked ${hookResult.filesChecked} files, updated ${hookResult.filesUpdated}, +${hookResult.newEvents.toLocaleString()} events`);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`\nTotal time: ${elapsed}s`);
        db.close();
        return 0;
      }

      case 'watch': {
        if (!isDatabaseReady()) {
          console.log('No existing index found. Run "transcript index build" first.');
          return 1;
        }

        console.log('Watching for transcript and hook changes (Ctrl+C to stop)...\n');

        const db = getDatabase();
        initSchema(db);

        const cleanupTranscripts = watchTranscripts(db, undefined, (file, newLines) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 50 ? fileName.slice(0, 47) + '...' : fileName;
          const time = new Date().toLocaleTimeString();
          console.log(`[${time}] [transcript] ${shortName}: +${newLines} lines indexed`);
        });

        const cleanupHooks = watchHookFiles(db, undefined, (file, newEvents) => {
          const fileName = file.split('/').pop() || file;
          const shortName = fileName.length > 50 ? fileName.slice(0, 47) + '...' : fileName;
          const time = new Date().toLocaleTimeString();
          console.log(`[${time}] [hooks] ${shortName}: +${newEvents} events indexed`);
        });

        // Handle Ctrl+C
        process.on('SIGINT', () => {
          console.log('\nStopping watch...');
          cleanupTranscripts();
          cleanupHooks();
          db.close();
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {});
        return 0;
      }

      case 'daemon': {
        // daemon subcommand requires a second argument
        const daemonArg = process.argv[4] || '';

        if (daemonArg === '--run') {
          // Actually run the daemon process (called by start)
          return runDaemonProcess();
        }

        switch (daemonArg) {
          case 'start':
            return startDaemon();
          case 'stop':
            return stopDaemon();
          case 'status':
            return showDaemonStatus();
          case 'logs':
            return showDaemonLogs();
          default:
            console.log('Usage: transcript index daemon <command>');
            console.log('\nCommands:');
            console.log('  start   Start the background indexer daemon');
            console.log('  stop    Stop the daemon');
            console.log('  status  Show daemon status');
            console.log('  logs    Show recent daemon logs');
            return 0;
        }
      }

      default:
        console.log('Usage: transcript index <command>');
        console.log('\nCommands:');
        console.log('  build    Build SQLite index from all transcript files');
        console.log('  update   Update index with only new content (fast delta)');
        console.log('  watch    Watch for changes and update in real-time');
        console.log('  status   Show index status and statistics');
        console.log('  rebuild  Clear and rebuild entire index');
        console.log('  daemon   Manage background indexer daemon');
        return 0;
    }
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }
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

    if (arg === 'version' || arg === '--version' || arg === '-v') {
      command = 'version';
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

    if (arg === 'index') {
      command = 'index';
      continue;
    }

    if (arg === 'doctor') {
      command = 'doctor';
      continue;
    }

    // Flags with values
    if (arg === '--type' || arg === '-t') {
      flags.types = args[++i] || '';
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
    if (arg === '--from') {
      flags.from = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--to') {
      flags.to = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--offset') {
      flags.offset = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--limit') {
      flags.limit = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--search') {
      flags.search = args[++i] || '';
      continue;
    }
    if (arg === '--session' || arg === '-s') {
      const ids = args[++i]?.split(',').map((s) => s.trim()) || [];
      flags.sessionIds = ids;
      continue;
    }
    if (arg === '--session-name') {
      const name = args[++i];
      if (name) {
        flags.sessionNameLookup = name;
      }
      continue;
    }
    if (arg === '--recent') {
      flags.recent = parseInt(args[++i]!, 10);
      continue;
    }
    if (arg === '--project') {
      flags.project = args[++i] || '';
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

    // Boolean flags
    if (arg === '--user-prompts' || arg === '-u') {
      flags.userPrompts = true;
      continue;
    }
    if (arg === '--assistant' || arg === '-a') {
      flags.assistant = true;
      continue;
    }
    if (arg === '--tools') {
      flags.tools = true;
      continue;
    }
    if (arg === '--thinking') {
      flags.thinking = true;
      continue;
    }
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
    if (arg === '--use-index') {
      flags.useIndex = true;
      continue;
    }

    // Positional argument
    if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  // Default command is view if we have a positional arg or session-name
  if (!command && (positional.length > 0 || flags.sessionNameLookup)) {
    command = 'view';
  }

  return { command, positional, flags };
}

// ============================================================================
// Doctor Command
// ============================================================================

interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

async function cmdDoctor(): Promise<number> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const results: DiagnosticResult[] = [];
  const cwd = process.cwd();

  console.log('Transcript Indexer Doctor\n');
  console.log('Checking configuration...\n');

  // 1. Check daemon status
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 0); // Check if process exists
        results.push({
          name: 'Daemon status',
          status: 'pass',
          message: `Running (PID: ${pid})`,
        });
      } catch {
        results.push({
          name: 'Daemon status',
          status: 'warn',
          message: 'PID file exists but process not running. Run: transcript index daemon start',
        });
      }
    } catch {
      results.push({
        name: 'Daemon status',
        status: 'warn',
        message: 'Could not read PID file',
      });
    }
  } else {
    results.push({
      name: 'Daemon status',
      status: 'warn',
      message: 'Not running. Run: transcript index daemon start',
    });
  }

  // 2. Check database exists and is valid
  if (fs.existsSync(DEFAULT_DB_PATH)) {
    try {
      const stats = fs.statSync(DEFAULT_DB_PATH);
      const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
      results.push({
        name: 'Database file',
        status: 'pass',
        message: `Found (${sizeMb} MB)`,
      });

      // Check database health
      try {
        const db = getDatabase();
        const dbStats = getDbStats(db, DEFAULT_DB_PATH);
        results.push({
          name: 'Database health',
          status: 'pass',
          message: `${dbStats.lineCount.toLocaleString()} lines, ${dbStats.sessionCount} sessions`,
        });

        // Check hook events
        if (dbStats.hookEventCount !== undefined && dbStats.hookEventCount > 0) {
          results.push({
            name: 'Hook events indexed',
            status: 'pass',
            message: `${dbStats.hookEventCount.toLocaleString()} events from ${dbStats.hookFileCount || 0} files`,
          });
        } else {
          results.push({
            name: 'Hook events indexed',
            status: 'warn',
            message: 'No hook events indexed yet',
          });
        }

        // Check freshness
        const lastIndexed = db.query('SELECT value FROM metadata WHERE key = ?').get('last_indexed') as { value: string } | null;
        if (lastIndexed) {
          const lastTime = new Date(lastIndexed.value);
          const ageMinutes = Math.floor((Date.now() - lastTime.getTime()) / 60000);
          if (ageMinutes < 5) {
            results.push({
              name: 'Index freshness',
              status: 'pass',
              message: `Last indexed ${ageMinutes} minutes ago`,
            });
          } else if (ageMinutes < 60) {
            results.push({
              name: 'Index freshness',
              status: 'pass',
              message: `Last indexed ${ageMinutes} minutes ago`,
            });
          } else {
            const ageHours = Math.floor(ageMinutes / 60);
            results.push({
              name: 'Index freshness',
              status: 'warn',
              message: `Last indexed ${ageHours} hours ago. Consider running: transcript index update`,
            });
          }
        }
        db.close();
      } catch (error) {
        results.push({
          name: 'Database health',
          status: 'fail',
          message: `Error reading database: ${error instanceof Error ? error.message : error}`,
        });
      }
    } catch (error) {
      results.push({
        name: 'Database file',
        status: 'fail',
        message: `Error: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'Database file',
      status: 'fail',
      message: 'Not found. Run: transcript index build',
    });
  }

  // 3. Check hooks.yaml for event-logger
  const hooksYamlPaths = [
    path.join(cwd, 'hooks.yaml'),
    path.join(cwd, 'hooks.yml'),
    path.join(cwd, '.claude', 'hooks.yaml'),
    path.join(cwd, '.claude', 'hooks.yml'),
  ];

  let foundHooksConfig: string | null = null;
  for (const p of hooksYamlPaths) {
    if (fs.existsSync(p)) {
      foundHooksConfig = p;
      break;
    }
  }

  if (foundHooksConfig) {
    try {
      const yaml = await import('yaml');
      const content = fs.readFileSync(foundHooksConfig, 'utf-8');
      const config = yaml.parse(content);
      const builtins = config.builtins || {};
      const eventLogger = builtins['event-logger'] as { enabled?: boolean } | undefined;

      if (eventLogger?.enabled) {
        results.push({
          name: 'Event logger (hooks.yaml)',
          status: 'pass',
          message: 'Enabled - hook events will be logged',
        });
      } else {
        results.push({
          name: 'Event logger (hooks.yaml)',
          status: 'warn',
          message: 'Disabled. Enable event-logger in hooks.yaml for hook event tracking',
        });
      }
    } catch (error) {
      results.push({
        name: 'Event logger (hooks.yaml)',
        status: 'warn',
        message: `Could not parse hooks.yaml: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'Event logger (hooks.yaml)',
      status: 'warn',
      message: 'No hooks.yaml found. Hook event logging not configured.',
    });
  }

  // 4. Check .claude/settings.json for hooks integration
  const settingsPath = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.hooks) {
        const eventCount = Object.keys(settings.hooks).length;
        // Check if hooks route through framework
        let routesThroughFramework = false;
        for (const [_event, matchers] of Object.entries(settings.hooks)) {
          const matcherArray = matchers as Array<{ hooks?: Array<{ command?: string }> }>;
          for (const matcher of matcherArray) {
            for (const hook of matcher.hooks || []) {
              if (hook.command?.includes('hooks.ts') || hook.command?.includes('hooks.yaml')) {
                routesThroughFramework = true;
                break;
              }
            }
          }
        }

        if (routesThroughFramework) {
          results.push({
            name: 'Claude Code hooks integration',
            status: 'pass',
            message: `${eventCount} events configured, routing through framework`,
          });
        } else {
          results.push({
            name: 'Claude Code hooks integration',
            status: 'warn',
            message: `${eventCount} events configured but not routing through hooks framework`,
          });
        }
      } else {
        results.push({
          name: 'Claude Code hooks integration',
          status: 'warn',
          message: 'No hooks configured in .claude/settings.json',
        });
      }
    } catch (error) {
      results.push({
        name: 'Claude Code hooks integration',
        status: 'warn',
        message: `Could not parse settings.json: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'Claude Code hooks integration',
      status: 'warn',
      message: 'No .claude/settings.json found',
    });
  }

  // 5. Check hook events directory
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  if (fs.existsSync(hooksDir)) {
    try {
      const projects = fs.readdirSync(hooksDir).filter(f => {
        const stat = fs.statSync(path.join(hooksDir, f));
        return stat.isDirectory();
      });

      let totalFiles = 0;
      for (const project of projects) {
        const projectDir = path.join(hooksDir, project);
        const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.hooks.jsonl'));
        totalFiles += files.length;
      }

      if (totalFiles > 0) {
        results.push({
          name: 'Hook event files',
          status: 'pass',
          message: `${totalFiles} .hooks.jsonl files in ${projects.length} projects`,
        });
      } else {
        results.push({
          name: 'Hook event files',
          status: 'warn',
          message: 'No hook event files found yet',
        });
      }
    } catch (error) {
      results.push({
        name: 'Hook event files',
        status: 'warn',
        message: `Error reading hooks directory: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'Hook event files',
      status: 'warn',
      message: 'Hooks directory not found (will be created on first hook event)',
    });
  }

  // Print results
  console.log('Results:\n');
  let hasFailures = false;
  let hasWarnings = false;

  for (const result of results) {
    let icon: string;
    switch (result.status) {
      case 'pass':
        icon = '\x1b[32m✓\x1b[0m';
        break;
      case 'warn':
        icon = '\x1b[33m⚠\x1b[0m';
        hasWarnings = true;
        break;
      case 'fail':
        icon = '\x1b[31m✗\x1b[0m';
        hasFailures = true;
        break;
    }
    console.log(`  ${icon} ${result.name}: ${result.message}`);
  }

  console.log('');
  if (hasFailures) {
    console.log('Some checks failed. Fix the issues above to enable full functionality.');
    return 1;
  } else if (hasWarnings) {
    console.log('Some checks have warnings. Review the messages above.');
    return 0;
  } else {
    console.log('All checks passed! Transcript indexing is properly configured.');
    return 0;
  }
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

    case 'version':
      console.log(`transcript v${VERSION}`);
      return 0;

    case 'view':
      if (positional.length === 0 && !flags.sessionNameLookup) {
        printError('usage: transcript <file|session> [options]');
        return 1;
      }
      return cmdView({
        file: positional[0] || '',  // May be empty if using --session-name
        types: flags.types as string | undefined,
        last: flags.last as number | undefined,
        first: flags.first as number | undefined,
        from: flags.from as number | undefined,
        to: flags.to as number | undefined,
        fromTime: flags.fromTime as string | undefined,
        toTime: flags.toTime as string | undefined,
        offset: flags.offset as number | undefined,
        limit: flags.limit as number | undefined,
        userPrompts: flags.userPrompts as boolean | undefined,
        assistant: flags.assistant as boolean | undefined,
        tools: flags.tools as boolean | undefined,
        thinking: flags.thinking as boolean | undefined,
        search: flags.search as string | undefined,
        sessionIds: flags.sessionIds as string[] | undefined,
        sessionNameLookup: flags.sessionNameLookup as string | undefined,
        format: (flags.format as OutputFormat) || 'raw',
        pretty: flags.pretty as boolean | undefined,
        output: flags.output as string | undefined,
        tail: flags.tail as boolean | undefined,
        watch: flags.watch as boolean | undefined,
      });

    case 'list':
      return cmdList({
        recent: flags.recent as number | undefined,
        project: flags.project as string | undefined,
        names: flags.names as boolean | undefined,
        json: flags.json as boolean | undefined,
      });

    case 'search':
      if (positional.length === 0) {
        printError('usage: transcript search <query> [options]');
        return 1;
      }
      return cmdSearch({
        query: positional.join(' '),
        limit: flags.limit as number | undefined,
        types: flags.types as string | undefined,
        json: flags.json as boolean | undefined,
        sessionIds: flags.sessionIds as string[] | undefined,
        sessionName: flags.sessionNameLookup as string | undefined,
      });

    case 'info':
      if (positional.length === 0) {
        printError('usage: transcript info <file|session>');
        return 1;
      }
      return cmdInfo(positional[0]!);

    case 'index':
      return cmdIndex({
        subcommand: positional[0] || '',
      });

    case 'doctor':
      return cmdDoctor();

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
