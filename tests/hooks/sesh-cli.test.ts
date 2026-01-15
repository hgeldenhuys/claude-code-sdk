/**
 * Sesh CLI Integration Tests
 *
 * Tests the sesh CLI binary as an end-to-end integration test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'bun';

const TEST_DIR = '/tmp/claude-sdk-sesh-test';
const SESH_PATH = join(import.meta.dir, '../../bin/sesh.ts');

// Helper to run sesh CLI and get output
async function runSesh(
  args: string[],
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = spawn(['bun', SESH_PATH, ...args], {
    cwd: TEST_DIR,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

// Helper to create test session data
function createTestSessions() {
  const sessionsPath = join(TEST_DIR, '.claude/sessions.json');
  const data = {
    version: '2.0',
    names: {
      'test-project': {
        name: 'test-project',
        currentSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        history: [
          {
            sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
            timestamp: '2024-01-14T10:00:00.000Z',
            source: 'startup',
          },
        ],
        created: '2024-01-14T10:00:00.000Z',
        lastAccessed: '2024-01-14T12:00:00.000Z',
        manual: true,
        cwd: TEST_DIR,
      },
      'another-session': {
        name: 'another-session',
        currentSessionId: '11111111-2222-3333-4444-555555555555',
        history: [
          {
            sessionId: '11111111-2222-3333-4444-555555555555',
            timestamp: '2024-01-14T11:00:00.000Z',
            source: 'resume',
          },
        ],
        created: '2024-01-14T11:00:00.000Z',
        lastAccessed: '2024-01-14T11:30:00.000Z',
        manual: false,
      },
    },
    sessionIndex: {
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee': 'test-project',
      '11111111-2222-3333-4444-555555555555': 'another-session',
    },
  };

  mkdirSync(join(TEST_DIR, '.claude'), { recursive: true });
  writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
}

describe('sesh CLI', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    createTestSessions();
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('help', () => {
    it('shows help with no args', async () => {
      const { stdout, exitCode } = await runSesh([]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('sesh');
      expect(stdout).toContain('Session Name Manager');
    });

    it('shows help with help command', async () => {
      const { stdout, exitCode } = await runSesh(['help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage');
    });

    it('shows help with --help flag', async () => {
      const { stdout, exitCode } = await runSesh(['--help']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Usage');
    });
  });

  describe('version', () => {
    it('shows version', async () => {
      const { stdout, exitCode } = await runSesh(['version']);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/sesh v\d+\.\d+\.\d+/);
    });

    it('shows version with --version flag', async () => {
      const { stdout, exitCode } = await runSesh(['--version']);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/sesh v\d+\.\d+\.\d+/);
    });
  });

  describe('auto-detect conversion', () => {
    it('converts name to session ID', async () => {
      const { stdout, exitCode } = await runSesh(['test-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('converts session ID to name', async () => {
      const { stdout, exitCode } = await runSesh(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('test-project');
    });

    it('returns error for non-existent name', async () => {
      const { stdout, stderr, exitCode } = await runSesh(['non-existent']);
      expect(exitCode).toBe(1);
      // Error goes to stderr
      expect(stderr).toContain('not found');
    });

    it('returns error for non-existent UUID', async () => {
      const { stdout, stderr, exitCode } = await runSesh(['00000000-0000-0000-0000-000000000000']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('explicit commands', () => {
    it('id command returns session ID', async () => {
      const { stdout, exitCode } = await runSesh(['id', 'test-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('name command returns name', async () => {
      const { stdout, exitCode } = await runSesh(['name', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
      expect(exitCode).toBe(0);
      expect(stdout).toBe('test-project');
    });
  });

  describe('list command', () => {
    it('lists all sessions', async () => {
      const { stdout, exitCode } = await runSesh(['list']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-project');
      expect(stdout).toContain('another-session');
    });

    it('lists sessions as JSON', async () => {
      const { stdout, exitCode } = await runSesh(['list', '--json']);
      expect(exitCode).toBe(0);
      const sessions = JSON.parse(stdout);
      expect(Array.isArray(sessions)).toBe(true);
      expect(sessions.length).toBe(2);
    });

    it('lists session names only', async () => {
      const { stdout, exitCode } = await runSesh(['list', '--names']);
      expect(exitCode).toBe(0);
      const names = stdout.split('\n');
      expect(names).toContain('test-project');
      expect(names).toContain('another-session');
    });

    it('lists session IDs only', async () => {
      const { stdout, exitCode } = await runSesh(['list', '--ids']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(stdout).toContain('11111111-2222-3333-4444-555555555555');
    });

    it('limits results', async () => {
      const { stdout, exitCode } = await runSesh(['list', '--limit', '1', '--names']);
      expect(exitCode).toBe(0);
      const names = stdout.split('\n').filter(Boolean);
      expect(names.length).toBe(1);
    });

    it('filters by pattern', async () => {
      const { stdout, exitCode } = await runSesh(['list', '--pattern', 'test-*', '--names']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-project');
      expect(stdout).not.toContain('another-session');
    });

    it('ls is alias for list', async () => {
      const { stdout, exitCode } = await runSesh(['ls']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-project');
    });
  });

  describe('info command', () => {
    it('shows session info by name', async () => {
      const { stdout, exitCode } = await runSesh(['info', 'test-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-project');
      expect(stdout).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      expect(stdout).toContain('Manual:');
    });

    it('shows session info by ID', async () => {
      const { stdout, exitCode } = await runSesh(['info', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('test-project');
    });

    it('returns error for non-existent session', async () => {
      const { stderr, exitCode } = await runSesh(['info', 'non-existent']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('rename command', () => {
    it('renames a session', async () => {
      const { stdout, exitCode } = await runSesh(['rename', 'test-project', 'renamed-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Renamed');

      // Verify rename worked - should error now
      const { stderr: err, exitCode: code } = await runSesh(['test-project']);
      expect(code).toBe(1);
      expect(err).toContain('not found');

      const { stdout: id } = await runSesh(['renamed-project']);
      expect(id).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('mv is alias for rename', async () => {
      const { stdout, exitCode } = await runSesh(['mv', 'test-project', 'moved-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Renamed');
    });

    it('returns error for non-existent session', async () => {
      const { stderr, exitCode } = await runSesh(['rename', 'non-existent', 'new-name']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('delete command', () => {
    it('deletes a session', async () => {
      const { stdout, exitCode } = await runSesh(['delete', 'another-session']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Deleted');

      // Verify deletion - should error now
      const { stderr: err, exitCode: code } = await runSesh(['another-session']);
      expect(code).toBe(1);
      expect(err).toContain('not found');
    });

    it('rm is alias for delete', async () => {
      const { stdout, exitCode } = await runSesh(['rm', 'another-session']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Deleted');
    });

    it('returns error for non-existent session', async () => {
      const { stderr, exitCode } = await runSesh(['delete', 'non-existent']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('history command', () => {
    it('shows session history', async () => {
      const { stdout, exitCode } = await runSesh(['history', 'test-project']);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('History');
      expect(stdout).toContain('aaaaaaaa');
      expect(stdout).toContain('startup');
    });

    it('returns error for non-existent session', async () => {
      const { stderr, exitCode } = await runSesh(['history', 'non-existent']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('no history');
    });
  });

  describe('describe command', () => {
    it('sets session description', async () => {
      const { stdout, exitCode } = await runSesh([
        'describe',
        'test-project',
        'Working on authentication',
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Description set');

      // Verify description was set
      const { stdout: info } = await runSesh(['info', 'test-project']);
      expect(info).toContain('Working on authentication');
    });

    it('handles multi-word descriptions', async () => {
      const { stdout, exitCode } = await runSesh([
        'describe',
        'test-project',
        'This',
        'is',
        'a',
        'long',
        'description',
      ]);
      expect(exitCode).toBe(0);

      const { stdout: info } = await runSesh(['info', 'test-project']);
      expect(info).toContain('This is a long description');
    });

    it('returns error for non-existent session', async () => {
      const { stderr, exitCode } = await runSesh(['describe', 'non-existent', 'description']);
      expect(exitCode).toBe(1);
      expect(stderr).toContain('not found');
    });
  });

  describe('cleanup command', () => {
    it('runs cleanup', async () => {
      const { stdout, exitCode } = await runSesh(['cleanup']);
      expect(exitCode).toBe(0);
      // Should report "No sessions to clean up"
      expect(stdout).toContain('clean');
    });

    it('accepts hours argument', async () => {
      const { exitCode } = await runSesh(['cleanup', '24']);
      expect(exitCode).toBe(0);
    });
  });
});
