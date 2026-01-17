/**
 * Session Naming Built-in Handler
 *
 * Automatically assigns human-friendly names to Claude Code sessions
 * and injects the session name into Claude's context on SessionStart.
 *
 * Uses the existing NameGenerator from src/hooks/sessions/namer.ts.
 */

import { NameGenerator } from '../../sessions/namer';
import { getSessionName, getSessionStore, listSessions } from '../../sessions/store';
import type { SessionStartInput } from '../../types';
import type { SessionNamingOptions } from '../config/types';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';

// ============================================================================
// Types
// ============================================================================

interface SessionNamingState {
  sessionName?: string;
  sessionId?: string;
  isNew?: boolean;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a session-naming handler with the given options
 */
export function createSessionNamingHandler(
  options: SessionNamingOptions = {}
): HandlerDefinition<SessionNamingState> {
  const { format = 'adjective-animal', separator = '-', includeTimestamp = false } = options;

  // Create name generator based on format
  const nameGenerator = new NameGenerator({ separator });

  return {
    id: 'session-naming',
    name: 'Session Naming',
    description: 'Assigns human-friendly names to sessions and injects context',
    priority: 10,
    enabled: true,
    handler: async (ctx: PipelineContext<SessionNamingState>): Promise<HandlerResult> => {
      const event = ctx.event as SessionStartInput;
      const sessionId = event.session_id;

      if (!sessionId) {
        return {
          success: true,
          durationMs: 0,
          data: { error: 'No session ID in event' },
        };
      }

      try {
        // Get or generate session name
        let sessionName: string;
        let isNew = false;

        // Try to get existing session name from store
        const store = getSessionStore();
        const existingName = getSessionName(sessionId);

        if (existingName) {
          sessionName = existingName;
        } else {
          // Generate new name based on format
          sessionName = generateSessionName(format, nameGenerator, includeTimestamp);
          isNew = true;

          // Register the session with the store
          store.track(sessionId, {
            name: sessionName,
            cwd: ctx.cwd,
            source: event.source || 'startup',
          });
        }

        // Store in pipeline state
        ctx.state.sessionName = sessionName;
        ctx.state.sessionId = sessionId;
        ctx.state.isNew = isNew;

        // Build context message for Claude
        const contextMessage = buildContextMessage(sessionName, event, isNew);

        return {
          success: true,
          durationMs: 0,
          contextToInject: contextMessage,
          data: {
            sessionName,
            sessionId,
            isNew,
          },
        };
      } catch (error) {
        // Non-fatal - return success but with error data
        return {
          success: true,
          durationMs: 0,
          data: {
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        };
      }
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a session name based on the configured format
 */
function generateSessionName(
  format: SessionNamingOptions['format'],
  nameGenerator: NameGenerator,
  includeTimestamp: boolean
): string {
  let name: string;

  switch (format) {
    case 'timestamp':
      name = `session-${Date.now()}`;
      break;

    case 'uuid':
      name = crypto.randomUUID().slice(0, 8);
      break;
    default: {
      // Get existing names to avoid collisions
      const existingNames = new Set(listSessions().map((s) => s.name));
      name = nameGenerator.generateUnique(existingNames);
      break;
    }
  }

  if (includeTimestamp && format !== 'timestamp') {
    name = `${name}-${Date.now()}`;
  }

  return name;
}

/**
 * Build the context message to inject for Claude
 */
function buildContextMessage(
  sessionName: string,
  event: SessionStartInput,
  isNew: boolean
): string {
  const lines: string[] = ['<session-info>', `Session: ${sessionName}`];

  // Add source if not startup
  if (event.source && event.source !== 'startup') {
    lines.push(`Source: ${event.source}`);
  }

  // Add note if session was just created
  if (isNew) {
    lines.push('Note: New session name assigned');
  }

  // Add agent type if present (Claude Code 2.1.2+)
  if (event.agent_type) {
    lines.push(`Agent: ${event.agent_type}`);
  }

  lines.push('</session-info>');

  return lines.join('\n');
}

// ============================================================================
// Default Export
// ============================================================================

export default createSessionNamingHandler;
