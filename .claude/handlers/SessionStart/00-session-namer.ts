/**
 * Built-in SessionStart Handler - Session Naming
 *
 * Automatically generates memorable session names (adjective-animal pattern)
 * and persists them to .claude/sessions.json
 *
 * This handler MUST run first (00-prefix) to ensure session is named
 * before other handlers run.
 */

import { DispatcherHandler } from '../hook-dispatcher';
import { SessionNamer } from '../session-namer';

export const sessionStartNamerHandler: DispatcherHandler = {
  name: 'session-start-namer',

  async handle(input: any) {
    try {
      const sessionId = input.session_id;
      const source = input.source || 'startup';

      // Get or create session name
      const namer = new SessionNamer();
      const sessionName = namer.getOrCreateName(sessionId, source);

      return {
        message: `Session: ${sessionName} (${sessionId.substring(0, 8)})`,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
