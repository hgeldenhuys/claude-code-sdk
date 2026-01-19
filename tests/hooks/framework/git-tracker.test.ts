/**
 * Tests for Git Tracker Handler
 *
 * Tests the git tracking handler that captures git repository state
 * at session start and before file-modifying tool use.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createGitTrackerHandler,
  DEFAULT_TRACKED_TOOLS,
  gitTrackerMeta,
  gitTrackerFactory,
  type GitTrackerOptions,
  type GitTrackerData,
} from '../../../src/hooks/framework/handlers/git-tracker';
import type { PipelineContext } from '../../../src/hooks/framework/types';
import type { HookEvent } from '../../../src/hooks/types';
import * as gitUtils from '../../../src/utils/git';
import type { GitState } from '../../../src/utils/git';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock PipelineContext for testing
 */
function createMockContext<T = Record<string, unknown>>(
  event: Partial<HookEvent> & { session_id?: string; tool_name?: string; tool_input?: unknown },
  eventType: string,
  state: T = {} as T,
  cwd?: string
): PipelineContext<T> {
  return {
    event: event as HookEvent,
    eventType,
    state,
    results: new Map(),
    startedAt: new Date(),
    sessionId: event.session_id,
    cwd: cwd || process.cwd(),
  };
}

/**
 * Create a mock GitState for controlled testing
 */
function createMockGitState(overrides: Partial<GitState> = {}): GitState {
  return {
    hash: 'abc1234',
    branch: 'main',
    isDirty: false,
    isRepo: true,
    ...overrides,
  };
}

// ============================================================================
// SessionStart Event Tests
// ============================================================================

describe('Git Tracker - SessionStart', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Mock getGitState to control responses
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('captures git state on SessionStart event', async () => {
    const mockState = createMockGitState({
      hash: 'def5678',
      branch: 'feature/test',
      isDirty: true,
    });
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SessionStart'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as GitTrackerData;
    expect(data.gitState).toEqual(mockState);
  });

  test('uses cwd from context for git state lookup', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const customCwd = '/custom/path';
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SessionStart',
      {},
      customCwd
    );

    await handler.handler(ctx);

    expect(mockGetGitState).toHaveBeenCalledWith(customCwd);
  });

  test('returns all git state fields on SessionStart', async () => {
    const mockState = createMockGitState({
      hash: 'commit123',
      branch: 'develop',
      isDirty: false,
      isRepo: true,
    });
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SessionStart'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    const data = result.data as GitTrackerData;
    expect(data.gitState.hash).toBe('commit123');
    expect(data.gitState.branch).toBe('develop');
    expect(data.gitState.isDirty).toBe(false);
    expect(data.gitState.isRepo).toBe(true);
  });
});

// ============================================================================
// PreToolUse - Edit Tool Tests
// ============================================================================

describe('Git Tracker - PreToolUse Edit', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('captures git state for Edit tool', async () => {
    const mockState = createMockGitState({
      hash: 'edit123',
      branch: 'main',
      isDirty: false,
    });
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Edit',
        tool_input: { file_path: '/path/to/file.ts', old_string: 'foo', new_string: 'bar' },
      },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as GitTrackerData;
    expect(data.gitState).toEqual(mockState);
  });

  test('Edit tool triggers getGitState call', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Edit',
        tool_input: {},
      },
      'PreToolUse'
    );

    await handler.handler(ctx);

    expect(mockGetGitState).toHaveBeenCalled();
  });
});

// ============================================================================
// PreToolUse - Write Tool Tests
// ============================================================================

describe('Git Tracker - PreToolUse Write', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('captures git state for Write tool', async () => {
    const mockState = createMockGitState({
      hash: 'write456',
      branch: 'feature/new-file',
      isDirty: true,
    });
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Write',
        tool_input: { file_path: '/path/to/new-file.ts', content: 'content' },
      },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as GitTrackerData;
    expect(data.gitState).toEqual(mockState);
  });

  test('Write tool triggers getGitState call', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Write',
        tool_input: {},
      },
      'PreToolUse'
    );

    await handler.handler(ctx);

    expect(mockGetGitState).toHaveBeenCalled();
  });
});

// ============================================================================
// PreToolUse - Bash Tool Tests
// ============================================================================

describe('Git Tracker - PreToolUse Bash', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('captures git state for Bash tool', async () => {
    const mockState = createMockGitState({
      hash: 'bash789',
      branch: 'main',
      isDirty: false,
    });
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Bash',
        tool_input: { command: 'npm install' },
      },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    const data = result.data as GitTrackerData;
    expect(data.gitState).toEqual(mockState);
  });

  test('Bash tool triggers getGitState call', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Bash',
        tool_input: {},
      },
      'PreToolUse'
    );

    await handler.handler(ctx);

    expect(mockGetGitState).toHaveBeenCalled();
  });
});

// ============================================================================
// PreToolUse - Read Tool Tests (Should NOT capture)
// ============================================================================

describe('Git Tracker - PreToolUse Read (skipped)', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('does NOT capture git state for Read tool', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Read',
        tool_input: { file_path: '/path/to/file.ts' },
      },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    // Read tool should NOT return git state data
    expect(result.data).toBeUndefined();
  });

  test('Read tool does NOT trigger getGitState call', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Read',
        tool_input: {},
      },
      'PreToolUse'
    );

    await handler.handler(ctx);

    expect(mockGetGitState).not.toHaveBeenCalled();
  });

  test('other read-only tools do NOT capture git state', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();

    for (const toolName of ['Glob', 'Grep', 'WebSearch', 'WebFetch']) {
      mockGetGitState.mockClear();

      const ctx = createMockContext(
        {
          session_id: 'session-123',
          tool_name: toolName,
          tool_input: {},
        },
        'PreToolUse'
      );

      const result = await handler.handler(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toBeUndefined();
      expect(mockGetGitState).not.toHaveBeenCalled();
    }
  });
});

// ============================================================================
// Non-Git Directory Tests
// ============================================================================

describe('Git Tracker - Non-git directory', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('returns isRepo: false for non-git directory on SessionStart', async () => {
    const nonRepoState: GitState = {
      hash: '',
      branch: '',
      isDirty: false,
      isRepo: false,
    };
    mockGetGitState.mockReturnValue(nonRepoState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SessionStart'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    const data = result.data as GitTrackerData;
    expect(data.gitState.isRepo).toBe(false);
    expect(data.gitState.hash).toBe('');
    expect(data.gitState.branch).toBe('');
    expect(data.gitState.isDirty).toBe(false);
  });

  test('returns isRepo: false for non-git directory on PreToolUse', async () => {
    const nonRepoState: GitState = {
      hash: '',
      branch: '',
      isDirty: false,
      isRepo: false,
    };
    mockGetGitState.mockReturnValue(nonRepoState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Edit',
        tool_input: {},
      },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    const data = result.data as GitTrackerData;
    expect(data.gitState.isRepo).toBe(false);
  });
});

// ============================================================================
// Handler Configuration Tests
// ============================================================================

describe('Git Tracker - Handler Configuration', () => {
  test('handler has correct default properties', () => {
    const handler = createGitTrackerHandler();

    expect(handler.id).toBe('git-tracker');
    expect(handler.name).toBe('Git Tracker');
    expect(handler.priority).toBe(6); // After turn-tracker (5)
  });

  test('default tracked tools include Edit, Write, Bash', () => {
    expect(DEFAULT_TRACKED_TOOLS).toContain('Edit');
    expect(DEFAULT_TRACKED_TOOLS).toContain('Write');
    expect(DEFAULT_TRACKED_TOOLS).toContain('Bash');
  });

  test('default tracked tools do NOT include Read', () => {
    expect(DEFAULT_TRACKED_TOOLS).not.toContain('Read');
  });

  test('custom tracked tools can be specified', async () => {
    const mockGetGitState = spyOn(gitUtils, 'getGitState');
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    // Create handler that ONLY tracks CustomTool
    const handler = createGitTrackerHandler({
      trackOnTools: ['CustomTool'],
    });

    // Edit should NOT be tracked with custom config
    const editCtx = createMockContext(
      { session_id: 'session-123', tool_name: 'Edit', tool_input: {} },
      'PreToolUse'
    );
    const editResult = await handler.handler(editCtx);
    expect(editResult.data).toBeUndefined();

    // CustomTool SHOULD be tracked
    mockGetGitState.mockClear();
    const customCtx = createMockContext(
      { session_id: 'session-123', tool_name: 'CustomTool', tool_input: {} },
      'PreToolUse'
    );
    const customResult = await handler.handler(customCtx);
    expect(customResult.data).toBeDefined();
    expect(mockGetGitState).toHaveBeenCalled();

    mockGetGitState.mockRestore();
  });
});

// ============================================================================
// Handler Meta Tests
// ============================================================================

describe('Git Tracker - Handler Meta', () => {
  test('meta has correct id and name', () => {
    expect(gitTrackerMeta.id).toBe('git-tracker');
    expect(gitTrackerMeta.name).toBe('Git Tracker');
  });

  test('meta has description', () => {
    expect(gitTrackerMeta.description).toBeDefined();
    expect(gitTrackerMeta.description.length).toBeGreaterThan(0);
  });

  test('meta default events include SessionStart and PreToolUse', () => {
    expect(gitTrackerMeta.defaultEvents).toContain('SessionStart');
    expect(gitTrackerMeta.defaultEvents).toContain('PreToolUse');
  });

  test('meta default priority is 6', () => {
    expect(gitTrackerMeta.defaultPriority).toBe(6);
  });

  test('meta has options schema for track_on_tools', () => {
    expect(gitTrackerMeta.optionsSchema).toBeDefined();
    expect(gitTrackerMeta.optionsSchema.track_on_tools).toBeDefined();
    expect(gitTrackerMeta.optionsSchema.track_on_tools.type).toBe('array');
  });
});

// ============================================================================
// Handler Factory Tests
// ============================================================================

describe('Git Tracker - Handler Factory', () => {
  test('factory creates handler with default options', () => {
    const handler = gitTrackerFactory();

    expect(handler.id).toBe('git-tracker');
    expect(handler.name).toBe('Git Tracker');
  });

  test('factory accepts track_on_tools option', async () => {
    const mockGetGitState = spyOn(gitUtils, 'getGitState');
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = gitTrackerFactory({
      track_on_tools: ['MyTool'],
    });

    // Default Edit should NOT be tracked
    const editCtx = createMockContext(
      { session_id: 'session-123', tool_name: 'Edit', tool_input: {} },
      'PreToolUse'
    );
    const editResult = await handler.handler(editCtx);
    expect(editResult.data).toBeUndefined();

    // MyTool SHOULD be tracked
    const myCtx = createMockContext(
      { session_id: 'session-123', tool_name: 'MyTool', tool_input: {} },
      'PreToolUse'
    );
    const myResult = await handler.handler(myCtx);
    expect(myResult.data).toBeDefined();

    mockGetGitState.mockRestore();
  });
});

// ============================================================================
// Event Type Tests
// ============================================================================

describe('Git Tracker - Other Event Types', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('returns empty result for unknown event type', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SomeUnknownEvent'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(mockGetGitState).not.toHaveBeenCalled();
  });

  test('returns empty result for PostToolUse event', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      {
        session_id: 'session-123',
        tool_name: 'Edit',
        tool_input: {},
      },
      'PostToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(mockGetGitState).not.toHaveBeenCalled();
  });

  test('returns empty result for Stop event', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'Stop'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
    expect(mockGetGitState).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Git Tracker - Edge Cases', () => {
  let mockGetGitState: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockGetGitState = spyOn(gitUtils, 'getGitState');
  });

  afterEach(() => {
    mockGetGitState.mockRestore();
  });

  test('handles missing tool_name in PreToolUse', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    // With no tool_name, it shouldn't match any tracked tools
    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  test('handles detached HEAD state in git response', async () => {
    const detachedState: GitState = {
      hash: 'abc1234',
      branch: 'HEAD',
      isDirty: false,
      isRepo: true,
    };
    mockGetGitState.mockReturnValue(detachedState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123' },
      'SessionStart'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    const data = result.data as GitTrackerData;
    expect(data.gitState.branch).toBe('HEAD');
    expect(data.gitState.isRepo).toBe(true);
  });

  test('handles dirty state with uncommitted changes', async () => {
    const dirtyState: GitState = {
      hash: 'abc1234',
      branch: 'feature/wip',
      isDirty: true,
      isRepo: true,
    };
    mockGetGitState.mockReturnValue(dirtyState);

    const handler = createGitTrackerHandler();
    const ctx = createMockContext(
      { session_id: 'session-123', tool_name: 'Edit', tool_input: {} },
      'PreToolUse'
    );

    const result = await handler.handler(ctx);

    expect(result.success).toBe(true);
    const data = result.data as GitTrackerData;
    expect(data.gitState.isDirty).toBe(true);
  });

  test('uses process.cwd when cwd is missing from context', async () => {
    const mockState = createMockGitState();
    mockGetGitState.mockReturnValue(mockState);

    const handler = createGitTrackerHandler();
    const ctx: PipelineContext = {
      event: { session_id: 'session-123' } as HookEvent,
      eventType: 'SessionStart',
      state: {},
      results: new Map(),
      startedAt: new Date(),
      sessionId: 'session-123',
      cwd: '', // Empty cwd
    };

    await handler.handler(ctx);

    // Should fall back to process.cwd()
    expect(mockGetGitState).toHaveBeenCalledWith(process.cwd());
  });
});
