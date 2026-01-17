/**
 * Event Logger Handler
 *
 * Logs all hook events to JSONL files for indexing by the transcript daemon.
 * This creates a parallel log alongside Claude Code transcripts that can be
 * joined via session_id and tool_use_id for analysis.
 *
 * Output format: ~/.claude/hooks/{project}/{session_id}.hooks.jsonl
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface EventLoggerOptions {
  /** Base directory for hook logs (default: ~/.claude/hooks) */
  outputDir?: string;
  /** Include full hook input payload (default: true) */
  includeInput?: boolean;
  /** Include hook context (transcript_path, cwd, etc.) (default: true) */
  includeContext?: boolean;
  /** Include results from other handlers (default: true) */
  includeHandlerResults?: boolean;
  /** Event types to log (default: all) */
  events?: string[];
}

export interface HookEventLogEntry {
  /** Timestamp of the event */
  timestamp: string;
  /** Session ID (links to transcript file) */
  sessionId: string;
  /** Event type (PreToolUse, PostToolUse, etc.) */
  eventType: string;
  /** For tool events, the tool_use_id that links to transcript */
  toolUseId?: string;
  /** Tool name for tool events */
  toolName?: string;
  /** Handler decision (allow, block, etc.) */
  decision?: string;
  /** Results from all handlers */
  handlerResults?: Record<string, unknown>;
  /** Full hook input payload */
  input?: unknown;
  /** Hook context */
  context?: {
    hookEvent: string;
    transcriptPath?: string;
    cwd: string;
    claudeCodeVersion?: string;
  };
  /** Line number in the hooks log file */
  lineNumber?: number;
}

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_OUTPUT_DIR = join(process.env.HOME || '~', '.claude', 'hooks');

/**
 * Get the project path from transcript path
 * ~/.claude/projects/-Users-foo-bar/session.jsonl -> -Users-foo-bar
 */
function getProjectFromTranscriptPath(transcriptPath: string): string {
  if (!transcriptPath) return 'unknown';
  const parts = transcriptPath.split('/');
  const projectsIndex = parts.indexOf('projects');
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return parts[projectsIndex + 1];
  }
  return 'unknown';
}

/**
 * Get the project from cwd if transcript path is not available
 * /Users/foo/bar -> -Users-foo-bar
 */
function getProjectFromCwd(cwd: string): string {
  if (!cwd) return 'unknown';
  return cwd.replace(/\//g, '-').replace(/^-/, '');
}

/**
 * Get the output file path for a session
 */
function getOutputPath(outputDir: string, project: string, sessionId: string): string {
  const dir = join(outputDir, project);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, `${sessionId}.hooks.jsonl`);
}

/**
 * Count existing lines in file (for line number tracking)
 */
function countLines(filePath: string): number {
  if (!existsSync(filePath)) return 0;
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').filter((l: string) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Create a log entry from pipeline context
 */
export function createLogEntry(
  ctx: PipelineContext,
  options?: EventLoggerOptions
): HookEventLogEntry {
  const entry: HookEventLogEntry = {
    timestamp: new Date().toISOString(),
    sessionId: ctx.sessionId,
    eventType: ctx.eventType,
  };

  // Extract tool-specific fields for linking
  const event = ctx.event as Record<string, unknown>;
  if (event.tool_use_id) {
    entry.toolUseId = String(event.tool_use_id);
  }
  if (event.tool_name) {
    entry.toolName = String(event.tool_name);
  }

  // Include handler results
  if (options?.includeHandlerResults !== false && ctx.results.size > 0) {
    entry.handlerResults = {};
    for (const [id, result] of ctx.results) {
      entry.handlerResults[id] = {
        success: result.success,
        decision: result.decision,
        data: result.data,
        error: result.error,
      };
      // Extract decision from any handler
      if (result.decision && !entry.decision) {
        entry.decision = String(result.decision);
      }
    }
  }

  // Include full input
  if (options?.includeInput !== false) {
    entry.input = ctx.event;
  }

  // Include context
  if (options?.includeContext !== false) {
    entry.context = {
      hookEvent: ctx.eventType,
      transcriptPath: ctx.transcriptPath,
      cwd: ctx.cwd,
    };
  }

  return entry;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create an event logger handler
 */
export function createEventLoggerHandler(options?: EventLoggerOptions): HandlerDefinition {
  const outputDir = options?.outputDir || DEFAULT_OUTPUT_DIR;
  const eventFilter = options?.events ? new Set(options.events) : null;

  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  return {
    id: 'event-logger',
    name: 'Event Logger',
    description: 'Logs hook events to JSONL files for transcript indexing',
    priority: 998, // Run very late to capture all handler results
    enabled: true,

    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      try {
        // Check event filter
        if (eventFilter && !eventFilter.has(ctx.eventType)) {
          return { success: true, durationMs: 0 };
        }

        // Determine output file - use transcript path if available, otherwise cwd
        const project = ctx.transcriptPath
          ? getProjectFromTranscriptPath(ctx.transcriptPath)
          : getProjectFromCwd(ctx.cwd);
        const filePath = getOutputPath(outputDir, project, ctx.sessionId);

        // Create log entry
        const entry = createLogEntry(ctx, options);
        entry.lineNumber = countLines(filePath) + 1;

        // Append to file
        const line = JSON.stringify(entry) + '\n';
        appendFileSync(filePath, line);

        return { success: true, durationMs: 0 };
      } catch (error) {
        // Don't fail the hook pipeline for logging errors
        console.error('[event-logger] Failed to log event:', error);
        return { success: true, durationMs: 0, error: String(error) };
      }
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_OUTPUT_DIR };
