/**
 * Debug Logger Built-in Handler
 *
 * Logs full payloads and context for ALL hook events.
 * Useful for debugging hook development and understanding event flow.
 *
 * Disabled by default - enable when needed for debugging.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { DebugLoggerOptions } from '../config/types';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';

// ============================================================================
// Types
// ============================================================================

interface DebugLogEntry {
  timestamp: string;
  eventType: string;
  sessionId?: string;
  sessionName?: string;
  turnId?: string;
  turnSequence?: number;
  cwd: string;
  payload: unknown;
  handlerResults?: Record<string, unknown>;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a debug-logger handler with the given options
 */
export function createDebugLoggerHandler(options: DebugLoggerOptions = {}): HandlerDefinition {
  const {
    outputPath,
    includePayload = true,
    includeHandlerResults = true,
    prettyPrint = true,
    events,
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

  // Create event filter set if specified
  const eventFilter = events ? new Set(events) : null;

  return {
    id: 'debug-logger',
    name: 'Debug Logger',
    description: 'Logs full payloads and context for debugging',
    priority: 999, // Run very late (after all other handlers)
    enabled: true,
    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      // Check event filter
      if (eventFilter && !eventFilter.has(ctx.eventType)) {
        return { success: true, durationMs: 0 };
      }

      // Extract context from other handlers
      const turnTrackerResult = ctx.results.get('turn-tracker');
      const sessionNamingResult = ctx.results.get('session-naming');

      // Build debug entry
      const entry: DebugLogEntry = {
        timestamp: new Date().toISOString(),
        eventType: ctx.eventType,
        sessionId: ctx.sessionId,
        sessionName: sessionNamingResult?.data?.sessionName as string | undefined,
        turnId: turnTrackerResult?.data?.turnId as string | undefined,
        turnSequence: turnTrackerResult?.data?.sequence as number | undefined,
        cwd: ctx.cwd,
        payload: includePayload ? ctx.event : '[payload hidden]',
      };

      // Include results from other handlers
      if (includeHandlerResults && ctx.results.size > 0) {
        entry.handlerResults = {};
        for (const [id, result] of ctx.results) {
          entry.handlerResults[id] = {
            success: result.success,
            decision: result.decision,
            data: result.data,
            error: result.error,
          };
        }
      }

      // Format and write
      const formatted = formatDebugEntry(entry, prettyPrint);
      writeDebugLog(formatted, ctx.eventType, outputStream);

      return {
        success: true,
        durationMs: 0,
        data: { logged: true, eventType: ctx.eventType },
      };
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a debug entry
 */
function formatDebugEntry(entry: DebugLogEntry, prettyPrint: boolean): string {
  if (prettyPrint) {
    return JSON.stringify(entry, null, 2);
  }
  return JSON.stringify(entry);
}

/**
 * Write debug log entry to output
 */
function writeDebugLog(message: string, eventType: string, stream: fs.WriteStream | null): void {
  const header = `\n${'='.repeat(60)}\n[DEBUG] ${eventType} @ ${new Date().toISOString()}\n${'='.repeat(60)}`;

  if (stream) {
    stream.write(`${header}\n${message}\n`);
  } else {
    console.error(`${header}\n${message}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a debug entry manually (for testing)
 */
export function createDebugEntry(
  eventType: string,
  payload: unknown,
  options: {
    sessionId?: string;
    sessionName?: string;
    turnId?: string;
    cwd?: string;
  } = {}
): DebugLogEntry {
  return {
    timestamp: new Date().toISOString(),
    eventType,
    sessionId: options.sessionId,
    sessionName: options.sessionName,
    turnId: options.turnId,
    cwd: options.cwd ?? process.cwd(),
    payload,
  };
}

// ============================================================================
// Default Export
// ============================================================================

export default createDebugLoggerHandler;
