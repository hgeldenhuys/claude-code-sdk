/**
 * Git Tracker Handler
 *
 * Tracks git repository state during Claude Code sessions. Captures the
 * current commit hash, branch name, and dirty state at key points:
 *
 * - SessionStart: Capture initial git state
 * - PreToolUse: Capture git state only for file-modifying tools (Edit, Write, Bash)
 *
 * This enables tracking of code changes made during a session.
 *
 * @example
 * ```yaml
 * builtins:
 *   git-tracker:
 *     enabled: true
 *     options:
 *       track_on_tools: ['Edit', 'Write', 'Bash']
 * ```
 */

import { type GitState, getGitState } from '../../../utils/git';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';
import type { BuiltinHandlerFactory, BuiltinHandlerMeta } from './index';

// ============================================================================
// Types
// ============================================================================

export interface GitTrackerOptions {
  /** Tools to track git state for (default: ['Edit', 'Write', 'Bash']) */
  trackOnTools?: string[];
}

export interface GitTrackerData {
  /** Git state at this point */
  gitState: GitState;
}

// ============================================================================
// Constants
// ============================================================================

/** Default tools that trigger git state capture */
export const DEFAULT_TRACKED_TOOLS = ['Edit', 'Write', 'Bash'];

// ============================================================================
// Handler Implementation
// ============================================================================

/**
 * Create the git tracker handler
 */
export function createGitTrackerHandler<TState = Record<string, unknown>>(
  options: GitTrackerOptions = {}
): HandlerDefinition<TState> {
  const { trackOnTools = DEFAULT_TRACKED_TOOLS } = options;

  return {
    id: 'git-tracker',
    name: 'Git Tracker',
    priority: 6, // Run early, after turn-tracker (5)
    handler: async (ctx: PipelineContext<TState>): Promise<HandlerResult> => {
      const eventType = ctx.eventType;
      const cwd = ctx.cwd || process.cwd();

      switch (eventType) {
        case 'SessionStart': {
          // Always capture git state on session start
          const gitState = getGitState(cwd);

          return {
            success: true,
            durationMs: 0,
            data: { gitState } as GitTrackerData,
          };
        }

        case 'PreToolUse': {
          // Only capture for file-modifying tools
          const event = ctx.event as unknown as Record<string, unknown>;
          const toolName = (event.tool_name as string) || '';

          if (!trackOnTools.includes(toolName)) {
            // Skip tracking for non-file-modifying tools
            return {
              success: true,
              durationMs: 0,
            };
          }

          const gitState = getGitState(cwd);

          return {
            success: true,
            durationMs: 0,
            data: { gitState } as GitTrackerData,
          };
        }

        default: {
          // Unknown event type - return empty result
          return {
            success: true,
            durationMs: 0,
          };
        }
      }
    },
  };
}

// ============================================================================
// Handler Factory for Config System
// ============================================================================

export const gitTrackerMeta: BuiltinHandlerMeta = {
  id: 'git-tracker',
  name: 'Git Tracker',
  description: 'Tracks git repository state (hash, branch, dirty) during sessions',
  defaultEvents: ['SessionStart', 'PreToolUse'],
  defaultPriority: 6,
  optionsSchema: {
    track_on_tools: {
      type: 'array',
      description: 'Tools that trigger git state capture',
      default: DEFAULT_TRACKED_TOOLS,
    },
  },
};

export const gitTrackerFactory: BuiltinHandlerFactory = (options = {}) => {
  return createGitTrackerHandler({
    trackOnTools: options.track_on_tools as string[] | undefined,
  });
};
