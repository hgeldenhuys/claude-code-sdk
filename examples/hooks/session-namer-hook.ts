#!/usr/bin/env bun
/**
 * Example: Session Naming Hook
 *
 * This hook automatically assigns human-friendly names to Claude Code sessions
 * and injects the session name into Claude's context.
 *
 * Usage in .claude/settings.json:
 * {
 *   "hooks": {
 *     "SessionStart": [{
 *       "command": "bun run examples/hooks/session-namer-hook.ts"
 *     }]
 *   }
 * }
 */

import {
  createSessionStartHook,
  sessionStartContext,
} from '../../src/hooks';

createSessionStartHook(({ sessionName, session, input }) => {
  // Build context message for Claude
  let message = `<session-info>\nSession: ${sessionName}`;

  // Add source information
  if (input.source !== 'startup') {
    message += `\nSource: ${input.source}`;
  }

  // Notify if session ID changed (after compact/clear)
  if (session?.sessionIdChanged) {
    message += `\nNote: Session ID changed (${input.source}). Previous: ${session.previousSessionId?.slice(0, 8)}...`;
  }

  // Add agent type if present (2.1.2+)
  if (input.agent_type) {
    message += `\nAgent: ${input.agent_type}`;
  }

  message += '\n</session-info>';

  return sessionStartContext(message);
});
