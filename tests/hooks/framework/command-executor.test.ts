/**
 * Tests for Command Executor
 *
 * Tests external command execution with framework environment variables.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildFrameworkEnv,
  executeCommand,
  parseCommandOutput,
  createCommandHandler,
} from '../../../src/hooks/framework/command-executor';
import type { PipelineContext, HandlerResult } from '../../../src/hooks/framework/types';
import type { HookEvent } from '../../../src/hooks/types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  const results = new Map<string, HandlerResult>();

  return {
    event: { session_id: 'test-session-123' } as HookEvent,
    eventType: 'PreToolUse',
    state: {},
    results,
    startedAt: new Date(),
    sessionId: 'test-session-123',
    cwd: process.cwd(),
    ...overrides,
  };
}

// ============================================================================
// buildFrameworkEnv Tests
// ============================================================================

describe('buildFrameworkEnv', () => {
  test('sets basic context values', () => {
    const ctx = createMockContext({
      eventType: 'PreToolUse',
      cwd: '/test/project',
      sessionId: 'abc123',
    });

    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_EVENT_TYPE).toBe('PreToolUse');
    expect(env.CLAUDE_CWD).toBe('/test/project');
    expect(env.CLAUDE_SESSION_ID).toBe('abc123');
  });

  test('extracts turn tracker data from results', () => {
    const results = new Map<string, HandlerResult>();
    results.set('turn-tracker', {
      data: { turnId: 'abc123:5', sequence: 5 },
    });

    const ctx = createMockContext({ results });
    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_TURN_ID).toBe('abc123:5');
    expect(env.CLAUDE_TURN_SEQUENCE).toBe('5');
  });

  test('extracts session naming data from results', () => {
    const results = new Map<string, HandlerResult>();
    results.set('session-naming', {
      data: { sessionName: 'jolly-elephant' },
    });

    const ctx = createMockContext({ results });
    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_SESSION_NAME).toBe('jolly-elephant');
  });

  test('handles missing turn tracker gracefully', () => {
    const ctx = createMockContext();
    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_TURN_ID).toBeUndefined();
    expect(env.CLAUDE_TURN_SEQUENCE).toBeUndefined();
  });

  test('handles missing session naming gracefully', () => {
    const ctx = createMockContext();
    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_SESSION_NAME).toBeUndefined();
  });

  test('includes all available data', () => {
    const results = new Map<string, HandlerResult>();
    results.set('turn-tracker', {
      data: { turnId: 'sess:3', sequence: 3 },
    });
    results.set('session-naming', {
      data: { sessionName: 'brave-tiger' },
    });

    const ctx = createMockContext({
      results,
      sessionId: 'sess',
      eventType: 'PostToolUse',
      cwd: '/my/project',
    });

    const env = buildFrameworkEnv(ctx);

    expect(env.CLAUDE_SESSION_ID).toBe('sess');
    expect(env.CLAUDE_EVENT_TYPE).toBe('PostToolUse');
    expect(env.CLAUDE_CWD).toBe('/my/project');
    expect(env.CLAUDE_TURN_ID).toBe('sess:3');
    expect(env.CLAUDE_TURN_SEQUENCE).toBe('3');
    expect(env.CLAUDE_SESSION_NAME).toBe('brave-tiger');
  });
});

// ============================================================================
// parseCommandOutput Tests
// ============================================================================

describe('parseCommandOutput', () => {
  test('empty output means approve/continue', () => {
    const result = parseCommandOutput('');
    expect(result.success).toBe(true);
  });

  test('whitespace-only output means approve/continue', () => {
    const result = parseCommandOutput('   \n\t  ');
    expect(result.success).toBe(true);
  });

  test('parses block decision JSON', () => {
    const output = JSON.stringify({ decision: 'block', reason: 'Dangerous command' });
    const result = parseCommandOutput(output);

    expect(result.decision).toBe('block');
    expect(result.reason).toBe('Dangerous command');
  });

  test('parses context injection JSON', () => {
    const output = JSON.stringify({ context: '<info>Some context</info>' });
    const result = parseCommandOutput(output);

    expect(result.context).toBe('<info>Some context</info>');
  });

  test('parses generic JSON as data', () => {
    const output = JSON.stringify({ customField: 'value', count: 42 });
    const result = parseCommandOutput(output);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ customField: 'value', count: 42 });
  });

  test('treats non-JSON text as context injection', () => {
    const output = '<session-info>\nSession: test-session\n</session-info>';
    const result = parseCommandOutput(output);

    expect(result.context).toBe(output);
  });

  test('handles block without reason', () => {
    const output = JSON.stringify({ decision: 'block' });
    const result = parseCommandOutput(output);

    expect(result.decision).toBe('block');
    expect(result.reason).toBe('Blocked by external handler');
  });
});

// ============================================================================
// executeCommand Tests
// ============================================================================

describe('executeCommand', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `cmd-exec-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('executes simple echo command', async () => {
    const ctx = createMockContext();
    const result = await executeCommand({
      command: 'echo "hello"',
      event: { session_id: 'test' } as HookEvent,
      context: ctx,
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  test('passes event via stdin', async () => {
    const scriptPath = path.join(testDir, 'read-stdin.sh');
    fs.writeFileSync(scriptPath, '#!/bin/bash\ncat', { mode: 0o755 });

    const ctx = createMockContext();
    const event = { session_id: 'test-123', tool_name: 'Bash' } as HookEvent;

    const result = await executeCommand({
      command: `bash ${scriptPath}`,
      event,
      context: ctx,
    });

    expect(result.success).toBe(true);
    const parsedOutput = JSON.parse(result.stdout);
    expect(parsedOutput.session_id).toBe('test-123');
    expect(parsedOutput.tool_name).toBe('Bash');
  });

  test('sets framework environment variables', async () => {
    const results = new Map<string, HandlerResult>();
    results.set('turn-tracker', {
      data: { turnId: 'abc:2', sequence: 2 },
    });
    results.set('session-naming', {
      data: { sessionName: 'test-session' },
    });

    const ctx = createMockContext({
      results,
      sessionId: 'abc',
      eventType: 'PreToolUse',
    });

    const result = await executeCommand({
      command: 'echo $CLAUDE_TURN_ID:$CLAUDE_SESSION_NAME',
      event: { session_id: 'abc' } as HookEvent,
      context: ctx,
    });

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('abc:2:test-session');
  });

  test('captures stderr', async () => {
    const ctx = createMockContext();
    const result = await executeCommand({
      command: 'echo "error" >&2',
      event: { session_id: 'test' } as HookEvent,
      context: ctx,
    });

    expect(result.stderr).toBe('error');
  });

  test('handles command failure', async () => {
    const ctx = createMockContext();
    const result = await executeCommand({
      command: 'exit 1',
      event: { session_id: 'test' } as HookEvent,
      context: ctx,
    });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test(
    'handles command timeout',
    async () => {
      const ctx = createMockContext();
      const result = await executeCommand({
        command: 'sleep 10',
        event: { session_id: 'test' } as HookEvent,
        context: ctx,
        timeoutMs: 200,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    },
    { timeout: 10000 }
  );

  test('handles non-existent command', async () => {
    const ctx = createMockContext();
    const result = await executeCommand({
      command: 'nonexistent-command-12345',
      event: { session_id: 'test' } as HookEvent,
      context: ctx,
    });

    expect(result.success).toBe(false);
  });
});

// ============================================================================
// createCommandHandler Tests
// ============================================================================

describe('createCommandHandler', () => {
  test('creates handler that executes command', async () => {
    const handler = createCommandHandler('echo "test output"');
    const ctx = createMockContext();

    const result = await handler(ctx);

    // "test output" is not JSON, so treated as context
    expect(result.context).toBe('test output');
  });

  test('creates handler that returns block decision', async () => {
    // Use base64-encoded JSON to avoid shell escaping issues
    const json = '{"decision":"block","reason":"Not allowed"}';
    const encoded = Buffer.from(json).toString('base64');
    const handler = createCommandHandler(`echo ${encoded} | base64 -d`);
    const ctx = createMockContext();

    const result = await handler(ctx);

    expect(result.decision).toBe('block');
    expect(result.reason).toBe('Not allowed');
  });

  test(
    'creates handler with custom timeout',
    async () => {
      const handler = createCommandHandler('sleep 10', 200);
      const ctx = createMockContext();

      const result = await handler(ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    },
    { timeout: 10000 }
  );
});

// ============================================================================
// Integration Test with Real Script
// ============================================================================

describe('Command Executor Integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `cmd-exec-int-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('external script can access all framework env vars', async () => {
    // Create a script that outputs all CLAUDE_ env vars
    const scriptPath = path.join(testDir, 'env-check.sh');
    fs.writeFileSync(
      scriptPath,
      `#!/bin/bash
echo "{"
echo "  \\"turnId\\": \\"$CLAUDE_TURN_ID\\","
echo "  \\"sequence\\": \\"$CLAUDE_TURN_SEQUENCE\\","
echo "  \\"sessionName\\": \\"$CLAUDE_SESSION_NAME\\","
echo "  \\"sessionId\\": \\"$CLAUDE_SESSION_ID\\","
echo "  \\"eventType\\": \\"$CLAUDE_EVENT_TYPE\\""
echo "}"
`,
      { mode: 0o755 }
    );

    const results = new Map<string, HandlerResult>();
    results.set('turn-tracker', {
      data: { turnId: 'session-abc:7', sequence: 7 },
    });
    results.set('session-naming', {
      data: { sessionName: 'happy-dolphin' },
    });

    const ctx = createMockContext({
      results,
      sessionId: 'session-abc',
      eventType: 'PostToolUse',
    });

    const result = await executeCommand({
      command: `bash ${scriptPath}`,
      event: { session_id: 'session-abc' } as HookEvent,
      context: ctx,
    });

    expect(result.success).toBe(true);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.turnId).toBe('session-abc:7');
    expect(parsed.sequence).toBe('7');
    expect(parsed.sessionName).toBe('happy-dolphin');
    expect(parsed.sessionId).toBe('session-abc');
    expect(parsed.eventType).toBe('PostToolUse');
  });

  test('external script can output block decision', async () => {
    const scriptPath = path.join(testDir, 'block-check.sh');
    fs.writeFileSync(
      scriptPath,
      `#!/bin/bash
# Read event from stdin
EVENT=$(cat)
TOOL_NAME=$(echo $EVENT | grep -o '"tool_name":"[^"]*"' | cut -d'"' -f4)

if [ "$TOOL_NAME" = "Bash" ]; then
  echo '{"decision": "block", "reason": "Bash blocked by policy"}'
else
  echo ''
fi
`,
      { mode: 0o755 }
    );

    const ctx = createMockContext();
    const event = { session_id: 'test', tool_name: 'Bash' } as HookEvent;

    const result = await executeCommand({
      command: `bash ${scriptPath}`,
      event,
      context: ctx,
    });

    expect(result.success).toBe(true);

    const parsed = parseCommandOutput(result.stdout);
    expect(parsed.decision).toBe('block');
    expect(parsed.reason).toBe('Bash blocked by policy');
  });
});
