/**
 * Turn Tracker Handler
 *
 * Tracks turns within a Claude Code session. A turn is the period between
 * Stop events, with Turn 1 being implicit when the session starts.
 *
 * Turn ID format: {session_id}:{sequence}
 * Subagent Turn ID format: {session_id}:{sequence}:s:{subagent_sequence}
 *
 * Events:
 * - SessionStart: Initialize state to { sequence: 1, subagentSeq: 0 }
 * - UserPromptSubmit/PreToolUse/PostToolUse: Read-only, return current turn ID
 * - SubagentStop: Increment subagent counter, return subagent turn ID
 * - Stop: Increment sequence, reset subagent counter
 *
 * @example
 * ```yaml
 * builtins:
 *   turn-tracker:
 *     enabled: true
 *     options:
 *       preserve_on_resume: true
 *       inject_context: false
 * ```
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';
import type { BuiltinHandlerFactory, BuiltinHandlerMeta } from './index';

// ============================================================================
// Types
// ============================================================================

export interface TurnState {
  /** Current turn sequence (starts at 1) */
  sequence: number;
  /** Subagent counter within current turn (resets each turn) */
  subagentSeq: number;
}

export interface TurnTrackerOptions {
  /** Directory to store turn state files (default: ~/.claude/turns) */
  turnsDir?: string;
  /** Preserve turn state when resuming a session (default: true) */
  preserveOnResume?: boolean;
  /** Inject turn context on SessionStart (default: false) */
  injectContext?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_TURNS_DIR = path.join(os.homedir(), '.claude', 'turns');

// ============================================================================
// Turn ID Generation
// ============================================================================

/**
 * Generate a turn ID for the current turn
 */
export function getCurrentTurnId(sessionId: string, sequence: number): string {
  return `${sessionId}:${sequence}`;
}

/**
 * Generate a subagent turn ID
 */
export function getSubagentTurnId(
  sessionId: string,
  sequence: number,
  subagentSeq: number
): string {
  return `${sessionId}:${sequence}:s:${subagentSeq}`;
}

// ============================================================================
// State Storage
// ============================================================================

/**
 * Load turn state for a session
 */
export function loadTurnState(sessionId: string, turnsDir: string = DEFAULT_TURNS_DIR): TurnState {
  const filePath = path.join(turnsDir, `${sessionId}.json`);

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        sequence: typeof data.sequence === 'number' ? data.sequence : 1,
        subagentSeq: typeof data.subagentSeq === 'number' ? data.subagentSeq : 0,
      };
    }
  } catch {
    // Corrupted or missing file - return default
  }

  return { sequence: 1, subagentSeq: 0 };
}

/**
 * Save turn state for a session
 */
export function saveTurnState(
  sessionId: string,
  state: TurnState,
  turnsDir: string = DEFAULT_TURNS_DIR
): void {
  // Ensure directory exists
  if (!fs.existsSync(turnsDir)) {
    fs.mkdirSync(turnsDir, { recursive: true });
  }

  const filePath = path.join(turnsDir, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

// ============================================================================
// Handler Implementation
// ============================================================================

/**
 * Create the turn tracker handler
 */
export function createTurnTrackerHandler<TState = Record<string, unknown>>(
  options: TurnTrackerOptions = {}
): HandlerDefinition<TState> {
  const { turnsDir = DEFAULT_TURNS_DIR, preserveOnResume = true, injectContext = false } = options;

  return {
    id: 'turn-tracker',
    name: 'Turn Tracker',
    priority: 5, // Run early to establish turn context
    handler: async (ctx: PipelineContext<TState>): Promise<HandlerResult> => {
      const event = ctx.event as unknown as Record<string, unknown>;
      const sessionId = (event.session_id as string) || ctx.sessionId;

      if (!sessionId) {
        // No session ID available, skip
        return {};
      }

      const eventType = ctx.eventType;

      switch (eventType) {
        case 'SessionStart': {
          const isResume = event.is_resume === true;

          if (isResume && preserveOnResume) {
            // Preserve existing state on resume
            const existingState = loadTurnState(sessionId, turnsDir);
            // Re-save to ensure file exists
            saveTurnState(sessionId, existingState, turnsDir);

            if (injectContext) {
              const turnId = getCurrentTurnId(sessionId, existingState.sequence);
              return {
                context: `<turn-context>\nTurn ID: ${turnId}\nResumed at turn: ${existingState.sequence}\n</turn-context>`,
                data: { turnId, sequence: existingState.sequence },
              };
            }

            return { data: { turnId: getCurrentTurnId(sessionId, existingState.sequence) } };
          }

          // Initialize fresh state
          const newState: TurnState = { sequence: 1, subagentSeq: 0 };
          saveTurnState(sessionId, newState, turnsDir);

          const turnId = getCurrentTurnId(sessionId, 1);

          if (injectContext) {
            return {
              context: `<turn-context>\nTurn ID: ${turnId}\nTurn: 1\n</turn-context>`,
              data: { turnId, sequence: 1 },
            };
          }

          return { data: { turnId, sequence: 1 } };
        }

        case 'Stop': {
          // Load current state
          const state = loadTurnState(sessionId, turnsDir);
          const completedTurnId = getCurrentTurnId(sessionId, state.sequence);

          // Increment sequence, reset subagent counter
          state.sequence++;
          state.subagentSeq = 0;
          saveTurnState(sessionId, state, turnsDir);

          return {
            data: {
              completedTurnId,
              nextTurnId: getCurrentTurnId(sessionId, state.sequence),
              sequence: state.sequence,
            },
          };
        }

        case 'SubagentStop': {
          // Load current state
          const state = loadTurnState(sessionId, turnsDir);

          // Increment subagent counter
          state.subagentSeq++;
          saveTurnState(sessionId, state, turnsDir);

          const subagentTurnId = getSubagentTurnId(sessionId, state.sequence, state.subagentSeq);

          return {
            data: {
              subagentTurnId,
              turnId: getCurrentTurnId(sessionId, state.sequence),
              subagentSeq: state.subagentSeq,
            },
          };
        }

        case 'UserPromptSubmit':
        case 'PreToolUse':
        case 'PostToolUse':
        case 'PreCompact':
        case 'Notification': {
          // Read-only - just return current turn ID
          const state = loadTurnState(sessionId, turnsDir);
          const turnId = getCurrentTurnId(sessionId, state.sequence);

          return {
            data: { turnId, sequence: state.sequence },
          };
        }

        case 'SessionEnd': {
          // No mutation needed
          const state = loadTurnState(sessionId, turnsDir);
          return {
            data: {
              turnId: getCurrentTurnId(sessionId, state.sequence),
              totalTurns: state.sequence,
            },
          };
        }

        default: {
          // Unknown event type - return empty result
          return {};
        }
      }
    },
  };
}

// ============================================================================
// Handler Factory for Config System
// ============================================================================

export const turnTrackerMeta: BuiltinHandlerMeta = {
  id: 'turn-tracker',
  name: 'Turn Tracker',
  description: 'Tracks turns within a session based on Stop events',
  defaultEvents: [
    'SessionStart',
    'Stop',
    'SubagentStop',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
  ],
  defaultPriority: 5,
  optionsSchema: {
    turns_dir: {
      type: 'string',
      description: 'Directory to store turn state files',
      default: DEFAULT_TURNS_DIR,
    },
    preserve_on_resume: {
      type: 'boolean',
      description: 'Preserve turn state when resuming a session',
      default: true,
    },
    inject_context: {
      type: 'boolean',
      description: 'Inject turn context on SessionStart',
      default: false,
    },
  },
};

export const turnTrackerFactory: BuiltinHandlerFactory = (options = {}) => {
  return createTurnTrackerHandler({
    turnsDir: options.turns_dir as string | undefined,
    preserveOnResume: options.preserve_on_resume as boolean | undefined,
    injectContext: options.inject_context as boolean | undefined,
  });
};
