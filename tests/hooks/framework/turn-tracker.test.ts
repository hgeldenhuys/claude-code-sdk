/**
 * Tests for Turn Tracker Handler
 *
 * Tests the turn tracking system that assigns deterministic turn IDs
 * to sessions based on Stop events.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createTurnTrackerHandler,
  TurnTrackerOptions,
  TurnState,
  loadTurnState,
  saveTurnState,
  getCurrentTurnId,
  getSubagentTurnId,
  DEFAULT_TURNS_DIR,
} from '../../../src/hooks/framework/handlers/turn-tracker';
import type { PipelineContext } from '../../../src/hooks/framework/types';
import type { HookEvent } from '../../../src/hooks/types';

// ============================================================================
// Test Helpers
// ============================================================================

function createMockContext<T = Record<string, unknown>>(
  event: Partial<HookEvent> & { session_id?: string },
  eventType: string,
  state: T = {} as T
): PipelineContext<T> {
  return {
    event: event as HookEvent,
    eventType,
    state,
    results: new Map(),
    startedAt: new Date(),
    sessionId: event.session_id,
    cwd: process.cwd(),
  };
}

// ============================================================================
// Turn State Storage Tests
// ============================================================================

describe('Turn State Storage', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('loadTurnState returns default state for new session', () => {
    const state = loadTurnState('new-session', testDir);
    expect(state).toEqual({ sequence: 1, subagentSeq: 0 });
  });

  test('saveTurnState creates directory if missing', () => {
    const nestedDir = path.join(testDir, 'nested', 'dir');
    saveTurnState('test-session', { sequence: 5, subagentSeq: 2 }, nestedDir);

    expect(fs.existsSync(nestedDir)).toBe(true);
    const loaded = loadTurnState('test-session', nestedDir);
    expect(loaded).toEqual({ sequence: 5, subagentSeq: 2 });
  });

  test('saveTurnState and loadTurnState round-trip', () => {
    const sessionId = 'round-trip-session';
    const state: TurnState = { sequence: 10, subagentSeq: 3 };

    saveTurnState(sessionId, state, testDir);
    const loaded = loadTurnState(sessionId, testDir);

    expect(loaded).toEqual(state);
  });

  test('loadTurnState handles corrupted file gracefully', () => {
    const sessionId = 'corrupted-session';
    const filePath = path.join(testDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, 'not valid json{{{');

    const state = loadTurnState(sessionId, testDir);
    expect(state).toEqual({ sequence: 1, subagentSeq: 0 });
  });

  test('loadTurnState handles missing fields', () => {
    const sessionId = 'partial-session';
    const filePath = path.join(testDir, `${sessionId}.json`);
    fs.writeFileSync(filePath, JSON.stringify({ sequence: 5 }));

    const state = loadTurnState(sessionId, testDir);
    expect(state.sequence).toBe(5);
    expect(state.subagentSeq).toBe(0);
  });
});

// ============================================================================
// Turn ID Generation Tests
// ============================================================================

describe('Turn ID Generation', () => {
  test('getCurrentTurnId formats correctly', () => {
    expect(getCurrentTurnId('abc123', 1)).toBe('abc123:1');
    expect(getCurrentTurnId('abc123', 5)).toBe('abc123:5');
    expect(getCurrentTurnId('session-with-dashes', 10)).toBe('session-with-dashes:10');
  });

  test('getSubagentTurnId formats correctly', () => {
    expect(getSubagentTurnId('abc123', 1, 1)).toBe('abc123:1:s:1');
    expect(getSubagentTurnId('abc123', 2, 3)).toBe('abc123:2:s:3');
    expect(getSubagentTurnId('session-id', 5, 10)).toBe('session-id:5:s:10');
  });
});

// ============================================================================
// SessionStart Handler Tests
// ============================================================================

describe('Turn Tracker - SessionStart', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('initializes state to sequence 1 on new session', async () => {
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'new-session-123' },
      'SessionStart'
    );

    const result = await handlerDef.handler(ctx);

    expect(result.decision).toBeUndefined();
    const state = loadTurnState('new-session-123', testDir);
    expect(state.sequence).toBe(1);
    expect(state.subagentSeq).toBe(0);
  });

  test('preserves existing state on resume', async () => {
    // Pre-save state
    saveTurnState('resume-session', { sequence: 5, subagentSeq: 2 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir, preserveOnResume: true };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'resume-session', is_resume: true } as HookEvent & { session_id: string; is_resume: boolean },
      'SessionStart'
    );

    await handlerDef.handler(ctx);

    const state = loadTurnState('resume-session', testDir);
    expect(state.sequence).toBe(5);
    expect(state.subagentSeq).toBe(2);
  });

  test('resets state on resume when preserveOnResume is false', async () => {
    saveTurnState('reset-session', { sequence: 5, subagentSeq: 2 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir, preserveOnResume: false };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'reset-session', is_resume: true } as HookEvent & { session_id: string; is_resume: boolean },
      'SessionStart'
    );

    await handlerDef.handler(ctx);

    const state = loadTurnState('reset-session', testDir);
    expect(state.sequence).toBe(1);
    expect(state.subagentSeq).toBe(0);
  });

  test('injects turn context when injectContext is true', async () => {
    const options: TurnTrackerOptions = { turnsDir: testDir, injectContext: true };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'inject-session' },
      'SessionStart'
    );

    const result = await handlerDef.handler(ctx);

    expect(result.context).toBeDefined();
    expect(result.context).toContain('inject-session:1');
  });
});

// ============================================================================
// Stop Handler Tests
// ============================================================================

describe('Turn Tracker - Stop', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('increments sequence on Stop event', async () => {
    saveTurnState('stop-session', { sequence: 1, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'stop-session', stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    );

    await handlerDef.handler(ctx);

    const state = loadTurnState('stop-session', testDir);
    expect(state.sequence).toBe(2);
  });

  test('resets subagentSeq on Stop event', async () => {
    saveTurnState('stop-reset-session', { sequence: 3, subagentSeq: 5 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'stop-reset-session', stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    );

    await handlerDef.handler(ctx);

    const state = loadTurnState('stop-reset-session', testDir);
    expect(state.sequence).toBe(4);
    expect(state.subagentSeq).toBe(0);
  });

  test('multiple Stop events increment correctly', async () => {
    saveTurnState('multi-stop', { sequence: 1, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    // First stop
    await handlerDef.handler(createMockContext(
      { session_id: 'multi-stop', stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    expect(loadTurnState('multi-stop', testDir).sequence).toBe(2);

    // Second stop
    await handlerDef.handler(createMockContext(
      { session_id: 'multi-stop', stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    expect(loadTurnState('multi-stop', testDir).sequence).toBe(3);

    // Third stop
    await handlerDef.handler(createMockContext(
      { session_id: 'multi-stop', stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    expect(loadTurnState('multi-stop', testDir).sequence).toBe(4);
  });
});

// ============================================================================
// SubagentStop Handler Tests
// ============================================================================

describe('Turn Tracker - SubagentStop', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('increments subagentSeq on SubagentStop', async () => {
    saveTurnState('subagent-session', { sequence: 2, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'subagent-session' },
      'SubagentStop'
    );

    await handlerDef.handler(ctx);

    const state = loadTurnState('subagent-session', testDir);
    expect(state.subagentSeq).toBe(1);
    expect(state.sequence).toBe(2); // sequence unchanged
  });

  test('multiple SubagentStop events increment correctly', async () => {
    saveTurnState('multi-subagent', { sequence: 1, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    for (let i = 1; i <= 3; i++) {
      await handlerDef.handler(createMockContext(
        { session_id: 'multi-subagent' },
        'SubagentStop'
      ));
      const state = loadTurnState('multi-subagent', testDir);
      expect(state.subagentSeq).toBe(i);
      expect(state.sequence).toBe(1); // sequence unchanged
    }
  });

  test('subagent ID format is correct', async () => {
    saveTurnState('subid-session', { sequence: 3, subagentSeq: 4 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'subid-session' },
      'SubagentStop'
    );

    const result = await handlerDef.handler(ctx);

    // After increment, subagentSeq is 5
    expect(result.data?.subagentTurnId).toBe('subid-session:3:s:5');
  });
});

// ============================================================================
// Read-Only Event Tests
// ============================================================================

describe('Turn Tracker - Read-Only Events', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('UserPromptSubmit does not mutate state', async () => {
    saveTurnState('readonly-session', { sequence: 5, subagentSeq: 3 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'readonly-session', prompt: 'test prompt' } as HookEvent & { session_id: string; prompt: string },
      'UserPromptSubmit'
    );

    const result = await handlerDef.handler(ctx);

    const state = loadTurnState('readonly-session', testDir);
    expect(state.sequence).toBe(5);
    expect(state.subagentSeq).toBe(3);
    expect(result.data?.turnId).toBe('readonly-session:5');
  });

  test('PreToolUse does not mutate state', async () => {
    saveTurnState('pretool-session', { sequence: 2, subagentSeq: 1 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'pretool-session', tool_name: 'Bash', tool_input: {} } as HookEvent & { session_id: string; tool_name: string; tool_input: object },
      'PreToolUse'
    );

    const result = await handlerDef.handler(ctx);

    const state = loadTurnState('pretool-session', testDir);
    expect(state.sequence).toBe(2);
    expect(state.subagentSeq).toBe(1);
    expect(result.data?.turnId).toBe('pretool-session:2');
  });

  test('PostToolUse does not mutate state', async () => {
    saveTurnState('posttool-session', { sequence: 7, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'posttool-session', tool_name: 'Read', tool_result: 'file content' } as HookEvent & { session_id: string; tool_name: string; tool_result: string },
      'PostToolUse'
    );

    const result = await handlerDef.handler(ctx);

    const state = loadTurnState('posttool-session', testDir);
    expect(state.sequence).toBe(7);
    expect(state.subagentSeq).toBe(0);
    expect(result.data?.turnId).toBe('posttool-session:7');
  });
});

// ============================================================================
// Full Lifecycle Tests
// ============================================================================

describe('Turn Tracker - Full Lifecycle', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('complete turn lifecycle matches spec', async () => {
    const sessionId = 'lifecycle-test';
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    // SessionStart - initializes to sequence 1
    await handlerDef.handler(createMockContext(
      { session_id: sessionId },
      'SessionStart'
    ));
    let state = loadTurnState(sessionId, testDir);
    expect(state).toEqual({ sequence: 1, subagentSeq: 0 });

    // TURN 1
    // UserPromptSubmit - reads turnId abc:1
    let result = await handlerDef.handler(createMockContext(
      { session_id: sessionId, prompt: 'hello' } as HookEvent & { session_id: string; prompt: string },
      'UserPromptSubmit'
    ));
    expect(result.data?.turnId).toBe(`${sessionId}:1`);

    // PreToolUse - reads turnId abc:1
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId, tool_name: 'Bash', tool_input: {} } as HookEvent & { session_id: string; tool_name: string; tool_input: object },
      'PreToolUse'
    ));
    expect(result.data?.turnId).toBe(`${sessionId}:1`);

    // SubagentStop - generates subId abc:1:s:1
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId },
      'SubagentStop'
    ));
    expect(result.data?.subagentTurnId).toBe(`${sessionId}:1:s:1`);

    // SubagentStop - generates subId abc:1:s:2
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId },
      'SubagentStop'
    ));
    expect(result.data?.subagentTurnId).toBe(`${sessionId}:1:s:2`);

    // Stop - increments to sequence 2
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId, stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    expect(result.data?.completedTurnId).toBe(`${sessionId}:1`);
    state = loadTurnState(sessionId, testDir);
    expect(state).toEqual({ sequence: 2, subagentSeq: 0 });

    // TURN 2
    // UserPromptSubmit - reads turnId abc:2
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId, prompt: 'another prompt' } as HookEvent & { session_id: string; prompt: string },
      'UserPromptSubmit'
    ));
    expect(result.data?.turnId).toBe(`${sessionId}:2`);

    // Stop - increments to sequence 3
    result = await handlerDef.handler(createMockContext(
      { session_id: sessionId, stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    expect(result.data?.completedTurnId).toBe(`${sessionId}:2`);
    state = loadTurnState(sessionId, testDir);
    expect(state).toEqual({ sequence: 3, subagentSeq: 0 });
  });

  test('idempotency - same execution yields same turn ID', async () => {
    const sessionId = 'idempotent-test';
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    // Initialize
    await handlerDef.handler(createMockContext(
      { session_id: sessionId },
      'SessionStart'
    ));

    // After 2 Stop events
    await handlerDef.handler(createMockContext(
      { session_id: sessionId, stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));
    await handlerDef.handler(createMockContext(
      { session_id: sessionId, stop_reason: 'end_turn' } as HookEvent & { session_id: string; stop_reason: string },
      'Stop'
    ));

    // Current turn should always be sessionId:3
    for (let i = 0; i < 5; i++) {
      const result = await handlerDef.handler(createMockContext(
        { session_id: sessionId, prompt: `prompt ${i}` } as HookEvent & { session_id: string; prompt: string },
        'UserPromptSubmit'
      ));
      expect(result.data?.turnId).toBe(`${sessionId}:3`);
    }
  });
});

// ============================================================================
// Handler Configuration Tests
// ============================================================================

describe('Turn Tracker - Handler Configuration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('handler has correct default properties', () => {
    const handlerDef = createTurnTrackerHandler({ turnsDir: testDir });

    expect(handlerDef.id).toBe('turn-tracker');
    expect(handlerDef.name).toBe('Turn Tracker');
    expect(handlerDef.priority).toBe(5); // Runs early to set turn context
  });

  test('custom turns directory is used', async () => {
    const customDir = path.join(testDir, 'custom-turns');
    const options: TurnTrackerOptions = { turnsDir: customDir };
    const handlerDef = createTurnTrackerHandler(options);

    await handlerDef.handler(createMockContext(
      { session_id: 'custom-dir-session' },
      'SessionStart'
    ));

    expect(fs.existsSync(path.join(customDir, 'custom-dir-session.json'))).toBe(true);
  });

  test('handles missing session_id gracefully', async () => {
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext({}, 'UserPromptSubmit');

    const result = await handlerDef.handler(ctx);

    // Should not crash, returns empty result
    expect(result.decision).toBeUndefined();
    expect(result.data?.turnId).toBeUndefined();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Turn Tracker - Edge Cases', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `turn-tracker-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  test('handles very long session IDs', async () => {
    const longSessionId = 'a'.repeat(200);
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    await handlerDef.handler(createMockContext(
      { session_id: longSessionId },
      'SessionStart'
    ));

    const state = loadTurnState(longSessionId, testDir);
    expect(state.sequence).toBe(1);
  });

  test('handles session IDs with special characters', async () => {
    // Claude Code session IDs are typically UUIDs, but test edge cases
    const sessionId = 'session_with-dashes.and.dots';
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    await handlerDef.handler(createMockContext(
      { session_id: sessionId },
      'SessionStart'
    ));

    const state = loadTurnState(sessionId, testDir);
    expect(state.sequence).toBe(1);
  });

  test('concurrent access to same session (simulated)', async () => {
    const sessionId = 'concurrent-session';
    saveTurnState(sessionId, { sequence: 1, subagentSeq: 0 }, testDir);

    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);

    // Simulate concurrent SubagentStop events
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(handlerDef.handler(createMockContext(
        { session_id: sessionId },
        'SubagentStop'
      )));
    }

    await Promise.all(promises);

    // Due to race conditions, final count may not be exactly 5
    // but should be at least 1 and state should be valid
    const state = loadTurnState(sessionId, testDir);
    expect(state.sequence).toBe(1);
    expect(state.subagentSeq).toBeGreaterThanOrEqual(1);
  });

  test('unhandled event types pass through', async () => {
    const options: TurnTrackerOptions = { turnsDir: testDir };
    const handlerDef = createTurnTrackerHandler(options);
    const ctx = createMockContext(
      { session_id: 'unknown-event-session' },
      'SomeUnknownEvent'
    );

    const result = await handlerDef.handler(ctx);

    // Should not crash, returns basic result
    expect(result.decision).toBeUndefined();
  });
});
