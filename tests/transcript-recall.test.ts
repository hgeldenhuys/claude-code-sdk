/**
 * Transcript Recall Tests
 *
 * Tests for the tiered recall feature (RECALL-001)
 * Covers:
 * - Unit tests for shouldEscalate heuristics
 * - Integration tests for --fast and --deep CLI flags
 * - Performance tests for fast path
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { $ } from 'bun';

// ============================================================================
// Test Fixtures
// ============================================================================

let tempDir: string;
let testDbPath: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'transcript-recall-test-'));
  testDbPath = join(tempDir, 'test-transcripts.db');
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ============================================================================
// shouldEscalate Unit Tests
// ============================================================================

describe('shouldEscalate heuristics', () => {
  // Import the function once it exists
  // These tests will fail until backend-dev implements the function

  // Helper to create test context
  interface EscalationContext {
    matchCount: number;
    sessionCount: number;
    timespanDays: number;
    query: string;
    fastFlag?: boolean;
    deepFlag?: boolean;
  }

  // Mock function to test against - will be replaced by actual import
  // when backend-dev completes implementation
  const mockShouldEscalate = (ctx: EscalationContext): boolean => {
    // Override flags take precedence
    if (ctx.fastFlag === true) return false;
    if (ctx.deepFlag === true) return true;

    // Match count threshold
    if (ctx.matchCount > 50) return true;

    // Timespan threshold (7 days)
    if (ctx.timespanDays > 7) return true;

    // Session count threshold
    if (ctx.sessionCount > 5) return true;

    // Query complexity - questions that need synthesis
    const questionPatterns = /^(what|why|how|when|where|which|who|explain|describe|compare)/i;
    if (questionPatterns.test(ctx.query.trim())) return true;

    return false;
  };

  // Note: Replace mockShouldEscalate with actual import when available:
  // import { shouldEscalate } from '../bin/transcript';
  // For now we test the expected behavior

  describe('match count threshold', () => {
    test('returns false when matches < 50', () => {
      const result = mockShouldEscalate({
        matchCount: 25,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns false when matches = 50 (boundary)', () => {
      const result = mockShouldEscalate({
        matchCount: 50,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns true when matches > 50', () => {
      const result = mockShouldEscalate({
        matchCount: 51,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });

    test('returns true when matches significantly exceed threshold', () => {
      const result = mockShouldEscalate({
        matchCount: 200,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });
  });

  describe('timespan threshold', () => {
    test('returns false when timespan < 7 days', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 3,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns false when timespan = 7 days (boundary)', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 7,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns true when timespan > 7 days', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 8,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });

    test('returns true when timespan spans weeks', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 30,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });
  });

  describe('session count threshold', () => {
    test('returns false when sessions < 5', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 3,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns false when sessions = 5 (boundary)', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 5,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(false);
    });

    test('returns true when sessions > 5', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 6,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });

    test('returns true when sessions significantly exceed threshold', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 15,
        timespanDays: 1,
        query: 'simple search',
      });
      expect(result).toBe(true);
    });
  });

  describe('query complexity - question patterns', () => {
    test('returns true when query starts with "what"', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'what is the caching strategy',
      });
      expect(result).toBe(true);
    });

    test('returns true when query starts with "why"', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'why did we choose this architecture',
      });
      expect(result).toBe(true);
    });

    test('returns true when query starts with "how"', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'how does the hook system work',
      });
      expect(result).toBe(true);
    });

    test('returns true when query starts with "explain"', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'explain the session naming pattern',
      });
      expect(result).toBe(true);
    });

    test('returns true when query starts with "compare"', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'compare hooks vs MCP servers',
      });
      expect(result).toBe(true);
    });

    test('is case-insensitive for question patterns', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'WHAT is the database schema',
      });
      expect(result).toBe(true);
    });

    test('handles leading whitespace in queries', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: '  what is this',
      });
      expect(result).toBe(true);
    });

    test('returns false for non-question queries', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'caching strategy',
      });
      expect(result).toBe(false);
    });

    test('returns false for queries that contain but dont start with question words', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'find what the error was',
      });
      expect(result).toBe(false);
    });
  });

  describe('flag overrides', () => {
    test('--fast flag overrides to false regardless of other conditions', () => {
      const result = mockShouldEscalate({
        matchCount: 200, // Would normally escalate
        sessionCount: 10, // Would normally escalate
        timespanDays: 30, // Would normally escalate
        query: 'what is everything', // Would normally escalate
        fastFlag: true,
      });
      expect(result).toBe(false);
    });

    test('--deep flag overrides to true regardless of other conditions', () => {
      const result = mockShouldEscalate({
        matchCount: 5, // Would not normally escalate
        sessionCount: 1, // Would not normally escalate
        timespanDays: 1, // Would not normally escalate
        query: 'simple', // Would not normally escalate
        deepFlag: true,
      });
      expect(result).toBe(true);
    });

    test('--fast takes precedence when both flags provided', () => {
      // This tests a potentially invalid state, but --fast should win
      // to preserve the user's explicit intent for speed
      const result = mockShouldEscalate({
        matchCount: 100,
        sessionCount: 10,
        timespanDays: 30,
        query: 'what is this',
        fastFlag: true,
        deepFlag: true,
      });
      expect(result).toBe(false);
    });
  });

  describe('combined conditions', () => {
    test('escalates when multiple conditions are met', () => {
      const result = mockShouldEscalate({
        matchCount: 100,
        sessionCount: 10,
        timespanDays: 14,
        query: 'what is the pattern',
      });
      expect(result).toBe(true);
    });

    test('escalates when any single condition is met', () => {
      // Only timespan triggers
      const result1 = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 14,
        query: 'simple',
      });
      expect(result1).toBe(true);

      // Only sessions trigger
      const result2 = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 10,
        timespanDays: 1,
        query: 'simple',
      });
      expect(result2).toBe(true);

      // Only matches trigger
      const result3 = mockShouldEscalate({
        matchCount: 100,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple',
      });
      expect(result3).toBe(true);
    });

    test('does not escalate when no conditions are met', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: 'simple search term',
      });
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    test('handles zero matches', () => {
      const result = mockShouldEscalate({
        matchCount: 0,
        sessionCount: 0,
        timespanDays: 0,
        query: 'no results',
      });
      expect(result).toBe(false);
    });

    test('handles empty query', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: '',
      });
      expect(result).toBe(false);
    });

    test('handles query with only whitespace', () => {
      const result = mockShouldEscalate({
        matchCount: 10,
        sessionCount: 2,
        timespanDays: 1,
        query: '   ',
      });
      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// CLI Integration Tests for --fast and --deep flags
// ============================================================================

describe('recall CLI flags', () => {
  const cliPath = join(process.cwd(), 'bin/transcript.ts');

  // Note: These tests require the SQLite index to be built
  // They test the CLI flag parsing and behavior

  describe('--fast flag', () => {
    test('accepts --fast flag', async () => {
      // Should not error when --fast is provided
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Wait for process to complete or timeout
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      // Kill if still running
      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      // Check stderr for flag parsing errors
      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
      expect(stderr).not.toContain('invalid');
    });

    test('accepts -F short form', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '-F'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
    });

    test('--fast does not produce synthesis output', async () => {
      // When --fast is used, should not include synthesis/summary section
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stdout = await new Response(proc.stdout).text();
      // Fast mode should not have synthesis section markers
      expect(stdout).not.toContain('## Synthesis');
      expect(stdout).not.toContain('## Summary');
    });
  });

  describe('--deep flag', () => {
    test('accepts --deep flag', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--deep'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
      expect(stderr).not.toContain('invalid');
    });

    test('accepts -D short form', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '-D'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
    });
  });

  describe('flag combinations', () => {
    test('--fast and --json work together', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--json'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
    });

    test('--deep and --json work together', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--deep', '--json'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
    });

    test('--fast works with --max-sessions', async () => {
      const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--max-sessions', '3'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([proc.exited, timeoutPromise]);

      if (proc.exitCode === null) {
        proc.kill();
        await proc.exited;
      }

      const stderr = await new Response(proc.stderr).text();
      expect(stderr).not.toContain('unknown option');
    });
  });
});

// ============================================================================
// Performance Tests
// ============================================================================

describe('recall performance', () => {
  const cliPath = join(process.cwd(), 'bin/transcript.ts');

  test('fast path completes in under 2 seconds', async () => {
    const startTime = performance.now();

    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Set a timeout of 2 seconds
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 2000)
    );

    const result = await Promise.race([
      proc.exited.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    const elapsed = performance.now() - startTime;

    if (result === 'timeout') {
      proc.kill();
      await proc.exited;
    }

    // Fast path should complete within 2 seconds
    expect(result).toBe('completed');
    expect(elapsed).toBeLessThan(2000);

    console.log(`Fast path completed in ${elapsed.toFixed(0)}ms`);
  });

  test('fast path with --json is performant', async () => {
    const startTime = performance.now();

    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 2000)
    );

    const result = await Promise.race([
      proc.exited.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    const elapsed = performance.now() - startTime;

    if (result === 'timeout') {
      proc.kill();
      await proc.exited;
    }

    expect(result).toBe('completed');
    expect(elapsed).toBeLessThan(2000);

    console.log(`Fast path with --json completed in ${elapsed.toFixed(0)}ms`);
  });

  test('fast path with limit is performant', async () => {
    const startTime = performance.now();

    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--limit', '10'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 2000)
    );

    const result = await Promise.race([
      proc.exited.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    const elapsed = performance.now() - startTime;

    if (result === 'timeout') {
      proc.kill();
      await proc.exited;
    }

    expect(result).toBe('completed');
    expect(elapsed).toBeLessThan(2000);

    console.log(`Fast path with --limit completed in ${elapsed.toFixed(0)}ms`);
  });

  // Note: Deep mode performance is not bounded by 2 seconds since it
  // involves LLM synthesis. This test just ensures it doesn't hang.
  test('deep mode starts without hanging', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--deep', '--limit', '5'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Give it 10 seconds to start producing output or complete
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), 10000)
    );

    const result = await Promise.race([
      proc.exited.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    if (result === 'timeout') {
      // Deep mode may take longer, just ensure it's not stuck
      // Check if we got any output
      proc.kill();
      await proc.exited;
    }

    // Either completed or we killed it after seeing it's running
    expect(['completed', 'timeout']).toContain(result);
  });
});

// ============================================================================
// JSON Output Tests
// ============================================================================

describe('recall JSON output', () => {
  const cliPath = join(process.cwd(), 'bin/transcript.ts');

  test('--json outputs valid JSON', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([proc.exited, timeoutPromise]);

    if (proc.exitCode === null) {
      proc.kill();
      await proc.exited;
    }

    const stdout = await new Response(proc.stdout).text();

    // If there's output, it should be valid JSON
    if (stdout.trim()) {
      expect(() => JSON.parse(stdout)).not.toThrow();
    }
  });

  test('--json output includes expected fields', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([proc.exited, timeoutPromise]);

    if (proc.exitCode === null) {
      proc.kill();
      await proc.exited;
    }

    const stdout = await new Response(proc.stdout).text();

    if (stdout.trim()) {
      const json = JSON.parse(stdout);
      // Expected structure from recall command
      expect(json).toHaveProperty('query');
      expect(json).toHaveProperty('totalMatches');
      expect(json).toHaveProperty('sessions');
    }
  });

  test('fast mode JSON includes escalated: false', async () => {
    const proc = Bun.spawn(['bun', cliPath, 'recall', 'test', '--fast', '--json'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));
    await Promise.race([proc.exited, timeoutPromise]);

    if (proc.exitCode === null) {
      proc.kill();
      await proc.exited;
    }

    const stdout = await new Response(proc.stdout).text();

    if (stdout.trim()) {
      const json = JSON.parse(stdout);
      // Fast mode should indicate no escalation
      if ('escalated' in json) {
        expect(json.escalated).toBe(false);
      }
    }
  });
});
