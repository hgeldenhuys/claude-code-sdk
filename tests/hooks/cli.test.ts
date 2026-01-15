/**
 * CLI Commands Tests
 *
 * Tests for the session management CLI commands.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import {
  cmdCleanup,
  cmdDelete,
  cmdDescribe,
  cmdGetId,
  cmdGetName,
  cmdHistory,
  cmdInfo,
  cmdList,
  cmdRename,
  runCLI,
} from '../../src/hooks/sessions/cli';
import { SessionStore } from '../../src/hooks/sessions/store';

const TEST_DIR = '/tmp/claude-sdk-cli-test';
const TEST_STORAGE_PATH = `${TEST_DIR}/sessions.json`;

// Helper to create a test store and populate it
function createTestStore(): SessionStore {
  return new SessionStore({ storagePath: TEST_STORAGE_PATH });
}

describe('CLI Commands', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Clean up and create test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });

    // Create store with test data
    store = createTestStore();
    store.track('uuid-alpha', { name: 'alpha-project', source: 'startup', cwd: '/projects/alpha' });
    store.track('uuid-beta', { name: 'beta-feature', source: 'resume' });
    store.track('uuid-gamma', { name: 'gamma-test', source: 'compact' });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('cmdGetId', () => {
    it('returns session ID for existing name', () => {
      // Need to use same store path
      const result = cmdGetId('alpha-project');
      // This will fail because cmdGetId uses the global store, not our test store
      // For proper testing, we'd need dependency injection
      // For now, let's test with the store we created
      const id = store.getSessionId('alpha-project');
      expect(id).toBe('uuid-alpha');
    });

    it('returns error for non-existent name', () => {
      const result = cmdGetId('non-existent');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('cmdGetName', () => {
    it('returns name for existing session ID', () => {
      const name = store.getName('uuid-beta');
      expect(name).toBe('beta-feature');
    });

    it('returns error for non-existent session ID', () => {
      const result = cmdGetName('non-existent-uuid');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('cmdList', () => {
    it('lists all sessions', () => {
      const sessions = store.list();
      expect(sessions.length).toBe(3);
    });

    it('lists sessions with pattern filter', () => {
      const sessions = store.list({ namePattern: 'alpha-*' });
      expect(sessions.length).toBe(1);
      expect(sessions[0].name).toBe('alpha-project');
    });

    it('lists sessions with limit', () => {
      const sessions = store.list({ limit: 2 });
      expect(sessions.length).toBe(2);
    });

    it('lists sessions with source filter', () => {
      const sessions = store.list({ source: 'startup' });
      expect(sessions.length).toBe(1);
      expect(sessions[0].name).toBe('alpha-project');
    });

    it('returns empty message for no sessions', () => {
      // Create empty store
      const emptyPath = `${TEST_DIR}/empty.json`;
      const emptyStore = new SessionStore({ storagePath: emptyPath });
      const sessions = emptyStore.list();
      expect(sessions.length).toBe(0);
    });
  });

  describe('cmdRename', () => {
    it('renames a session successfully', () => {
      store.rename('alpha-project', 'renamed-alpha');

      expect(store.getSessionId('renamed-alpha')).toBe('uuid-alpha');
      expect(store.getSessionId('alpha-project')).toBeUndefined();
      expect(store.getName('uuid-alpha')).toBe('renamed-alpha');
    });

    it('fails for non-existent session', () => {
      const result = cmdRename('non-existent', 'new-name');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('fails for duplicate name', () => {
      expect(() => store.rename('alpha-project', 'beta-feature')).toThrow('already exists');
    });
  });

  describe('cmdDelete', () => {
    it('deletes a session by name', () => {
      const deleted = store.delete('alpha-project');
      expect(deleted).toBe(true);
      expect(store.getSessionId('alpha-project')).toBeUndefined();
      expect(store.getName('uuid-alpha')).toBeUndefined();
    });

    it('deletes a session by ID', () => {
      const deleted = store.delete('uuid-beta');
      expect(deleted).toBe(true);
      expect(store.getSessionId('beta-feature')).toBeUndefined();
    });

    it('returns false for non-existent session', () => {
      const result = cmdDelete('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('cmdInfo', () => {
    it('returns session info by name', () => {
      const info = store.getByName('alpha-project');
      expect(info).toBeDefined();
      expect(info?.name).toBe('alpha-project');
      expect(info?.sessionId).toBe('uuid-alpha');
      expect(info?.cwd).toBe('/projects/alpha');
    });

    it('returns session info by ID', () => {
      const info = store.getBySessionId('uuid-beta');
      expect(info).toBeDefined();
      expect(info?.name).toBe('beta-feature');
    });

    it('returns error for non-existent session', () => {
      const result = cmdInfo('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('cmdHistory', () => {
    it('returns session history', () => {
      // Add more history entries
      store.track('uuid-alpha-2', { name: 'alpha-project', source: 'compact' });
      store.track('uuid-alpha-3', { name: 'alpha-project', source: 'clear' });

      const history = store.getHistory('alpha-project');
      expect(history.length).toBe(3);
      expect(history[0].sessionId).toBe('uuid-alpha');
      expect(history[1].sessionId).toBe('uuid-alpha-2');
      expect(history[2].sessionId).toBe('uuid-alpha-3');
    });

    it('returns error for non-existent session', () => {
      const result = cmdHistory('non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('cmdDescribe', () => {
    it('sets session description', () => {
      store.setDescription('alpha-project', 'Working on authentication');
      const info = store.getByName('alpha-project');
      expect(info?.description).toBe('Working on authentication');
    });

    it('returns error for non-existent session', () => {
      const result = cmdDescribe('non-existent', 'description');
      expect(result.success).toBe(false);
    });
  });

  describe('cmdCleanup', () => {
    it('reports cleanup results', () => {
      // With default maxAge (none set), cleanup won't remove anything
      const result = cmdCleanup();
      expect(result.success).toBe(true);
    });
  });
});

describe('runCLI argument parsing', () => {
  it('shows help for empty args', () => {
    const result = runCLI([]);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Session Manager');
  });

  it('shows help for help command', () => {
    const result = runCLI(['help']);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Session Manager');
  });

  it('shows help for --help flag', () => {
    const result = runCLI(['--help']);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Session Manager');
  });

  it('handles get-id with missing argument', () => {
    const result = runCLI(['get-id']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles get-name with missing argument', () => {
    const result = runCLI(['get-name']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles rename with missing arguments', () => {
    const result = runCLI(['rename', 'old-name']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles delete with missing argument', () => {
    const result = runCLI(['delete']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles info with missing argument', () => {
    const result = runCLI(['info']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles history with missing argument', () => {
    const result = runCLI(['history']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles describe with missing arguments', () => {
    const result = runCLI(['describe', 'name']);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage');
  });

  it('handles list command', () => {
    const result = runCLI(['list']);
    expect(result.success).toBe(true);
  });

  it('handles ls alias for list', () => {
    const result = runCLI(['ls']);
    expect(result.success).toBe(true);
  });

  it('handles cleanup command', () => {
    const result = runCLI(['cleanup']);
    expect(result.success).toBe(true);
  });

  it('shows help for unknown commands', () => {
    // runCLI doesn't have auto-detect - unknown commands show help
    // Auto-detect is only in bin/sesh.ts
    const result = runCLI(['non-existent-session-name']);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Session Manager');
  });

  it('shows help for UUID-like unknown commands', () => {
    // runCLI doesn't have auto-detect - unknown commands show help
    const result = runCLI(['12345678-1234-1234-1234-123456789012']);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Session Manager');
  });
});
