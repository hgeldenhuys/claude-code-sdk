#!/usr/bin/env bun
/**
 * hook-events-tui - Claude Code Hook Events Viewer TUI
 *
 * Interactive terminal UI for browsing Claude Code hook event logs.
 *
 * Usage:
 *   hook-events-tui <session>              Open hook events in TUI
 *
 * Navigation:
 *   j/k, Up/Down     Navigate events
 *   g/G              Go to first/last event
 *   /                Search
 *   Space            Toggle bookmark on current line
 *   [ ]              Jump between bookmarks
 *   Tab              Switch panes
 *   1-4              Switch view mode (raw, human, minimal, tool-io)
 *   q                Quit
 *
 * Examples:
 *   hook-events-tui .
 *   hook-events-tui peaceful-osprey
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import blessed from 'blessed';
import { getSessionStore } from '../src/hooks/sessions/store';
import {
  DEFAULT_DB_PATH,
  type HookEventResult,
  getDatabase,
  getHookEvents,
  getHookEventsAfterId,
  getHookSessions,
  getMaxHookEventId,
} from '../src/transcripts/db';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0';
const DAEMON_DIR = join(process.env.HOME || '~', '.claude-code-sdk');
const PID_FILE = join(DAEMON_DIR, 'transcript-daemon.pid');
const BOOKMARKS_FILE = join(DAEMON_DIR, 'hook-event-bookmarks.json');

// Valid event types for filtering
const VALID_EVENT_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStop',
];

// ============================================================================
// Bookmark Persistence
// ============================================================================

interface BookmarkStore {
  // Map of sessionId -> Set of event IDs
  [sessionId: string]: number[];
}

function loadBookmarks(): BookmarkStore {
  try {
    if (existsSync(BOOKMARKS_FILE)) {
      const content = readFileSync(BOOKMARKS_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore errors
  }
  return {};
}

function saveBookmarks(bookmarks: BookmarkStore): void {
  try {
    if (!existsSync(DAEMON_DIR)) {
      mkdirSync(DAEMON_DIR, { recursive: true });
    }
    writeFileSync(BOOKMARKS_FILE, JSON.stringify(bookmarks, null, 2));
  } catch {
    // Ignore errors
  }
}

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
  let daemonRunning = false;
  if (existsSync(PID_FILE)) {
    try {
      const pid = Number.parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
      try {
        process.kill(pid, 0);
        daemonRunning = true;
      } catch {
        // Not running
      }
    } catch {
      // Ignore
    }
  }

  if (!daemonRunning) {
    console.error(
      '\x1b[33mwarning: Daemon not running. Data may be stale. Run: transcript index daemon start\x1b[0m'
    );
  }

  return _db;
}

// ============================================================================
// View Modes
// ============================================================================

type ViewMode = 'raw' | 'human' | 'minimal' | 'tool-io' | 'timeline';

// ============================================================================
// State
// ============================================================================

interface FilterOptions {
  eventTypes?: string[];
  toolNames?: string[];
  last?: number;
}

interface AppState {
  events: HookEventResult[];
  allEvents: HookEventResult[]; // Unfiltered events
  currentIndex: number;
  viewMode: ViewMode;
  searchQuery: string;
  searchResults: number[];
  searchResultIndex: number;
  sessionId: string;
  focusedPane: 'list' | 'content';
  activeFilter: string;
  fullscreen: boolean;
  scrollMode: boolean;
  // Bookmarks - persisted
  bookmarks: Set<number>; // Set of event IDs
  bookmarkStore: BookmarkStore;
  // Features
  showHelp: boolean;
  mouseEnabled: boolean;
  // Live mode
  liveMode: boolean;
  pollInterval: ReturnType<typeof setInterval> | null;
  lastMaxEventId: number;
  filterOpts: FilterOptions;
  // Performance cache
  cachedListItems: string[];
  listItemsDirty: boolean;
}

const state: AppState = {
  events: [],
  allEvents: [],
  currentIndex: 0,
  viewMode: 'human',
  searchQuery: '',
  searchResults: [],
  searchResultIndex: 0,
  sessionId: '',
  focusedPane: 'list',
  activeFilter: 'all',
  fullscreen: false,
  scrollMode: false,
  bookmarks: new Set<number>(),
  bookmarkStore: {},
  showHelp: false,
  mouseEnabled: false,
  liveMode: false,
  pollInterval: null,
  lastMaxEventId: 0,
  filterOpts: {},
  cachedListItems: [],
  listItemsDirty: true,
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Escape curly braces for blessed markup
 * Double braces {{ and }} render as literal { and }
 * Uses placeholder approach to avoid replacement interference
 */
function escapeBlessedMarkup(text: string): string {
  // Use placeholders to avoid replacement interference
  // ({open} contains }, {close} contains { - direct replacement would corrupt)
  return text
    .replace(/\{/g, '\x00OPEN\x00')
    .replace(/\}/g, '\x00CLOSE\x00')
    .replace(/\x00OPEN\x00/g, '{open}')
    .replace(/\x00CLOSE\x00/g, '{close}');
}

/**
 * Syntax highlight JSON for blessed markup
 * Colors: keys=cyan, strings=green, numbers=yellow, booleans/null=magenta
 */
function highlightJson(json: string): string {
  // Process line by line to handle indentation properly
  const lines = json.split('\n');
  const highlighted: string[] = [];

  for (const line of lines) {
    let result = '';
    let i = 0;

    while (i < line.length) {
      const char = line[i]!;

      // Handle whitespace (preserve indentation)
      if (char === ' ' || char === '\t') {
        result += char;
        i++;
        continue;
      }

      // Handle strings (keys or values)
      if (char === '"') {
        let str = '"';
        i++;
        while (i < line.length && line[i] !== '"') {
          const c = line[i]!;
          if (c === '\\' && i + 1 < line.length) {
            str += c + line[i + 1]!;
            i += 2;
          } else {
            str += c;
            i++;
          }
        }
        if (i < line.length) {
          str += '"';
          i++;
        }

        // Escape braces in the string content (blessed uses {open} and {close} for literal braces)
        // Use placeholder approach to avoid replacement interference
        const escapedStr = str
          .replace(/\{/g, '\x00OPEN\x00')
          .replace(/\}/g, '\x00CLOSE\x00')
          .replace(/\x00OPEN\x00/g, '{open}')
          .replace(/\x00CLOSE\x00/g, '{close}');

        // Check if this is a key (followed by colon)
        const remaining = line.slice(i).trim();
        if (remaining.startsWith(':')) {
          result += `{cyan-fg}${escapedStr}{/cyan-fg}`;
        } else {
          result += `{green-fg}${escapedStr}{/green-fg}`;
        }
        continue;
      }

      // Handle numbers
      if (char === '-' || (char >= '0' && char <= '9')) {
        let num = '';
        while (i < line.length && /[\d.eE+\-]/.test(line[i]!)) {
          num += line[i]!;
          i++;
        }
        result += `{yellow-fg}${num}{/yellow-fg}`;
        continue;
      }

      // Handle booleans and null
      if (line.slice(i, i + 4) === 'true') {
        result += '{magenta-fg}true{/magenta-fg}';
        i += 4;
        continue;
      }
      if (line.slice(i, i + 5) === 'false') {
        result += '{magenta-fg}false{/magenta-fg}';
        i += 5;
        continue;
      }
      if (line.slice(i, i + 4) === 'null') {
        result += '{magenta-fg}null{/magenta-fg}';
        i += 4;
        continue;
      }

      // Handle structural characters
      if (char === '{') {
        result += '{open}';
        i++;
        continue;
      }
      if (char === '}') {
        result += '{close}';
        i++;
        continue;
      }
      if (char === '[' || char === ']' || char === ':' || char === ',') {
        result += char;
        i++;
        continue;
      }

      // Default: pass through
      result += char;
      i++;
    }

    highlighted.push(result);
  }

  return highlighted.join('\n');
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

/**
 * Get the display width of a string in terminal columns.
 * Accounts for wide characters (emojis, CJK, etc.) that take 2 columns.
 */
function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    // Wide characters: emojis, CJK, fullwidth forms
    if (
      (code >= 0x1f300 && code <= 0x1faff) || // Emojis
      (code >= 0x2600 && code <= 0x27bf) || // Misc symbols
      (code >= 0x3000 && code <= 0x9fff) || // CJK
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
      (code >= 0xff00 && code <= 0xffef) // Fullwidth forms
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * Truncate a string to a target display width, accounting for wide characters.
 */
function truncateDisplay(str: string, targetWidth: number): string {
  let width = 0;
  let result = '';
  for (const char of str) {
    const code = char.codePointAt(0) || 0;
    const charWidth =
      (code >= 0x1f300 && code <= 0x1faff) || // Emojis
      (code >= 0x2600 && code <= 0x27bf) || // Misc symbols
      (code >= 0x3000 && code <= 0x9fff) || // CJK
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility
      (code >= 0xff00 && code <= 0xffef) // Fullwidth forms
        ? 2
        : 1;
    if (width + charWidth > targetWidth) {
      break;
    }
    result += char;
    width += charWidth;
  }
  return result;
}

/**
 * Pad a string to a target display width, accounting for wide characters.
 */
function padEndDisplay(str: string, targetWidth: number): string {
  const truncated = truncateDisplay(str, targetWidth);
  const currentWidth = getDisplayWidth(truncated);
  if (currentWidth >= targetWidth) {
    return truncated;
  }
  return truncated + ' '.repeat(targetWidth - currentWidth);
}

/**
 * Calculate context usage percentage from a hook event
 * Returns formatted string with color based on usage level
 * 0-50% = green, 51-70% = yellow, 71%+ = red
 */
const CONTEXT_WINDOW_SIZE = 200000; // Standard tier context window

function getContextUsage(event: HookEventResult): string {
  if (!event.inputJson) return '';

  try {
    const input = JSON.parse(event.inputJson);
    const usage = input.usage;
    if (!usage) return '';

    // Calculate total input tokens (including cache)
    const inputTokens =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

    if (inputTokens === 0) return '';

    const percentage = Math.round((inputTokens / CONTEXT_WINDOW_SIZE) * 100);

    // Color based on percentage thresholds
    let color: string;
    if (percentage <= 50) {
      color = 'green';
    } else if (percentage <= 70) {
      color = 'yellow'; // orange approximation in blessed
    } else {
      color = 'red';
    }

    // Right-align percentage to 4 chars (e.g., "  5%" or "100%") for consistent column width
    const percentStr = `${percentage}%`.padStart(4);
    return `{${color}-fg}[${percentStr}]{/${color}-fg}`;
  } catch {
    return '';
  }
}

function getEventColor(eventType: string): string {
  switch (eventType) {
    case 'UserPromptSubmit':
      return 'green';
    case 'PreToolUse':
      return 'yellow';
    case 'PostToolUse':
      return 'cyan';
    case 'SessionStart':
      return 'magenta';
    case 'SessionEnd':
    case 'Stop':
      return 'red';
    default:
      return 'white';
  }
}

/**
 * Toggle bookmark on an event
 */
function toggleBookmark(eventId: number): void {
  if (state.bookmarks.has(eventId)) {
    state.bookmarks.delete(eventId);
  } else {
    state.bookmarks.add(eventId);
  }

  // Persist bookmarks
  state.bookmarkStore[state.sessionId] = Array.from(state.bookmarks);
  saveBookmarks(state.bookmarkStore);
  invalidateListCache(); // Bookmark display changed
}

/**
 * Jump to the previous bookmarked event (respects current filter)
 */
function jumpToPrevBookmark(): boolean {
  if (state.bookmarks.size === 0) return false;

  const currentEventId = state.events[state.currentIndex]?.id ?? 0;

  // Get bookmarked event IDs that exist in current filtered list
  const visibleBookmarks: number[] = [];
  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i];
    if (event && state.bookmarks.has(event.id)) {
      visibleBookmarks.push(i);
    }
  }

  if (visibleBookmarks.length === 0) return false;

  // Find the previous bookmark index
  const sortedIndices = visibleBookmarks.sort((a, b) => b - a); // Descending
  for (const idx of sortedIndices) {
    if (idx < state.currentIndex) {
      state.currentIndex = idx;
      return true;
    }
  }

  // Wrap around to the last bookmark
  state.currentIndex = sortedIndices[0]!;
  return true;
}

/**
 * Jump to the next bookmarked event (respects current filter)
 */
function jumpToNextBookmark(): boolean {
  if (state.bookmarks.size === 0) return false;

  // Get bookmarked event IDs that exist in current filtered list
  const visibleBookmarks: number[] = [];
  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i];
    if (event && state.bookmarks.has(event.id)) {
      visibleBookmarks.push(i);
    }
  }

  if (visibleBookmarks.length === 0) return false;

  // Find the next bookmark index
  const sortedIndices = visibleBookmarks.sort((a, b) => a - b); // Ascending
  for (const idx of sortedIndices) {
    if (idx > state.currentIndex) {
      state.currentIndex = idx;
      return true;
    }
  }

  // Wrap around to the first bookmark
  state.currentIndex = sortedIndices[0]!;
  return true;
}

/**
 * Filter events based on options
 */
function filterEvents(events: HookEventResult[], opts: FilterOptions): HookEventResult[] {
  let filtered = events;

  if (opts.eventTypes && opts.eventTypes.length > 0) {
    const typeSet = new Set(opts.eventTypes);
    filtered = filtered.filter((e) => typeSet.has(e.eventType));
  }

  if (opts.toolNames && opts.toolNames.length > 0) {
    const toolSet = new Set(opts.toolNames);
    filtered = filtered.filter((e) => e.toolName && toolSet.has(e.toolName));
  }

  if (opts.last) {
    filtered = filtered.slice(-opts.last);
  }

  return filtered;
}

// ============================================================================
// View Renderers
// ============================================================================

function renderCurrentEvent(): string {
  if (state.events.length === 0) {
    return 'No events loaded.';
  }

  const event = state.events[state.currentIndex];
  if (!event) {
    return 'Invalid event index.';
  }

  const viewLabel = (mode: string, color: string) =>
    `{${color}-fg}=== VIEW: ${mode.toUpperCase()} ==={/${color}-fg}\n\n`;

  switch (state.viewMode) {
    case 'raw': {
      // Raw JSON
      const obj: Record<string, unknown> = {
        id: event.id,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        eventType: event.eventType,
        toolName: event.toolName,
        decision: event.decision,
        lineNumber: event.lineNumber,
      };
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
      return viewLabel('raw', 'yellow') + highlightJson(JSON.stringify(obj, null, 2));
    }

    case 'human': {
      const lines: string[] = [];
      const color = getEventColor(event.eventType);

      // Header
      const toolInfo = event.toolName ? ` [{${color}-fg}${event.toolName}{/${color}-fg}]` : '';
      const decisionInfo = event.decision ? ` -> ${event.decision}` : '';
      const turnInfo = event.turnSequence ? ` | {cyan-fg}Turn ${event.turnSequence}{/cyan-fg}` : '';
      const sessionNameInfo = event.sessionName ? ` | {green-fg}${event.sessionName}{/green-fg}` : '';
      lines.push(`{bold}Event #{event.id}{/bold} - ${formatTime(event.timestamp)}${turnInfo}${sessionNameInfo}`);
      lines.push(`{${color}-fg}${event.eventType}{/${color}-fg}${toolInfo}${decisionInfo}`);
      lines.push('');

      // Context usage - extract from inputJson if available
      let usage: { tokens: number; percentage: number } | null = null;
      if (event.inputJson) {
        try {
          const input = JSON.parse(event.inputJson);
          if (input.usage?.input_tokens || input.usage?.output_tokens) {
            const tokens = (input.usage.input_tokens || 0) + (input.usage.output_tokens || 0);
            const percentage = Math.round((tokens / 200000) * 100);
            usage = { tokens, percentage };
          }
        } catch {
          // Ignore
        }
      }
      if (usage) {
        const barWidth = 30;
        const filled = Math.round((usage.percentage / 100) * barWidth);
        const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
        lines.push(`{bold}Context:{/bold} ${usage.tokens.toLocaleString()} tokens`);
        lines.push(`[${bar}] ${usage.percentage}%`);
        lines.push('');
      }

      // Tool input
      if (event.inputJson) {
        try {
          const input = JSON.parse(event.inputJson);
          if (input.tool_input) {
            lines.push('{bold}Tool Input:{/bold}');
            lines.push(highlightJson(JSON.stringify(input.tool_input, null, 2)));
            lines.push('');
          }
          if (input.prompt) {
            lines.push('{bold}Prompt:{/bold}');
            lines.push(escapeBlessedMarkup(String(input.prompt).slice(0, 500)));
            lines.push('');
          }
          if (input.tool_response) {
            lines.push('{bold}Tool Response:{/bold}');
            const resp = input.tool_response;
            if (resp.stdout) {
              lines.push(escapeBlessedMarkup(String(resp.stdout).slice(0, 1000)));
            } else if (resp.content) {
              lines.push(escapeBlessedMarkup(String(resp.content).slice(0, 1000)));
            } else {
              lines.push(highlightJson(JSON.stringify(resp, null, 2).slice(0, 1000)));
            }
          }
        } catch {
          lines.push('{bold}Input JSON:{/bold}');
          lines.push(highlightJson(event.inputJson.slice(0, 500)));
        }
      }

      // Handler results
      if (event.handlerResults) {
        try {
          const results = JSON.parse(event.handlerResults);
          lines.push('');
          lines.push('{bold}Handler Results:{/bold}');
          lines.push(highlightJson(JSON.stringify(results, null, 2)));
        } catch {
          // Ignore
        }
      }

      return viewLabel('human', 'green') + lines.join('\n');
    }

    case 'minimal': {
      const lines: string[] = [];
      lines.push(`Event #${event.id}`);
      lines.push(`Time: ${formatTime(event.timestamp)}`);
      lines.push(`Type: ${event.eventType}`);
      if (event.toolName) lines.push(`Tool: ${event.toolName}`);
      if (event.decision) lines.push(`Decision: ${event.decision}`);
      if (event.turnSequence) lines.push(`Turn: ${event.turnSequence}`);
      if (event.sessionName) lines.push(`Session: ${event.sessionName}`);
      return viewLabel('minimal', 'magenta') + lines.join('\n');
    }

    case 'tool-io': {
      // Show tool input and output side by side
      const lines: string[] = [];

      if (event.eventType === 'PreToolUse' || event.eventType === 'PostToolUse') {
        lines.push(`{bold}Tool: ${event.toolName || 'unknown'}{/bold}`);
        lines.push('');

        if (event.inputJson) {
          try {
            const input = JSON.parse(event.inputJson);

            if (event.eventType === 'PreToolUse' && input.tool_input) {
              lines.push('{bold}INPUT:{/bold}');
              lines.push(highlightJson(JSON.stringify(input.tool_input, null, 2)));
            }

            if (event.eventType === 'PostToolUse' && input.tool_response) {
              const resp = input.tool_response;
              lines.push('{bold}OUTPUT:{/bold}');
              if (resp.stdout) {
                lines.push(escapeBlessedMarkup(String(resp.stdout)));
              } else if (resp.content) {
                lines.push(escapeBlessedMarkup(String(resp.content)));
              } else if (resp.filenames) {
                lines.push(highlightJson(JSON.stringify(resp.filenames, null, 2)));
              } else {
                lines.push(highlightJson(JSON.stringify(resp, null, 2)));
              }
            }
          } catch {
            lines.push(highlightJson(event.inputJson.slice(0, 2000)));
          }
        }
      } else {
        lines.push(`Event type ${event.eventType} is not a tool event.`);
        lines.push('Use view mode 2 (human) for other event types.');
      }

      return viewLabel('tool-io', 'blue') + lines.join('\n');
    }

    case 'timeline': {
      // Show a timeline of events around current (dynamic height, ~30 events for typical terminal)
      const lines: string[] = [];
      const contextLines = 25; // Show more context for better timeline view
      const start = Math.max(0, state.currentIndex - contextLines);
      const end = Math.min(state.events.length, state.currentIndex + contextLines + 1);

      for (let i = start; i < end; i++) {
        const e = state.events[i]!;
        const isCurrent = i === state.currentIndex;
        const prefix = isCurrent ? '>>> ' : '    ';
        const color = getEventColor(e.eventType);
        const toolInfo = e.toolName ? ` [${e.toolName}]` : '';
        const bookmarkMark = state.bookmarks.has(e.id) ? ' ★' : '';

        if (isCurrent) {
          lines.push(
            `{inverse}${prefix}${formatTime(e.timestamp)} {${color}-fg}${e.eventType.padEnd(16)}{/${color}-fg}${toolInfo}${bookmarkMark}{/inverse}`
          );
        } else {
          lines.push(
            `${prefix}${formatTime(e.timestamp)} {${color}-fg}${e.eventType.padEnd(16)}{/${color}-fg}${toolInfo}${bookmarkMark}`
          );
        }
      }

      return viewLabel('timeline', 'cyan') + lines.join('\n');
    }

    default:
      return 'Unknown view mode';
  }
}

/**
 * Generate list items - uses cache for performance
 * Only regenerates when listItemsDirty is true
 */
function getListItems(): string[] {
  if (!state.listItemsDirty && state.cachedListItems.length === state.events.length) {
    return state.cachedListItems;
  }

  // Pre-compute search result set for O(1) lookup
  const searchResultSet = new Set(state.searchResults);

  state.cachedListItems = state.events.map((event, index) => {
    // Compact format: markers + time + type + tool + decision + usage + turn-session
    const type = event.eventType.slice(0, 12).padEnd(12);
    const color = getEventColor(event.eventType);
    const toolInfo = event.toolName ? event.toolName.slice(0, 10).padEnd(10) : '          ';
    const searchMatch = searchResultSet.has(index) ? '*' : ' ';
    const bookmarkMark = state.bookmarks.has(event.id) ? '{yellow-fg}★{/yellow-fg}' : ' ';

    // Timestamp (time only)
    const time = formatTime(event.timestamp);

    // Decision indicator (PreToolUse only)
    const decision =
      event.eventType === 'PreToolUse'
        ? event.decision
          ? '{green-fg}✓{/green-fg}'
          : '{gray-fg}?{/gray-fg}'
        : ' ';

    // Context usage percentage (colored)
    const contextUsage = getContextUsage(event);
    const usageCol = contextUsage ? ` ${contextUsage}` : '        ';

    // Combined turn-session column: "{turn}-{session}" (e.g., "22-loyal-whippet")
    const SESSION_WIDTH = 16;
    const sessionName = event.sessionName;
    const turnSeq = event.turnSequence;

    let turnSessionStr = '';
    if (turnSeq && sessionName) {
      turnSessionStr = `${turnSeq}-${sessionName}`;
    } else if (sessionName) {
      turnSessionStr = sessionName;
    } else if (turnSeq) {
      turnSessionStr = `${turnSeq}`;
    }
    const turnSessionPadded = escapeBlessedMarkup(
      padEndDisplay(turnSessionStr.slice(0, SESSION_WIDTH), SESSION_WIDTH)
    );
    const turnSessionSuffix = turnSessionStr
      ? ` {cyan-fg}${turnSessionPadded}{/cyan-fg}`
      : ` ${turnSessionPadded}`;

    return `${searchMatch}${bookmarkMark}${time} {${color}-fg}${type}{/${color}-fg} ${toolInfo} ${decision}${usageCol}${turnSessionSuffix}`;
  });

  state.listItemsDirty = false;
  return state.cachedListItems;
}

/**
 * Mark list items as needing regeneration
 * Call this when events, filters, search, or bookmarks change
 */
function invalidateListCache(): void {
  state.listItemsDirty = true;
}

function generateHelpContent(): string {
  const modeStr = state.fullscreen ? (state.scrollMode ? 'SCROLL' : 'NAV') : 'SPLIT';
  const mouseStr = state.mouseEnabled ? 'ON' : 'OFF';
  const liveStr = state.liveMode ? 'ON' : 'OFF';
  const bookmarkCount = state.bookmarks.size;
  const visibleBookmarks = state.events.filter((e) => state.bookmarks.has(e.id)).length;

  return `{bold}{center}Hook Events TUI Help{/center}{/bold}

{bold}Current Status:{/bold}
  Mode: {cyan-fg}${modeStr}{/cyan-fg}  |  View: {cyan-fg}${state.viewMode}{/cyan-fg}  |  Mouse: {cyan-fg}${mouseStr}{/cyan-fg}  |  Live: {cyan-fg}${liveStr}{/cyan-fg}
  Filter: {cyan-fg}${state.activeFilter}{/cyan-fg}  |  Bookmarks: {cyan-fg}${bookmarkCount} total, ${visibleBookmarks} visible{/cyan-fg}
  Event: {cyan-fg}${state.currentIndex + 1}/${state.events.length}{/cyan-fg}

{bold}Navigation:{/bold}
  {green-fg}j/k{/green-fg} or {green-fg}↑/↓{/green-fg}     Navigate events (or scroll in scroll mode)
  {green-fg}h/l{/green-fg}             Scroll content up/down
  {green-fg}g/G{/green-fg}             Go to first/last event
  {green-fg}PgUp/PgDn{/green-fg}       Page up/down (Ctrl+u/d also work)
  {green-fg}Tab{/green-fg}             Switch panes (list/content)

{bold}View Modes:{/bold}
  {green-fg}1{/green-fg}               Raw JSON
  {green-fg}2{/green-fg}               Human-readable (default)
  {green-fg}3{/green-fg}               Minimal
  {green-fg}4{/green-fg}               Tool I/O (input/output for tool events)
  {green-fg}5{/green-fg}               Timeline (context around current event)

{bold}Search:{/bold}
  {green-fg}/{/green-fg}               Open search
  {green-fg}n/N{/green-fg}             Next/previous search result
  {green-fg}Esc{/green-fg}             Clear search

{bold}Bookmarks (Persisted):{/bold}
  {green-fg}Space{/green-fg}           Toggle bookmark on current event
  {green-fg}[{/green-fg}               Jump to previous bookmark (in filtered view)
  {green-fg}]{/green-fg}               Jump to next bookmark (in filtered view)

{bold}Features:{/bold}
  {green-fg}f{/green-fg}               Toggle fullscreen mode
  {green-fg}s{/green-fg}               Toggle scroll mode (fullscreen only)
  {green-fg}c{/green-fg}               Copy current event to clipboard
  {green-fg}m{/green-fg}               Toggle mouse support
  {green-fg}L{/green-fg}               Toggle live mode (watch for new events)
  {green-fg}r{/green-fg} or {green-fg}Ctrl+L{/green-fg}  Redraw screen (fix display glitches)
  {green-fg}?{/green-fg}               Toggle this help overlay

{bold}Decision Indicator (PreToolUse only):{/bold}
  {green-fg}✓{/green-fg}                Hook handler approved
  {gray-fg}?{/gray-fg}                No handler decision

{bold}Quit:{/bold}
  {green-fg}q{/green-fg} or {green-fg}Ctrl+C{/green-fg}    Exit

{gray-fg}Press any key to close this help...{/gray-fg}`;
}

// ============================================================================
// Search
// ============================================================================

function performSearch(query: string): void {
  state.searchQuery = query;
  state.searchResults = [];
  state.searchResultIndex = 0;

  if (!query.trim()) {
    invalidateListCache(); // Clear search markers
    return;
  }

  const queryLower = query.toLowerCase();

  for (let i = 0; i < state.events.length; i++) {
    const event = state.events[i]!;
    const searchText = [event.eventType, event.toolName || '', event.inputJson || '']
      .join(' ')
      .toLowerCase();

    if (searchText.includes(queryLower)) {
      state.searchResults.push(i);
    }
  }

  invalidateListCache(); // Search results changed
}

function jumpToNextSearchResult(): void {
  if (state.searchResults.length === 0) return;
  state.searchResultIndex = (state.searchResultIndex + 1) % state.searchResults.length;
  state.currentIndex = state.searchResults[state.searchResultIndex]!;
}

function jumpToPrevSearchResult(): void {
  if (state.searchResults.length === 0) return;
  state.searchResultIndex =
    (state.searchResultIndex - 1 + state.searchResults.length) % state.searchResults.length;
  state.currentIndex = state.searchResults[state.searchResultIndex]!;
}

// ============================================================================
// Clipboard
// ============================================================================

function copyToClipboard(text: string): void {
  const { spawn } = require('node:child_process');
  const proc =
    process.platform === 'darwin' ? spawn('pbcopy') : spawn('xclip', ['-selection', 'clipboard']);
  proc.stdin.write(text);
  proc.stdin.end();
}

// ============================================================================
// Main TUI
// ============================================================================

async function createTUI(): Promise<void> {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: `Hook Events Viewer - ${state.sessionId.slice(0, 8)}`,
    fullUnicode: true,
  });

  // Build header content
  const buildHeaderContent = (): string => {
    const currentEvent = state.events[state.currentIndex];
    const turnInfo = currentEvent?.turnSequence
      ? ` | {cyan-fg}Turn {bold}${currentEvent.turnSequence}{/bold}{/cyan-fg}`
      : '';
    const sessionName = currentEvent?.sessionName || state.sessionId.slice(0, 8) + '...';
    const filterInfo =
      state.activeFilter !== 'all' ? ` | {yellow-fg}Filter: ${state.activeFilter}{/yellow-fg}` : '';
    const fullscreenInfo = state.fullscreen ? ' | {magenta-fg}FULLSCREEN{/magenta-fg}' : '';
    const liveInfo = state.liveMode ? ' | {green-fg}LIVE{/green-fg}' : '';
    const searchInfo = state.searchQuery
      ? ` | {blue-fg}Search: "${state.searchQuery}" (${state.searchResults.length}){/blue-fg}`
      : '';

    return `{bold}{cyan-fg}Hook Events{/cyan-fg}{/bold} | Session: {green-fg}${sessionName}{/green-fg}${turnInfo} | {yellow-fg}Events: ${state.events.length}{/yellow-fg} | {magenta-fg}${state.currentIndex + 1}/${state.events.length}{/magenta-fg} | {blue-fg}[${state.viewMode}]{/blue-fg}${filterInfo}${fullscreenInfo}${liveInfo}${searchInfo}`;
  };

  // Header
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    style: { border: { fg: 'blue' }, fg: 'white' },
    content: buildHeaderContent(),
    tags: true,
  });

  // Left pane - Event list
  const listBox = blessed.list({
    parent: screen,
    top: 3,
    left: 0,
    width: '35%',
    height: '100%-6',
    border: 'line',
    label: ' Events ',
    tags: true,
    style: {
      border: { fg: state.focusedPane === 'list' ? 'green' : 'blue' },
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white' },
    },
    keys: false,
    vi: false,
    mouse: false,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    items: getListItems(),
  });

  // Right pane - Content
  const contentBox = blessed.box({
    parent: screen,
    top: 3,
    left: '35%',
    width: '65%',
    height: '100%-6',
    border: 'line',
    label: ` Content [${state.viewMode}] `,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    style: {
      border: { fg: state.focusedPane === 'content' ? 'green' : 'blue' },
      fg: 'white',
    },
    content: renderCurrentEvent(),
    tags: true,
  });

  // Footer
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    style: { border: { fg: 'blue' }, fg: 'gray' },
    content:
      '{bold}j/k{/bold}:nav {bold}Space{/bold}:bookmark {bold}[]{/bold}:jump {bold}c{/bold}:copy {bold}f{/bold}:fullscreen {bold}1-5{/bold}:view {bold}/{/bold}:search {bold}r{/bold}:redraw {bold}?{/bold}:help {bold}q{/bold}:quit',
    tags: true,
  });

  // Search input (hidden by default)
  const searchInput = blessed.textbox({
    parent: screen,
    bottom: 3,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    label: ' Search ',
    hidden: true,
    style: { border: { fg: 'yellow' }, fg: 'white' },
    inputOnFocus: true,
  });

  // Help overlay (hidden by default)
  const helpOverlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '75%',
    height: '85%',
    border: 'line',
    label: ' Help (press any key to close) ',
    hidden: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'cyan' } },
    style: { border: { fg: 'cyan' }, fg: 'white', bg: 'black' },
    tags: true,
    content: '',
  });

  // Toast notification
  const toast = blessed.box({
    parent: screen,
    bottom: 4,
    right: 2,
    width: 40,
    height: 3,
    border: 'line',
    hidden: true,
    style: { border: { fg: 'green' }, fg: 'white', bg: 'black' },
    tags: true,
    content: '',
  });

  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  const showToast = (message: string, duration = 2000) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.setContent(` {green-fg}${message}{/green-fg}`);
    toast.show();
    screen.render();
    toastTimeout = setTimeout(() => {
      toast.hide();
      screen.render();
    }, duration);
  };

  // Lightweight selection update - only updates selection and content, no list regeneration
  // This is the fast path for navigation (j/k, up/down, etc.)
  const updateSelection = () => {
    // Update header with current position
    header.setContent(buildHeaderContent());

    // Update fullscreen label if in fullscreen
    if (state.fullscreen) {
      const modeStr = state.scrollMode ? 'SCROLL' : 'NAV';
      contentBox.setLabel(
        ` [${modeStr}] Event ${state.currentIndex + 1}/${state.events.length} | s:toggle f:exit `
      );
    }

    // Just update selection index (blessed handles the visual update)
    listBox.select(state.currentIndex);

    // Update content pane
    contentBox.setLabel(` Content [${state.viewMode}] `);
    contentBox.setContent(renderCurrentEvent());
    contentBox.scrollTo(0);

    screen.render();
  };

  // Full UI update - regenerates list if dirty, updates layout
  // Use this for filter changes, search, bookmarks, fullscreen toggle
  const updateUI = () => {
    // Update header
    header.setContent(buildHeaderContent());

    // Handle fullscreen mode
    if (state.fullscreen) {
      listBox.hide();
      header.hide();
      footer.hide();
      contentBox.top = 0;
      contentBox.left = 0;
      contentBox.width = '100%';
      contentBox.height = '100%';
      contentBox.border = {
        type: 'line',
        left: false,
        right: false,
        top: false,
        bottom: false,
      } as any;
      const modeStr = state.scrollMode ? 'SCROLL' : 'NAV';
      contentBox.setLabel(
        ` [${modeStr}] Event ${state.currentIndex + 1}/${state.events.length} | s:toggle f:exit `
      );
    } else {
      listBox.show();
      header.show();
      footer.show();
      contentBox.top = 3;
      contentBox.left = '35%';
      contentBox.width = '65%';
      contentBox.height = '100%-6';
      contentBox.border = { type: 'line' } as any;
      state.scrollMode = false;
    }

    // Update list (uses cache if not dirty)
    listBox.setItems(getListItems());
    listBox.select(state.currentIndex);

    // Update content
    contentBox.setLabel(` Content [${state.viewMode}] `);
    contentBox.setContent(renderCurrentEvent());
    contentBox.scrollTo(0);

    // Update border colors
    listBox.style.border = { fg: state.focusedPane === 'list' ? 'green' : 'blue' };
    contentBox.style.border = {
      fg: state.focusedPane === 'content' || state.fullscreen ? 'green' : 'blue',
    };

    screen.render();
  };

  // Navigation helper
  const shouldNavigateEvents = () => {
    if (state.fullscreen) return !state.scrollMode;
    return state.focusedPane === 'list';
  };

  // Key bindings - navigation uses lightweight updateSelection() for speed
  screen.key(['j', 'down'], () => {
    if (shouldNavigateEvents() && state.currentIndex < state.events.length - 1) {
      state.currentIndex++;
      updateSelection();
    } else if (!shouldNavigateEvents()) {
      contentBox.scroll(1);
      screen.render();
    }
  });

  screen.key(['k', 'up'], () => {
    if (shouldNavigateEvents() && state.currentIndex > 0) {
      state.currentIndex--;
      updateSelection();
    } else if (!shouldNavigateEvents()) {
      contentBox.scroll(-1);
      screen.render();
    }
  });

  screen.key(['pagedown', 'C-d'], () => {
    if (shouldNavigateEvents()) {
      state.currentIndex = Math.min(state.currentIndex + 20, state.events.length - 1);
      updateSelection();
    } else {
      contentBox.scroll(10);
      screen.render();
    }
  });

  screen.key(['pageup', 'C-u'], () => {
    if (shouldNavigateEvents()) {
      state.currentIndex = Math.max(state.currentIndex - 20, 0);
      updateSelection();
    } else {
      contentBox.scroll(-10);
      screen.render();
    }
  });

  screen.key('h', () => {
    contentBox.scroll(-1);
    screen.render();
  });

  screen.key('l', () => {
    contentBox.scroll(1);
    screen.render();
  });

  screen.key('g', () => {
    if (shouldNavigateEvents()) {
      state.currentIndex = 0;
      updateSelection();
    } else {
      contentBox.setScrollPerc(0);
      screen.render();
    }
  });

  screen.key(['G', 'S-g'], () => {
    if (shouldNavigateEvents()) {
      state.currentIndex = state.events.length - 1;
      updateSelection();
    } else {
      contentBox.setScrollPerc(100);
      screen.render();
    }
  });

  screen.key('s', () => {
    if (state.fullscreen) {
      state.scrollMode = !state.scrollMode;
      updateUI();
    }
  });

  screen.key('tab', () => {
    if (!state.fullscreen) {
      state.focusedPane = state.focusedPane === 'list' ? 'content' : 'list';
      updateUI();
    }
  });

  // View modes
  screen.key('1', () => {
    state.viewMode = 'raw';
    updateUI();
  });
  screen.key('2', () => {
    state.viewMode = 'human';
    updateUI();
  });
  screen.key('3', () => {
    state.viewMode = 'minimal';
    updateUI();
  });
  screen.key('4', () => {
    state.viewMode = 'tool-io';
    updateUI();
  });
  screen.key('5', () => {
    state.viewMode = 'timeline';
    updateUI();
  });

  // Fullscreen toggle
  let prevFocusedPane: 'list' | 'content' = 'list';
  screen.key('f', () => {
    if (!state.fullscreen) {
      prevFocusedPane = state.focusedPane;
    } else {
      state.focusedPane = prevFocusedPane;
    }
    state.fullscreen = !state.fullscreen;
    updateUI();
  });

  // Bookmark toggle with Space
  screen.key('space', () => {
    const event = state.events[state.currentIndex];
    if (event) {
      toggleBookmark(event.id);
      const action = state.bookmarks.has(event.id) ? 'Added' : 'Removed';
      showToast(`${action} bookmark (${state.bookmarks.size} total, persisted)`);
      updateUI();
    }
  });

  // Bookmark navigation
  screen.key('[', () => {
    if (state.bookmarks.size === 0) {
      showToast('No bookmarks set');
      return;
    }
    const jumped = jumpToPrevBookmark();
    if (!jumped) {
      showToast('No visible bookmarks in current filter');
    }
    updateSelection();
  });

  screen.key(']', () => {
    if (state.bookmarks.size === 0) {
      showToast('No bookmarks set');
      return;
    }
    const jumped = jumpToNextBookmark();
    if (!jumped) {
      showToast('No visible bookmarks in current filter');
    }
    updateSelection();
  });

  // Copy to clipboard
  screen.key('c', () => {
    const event = state.events[state.currentIndex];
    if (event) {
      const content = JSON.stringify(
        {
          id: event.id,
          eventType: event.eventType,
          toolName: event.toolName,
          timestamp: event.timestamp,
        },
        null,
        2
      );
      copyToClipboard(content);
      showToast('Copied to clipboard!');
    }
  });

  // Mouse toggle
  screen.key('m', () => {
    state.mouseEnabled = !state.mouseEnabled;
    (listBox as any).options.mouse = state.mouseEnabled;
    showToast(`Mouse ${state.mouseEnabled ? 'enabled' : 'disabled'}`);
    screen.render();
  });

  // Search
  screen.key('/', () => {
    searchInput.show();
    searchInput.focus();
    screen.render();
  });

  searchInput.on('submit', (value: string) => {
    searchInput.hide();
    performSearch(value);
    if (state.searchResults.length > 0) {
      state.currentIndex = state.searchResults[0]!;
    }
    updateUI();
  });

  searchInput.on('cancel', () => {
    searchInput.hide();
    screen.render();
  });

  screen.key('n', () => {
    jumpToNextSearchResult();
    updateSelection();
  });

  screen.key(['N', 'S-n'], () => {
    jumpToPrevSearchResult();
    updateSelection();
  });

  screen.key('escape', () => {
    state.searchQuery = '';
    state.searchResults = [];
    invalidateListCache(); // Search markers need to be cleared
    updateUI();
  });

  // Live mode
  screen.key(['L', 'S-l'], () => {
    state.liveMode = !state.liveMode;

    if (state.liveMode && !state.pollInterval) {
      const db = getDb();
      state.lastMaxEventId = getMaxHookEventId(db, state.sessionId);

      // Start polling SQLite every 200ms (same as transcript-tui)
      let pollCount = 0;
      state.pollInterval = setInterval(() => {
        try {
          const db = getDb();
          const currentMaxId = getMaxHookEventId(db, state.sessionId);
          let needsUpdate = false;

          if (currentMaxId > state.lastMaxEventId) {
            const newEvents = getHookEventsAfterId(
              db,
              state.lastMaxEventId,
              state.sessionId,
              state.filterOpts.eventTypes,
              state.filterOpts.toolNames
            );

            if (newEvents.length > 0) {
              state.allEvents = [...state.allEvents, ...newEvents];
              state.lastMaxEventId = currentMaxId;
              needsUpdate = true;
            }
          }

          // Every 5th poll (1 second), check for turn/session data updates on events missing it
          pollCount++;
          if (pollCount >= 5) {
            pollCount = 0;
            // Find events missing turn data
            const eventsMissingTurnData = state.allEvents.filter(
              (event) => !event.turnSequence
            );
            if (eventsMissingTurnData.length > 0) {
              // Re-query these events from the database
              const refreshedResults = getHookEvents(db, { sessionId: state.sessionId });
              const refreshedMap = new Map(refreshedResults.map((r) => [r.id, r]));
              // Update allEvents with refreshed turn data
              let updated = 0;
              for (let i = 0; i < state.allEvents.length; i++) {
                const event = state.allEvents[i]!;
                if (!event.turnSequence) {
                  const refreshed = refreshedMap.get(event.id);
                  if (refreshed?.turnSequence) {
                    state.allEvents[i] = refreshed;
                    updated++;
                  }
                }
              }
              if (updated > 0) {
                needsUpdate = true;
              }
            }
          }

          if (needsUpdate) {
            const filteredEvents = filterEvents(state.allEvents, state.filterOpts);
            const prevCount = state.events.length;
            state.events = filteredEvents;
            invalidateListCache(); // Events changed

            const wasAtEnd = state.currentIndex >= prevCount - 1;
            if (wasAtEnd && filteredEvents.length > prevCount) {
              state.currentIndex = filteredEvents.length - 1;
            }

            updateUI();
          }
        } catch {
          // Ignore polling errors
        }
      }, 200);
    } else if (!state.liveMode && state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }

    showToast(`Live mode ${state.liveMode ? 'enabled (polling SQLite)' : 'disabled'}`);
    updateUI();
  });

  // Help
  screen.key('?', () => {
    state.showHelp = !state.showHelp;
    if (state.showHelp) {
      helpOverlay.setContent(generateHelpContent());
      helpOverlay.show();
      helpOverlay.focus();
    } else {
      helpOverlay.hide();
    }
    screen.render();
  });

  helpOverlay.key(['escape', 'enter', 'q', '?'], () => {
    state.showHelp = false;
    helpOverlay.hide();
    screen.render();
  });

  // Redraw screen (fixes garbage characters from wide chars/emojis)
  screen.key(['C-l', 'r'], () => {
    screen.realloc();
    screen.render();
  });

  // Quit
  screen.key(['q', 'C-c'], () => {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
    process.exit(0);
  });

  // List selection
  listBox.on('select', (item, index) => {
    state.currentIndex = index;
    updateUI();
  });

  // Initial render
  updateUI();
  listBox.focus();
  screen.render();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(`hook-events-tui v${VERSION}`);
    return 0;
  }

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`hook-events-tui v${VERSION} - Interactive Hook Events Viewer

Usage:
  hook-events-tui <session|sessions> [filter options]

  The session can be:
    - "." for most recent session
    - A session name (tender-spider)
    - A session ID (abc-123-...)
    - Comma-separated names/IDs ("tender-spider,earnest-lion")

Filter Options:
  --event, -e <types>     Filter by event type (comma-separated)
  --tool, -t <names>      Filter by tool name (comma-separated)
  --last <n>              Only last N events
  --live, -w              Watch for new events in real-time

Navigation:
  j/k, Up/Down     Navigate events
  h/l              Scroll content
  g/G              Go to first/last event
  Tab              Switch panes

View Modes:
  1                Raw JSON
  2                Human-readable (default)
  3                Minimal
  4                Tool I/O (input/output for tool events)
  5                Timeline (context around current event)

Bookmarks (Persisted to ~/.claude-code-sdk/hook-event-bookmarks.json):
  Space            Toggle bookmark on current event
  [                Jump to previous bookmark (respects filter)
  ]                Jump to next bookmark (respects filter)

Features:
  f                Toggle fullscreen
  s                Toggle scroll mode (fullscreen only)
  c                Copy current event to clipboard
  L                Toggle live mode
  r / Ctrl+L       Redraw screen (fix display glitches)
  ?                Show help
  q                Quit

List Display:
  Shows: time, event type, tool name, decision, context usage %, turn-session

Decision Indicator (PreToolUse only):
  ✓                Hook handler approved
  ?                No handler decision

Examples:
  hook-events-tui .
  hook-events-tui "tender-spider,earnest-lion"        # Multiple sessions
  hook-events-tui . --event PreToolUse,PostToolUse
  hook-events-tui . --tool Bash --live`);
    return 0;
  }

  // Parse arguments
  let sessionId = '';
  const filterOpts: FilterOptions = {};
  let filterLabel = 'all';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--event' || arg === '-e') {
      filterOpts.eventTypes = args[++i]?.split(',').map((t) => t.trim());
      filterLabel = `event:${filterOpts.eventTypes!.length}`;
    } else if (arg === '--tool' || arg === '-t') {
      filterOpts.toolNames = args[++i]?.split(',').map((t) => t.trim());
      filterLabel =
        filterLabel === 'all' ? `tool:${filterOpts.toolNames!.length}` : `${filterLabel}+tool`;
    } else if (arg === '--last') {
      filterOpts.last = Number.parseInt(args[++i]!, 10);
    } else if (arg === '--live' || arg === '-w') {
      state.liveMode = true;
    } else if (!arg.startsWith('-')) {
      sessionId = arg;
    }
  }

  if (!sessionId) {
    console.error('Error: No session specified');
    return 1;
  }

  const db = getDb();

  // Helper to resolve a single session name/ID
  const resolveSingleSession = (input: string): string | null => {
    // Handle "." as most recent session
    if (input === '.') {
      const sessions = getHookSessions(db, { recentDays: 1 });
      if (sessions.length === 0) {
        return null;
      }
      return sessions[0]!.sessionId;
    }

    // Try to resolve session name to session ID
    // Session names are like "peaceful-osprey", IDs are UUIDs
    const isLikelyName = !input.includes('-') || input.split('-').length <= 3;
    if (isLikelyName) {
      try {
        const store = getSessionStore();
        const resolvedId = store.getSessionId(input);
        if (resolvedId) {
          return resolvedId;
        }
      } catch {
        // Ignore - will try as literal session ID
      }
    }
    return input;
  };

  // Check if input contains comma-separated sessions
  let resolvedSessionIds: string[] = [];
  if (sessionId.includes(',')) {
    // Multi-session mode: resolve each session name/ID
    const parts = sessionId.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    for (const part of parts) {
      const resolved = resolveSingleSession(part);
      if (resolved) {
        resolvedSessionIds.push(resolved);
      }
    }
    if (resolvedSessionIds.length === 0) {
      console.error(`Error: No sessions found matching: ${sessionId}`);
      return 1;
    }
    // Use first session as primary for bookmarks
    sessionId = resolvedSessionIds[0]!;
    if (filterLabel === 'all') {
      filterLabel = `sessions:${resolvedSessionIds.length}`;
    } else {
      filterLabel = `${filterLabel}+sessions:${resolvedSessionIds.length}`;
    }
  } else {
    // Single session mode
    const resolved = resolveSingleSession(sessionId);
    if (!resolved) {
      console.error('Error: No recent hook events found');
      return 1;
    }
    sessionId = resolved;
    resolvedSessionIds = [sessionId];
  }

  // Load events from all sessions
  let allEvents: HookEventResult[];
  if (resolvedSessionIds.length > 1) {
    const allResults: HookEventResult[] = [];
    for (const sid of resolvedSessionIds) {
      const events = getHookEvents(db, { sessionId: sid });
      allResults.push(...events);
    }
    // Sort by timestamp for chronological view
    allEvents = allResults.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  } else {
    allEvents = getHookEvents(db, { sessionId });
  }

  if (allEvents.length === 0) {
    console.error(`Error: No hook events found for session: ${sessionId}`);
    console.error('Tip: Use "." for most recent session, or provide a full session ID');
    return 1;
  }

  // Apply filters
  const filteredEvents = filterEvents(allEvents, filterOpts);
  if (filteredEvents.length === 0) {
    console.error('Error: No events match the filter criteria');
    return 1;
  }

  // Load persisted bookmarks
  const bookmarkStore = loadBookmarks();
  const sessionBookmarks = new Set<number>(bookmarkStore[sessionId] || []);

  // Initialize state
  state.allEvents = allEvents;
  state.events = filteredEvents;
  state.currentIndex = filteredEvents.length - 1; // Start at last event
  // For multi-session, show count; for single session, show the ID
  state.sessionId = resolvedSessionIds.length > 1
    ? `${resolvedSessionIds.length} sessions`
    : sessionId;
  state.activeFilter = filterLabel;
  state.filterOpts = filterOpts;
  state.bookmarks = sessionBookmarks;
  state.bookmarkStore = bookmarkStore;

  // Start TUI
  await createTUI();

  return 0;
}

main()
  .then((code) => {
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
