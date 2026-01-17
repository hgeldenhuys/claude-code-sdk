/**
 * Event Logger Handler
 *
 * Logs all hook events to JSONL files for indexing by the transcript daemon.
 * This creates a parallel log alongside Claude Code transcripts that can be
 * joined via session_id and tool_use_id for analysis.
 *
 * Output format: ~/.claude/hooks/{project}/{session_id}.hooks.jsonl
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { HookInput, HookContext, HookResult } from '../../types';
import type { HandlerDefinition } from '../types';

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
  input?: HookInput;
  /** Hook context (env vars as object) */
  context?: Partial<HookContext>;
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
  const parts = transcriptPath.split('/');
  const projectsIndex = parts.indexOf('projects');
  if (projectsIndex >= 0 && parts[projectsIndex + 1]) {
    return parts[projectsIndex + 1];
  }
  return 'unknown';
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
    const { readFileSync } = require('node:fs');
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').filter((l: string) => l.trim()).length;
  } catch {
    return 0;
  }
}

/**
 * Create a log entry from hook input and context
 */
export function createLogEntry(
  input: HookInput,
  context: HookContext,
  handlerResults?: Record<string, unknown>,
  options?: EventLoggerOptions
): HookEventLogEntry {
  const entry: HookEventLogEntry = {
    timestamp: new Date().toISOString(),
    sessionId: input.session_id,
    eventType: context.hookEvent,
  };

  // Extract tool-specific fields for linking
  if ('tool_use_id' in input && input.tool_use_id) {
    entry.toolUseId = input.tool_use_id;
  }
  if ('tool_name' in input && input.tool_name) {
    entry.toolName = input.tool_name;
  }

  // Include handler results
  if (options?.includeHandlerResults !== false && handlerResults) {
    entry.handlerResults = handlerResults;
    // Extract decision if present
    if (handlerResults.decision) {
      entry.decision = String(handlerResults.decision);
    }
  }

  // Include full input
  if (options?.includeInput !== false) {
    entry.input = input;
  }

  // Include context
  if (options?.includeContext !== false) {
    entry.context = {
      hookEvent: context.hookEvent,
      transcriptPath: context.transcriptPath,
      cwd: context.cwd,
      claudeCodeVersion: context.claudeCodeVersion,
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

    handler: async (
      input: HookInput,
      context: HookContext,
      handlerResults?: Record<string, unknown>
    ): Promise<HookResult> => {
      try {
        // Check event filter
        if (eventFilter && !eventFilter.has(context.hookEvent)) {
          return { continue: true };
        }

        // Determine output file
        const project = getProjectFromTranscriptPath(context.transcriptPath || '');
        const filePath = getOutputPath(outputDir, project, input.session_id);

        // Create log entry
        const entry = createLogEntry(input, context, handlerResults, options);
        entry.lineNumber = countLines(filePath) + 1;

        // Append to file
        const line = JSON.stringify(entry) + '\n';
        appendFileSync(filePath, line);

        return { continue: true };
      } catch (error) {
        // Don't fail the hook pipeline for logging errors
        console.error('[event-logger] Failed to log event:', error);
        return { continue: true };
      }
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_OUTPUT_DIR };
