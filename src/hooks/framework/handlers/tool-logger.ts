/**
 * Tool Logger Built-in Handler
 *
 * Logs tool usage on PostToolUse events.
 * Supports configurable log levels, output paths, and formats.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';
import type { ToolLoggerOptions } from '../config/types';
import type { PostToolUseInput } from '../../types';

// ============================================================================
// Types
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogFormat = 'json' | 'text';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  sessionId?: string;
  sessionName?: string;
  turnId?: string;
  turnSequence?: number;
  toolName: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  cwd: string;
}

// ============================================================================
// Log Level Priority
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a tool-logger handler with the given options
 */
export function createToolLoggerHandler(
  options: ToolLoggerOptions = {}
): HandlerDefinition {
  const {
    logLevel = 'info',
    outputPath,
    includeInput = true,
    includeOutput = false,
    tools,
    format = 'text',
  } = options;

  // Create output stream if path specified
  let outputStream: fs.WriteStream | null = null;
  if (outputPath) {
    const resolvedPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    outputStream = fs.createWriteStream(resolvedPath, { flags: 'a' });
  }

  // Create tool filter set if specified
  const toolFilter = tools ? new Set(tools) : null;

  return {
    id: 'tool-logger',
    name: 'Tool Logger',
    description: 'Logs tool usage for debugging and auditing',
    priority: 100, // Run late (after other handlers)
    enabled: true,
    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      const event = ctx.event as PostToolUseInput;

      // Only handle PostToolUse
      if (ctx.eventType !== 'PostToolUse') {
        return { success: true, durationMs: 0 };
      }

      // Check tool filter
      if (toolFilter && !toolFilter.has(event.tool_name)) {
        return { success: true, durationMs: 0 };
      }

      // Determine log level based on error
      const entryLevel: LogLevel = event.tool_error ? 'error' : 'info';

      // Check if we should log at this level
      if (LOG_LEVEL_PRIORITY[entryLevel] < LOG_LEVEL_PRIORITY[logLevel]) {
        return { success: true, durationMs: 0 };
      }

      // Extract context from other handlers
      const turnTrackerResult = ctx.results.get('turn-tracker');
      const sessionNamingResult = ctx.results.get('session-naming');

      // Build log entry
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: entryLevel,
        sessionId: ctx.sessionId,
        sessionName: sessionNamingResult?.data?.sessionName as string | undefined,
        turnId: turnTrackerResult?.data?.turnId as string | undefined,
        turnSequence: turnTrackerResult?.data?.sequence as number | undefined,
        toolName: event.tool_name,
        cwd: ctx.cwd,
      };

      if (includeInput && event.tool_input) {
        entry.input = sanitizeInput(event.tool_input);
      }

      if (includeOutput && event.tool_output !== undefined) {
        entry.output = truncateOutput(event.tool_output);
      }

      if (event.tool_error) {
        entry.error = event.tool_error;
      }

      // Format and write log entry
      const formatted = formatEntry(entry, format);
      writeLog(formatted, outputStream);

      return {
        success: true,
        durationMs: 0,
        data: { logged: true, level: entryLevel },
      };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize tool input for logging (remove sensitive data)
 */
function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    // Mask potentially sensitive keys
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes('password') ||
      lowerKey.includes('secret') ||
      lowerKey.includes('token') ||
      lowerKey.includes('key') ||
      lowerKey.includes('credential')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 1000) {
      // Truncate long strings
      sanitized[key] = `${value.slice(0, 1000)}... [truncated]`;
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Truncate output for logging
 */
function truncateOutput(output: unknown, maxLength = 500): unknown {
  if (typeof output === 'string') {
    if (output.length > maxLength) {
      return `${output.slice(0, maxLength)}... [truncated, ${output.length} chars total]`;
    }
    return output;
  }

  if (typeof output === 'object' && output !== null) {
    const str = JSON.stringify(output);
    if (str.length > maxLength) {
      return `[object, ${str.length} chars]`;
    }
    return output;
  }

  return output;
}

/**
 * Format a log entry
 */
function formatEntry(entry: LogEntry, format: LogFormat): string {
  if (format === 'json') {
    return JSON.stringify(entry);
  }

  // Text format
  const parts: string[] = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    `Tool: ${entry.toolName}`,
  ];

  if (entry.turnId) {
    parts.push(`Turn: ${entry.turnId}`);
  }

  if (entry.sessionName) {
    parts.push(`Session: ${entry.sessionName}`);
  } else if (entry.sessionId) {
    parts.push(`Session: ${entry.sessionId.slice(0, 8)}...`);
  }

  if (entry.input) {
    const inputStr = formatInputForText(entry.input);
    if (inputStr) {
      parts.push(`Input: ${inputStr}`);
    }
  }

  if (entry.error) {
    parts.push(`Error: ${entry.error}`);
  }

  if (entry.output !== undefined) {
    parts.push(`Output: ${formatOutputForText(entry.output)}`);
  }

  return parts.join(' | ');
}

/**
 * Format input for text log
 */
function formatInputForText(input: Record<string, unknown>): string {
  const keys = Object.keys(input);
  if (keys.length === 0) {
    return '';
  }

  // For Bash commands, show the command
  if (input.command && typeof input.command === 'string') {
    const cmd = input.command.length > 100
      ? `${input.command.slice(0, 100)}...`
      : input.command;
    return `command="${cmd}"`;
  }

  // For Edit tool, show file path
  if (input.file_path) {
    return `file_path="${input.file_path}"`;
  }

  // For Read tool, show file path
  if (input.path) {
    return `path="${input.path}"`;
  }

  // Generic: show key names
  return `{${keys.join(', ')}}`;
}

/**
 * Format output for text log
 */
function formatOutputForText(output: unknown): string {
  if (typeof output === 'string') {
    if (output.length > 100) {
      return `"${output.slice(0, 100)}..." (${output.length} chars)`;
    }
    return `"${output}"`;
  }

  if (typeof output === 'object' && output !== null) {
    return `[object]`;
  }

  return String(output);
}

/**
 * Write log entry to output
 */
function writeLog(message: string, stream: fs.WriteStream | null): void {
  if (stream) {
    stream.write(`${message}\n`);
  } else {
    console.error(message);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a log entry manually (for testing)
 */
export function createLogEntry(
  toolName: string,
  options: {
    level?: LogLevel;
    sessionId?: string;
    input?: Record<string, unknown>;
    output?: unknown;
    error?: string;
    cwd?: string;
  } = {}
): LogEntry {
  return {
    timestamp: new Date().toISOString(),
    level: options.level ?? 'info',
    sessionId: options.sessionId,
    toolName,
    cwd: options.cwd ?? process.cwd(),
    input: options.input,
    output: options.output,
    error: options.error,
  };
}

/**
 * Format a log entry (exposed for testing)
 */
export function formatLogEntry(entry: LogEntry, format: LogFormat = 'text'): string {
  return formatEntry(entry, format);
}

// ============================================================================
// Default Export
// ============================================================================

export default createToolLoggerHandler;
