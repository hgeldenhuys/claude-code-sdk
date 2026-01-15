#!/usr/bin/env bun
/**
 * Session Start Hook
 *
 * Tracks sessions with human-friendly names using our SessionStore.
 */

import { SessionStore } from '../src/hooks/sessions/store';
import type { SessionStartInput } from '../src/hooks/types';

// Read input from stdin
const input = await Bun.stdin.text();
const data: SessionStartInput = JSON.parse(input);

// Get or create session store
const store = new SessionStore();

// Track this session
const result = store.track(data.session_id, {
  source: data.source,
  cwd: data.cwd,
});

// Log for debugging
console.error(`[session-hook] Tracked session: ${result.name} -> ${data.session_id} (source: ${data.source}, isNew: ${result.isNew})`);

// Output response with correct format for context injection
// See: https://code.claude.com/docs/en/hooks
const response = {
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `Your session name is: ${result.name}`,
  },
};

// Write JSON to stdout
process.stdout.write(JSON.stringify(response));
