/**
 * Transcript Viewer Utilities
 * Human-friendly rendering and filtering for transcript content
 */

import type { ContentBlock, TranscriptLine, TranscriptMessage } from './types';

/**
 * Extended line types that can appear in JSONL files
 * More specific than the base TranscriptLine type
 */
export type ExtendedLineType =
  | 'user'
  | 'assistant'
  | 'tool_use'
  | 'tool_result'
  | 'system'
  | 'thinking'
  | 'text'
  | 'file-history-snapshot'
  | 'summary'
  | 'progress'
  | 'hook_progress'
  | 'message'
  | 'create'
  | 'update'
  | 'queue-operation';

/**
 * Output format for CLI
 */
export type OutputFormat = 'json' | 'human' | 'minimal' | 'raw';

/**
 * Filtering options for transcript viewer
 */
export interface FilterOptions {
  types?: ExtendedLineType[];
  last?: number;
  first?: number;
  fromLine?: number;
  toLine?: number;
  fromTime?: Date;
  toTime?: Date;
  offset?: number;
  limit?: number;
  userPrompts?: boolean;
  assistant?: boolean;
  tools?: boolean;
  thinking?: boolean;
  textOnly?: boolean; // AI text output only (no thinking, no tool_use)
  search?: string;
  sessionIds?: string[]; // Filter by session ID(s)
}

/**
 * Rendered content for display
 */
export interface RenderedLine {
  lineNumber: number;
  type: string;
  timestamp: string;
  preview: string;
  fullContent: string;
  metadata: Record<string, unknown>;
}

/**
 * Filter transcript lines based on options
 */
export function filterLines(lines: TranscriptLine[], options: FilterOptions): TranscriptLine[] {
  let filtered = [...lines];

  // Session ID filtering (applied early for efficiency)
  if (options.sessionIds && options.sessionIds.length > 0) {
    filtered = filtered.filter((line) => options.sessionIds!.includes(line.sessionId));
  }

  // Type filtering
  if (options.types && options.types.length > 0) {
    filtered = filtered.filter((line) => {
      // Check the line type directly
      if (options.types!.includes(line.type as ExtendedLineType)) {
        return true;
      }
      // Also check message content for nested types
      if (line.message?.content && Array.isArray(line.message.content)) {
        for (const block of line.message.content as ContentBlock[]) {
          if (options.types!.includes(block.type as ExtendedLineType)) {
            return true;
          }
        }
      }
      return false;
    });
  }

  // Convenience filters
  if (options.userPrompts) {
    filtered = filtered.filter((line) => line.type === 'user');
  }

  if (options.assistant) {
    filtered = filtered.filter((line) => line.type === 'assistant');
  }

  // textOnly: filter to assistant messages that have text blocks (not just tool_use)
  if (options.textOnly) {
    filtered = filtered.filter((line) => {
      if (line.type !== 'assistant') return false;
      if (!line.message?.content || !Array.isArray(line.message.content)) return false;
      // Only include if there's at least one text block
      return line.message.content.some((block) => (block as ContentBlock).type === 'text');
    });
  }

  if (options.tools) {
    filtered = filtered.filter((line) => {
      if (line.type === 'user' && line.message?.content) {
        if (Array.isArray(line.message.content)) {
          return line.message.content.some(
            (block) => (block as ContentBlock).type === 'tool_result'
          );
        }
      }
      if (line.type === 'assistant' && line.message?.content) {
        if (Array.isArray(line.message.content)) {
          return line.message.content.some((block) => (block as ContentBlock).type === 'tool_use');
        }
      }
      return false;
    });
  }

  if (options.thinking) {
    filtered = filtered.filter((line) => {
      if (line.message?.content && Array.isArray(line.message.content)) {
        return line.message.content.some((block) => (block as ContentBlock).type === 'thinking');
      }
      return false;
    });
  }

  // Text search
  if (options.search) {
    const searchLower = options.search.toLowerCase();
    filtered = filtered.filter((line) => {
      const text = extractAllText(line);
      return text.toLowerCase().includes(searchLower);
    });
  }

  // Range filtering (applied before limit)
  if (options.fromLine !== undefined || options.toLine !== undefined) {
    const from = options.fromLine ?? 1;
    const to = options.toLine ?? filtered.length;
    filtered = filtered.filter((line) => line.lineNumber >= from && line.lineNumber <= to);
  }

  // Timestamp filtering
  if (options.fromTime) {
    filtered = filtered.filter((line) => new Date(line.timestamp) >= options.fromTime!);
  }
  if (options.toTime) {
    filtered = filtered.filter((line) => new Date(line.timestamp) <= options.toTime!);
  }

  // First N
  if (options.first !== undefined && options.first > 0) {
    filtered = filtered.slice(0, options.first);
  }

  // Last N
  if (options.last !== undefined && options.last > 0) {
    filtered = filtered.slice(-options.last);
  }

  // Offset/limit pagination
  if (options.offset !== undefined || options.limit !== undefined) {
    const start = options.offset ?? 0;
    const count = options.limit ?? filtered.length;
    filtered = filtered.slice(start, start + count);
  }

  return filtered;
}

/**
 * Extract all text from a transcript line (for search)
 */
export function extractAllText(line: TranscriptLine): string {
  const parts: string[] = [];

  if (line.message?.content) {
    if (typeof line.message.content === 'string') {
      parts.push(line.message.content);
    } else if (Array.isArray(line.message.content)) {
      for (const block of line.message.content as ContentBlock[]) {
        if (block.type === 'text' && block.text) {
          parts.push(block.text);
        } else if (block.type === 'tool_use' && block.name) {
          parts.push(`Tool: ${block.name}`);
          if (block.input) {
            parts.push(JSON.stringify(block.input));
          }
        } else if (block.type === 'tool_result') {
          const resultBlock = block as ContentBlock & { content?: string };
          if (typeof resultBlock.content === 'string') {
            parts.push(resultBlock.content);
          }
        } else if ('thinking' in block && typeof block.thinking === 'string') {
          parts.push(block.thinking);
        }
      }
    }
  }

  if (line.toolUseResult) {
    if (typeof line.toolUseResult.stdout === 'string') {
      parts.push(line.toolUseResult.stdout);
    }
    if (typeof line.toolUseResult.content === 'string') {
      parts.push(line.toolUseResult.content);
    }
  }

  return parts.join('\n');
}

/**
 * Render a transcript line for human-friendly display
 */
export function renderLine(line: TranscriptLine): RenderedLine {
  const timestamp = formatTimestamp(line.timestamp);
  const type = getDisplayType(line);
  const preview = getPreview(line, 80);
  const fullContent = renderFullContent(line);

  const metadata: Record<string, unknown> = {
    uuid: line.uuid,
    parentUuid: line.parentUuid,
    sessionId: line.sessionId,
  };

  if (line.slug) metadata.slug = line.slug;
  if (line.version) metadata.version = line.version;
  if (line.gitBranch) metadata.gitBranch = line.gitBranch;
  if (line.message?.usage) metadata.usage = line.message.usage;
  if (line.message?.model) metadata.model = line.message.model;

  return {
    lineNumber: line.lineNumber,
    type,
    timestamp,
    preview,
    fullContent,
    metadata,
  };
}

/**
 * Get a more specific display type for a line
 */
export function getDisplayType(line: TranscriptLine): string {
  if (line.type === 'assistant' && line.message?.content) {
    if (Array.isArray(line.message.content)) {
      const blocks = line.message.content as ContentBlock[];
      const hasThinking = blocks.some((b) => b.type === 'thinking');
      const hasToolUse = blocks.some((b) => b.type === 'tool_use');
      const hasText = blocks.some((b) => b.type === 'text');

      if (hasThinking && !hasToolUse && !hasText) return 'thinking';
      if (hasToolUse) return 'tool_use';
    }
  }

  if (line.type === 'user' && line.message?.content) {
    if (Array.isArray(line.message.content)) {
      const blocks = line.message.content as ContentBlock[];
      const hasToolResult = blocks.some((b) => b.type === 'tool_result');
      if (hasToolResult) return 'tool_result';
    }
  }

  const lineWithSubtype = line as TranscriptLine & { subtype?: string };
  if (lineWithSubtype.subtype) {
    return `${line.type}:${lineWithSubtype.subtype}`;
  }

  return line.type;
}

/**
 * Get a short preview of the line content
 */
export function getPreview(line: TranscriptLine, maxLength: number): string {
  const text = extractAllText(line);
  if (!text) return '(empty)';

  // Clean up and truncate
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, maxLength);

  return cleaned.length < text.replace(/\s+/g, ' ').trim().length ? `${cleaned}...` : cleaned;
}

/**
 * Render full content in human-friendly format
 */
export function renderFullContent(line: TranscriptLine): string {
  const parts: string[] = [];

  // Header
  parts.push(`--- Line ${line.lineNumber} [${line.type}] ---`);
  parts.push(`Time: ${formatTimestamp(line.timestamp)}`);

  if (line.slug) {
    parts.push(`Session: ${line.slug}`);
  }

  parts.push('');

  // Content based on type
  if (line.type === 'user') {
    parts.push(renderUserMessage(line));
  } else if (line.type === 'assistant') {
    parts.push(renderAssistantMessage(line));
  } else if (line.type === 'system') {
    parts.push(renderSystemMessage(line));
  } else if (line.type === 'summary') {
    parts.push(renderSummary(line));
  } else if (line.type === 'file-history-snapshot') {
    parts.push(renderSnapshot(line));
  } else {
    // Generic fallback
    parts.push(extractAllText(line) || '(no content)');
  }

  return parts.join('\n');
}

/**
 * Render a user message
 */
function renderUserMessage(line: TranscriptLine): string {
  if (!line.message?.content) return '(empty message)';

  if (typeof line.message.content === 'string') {
    return `User:\n${line.message.content}`;
  }

  const parts: string[] = ['User:'];

  for (const block of line.message.content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    } else if (block.type === 'tool_result') {
      parts.push(`\n[Tool Result: ${block.tool_use_id}]`);
      if (block.content) {
        const content =
          typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content, null, 2);
        parts.push(truncateContent(content, 500));
      }
      if (block.is_error) {
        parts.push('(error)');
      }
    }
  }

  return parts.join('\n');
}

/**
 * Render an assistant message
 */
function renderAssistantMessage(line: TranscriptLine): string {
  if (!line.message?.content) return '(empty message)';

  if (typeof line.message.content === 'string') {
    return `Assistant:\n${line.message.content}`;
  }

  const parts: string[] = ['Assistant:'];
  const model = line.message.model ? ` (${line.message.model})` : '';
  if (model) parts[0] += model;

  for (const block of line.message.content as ContentBlock[]) {
    if (block.type === 'thinking' && block.thinking) {
      parts.push(`\n[Thinking]\n${truncateContent(block.thinking, 300)}`);
    } else if (block.type === 'text' && block.text) {
      parts.push(`\n${block.text}`);
    } else if (block.type === 'tool_use') {
      parts.push(`\n[Tool: ${block.name}]`);
      if (block.input) {
        parts.push(formatToolInput(block.input));
      }
    }
  }

  // Add usage info if present
  if (line.message.usage) {
    const usage = line.message.usage;
    parts.push(`\n[Tokens: in=${usage.input_tokens}, out=${usage.output_tokens}]`);
  }

  return parts.join('\n');
}

/**
 * Render only the text content from an assistant message (no thinking, no tool_use)
 */
export function renderTextOnlyContent(line: TranscriptLine): string {
  const parts: string[] = [];

  // Header
  parts.push(`--- Line ${line.lineNumber} ---`);
  parts.push(`Time: ${formatTimestamp(line.timestamp)}`);
  parts.push('');

  if (line.type !== 'assistant' || !line.message?.content) {
    return `${parts.join('\n')}(no text content)`;
  }

  if (typeof line.message.content === 'string') {
    parts.push(line.message.content);
    return parts.join('\n');
  }

  // Extract only text blocks
  for (const block of line.message.content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }

  if (parts.length <= 3) {
    parts.push('(no text content - only tool calls)');
  }

  return parts.join('\n');
}

/**
 * Extended line type for system messages with hook info
 */
interface SystemLine extends TranscriptLine {
  subtype?: string;
  hookInfos?: Array<{ command: string }>;
  hookErrors?: string[];
}

/**
 * Render a system message
 */
function renderSystemMessage(line: TranscriptLine): string {
  const sysLine = line as SystemLine;
  const parts: string[] = [`System: ${sysLine.subtype || 'message'}`];

  if (sysLine.hookInfos) {
    parts.push('\nHooks:');
    for (const hook of sysLine.hookInfos) {
      parts.push(`  - ${hook.command}`);
    }
  }

  if (sysLine.hookErrors && sysLine.hookErrors.length > 0) {
    parts.push('\nHook Errors:');
    for (const err of sysLine.hookErrors) {
      parts.push(`  - ${err}`);
    }
  }

  return parts.join('\n');
}

/**
 * Extended line type for summary
 */
interface SummaryLine extends TranscriptLine {
  summary?: string;
  leafUuid?: string;
}

/**
 * Render a summary
 */
function renderSummary(line: TranscriptLine): string {
  const sumLine = line as SummaryLine;
  const parts: string[] = ['Summary:'];

  if (sumLine.summary) {
    parts.push(sumLine.summary);
  }

  if (sumLine.leafUuid) {
    parts.push(`\nLeaf UUID: ${sumLine.leafUuid}`);
  }

  return parts.join('\n');
}

/**
 * Extended line type for file-history-snapshot
 */
interface SnapshotLine extends TranscriptLine {
  snapshot?: Record<string, unknown>;
  messageId?: string;
}

/**
 * Render a file-history-snapshot
 */
function renderSnapshot(line: TranscriptLine): string {
  const snapLine = line as SnapshotLine;
  const parts: string[] = ['File History Snapshot'];

  if (snapLine.snapshot) {
    parts.push(`Files: ${Object.keys(snapLine.snapshot).length}`);
  }

  if (snapLine.messageId) {
    parts.push(`Message: ${snapLine.messageId}`);
  }

  return parts.join('\n');
}

/**
 * Format tool input for display
 */
function formatToolInput(input: Record<string, unknown>): string {
  const formatted: string[] = [];

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      // Truncate long strings
      const truncated = truncateContent(value, 200);
      formatted.push(`  ${key}: ${truncated}`);
    } else {
      formatted.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }

  return formatted.join('\n');
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return timestamp;
  }
}

/**
 * Truncate content with ellipsis
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) return content;
  return `${content.slice(0, maxLength)}...`;
}

/**
 * Format line for minimal output (just essential text)
 */
export function formatMinimal(line: TranscriptLine): string {
  const text = extractAllText(line);
  return text || '';
}

/**
 * Format line for JSON output
 */
export function formatJson(line: TranscriptLine, pretty = false): string {
  return pretty ? JSON.stringify(JSON.parse(line.raw), null, 2) : line.raw;
}

/**
 * Get session info from first few lines
 */
export function getSessionMetadata(lines: TranscriptLine[]): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    lineCount: lines.length,
  };

  // Find session info from lines
  for (const line of lines.slice(0, 10)) {
    if (line.sessionId && line.sessionId !== 'unknown') {
      metadata.sessionId = line.sessionId;
    }
    if (line.slug) {
      metadata.sessionName = line.slug;
    }
    if (line.version) {
      metadata.version = line.version;
    }
    if (line.cwd) {
      metadata.cwd = line.cwd;
    }
    if (line.gitBranch) {
      metadata.gitBranch = line.gitBranch;
    }
  }

  // Get time range
  if (lines.length > 0) {
    metadata.firstTimestamp = lines[0]?.timestamp;
    metadata.lastTimestamp = lines[lines.length - 1]?.timestamp;
  }

  // Count types
  const typeCounts: Record<string, number> = {};
  for (const line of lines) {
    const type = getDisplayType(line);
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  metadata.typeCounts = typeCounts;

  return metadata;
}

/**
 * Get ANSI color code for a line type (for terminal output)
 */
export function getTypeColorAnsi(type: string): string {
  switch (type) {
    case 'user':
      return '\x1b[32m'; // green
    case 'assistant':
      return '\x1b[34m'; // blue
    case 'tool_use':
    case 'tool_result':
      return '\x1b[36m'; // cyan
    case 'thinking':
      return '\x1b[35m'; // magenta
    case 'system':
      return '\x1b[33m'; // yellow
    case 'summary':
      return '\x1b[90m'; // gray
    default:
      return '\x1b[37m'; // white
  }
}

/**
 * Format a line for tail/watch output (compact, colorized)
 */
export function formatTailLine(line: TranscriptLine): string {
  const time = new Date(line.timestamp).toLocaleTimeString();
  const type = getDisplayType(line).padEnd(12);
  const preview = getPreview(line, 60);
  const color = getTypeColorAnsi(getDisplayType(line));
  return `${color}${time} [${type}] ${preview}\x1b[0m`;
}

/**
 * Parse a timestamp input (ISO date or relative like "1h ago", "2d ago")
 */
export function parseTimestamp(input: string): Date {
  // Check for relative format: "Xh ago", "Xd ago", "Xm ago"
  const match = input.match(/^(\d+)([hdm])\s*ago$/i);
  if (match) {
    const [, numStr, unit] = match;
    const num = Number.parseInt(numStr!, 10);
    let ms: number;
    switch (unit!.toLowerCase()) {
      case 'h':
        ms = 3600000; // hour in ms
        break;
      case 'd':
        ms = 86400000; // day in ms
        break;
      case 'm':
        ms = 60000; // minute in ms
        break;
      default:
        ms = 3600000;
    }
    return new Date(Date.now() - num * ms);
  }

  // Try parsing as ISO date or any Date-parseable string
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp format: ${input}`);
  }
  return parsed;
}
