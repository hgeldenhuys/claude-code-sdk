#!/usr/bin/env bun
/**
 * Hook Framework Example
 *
 * Demonstrates the hook framework with:
 * - Multiple handlers with dependencies
 * - Conditional execution
 * - Shared state
 * - Different event types
 *
 * Usage in .claude/settings.json:
 * ```json
 * {
 *   "hooks": {
 *     "PreToolUse": [{ "command": "bun examples/hooks/framework-example.ts" }],
 *     "PostToolUse": [{ "command": "bun examples/hooks/framework-example.ts" }],
 *     "SessionStart": [{ "command": "bun examples/hooks/framework-example.ts" }]
 *   }
 * }
 * ```
 */

import {
  createFramework,
  handler,
  handlerResult,
  blockResult,
  injectResult,
  logHandler,
  validateHandler,
} from '../../src/hooks/framework';

// ============================================================================
// Define shared state type
// ============================================================================

interface MyState {
  toolsUsed: string[];
  blockedTools: string[];
  sessionStartTime?: Date;
  validationPassed: boolean;
}

// ============================================================================
// Create framework
// ============================================================================

const framework = createFramework<MyState>({
  debug: process.env.HOOK_DEBUG === 'true',
  defaultTimeoutMs: 10000,
  defaultErrorStrategy: 'continue',
  initialState: () => ({
    toolsUsed: [],
    blockedTools: [],
    validationPassed: false,
  }),
});

// ============================================================================
// PreToolUse Handlers
// ============================================================================

// 1. Log handler (runs first, priority 1)
framework.onPreToolUse(
  logHandler<MyState>('log-pretool', (ctx) => {
    const eventData = ctx.event as unknown as Record<string, unknown>;
    const toolName = eventData.tool_name;
    return `[PreToolUse] Tool: ${toolName}`;
  })
);

// 2. Validate dangerous commands (priority 10)
framework.onPreToolUse(
  handler<MyState>()
    .id('validate-dangerous')
    .name('Validate Dangerous Commands')
    .priority(10)
    .forTools('Bash')
    .handle((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const input = eventData.tool_input as { command?: string };
      const command = input?.command ?? '';

      // Block dangerous patterns
      const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){ :|:& };:'];
      for (const pattern of dangerous) {
        if (command.includes(pattern)) {
          ctx.state.blockedTools.push('Bash');
          return blockResult(`Blocked dangerous command pattern: ${pattern}`);
        }
      }

      ctx.state.validationPassed = true;
      return handlerResult({ validated: true });
    })
);

// 3. Check for sudo (depends on validate-dangerous)
framework.onPreToolUse(
  handler<MyState>()
    .id('check-sudo')
    .name('Check Sudo Usage')
    .priority(20)
    .after('validate-dangerous')
    .forTools('Bash')
    .when((ctx) => ctx.state.validationPassed) // Only if validation passed
    .handle((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const input = eventData.tool_input as { command?: string };
      const command = input?.command ?? '';

      if (command.startsWith('sudo ')) {
        // Log warning but don't block
        console.error('[WARN] Sudo command detected');
        ctx.state.toolsUsed.push('Bash (sudo)');
      } else {
        ctx.state.toolsUsed.push('Bash');
      }

      return handlerResult();
    })
);

// 4. Track all tool usage (runs for all tools)
framework.onPreToolUse(
  handler<MyState>()
    .id('track-usage')
    .name('Track Tool Usage')
    .priority(50)
    .handle((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const toolName = eventData.tool_name as string;
      if (!ctx.state.toolsUsed.includes(toolName)) {
        ctx.state.toolsUsed.push(toolName);
      }
      return handlerResult();
    })
);

// ============================================================================
// PostToolUse Handlers
// ============================================================================

// Log tool completion
framework.onPostToolUse(
  handler<MyState>()
    .id('log-completion')
    .name('Log Tool Completion')
    .handle((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const toolName = eventData.tool_name;
      console.error(`[PostToolUse] Completed: ${toolName}`);
      return handlerResult();
    })
);

// Analyze results (depends on logging)
framework.onPostToolUse(
  handler<MyState>()
    .id('analyze-results')
    .name('Analyze Tool Results')
    .after('log-completion')
    .handle((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const result = eventData.tool_result;
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

      // Check for errors in output
      if (resultStr.includes('error') || resultStr.includes('Error')) {
        console.error('[PostToolUse] Potential error detected in output');
      }

      return handlerResult({ analyzed: true });
    })
);

// ============================================================================
// SessionStart Handlers
// ============================================================================

// Inject context on session start
framework.onSessionStart(
  handler<MyState>()
    .id('inject-session-context')
    .name('Inject Session Context')
    .handle((ctx) => {
      ctx.state.sessionStartTime = new Date();

      return injectResult(`
<session-context>
Session started at: ${ctx.state.sessionStartTime.toISOString()}
Framework example hook is active with the following protections:
- Dangerous command blocking for Bash
- Sudo usage warnings
- Tool usage tracking
</session-context>
`);
    })
);

// ============================================================================
// Stop Handler
// ============================================================================

framework.onStop(
  handler<MyState>()
    .id('log-session-summary')
    .name('Log Session Summary')
    .handle((ctx) => {
      console.error('\n=== Session Summary ===');
      console.error(`Tools used: ${ctx.state.toolsUsed.join(', ') || 'none'}`);
      console.error(`Blocked tools: ${ctx.state.blockedTools.join(', ') || 'none'}`);
      console.error('=======================\n');
      return handlerResult();
    })
);

// ============================================================================
// Run
// ============================================================================

framework.run().catch((err) => {
  console.error(`Framework error: ${err}`);
  process.exit(1);
});
