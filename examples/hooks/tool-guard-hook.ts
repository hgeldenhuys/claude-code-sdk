#!/usr/bin/env bun
/**
 * Example: Tool Guard Hook with Session Awareness
 *
 * This hook demonstrates blocking certain tools based on session context.
 * It tracks sessions and can apply per-session policies.
 *
 * Usage in .claude/settings.json:
 * {
 *   "hooks": {
 *     "PreToolUse": [{
 *       "command": "bun run examples/hooks/tool-guard-hook.ts",
 *       "match": { "tool_name": "Bash" }
 *     }]
 *   }
 * }
 */

import {
  createPreToolUseHook,
  blockTool,
  approveTool,
  getSessionStore,
} from '../../src/hooks';

// Define blocked commands per session (example policy)
const sessionPolicies: Record<string, { blockedPatterns: RegExp[] }> = {
  'production-deploy': {
    blockedPatterns: [/rm\s+-rf/, /drop\s+database/i, /--force/],
  },
  'dev-environment': {
    blockedPatterns: [], // Allow everything
  },
};

createPreToolUseHook(({ sessionName, input }) => {
  // Get session-specific policy
  const policy = sessionName ? sessionPolicies[sessionName] : undefined;

  // If no specific policy, use default (allow)
  if (!policy) {
    return;
  }

  // Check Bash commands against blocked patterns
  if (input.tool_name === 'Bash') {
    const command = input.tool_input.command as string;

    for (const pattern of policy.blockedPatterns) {
      if (pattern.test(command)) {
        return blockTool(
          `Command blocked for session '${sessionName}': matches pattern ${pattern.toString()}`
        );
      }
    }
  }

  // Allow by default
  return approveTool();
});
