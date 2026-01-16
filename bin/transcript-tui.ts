#!/usr/bin/env bun
/**
 * transcript-tui - Claude Code Transcript Viewer TUI
 *
 * Interactive terminal UI for browsing Claude Code session transcripts.
 *
 * Usage:
 *   transcript-tui <file|session>          Open transcript in TUI
 *
 * Navigation:
 *   j/k, Up/Down     Navigate lines
 *   g/G              Go to first/last line
 *   /                Search
 *   Tab              Switch panes
 *   1-4              Switch view mode (raw, human, minimal, context)
 *   q                Quit
 *
 * Examples:
 *   transcript-tui ./session.jsonl
 *   transcript-tui cryptic-crunching-candle
 */

import blessed from 'blessed';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseTranscriptFile, getConversationThread } from '../src/transcripts/parser';
import { findTranscriptFiles, getSessionInfo } from '../src/transcripts/indexer';
import {
  renderLine,
  formatJson,
  formatMinimal,
  getDisplayType,
  getPreview,
  getSessionMetadata,
  filterLines,
  renderTextOnlyContent,
  type RenderedLine,
  type FilterOptions,
  type ExtendedLineType,
} from '../src/transcripts/viewer';
import type { TranscriptLine } from '../src/transcripts/types';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '1.0.0';
const PROJECTS_DIR = join(process.env.HOME || '~', '.claude', 'projects');

// View modes
type ViewMode = 'raw' | 'human' | 'minimal' | 'context' | 'markdown';

// Markdown rendering
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer() as any,
});

// ============================================================================
// State
// ============================================================================

interface AppState {
  lines: TranscriptLine[];
  allLines: TranscriptLine[]; // Unfiltered lines for context view
  currentIndex: number;
  viewMode: ViewMode;
  searchQuery: string;
  searchResults: number[];
  searchResultIndex: number;
  filePath: string;
  sessionName: string;
  sessionId: string;
  focusedPane: 'list' | 'content';
  activeFilter: string;
  fullscreen: boolean;
  scrollMode: boolean; // In fullscreen: true=arrows scroll content, false=arrows navigate lines
  lastCopiedRef: string;
  textOnly: boolean;
  // New TUI enhancement state
  bookmarks: Set<number>; // Set of bookmarked line numbers
  showUsageGraph: boolean; // Toggle usage graph overlay
  mouseEnabled: boolean; // Toggle mouse support
  showHelp: boolean; // Toggle help overlay
  sessionFilter: string[]; // Session IDs to filter by
}

let state: AppState = {
  lines: [],
  allLines: [],
  currentIndex: 0,
  viewMode: 'human',
  searchQuery: '',
  searchResults: [],
  searchResultIndex: 0,
  filePath: '',
  sessionName: '',
  sessionId: '',
  focusedPane: 'list',
  activeFilter: 'all',
  fullscreen: false,
  scrollMode: false,
  lastCopiedRef: '',
  textOnly: false,
  // New TUI enhancement state
  bookmarks: new Set<number>(),
  showUsageGraph: false,
  mouseEnabled: false,
  showHelp: false,
  sessionFilter: [],
};

// ============================================================================
// Helpers
// ============================================================================

async function resolveTranscriptPath(input: string): Promise<string | null> {
  const file = Bun.file(input);
  if (await file.exists()) {
    return input;
  }

  if (input.startsWith('/')) {
    return null;
  }

  const relativePath = join(process.cwd(), input);
  const relativeFile = Bun.file(relativePath);
  if (await relativeFile.exists()) {
    return relativePath;
  }

  const files = await findTranscriptFiles(PROJECTS_DIR);

  for (const filePath of files) {
    if (filePath.includes(input)) {
      return filePath;
    }
  }

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

  try {
    const { getSessionStore } = await import('../src/hooks/sessions');
    const store = getSessionStore();
    const sessionId = store.getSessionId(input);
    if (sessionId) {
      for (const filePath of files) {
        if (filePath.includes(sessionId)) {
          return filePath;
        }
      }
    }
  } catch {
    // sesh not available
  }

  return null;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'user':
      return 'green';
    case 'assistant':
    case 'tool_use':
      return 'blue';
    case 'tool_result':
      return 'cyan';
    case 'thinking':
      return 'magenta';
    case 'system':
      return 'yellow';
    case 'summary':
      return 'white';
    default:
      return 'gray';
  }
}

/**
 * Copy text to system clipboard
 */
function copyToClipboard(text: string): void {
  const proc = process.platform === 'darwin'
    ? spawn('pbcopy')
    : spawn('xclip', ['-selection', 'clipboard']);
  proc.stdin.write(text);
  proc.stdin.end();
}

/**
 * Toggle bookmark on the current line
 */
function toggleBookmark(lineNumber: number): void {
  if (state.bookmarks.has(lineNumber)) {
    state.bookmarks.delete(lineNumber);
  } else {
    state.bookmarks.add(lineNumber);
  }
}

/**
 * Jump to the previous bookmarked line
 */
function jumpToPrevBookmark(): void {
  if (state.bookmarks.size === 0) return;

  const currentLineNumber = state.lines[state.currentIndex]?.lineNumber ?? 0;
  const sortedBookmarks = Array.from(state.bookmarks).sort((a, b) => b - a); // Descending

  // Find the first bookmark with lineNumber < currentLineNumber
  for (const bookmark of sortedBookmarks) {
    if (bookmark < currentLineNumber) {
      // Find the index in state.lines that has this lineNumber
      for (let i = 0; i < state.lines.length; i++) {
        if (state.lines[i]?.lineNumber === bookmark) {
          state.currentIndex = i;
          return;
        }
      }
    }
  }

  // Wrap around to the last bookmark
  const lastBookmark = sortedBookmarks[0];
  if (lastBookmark !== undefined) {
    for (let i = 0; i < state.lines.length; i++) {
      if (state.lines[i]?.lineNumber === lastBookmark) {
        state.currentIndex = i;
        return;
      }
    }
  }
}

/**
 * Jump to the next bookmarked line
 */
function jumpToNextBookmark(): void {
  if (state.bookmarks.size === 0) return;

  const currentLineNumber = state.lines[state.currentIndex]?.lineNumber ?? 0;
  const sortedBookmarks = Array.from(state.bookmarks).sort((a, b) => a - b); // Ascending

  // Find the first bookmark with lineNumber > currentLineNumber
  for (const bookmark of sortedBookmarks) {
    if (bookmark > currentLineNumber) {
      // Find the index in state.lines that has this lineNumber
      for (let i = 0; i < state.lines.length; i++) {
        if (state.lines[i]?.lineNumber === bookmark) {
          state.currentIndex = i;
          return;
        }
      }
    }
  }

  // Wrap around to the first bookmark
  const firstBookmark = sortedBookmarks[0];
  if (firstBookmark !== undefined) {
    for (let i = 0; i < state.lines.length; i++) {
      if (state.lines[i]?.lineNumber === firstBookmark) {
        state.currentIndex = i;
        return;
      }
    }
  }
}

/**
 * Generate ASCII usage graph showing cumulative tokens
 */
function generateUsageGraph(width: number, height: number): string {
  const sourceLines = state.allLines.length > 0 ? state.allLines : state.lines;
  if (sourceLines.length === 0) return 'No data';

  // Calculate cumulative usage for each line
  const usageData: { lineNumber: number; total: number }[] = [];
  let runningInput = 0;
  let runningOutput = 0;

  for (const line of sourceLines) {
    if (line.message?.usage) {
      runningInput += line.message.usage.input_tokens || 0;
      runningOutput += line.message.usage.output_tokens || 0;
    }
    usageData.push({
      lineNumber: line.lineNumber,
      total: runningInput + runningOutput,
    });
  }

  const maxTokens = usageData[usageData.length - 1]?.total || 1;
  const graphHeight = height - 4; // Leave room for labels
  const graphWidth = width - 12; // Leave room for Y-axis labels

  // Sample data points to fit width
  const step = Math.max(1, Math.floor(usageData.length / graphWidth));
  const sampledData: number[] = [];
  for (let i = 0; i < usageData.length; i += step) {
    sampledData.push(usageData[i]?.total || 0);
  }

  // Build the graph
  const lines: string[] = [];
  lines.push(`{bold}Token Usage Graph{/bold} (Total: ${maxTokens.toLocaleString()} tokens)`);
  lines.push('');

  // ASCII bar chart (horizontal bars for each sampled point)
  const barChar = '█';
  const numBars = Math.min(graphHeight, sampledData.length);
  const dataStep = Math.max(1, Math.floor(sampledData.length / numBars));

  for (let i = 0; i < numBars; i++) {
    const dataIndex = Math.min(i * dataStep, sampledData.length - 1);
    const value = sampledData[dataIndex] || 0;
    const barLength = Math.round((value / maxTokens) * (graphWidth - 10));
    const lineNum = usageData[dataIndex * step]?.lineNumber || 0;
    const label = String(lineNum).padStart(5);
    const bar = barChar.repeat(Math.max(1, barLength));
    lines.push(`${label} {cyan-fg}${bar}{/cyan-fg} ${value.toLocaleString()}`);
  }

  lines.push('');
  lines.push(`{gray-fg}Lines: ${sourceLines.length} | Current: ${state.lines[state.currentIndex]?.lineNumber || 0}{/gray-fg}`);

  return lines.join('\n');
}

/**
 * Generate help content for the help overlay
 */
function generateHelpContent(): string {
  const modeStr = state.fullscreen ? (state.scrollMode ? 'SCROLL' : 'NAV') : 'SPLIT';
  const mouseStr = state.mouseEnabled ? 'ON' : 'OFF';
  const bookmarkCount = state.bookmarks.size;
  const sessionFilterStr = state.sessionFilter.length > 0
    ? state.sessionFilter.join(', ').slice(0, 30) + (state.sessionFilter.join(', ').length > 30 ? '...' : '')
    : 'none';

  return `{bold}{center}Transcript TUI Help{/center}{/bold}

{bold}Current Status:{/bold}
  Mode: {cyan-fg}${modeStr}{/cyan-fg}  |  View: {cyan-fg}${state.viewMode}{/cyan-fg}  |  Mouse: {cyan-fg}${mouseStr}{/cyan-fg}
  Filter: {cyan-fg}${state.activeFilter}{/cyan-fg}  |  Bookmarks: {cyan-fg}${bookmarkCount}{/cyan-fg}
  Session Filter: {cyan-fg}${sessionFilterStr}{/cyan-fg}
  Line: {cyan-fg}${state.currentIndex + 1}/${state.lines.length}{/cyan-fg}

{bold}Navigation:{/bold}
  {green-fg}j/k{/green-fg} or {green-fg}↑/↓{/green-fg}     Navigate lines (or scroll in scroll mode)
  {green-fg}h/l{/green-fg}             Scroll content up/down
  {green-fg}g/G{/green-fg}             Go to first/last line
  {green-fg}PgUp/PgDn{/green-fg}       Page up/down (Ctrl+u/d also work)
  {green-fg}Tab{/green-fg}             Switch panes (list/content)
  {green-fg}u/a{/green-fg}             Jump to next user/assistant message

{bold}View Modes:{/bold}
  {green-fg}1{/green-fg}               Raw JSON
  {green-fg}2{/green-fg}               Human-readable
  {green-fg}3{/green-fg}               Minimal (text only)
  {green-fg}4{/green-fg}               Context (conversation thread)
  {green-fg}5{/green-fg}               Markdown (rendered)

{bold}Search:{/bold}
  {green-fg}/{/green-fg}               Open search
  {green-fg}n/N{/green-fg}             Next/previous search result
  {green-fg}Esc{/green-fg}             Clear search

{bold}Bookmarks:{/bold}
  {green-fg}b{/green-fg}               Toggle bookmark on current line
  {green-fg}[{/green-fg}               Jump to previous bookmark
  {green-fg}]{/green-fg}               Jump to next bookmark

{bold}Features:{/bold}
  {green-fg}f{/green-fg}               Toggle fullscreen mode
  {green-fg}s{/green-fg}               Toggle scroll mode (fullscreen only)
  {green-fg}y{/green-fg}               Copy recall reference
  {green-fg}c{/green-fg}               Copy current line content to clipboard
  {green-fg}m{/green-fg}               Toggle mouse support
  {green-fg}?{/green-fg}               Toggle this help overlay

{bold}Quit:{/bold}
  {green-fg}q{/green-fg} or {green-fg}Ctrl+C{/green-fg}    Exit

{gray-fg}Press any key to close this help...{/gray-fg}`;
}

// ============================================================================
// View Renderers
// ============================================================================

/**
 * Calculate cumulative token usage up to and including the given line
 */
function getCumulativeUsage(upToLine: TranscriptLine): { input: number; output: number; total: number } {
  let input = 0;
  let output = 0;

  // Use allLines to get the complete picture
  const sourceLines = state.allLines.length > 0 ? state.allLines : state.lines;

  for (const line of sourceLines) {
    if (line.message?.usage) {
      input += line.message.usage.input_tokens || 0;
      output += line.message.usage.output_tokens || 0;
    }
    if (line.lineNumber >= upToLine.lineNumber) {
      break;
    }
  }

  // Add current line's usage
  if (upToLine.message?.usage) {
    input += upToLine.message.usage.input_tokens || 0;
    output += upToLine.message.usage.output_tokens || 0;
  }

  return { input, output, total: input + output };
}

function renderCurrentLine(): string {
  if (state.lines.length === 0) {
    return 'No lines loaded.';
  }

  const line = state.lines[state.currentIndex];
  if (!line) {
    return 'Invalid line index.';
  }

  // Helper to add view label at top
  const viewLabel = (mode: string, color: string) => `{${color}-fg}=== VIEW: ${mode.toUpperCase()} ==={/${color}-fg}\n\n`;

  switch (state.viewMode) {
    case 'raw':
      // Raw JSON - don't escape, just show as-is (disable tags interpretation)
      return viewLabel('raw', 'yellow') + formatJson(line, true);

    case 'human': {
      const content = renderLine(line).fullContent;
      const usage = getCumulativeUsage(line);
      const usageStr = `\n\n{cyan-fg}[Context: ${usage.total.toLocaleString()} tokens (in: ${usage.input.toLocaleString()}, out: ${usage.output.toLocaleString()})]{/cyan-fg}`;
      return viewLabel('human', 'green') + content + usageStr;
    }

    case 'minimal':
      return viewLabel('minimal', 'magenta') + (formatMinimal(line) || '(empty)');

    case 'context': {
      // Show conversation thread (user prompt + response) from full transcript
      const sourceLines = state.allLines.length > 0 ? state.allLines : state.lines;
      const thread = getConversationThread(sourceLines, line.uuid);
      const parts: string[] = [];

      for (const threadLine of thread) {
        parts.push(renderLine(threadLine).fullContent);
        parts.push('');
      }

      return viewLabel('context', 'blue') + parts.join('\n');
    }

    case 'markdown': {
      // Extract text content and render as markdown
      let textContent = '';
      if (line.type === 'assistant' && line.message?.content) {
        if (typeof line.message.content === 'string') {
          textContent = line.message.content;
        } else if (Array.isArray(line.message.content)) {
          for (const block of line.message.content as any[]) {
            if (block.type === 'text' && block.text) {
              textContent += block.text + '\n';
            }
          }
        }
      } else if (line.type === 'user' && line.message?.content) {
        if (typeof line.message.content === 'string') {
          textContent = line.message.content;
        } else if (Array.isArray(line.message.content)) {
          for (const block of line.message.content as any[]) {
            if (block.type === 'text' && block.text) {
              textContent += block.text + '\n';
            }
          }
        }
      }

      if (!textContent.trim()) {
        return viewLabel('markdown', 'red') + `--- Line ${line.lineNumber} [${line.type}] ---\n\n(no text content to render as markdown)`;
      }

      try {
        const rendered = marked(textContent) as string;
        return viewLabel('markdown', 'red') + `--- Line ${line.lineNumber} [${line.type}] ---\n\n${rendered}`;
      } catch {
        return viewLabel('markdown', 'red') + `--- Line ${line.lineNumber} [${line.type}] ---\n\n${textContent}`;
      }
    }

    default:
      return renderLine(line).fullContent;
  }
}

function getListItems(): string[] {
  return state.lines.map((line, index) => {
    // Compact format: lineNum type preview (no timestamp to save space)
    const type = getDisplayType(line).slice(0, 6).padEnd(6);
    const typeColor = getTypeColor(line.type);
    const preview = getPreview(line, 50);
    const searchMatch = state.searchResults.includes(index) ? '*' : ' ';
    const bookmarkMark = state.bookmarks.has(line.lineNumber) ? '{yellow-fg}★{/yellow-fg}' : ' ';

    return `${searchMatch}${bookmarkMark}${String(line.lineNumber).padStart(5)} {${typeColor}-fg}${type}{/${typeColor}-fg} ${preview}`;
  });
}

/**
 * Generate a recall reference ID for the current line
 * Format: transcript://<transcriptFileUUID>#<lineNumber>:<lineUUID>
 *
 * Uses the transcript file UUID (not session name) so references work
 * across different projects/repos that may not share session name storage.
 */
function generateRecallRef(line: TranscriptLine): string {
  // Extract transcript file UUID from the file path
  // e.g., /path/to/be59ef1a-4085-4f98-84ce-e9cbcb9500cc.jsonl -> be59ef1a-4085-4f98-84ce-e9cbcb9500cc
  const filename = state.filePath.split('/').pop() || '';
  const transcriptUuid = filename.replace('.jsonl', '');
  return `transcript://${transcriptUuid}#${line.lineNumber}:${line.uuid}`;
}

// ============================================================================
// Search
// ============================================================================

function performSearch(query: string): void {
  state.searchQuery = query;
  state.searchResults = [];
  state.searchResultIndex = 0;

  if (!query.trim()) {
    return;
  }

  const queryLower = query.toLowerCase();

  for (let i = 0; i < state.lines.length; i++) {
    const line = state.lines[i]!;
    const content = formatMinimal(line);
    if (content && content.toLowerCase().includes(queryLower)) {
      state.searchResults.push(i);
    }
  }
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
// Main TUI
// ============================================================================

async function createTUI(): Promise<void> {
  // Create screen
  const screen = blessed.screen({
    smartCSR: true,
    title: `Transcript Viewer - ${state.sessionName || state.sessionId}`,
    fullUnicode: true,
  });

  // Header
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    style: {
      border: { fg: 'blue' },
      fg: 'white',
    },
    content: `{bold}Transcript Viewer{/bold} | Session: {green-fg}${state.sessionName || state.sessionId}{/green-fg} | Lines: ${state.lines.length} | View: [${state.viewMode}]`,
    tags: true,
  });

  // Left pane - Line list
  const listBox = blessed.list({
    parent: screen,
    top: 3,
    left: 0,
    width: '30%',
    height: '100%-6',
    border: 'line',
    label: ' Lines ',
    style: {
      border: { fg: state.focusedPane === 'list' ? 'green' : 'blue' },
      selected: { bg: 'blue', fg: 'white', bold: true },
      item: { fg: 'white' },
    },
    keys: false, // Disabled - we handle navigation ourselves
    vi: false,   // Disabled - we handle navigation ourselves
    mouse: false, // Disabled to allow text selection for copying
    scrollbar: {
      ch: ' ',
      style: { bg: 'blue' },
    },
    items: getListItems(),
  });

  // Right pane - Content
  const contentBox = blessed.box({
    parent: screen,
    top: 3,
    left: '30%',
    width: '70%',
    height: '100%-6',
    border: 'line',
    label: ` Content [${state.viewMode}] `,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      style: { bg: 'blue' },
    },
    style: {
      border: { fg: state.focusedPane === 'content' ? 'green' : 'blue' },
      fg: 'white',
    },
    content: renderCurrentLine(),
    tags: true,
  });

  // Footer - Help
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: 'line',
    style: {
      border: { fg: 'blue' },
      fg: 'gray',
    },
    content:
      '{bold}j/k{/bold}:nav {bold}b{/bold}:bookmark {bold}[]{/bold}:jump {bold}c{/bold}:copy {bold}u{/bold}:usage {bold}m{/bold}:mouse {bold}f{/bold}:fullscreen {bold}1-5{/bold}:view {bold}/{/bold}:search {bold}?{/bold}:help {bold}q{/bold}:quit',
    tags: true,
  });

  // Recall reference display (hidden by default)
  const refDisplay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: 7,
    border: 'line',
    label: ' Recall Reference (Ctrl+C to copy, any key to close) ',
    hidden: true,
    style: {
      border: { fg: 'yellow' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
    content: '',
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
    style: {
      border: { fg: 'yellow' },
      fg: 'white',
    },
    inputOnFocus: true,
  });

  // Help overlay (hidden by default)
  const helpOverlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '70%',
    height: '80%',
    border: 'line',
    label: ' Help (press any key to close) ',
    hidden: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      style: { bg: 'cyan' },
    },
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
    content: '',
  });

  // Usage graph overlay (hidden by default)
  const usageGraphOverlay = blessed.box({
    parent: screen,
    top: 'center',
    left: 'center',
    width: '80%',
    height: '70%',
    border: 'line',
    label: ' Token Usage Graph (press any key to close) ',
    hidden: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: ' ',
      style: { bg: 'cyan' },
    },
    style: {
      border: { fg: 'cyan' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
    content: '',
  });

  // Copy confirmation toast (hidden by default)
  const copyToast = blessed.box({
    parent: screen,
    bottom: 4,
    right: 2,
    width: 40,
    height: 3,
    border: 'line',
    hidden: true,
    style: {
      border: { fg: 'green' },
      fg: 'white',
      bg: 'black',
    },
    tags: true,
    content: '',
  });

  // Toast timeout handle
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  const showToast = (message: string, duration = 2000) => {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }
    copyToast.setContent(` {green-fg}${message}{/green-fg}`);
    copyToast.show();
    screen.render();
    toastTimeout = setTimeout(() => {
      copyToast.hide();
      screen.render();
    }, duration);
  };

  // Update function
  const updateUI = () => {
    // Update header
    const filterInfo = state.activeFilter !== 'all' ? ` | Filter: {yellow-fg}${state.activeFilter}{/yellow-fg}` : '';
    const fullscreenInfo = state.fullscreen ? ' | {magenta-fg}FULLSCREEN{/magenta-fg}' : '';
    header.setContent(
      `{bold}Transcript Viewer{/bold} | Session: {green-fg}${state.sessionName || state.sessionId}{/green-fg} | Lines: ${state.lines.length}${filterInfo} | Line: ${state.currentIndex + 1}/${state.lines.length} | View: [${state.viewMode}]${fullscreenInfo}${state.searchQuery ? ` | Search: "${state.searchQuery}" (${state.searchResults.length})` : ''}`
    );

    // Handle fullscreen mode
    if (state.fullscreen) {
      listBox.hide();
      header.hide();
      footer.hide();
      contentBox.top = 0;
      contentBox.left = 0;
      contentBox.width = '100%';
      contentBox.height = '100%';
      contentBox.border = { type: 'line', left: false, right: false, top: false, bottom: false } as any;
      // Show mode indicator at top-left in fullscreen
      const modeStr = state.scrollMode ? 'SCROLL' : 'NAV';
      contentBox.setLabel(` [${modeStr}] Line ${state.currentIndex + 1}/${state.lines.length} | s:toggle f:exit `);
    } else {
      listBox.show();
      header.show();
      footer.show();
      contentBox.top = 3;
      contentBox.left = '30%';
      contentBox.width = '70%';
      contentBox.height = '100%-6';
      contentBox.border = 'line';
      state.scrollMode = false; // Reset scroll mode when exiting fullscreen
      footer.setContent('{bold}j/k{/bold}:nav {bold}b{/bold}:bookmark {bold}[]{/bold}:jump {bold}c{/bold}:copy {bold}u{/bold}:usage {bold}m{/bold}:mouse {bold}f{/bold}:fullscreen {bold}1-5{/bold}:view {bold}/{/bold}:search {bold}?{/bold}:help {bold}q{/bold}:quit');
    }

    // Update list
    listBox.setItems(getListItems());
    listBox.select(state.currentIndex);

    // Update content
    const newContent = renderCurrentLine();
    contentBox.setLabel(` Content [${state.viewMode}] `);
    contentBox.setContent(newContent);
    contentBox.scrollTo(0);

    // Update border colors based on focus
    listBox.style.border = { fg: state.focusedPane === 'list' ? 'green' : 'blue' };
    contentBox.style.border = { fg: state.focusedPane === 'content' || state.fullscreen ? 'green' : 'blue' };

    screen.render();
  };

  // Key bindings

  // Helper to check if we should navigate lines or scroll content
  const shouldNavigateLines = () => {
    if (state.fullscreen) {
      return !state.scrollMode; // In fullscreen: scrollMode=false means navigate lines
    }
    return state.focusedPane === 'list';
  };

  // Navigation
  screen.key(['j', 'down'], () => {
    if (shouldNavigateLines() && state.currentIndex < state.lines.length - 1) {
      state.currentIndex++;
      updateUI();
    } else if (!shouldNavigateLines()) {
      contentBox.scroll(1);
      screen.render();
    }
  });

  screen.key(['k', 'up'], () => {
    if (shouldNavigateLines() && state.currentIndex > 0) {
      state.currentIndex--;
      updateUI();
    } else if (!shouldNavigateLines()) {
      contentBox.scroll(-1);
      screen.render();
    }
  });

  screen.key(['pagedown', 'C-d'], () => {
    if (shouldNavigateLines()) {
      state.currentIndex = Math.min(state.currentIndex + 20, state.lines.length - 1);
      updateUI();
    } else {
      contentBox.scroll(10);
      screen.render();
    }
  });

  screen.key(['pageup', 'C-u'], () => {
    if (shouldNavigateLines()) {
      state.currentIndex = Math.max(state.currentIndex - 20, 0);
      updateUI();
    } else {
      contentBox.scroll(-10);
      screen.render();
    }
  });

  // Content scrolling (h=up, l=down) - works in any mode
  screen.key('h', () => {
    contentBox.scroll(-1);
    screen.render();
  });

  screen.key('l', () => {
    contentBox.scroll(1);
    screen.render();
  });

  screen.key('g', () => {
    if (shouldNavigateLines()) {
      state.currentIndex = 0;
      updateUI();
    } else {
      contentBox.setScrollPerc(0);
      screen.render();
    }
  });

  screen.key('G', () => {
    if (shouldNavigateLines()) {
      state.currentIndex = state.lines.length - 1;
      updateUI();
    } else {
      contentBox.setScrollPerc(100);
      screen.render();
    }
  });

  // Scroll mode toggle (only in fullscreen)
  screen.key('s', () => {
    if (state.fullscreen) {
      state.scrollMode = !state.scrollMode;
      updateUI();
    }
  });

  // Pane switching (disabled in fullscreen)
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
    state.viewMode = 'context';
    updateUI();
  });
  screen.key('5', () => {
    state.viewMode = 'markdown';
    updateUI();
  });

  // Fullscreen toggle
  let prevFocusedPane: 'list' | 'content' = 'list';
  screen.key('f', () => {
    if (!state.fullscreen) {
      // Entering fullscreen - save current focus
      prevFocusedPane = state.focusedPane;
    } else {
      // Exiting fullscreen - restore previous focus
      state.focusedPane = prevFocusedPane;
    }
    state.fullscreen = !state.fullscreen;
    updateUI();
  });

  // Copy recall reference
  screen.key('y', () => {
    const line = state.lines[state.currentIndex];
    if (line) {
      const ref = generateRecallRef(line);
      state.lastCopiedRef = ref;
      refDisplay.setContent(
        `\n{bold}Recall Reference:{/bold}\n\n{yellow-fg}${ref}{/yellow-fg}\n\nUse this ID to recall this line in another Claude session.`
      );
      refDisplay.show();
      refDisplay.focus();
      screen.render();
    }
  });

  // Close ref display on any key
  refDisplay.key(['escape', 'enter', 'q', 'y'], () => {
    refDisplay.hide();
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

  // Search navigation
  screen.key('n', () => {
    jumpToNextSearchResult();
    updateUI();
  });

  screen.key('N', () => {
    jumpToPrevSearchResult();
    updateUI();
  });

  // Clear search
  screen.key('escape', () => {
    state.searchQuery = '';
    state.searchResults = [];
    updateUI();
  });

  // Type filters (quick filters)
  screen.key('a', () => {
    // Jump to next assistant message
    for (let i = state.currentIndex + 1; i < state.lines.length; i++) {
      if (state.lines[i]?.type === 'assistant') {
        state.currentIndex = i;
        updateUI();
        return;
      }
    }
    // Wrap around
    for (let i = 0; i < state.currentIndex; i++) {
      if (state.lines[i]?.type === 'assistant') {
        state.currentIndex = i;
        updateUI();
        return;
      }
    }
  });

  // ============================================================================
  // NEW TUI ENHANCEMENTS
  // ============================================================================

  // Clipboard copy with 'c' key
  screen.key('c', () => {
    const line = state.lines[state.currentIndex];
    if (line) {
      const content = formatMinimal(line) || formatJson(line, true);
      copyToClipboard(content);
      showToast('Copied to clipboard!');
    }
  });

  // Bookmark toggle with 'b' key
  screen.key('b', () => {
    const line = state.lines[state.currentIndex];
    if (line) {
      toggleBookmark(line.lineNumber);
      const action = state.bookmarks.has(line.lineNumber) ? 'Added' : 'Removed';
      showToast(`${action} bookmark (${state.bookmarks.size} total)`);
      updateUI();
    }
  });

  // Bookmark navigation with '[' and ']'
  screen.key('[', () => {
    if (state.bookmarks.size === 0) {
      showToast('No bookmarks set');
      return;
    }
    jumpToPrevBookmark();
    updateUI();
  });

  screen.key(']', () => {
    if (state.bookmarks.size === 0) {
      showToast('No bookmarks set');
      return;
    }
    jumpToNextBookmark();
    updateUI();
  });

  // Usage graph toggle with 'u' key
  screen.key('u', () => {
    state.showUsageGraph = !state.showUsageGraph;
    if (state.showUsageGraph) {
      // Get dimensions from screen
      const width = typeof screen.width === 'number' ? screen.width : 80;
      const height = typeof screen.height === 'number' ? screen.height : 24;
      const graphWidth = Math.floor(width * 0.8);
      const graphHeight = Math.floor(height * 0.7);
      usageGraphOverlay.setContent(generateUsageGraph(graphWidth, graphHeight));
      usageGraphOverlay.show();
      usageGraphOverlay.focus();
    } else {
      usageGraphOverlay.hide();
    }
    screen.render();
  });

  // Close usage graph on any key
  usageGraphOverlay.key(['escape', 'enter', 'q', 'u'], () => {
    state.showUsageGraph = false;
    usageGraphOverlay.hide();
    screen.render();
  });

  // Mouse support toggle with 'm' key
  screen.key('m', () => {
    state.mouseEnabled = !state.mouseEnabled;
    (listBox as any).options.mouse = state.mouseEnabled;
    showToast(`Mouse ${state.mouseEnabled ? 'enabled' : 'disabled'}`);
    screen.render();
  });

  // Help overlay with '?' key
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

  // Close help overlay on any key
  helpOverlay.key(['escape', 'enter', 'q', '?'], () => {
    state.showHelp = false;
    helpOverlay.hide();
    screen.render();
  });

  // Quit
  screen.key(['q', 'C-c'], () => {
    process.exit(0);
  });

  // List selection via click
  listBox.on('select', (item, index) => {
    state.currentIndex = index;
    updateUI();
  });

  // Initial render
  updateUI();

  // Focus list by default
  listBox.focus();

  screen.render();
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`transcript-tui v${VERSION} - Interactive Transcript Viewer

Usage:
  transcript-tui <file|session> [filter options]

Filter Options:
  --type, -t <types>      Filter by type (comma-separated)
  --user-prompts, -u      Only user prompts
  --assistant, -a         Only assistant responses (includes thinking/tools)
  --text-only, -o         Only AI text output (no thinking, no tool_use)
  --tools                 Only tool use/result entries
  --thinking              Only thinking blocks
  --last <n>              Only last N entries
  --session, -s <ids>     Filter by session ID(s) (comma-separated)
  --session-name <name>   Filter by session name (uses sesh lookup)

Navigation:
  j/k, Up/Down     Navigate lines
  h/l              Scroll content (works in any mode)
  g/G              Go to first/last line
  PgUp/PgDn        Page navigation
  Tab              Switch between panes
  a                Jump to next assistant message

View Modes:
  1                Raw JSON (pretty-printed)
  2                Human-readable format
  3                Minimal (text only)
  4                Context (conversation thread)
  5                Markdown (rendered with colors/formatting)

Search:
  /                Open search
  n/N              Next/previous result
  Esc              Clear search

Bookmarks:
  b                Toggle bookmark on current line
  [                Jump to previous bookmark
  ]                Jump to next bookmark

Features:
  f                Toggle fullscreen (content only, no borders)
  s                Toggle scroll mode in fullscreen (NAV=lines, SCROLL=content)
  y                Copy recall reference for current line
  c                Copy current line content to clipboard
  u                Toggle token usage graph overlay
  m                Toggle mouse support
  ?                Show help overlay
  q, Ctrl+C        Quit

Examples:
  transcript-tui ./session.jsonl
  transcript-tui cryptic-crunching-candle
  transcript-tui cryptic-crunching-candle --assistant
  transcript-tui cryptic-crunching-candle --text-only        # AI text only
  transcript-tui cryptic-crunching-candle --type user,assistant
  transcript-tui cryptic-crunching-candle --tools --last 50`);
    return 0;
  }

  // Parse arguments
  let input = '';
  const filterOpts: FilterOptions = {};
  let filterLabel = 'all';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '--type' || arg === '-t') {
      const types = args[++i]?.split(',').map(t => t.trim()) as ExtendedLineType[];
      filterOpts.types = types;
      filterLabel = `type:${types.join(',')}`;
    } else if (arg === '--user-prompts' || arg === '-u') {
      filterOpts.userPrompts = true;
      filterLabel = 'user';
    } else if (arg === '--assistant' || arg === '-a') {
      filterOpts.assistant = true;
      filterLabel = 'assistant';
    } else if (arg === '--tools') {
      filterOpts.tools = true;
      filterLabel = 'tools';
    } else if (arg === '--thinking') {
      filterOpts.thinking = true;
      filterLabel = 'thinking';
    } else if (arg === '--text-only' || arg === '-o') {
      filterOpts.textOnly = true;
      filterLabel = 'text-only';
    } else if (arg === '--last') {
      filterOpts.last = parseInt(args[++i]!, 10);
    } else if (arg === '--session' || arg === '-s') {
      const ids = args[++i]?.split(',').map((s) => s.trim()) || [];
      filterOpts.sessionIds = ids;
      state.sessionFilter = ids;
      filterLabel = filterLabel === 'all' ? `session:${ids.length}` : `${filterLabel}+session`;
    } else if (arg === '--session-name') {
      const name = args[++i];
      if (name) {
        try {
          const { getSessionStore } = await import('../src/hooks/sessions');
          const store = getSessionStore();
          const sessionId = store.getSessionId(name);
          if (sessionId) {
            filterOpts.sessionIds = filterOpts.sessionIds || [];
            filterOpts.sessionIds.push(sessionId);
            state.sessionFilter = filterOpts.sessionIds;
            filterLabel = filterLabel === 'all' ? `session:${name}` : `${filterLabel}+session`;
          } else {
            console.error(`Error: Session name not found: ${name}`);
            return 1;
          }
        } catch {
          console.error(`Error: Session name lookup failed: ${name}`);
          return 1;
        }
      }
    } else if (!arg.startsWith('-')) {
      input = arg;
    }
  }

  if (!input) {
    console.error('Error: No transcript file or session specified');
    return 1;
  }

  const filePath = await resolveTranscriptPath(input);

  if (!filePath) {
    console.error(`Error: Transcript not found: ${input}`);
    return 1;
  }

  try {
    // Load transcript
    const allLines = await parseTranscriptFile(filePath);
    const metadata = getSessionMetadata(allLines);

    // Apply filters
    const filteredLines = filterLines(allLines, filterOpts);

    if (filteredLines.length === 0) {
      console.error(`Error: No lines match the filter criteria`);
      return 1;
    }

    // Initialize state
    state.allLines = allLines;
    state.lines = filteredLines;
    state.currentIndex = filteredLines.length - 1; // Start at last line
    state.filePath = filePath;
    state.sessionName = (metadata.sessionName as string) || '';
    state.sessionId = (metadata.sessionId as string) || '';
    state.activeFilter = filterLabel;
    state.textOnly = filterOpts.textOnly || false;

    // Start TUI
    await createTUI();

    return 0;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

main()
  .then((code) => {
    // Don't exit immediately - TUI is running
    if (code !== 0) process.exit(code);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
