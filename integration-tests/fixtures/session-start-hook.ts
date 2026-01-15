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
// If source is 'clear', try to resume the latest session for this directory
// to preserve the session name across /clear operations
let result;
if (data.source === 'clear' && data.cwd) {
  result = store.resumeLatestForDirectory(data.session_id, data.cwd, data.source);
}

// If no resume happened, track normally
if (!result) {
  result = store.track(data.session_id, {
    source: data.source,
    cwd: data.cwd,
  });
}

// Log for debugging
const resumed = data.source === 'clear' && !result.isNew;
console.error(`[session-hook] ${resumed ? 'Resumed' : 'Tracked'} session: ${result.name} -> ${data.session_id} (source: ${data.source}, isNew: ${result.isNew})`);

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
