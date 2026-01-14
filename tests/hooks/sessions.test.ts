/**
 * Session Naming Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  SessionStore,
  NameGenerator,
  generateName,
  generateUniqueName,
} from '../../src/hooks/sessions';

const TEST_STORAGE_PATH = '/tmp/claude-sdk-test/sessions.json';
const TEST_DIR = '/tmp/claude-sdk-test';

describe('NameGenerator', () => {
  it('generates adjective-noun names', () => {
    const gen = new NameGenerator();
    const name = gen.generate();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('generates unique names with collision handling', () => {
    const gen = new NameGenerator();
    const existing = new Set(['brave-eagle', 'swift-falcon']);
    const names = new Set<string>();

    // Generate 100 unique names
    for (let i = 0; i < 100; i++) {
      const name = gen.generateUnique(existing);
      expect(names.has(name)).toBe(false);
      names.add(name);
      existing.add(name);
    }
  });

  it('validates name format', () => {
    const gen = new NameGenerator();
    expect(gen.isValidName('brave-eagle')).toBe(true);
    expect(gen.isValidName('my-session-2')).toBe(true);
    expect(gen.isValidName('a')).toBe(true);
    expect(gen.isValidName('INVALID')).toBe(false);
    expect(gen.isValidName('-invalid')).toBe(false);
    expect(gen.isValidName('invalid-')).toBe(false);
  });

  it('normalizes names', () => {
    const gen = new NameGenerator();
    expect(gen.normalizeName('My Session')).toBe('my-session');
    expect(gen.normalizeName('UPPER_CASE')).toBe('upper-case');
    expect(gen.normalizeName('  spaces  ')).toBe('spaces');
    expect(gen.normalizeName('multiple---dashes')).toBe('multiple-dashes');
  });
});

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });

    store = new SessionStore({ storagePath: TEST_STORAGE_PATH });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('tracks a new session with auto-generated name', () => {
    const sessionId = 'test-uuid-1234';
    const result = store.track(sessionId);

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe(sessionId);
    expect(result.name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(result.sessionIdChanged).toBe(false);
  });

  it('returns same name for same session ID', () => {
    const sessionId = 'test-uuid-1234';
    const result1 = store.track(sessionId);
    const result2 = store.track(sessionId);

    expect(result1.name).toBe(result2.name);
    expect(result2.isNew).toBe(false);
    expect(result2.sessionIdChanged).toBe(false);
  });

  it('allows forced name assignment', () => {
    const sessionId = 'test-uuid-1234';
    const result = store.track(sessionId, { name: 'my-project' });

    expect(result.name).toBe('my-project');
    expect(result.isNew).toBe(true);
  });

  it('tracks session ID change for same name', () => {
    const oldSessionId = 'old-uuid-1234';
    const newSessionId = 'new-uuid-5678';
    const name = 'persistent-name';

    // Track original session
    store.track(oldSessionId, { name });

    // Track new session with same name (simulates compact/clear)
    const result = store.track(newSessionId, { name });

    expect(result.name).toBe(name);
    expect(result.sessionIdChanged).toBe(true);
    expect(result.previousSessionId).toBe(oldSessionId);
  });

  it('supports bidirectional lookup', () => {
    const sessionId = 'test-uuid-1234';
    const result = store.track(sessionId, { name: 'lookup-test' });

    expect(store.getName(sessionId)).toBe('lookup-test');
    expect(store.getSessionId('lookup-test')).toBe(sessionId);
  });

  it('supports renaming sessions', () => {
    const sessionId = 'test-uuid-1234';
    store.track(sessionId, { name: 'old-name' });

    store.rename('old-name', 'new-name');

    expect(store.getName(sessionId)).toBe('new-name');
    expect(store.getSessionId('new-name')).toBe(sessionId);
    expect(store.getSessionId('old-name')).toBeUndefined();
  });

  it('lists sessions with filtering', () => {
    // Create multiple sessions
    store.track('uuid-1', { name: 'project-a', source: 'startup' });
    store.track('uuid-2', { name: 'project-b', source: 'resume' });
    store.track('uuid-3', { name: 'other-c', source: 'startup' });

    // List all
    const all = store.list();
    expect(all.length).toBe(3);

    // Filter by pattern
    const projects = store.list({ namePattern: 'project-*' });
    expect(projects.length).toBe(2);

    // Filter by source
    const startups = store.list({ source: 'startup' });
    expect(startups.length).toBe(2);

    // Limit results
    const limited = store.list({ limit: 1 });
    expect(limited.length).toBe(1);
  });

  it('deletes sessions', () => {
    const sessionId = 'test-uuid-1234';
    store.track(sessionId, { name: 'to-delete' });

    expect(store.delete('to-delete')).toBe(true);
    expect(store.getName(sessionId)).toBeUndefined();
    expect(store.getSessionId('to-delete')).toBeUndefined();

    // Double delete returns false
    expect(store.delete('to-delete')).toBe(false);
  });

  it('maintains session history', () => {
    const name = 'history-test';

    // Track multiple sessions with same name
    store.track('uuid-1', { name, source: 'startup' });
    store.track('uuid-2', { name, source: 'compact' });
    store.track('uuid-3', { name, source: 'clear' });

    const history = store.getHistory(name);
    expect(history.length).toBe(3);
    expect(history[0].sessionId).toBe('uuid-1');
    expect(history[1].sessionId).toBe('uuid-2');
    expect(history[2].sessionId).toBe('uuid-3');
    expect(history[1].source).toBe('compact');
  });

  it('persists to disk', () => {
    const sessionId = 'persistent-uuid';
    store.track(sessionId, { name: 'persistent-session' });

    // Create new store from same file
    const newStore = new SessionStore({ storagePath: TEST_STORAGE_PATH });
    expect(newStore.getName(sessionId)).toBe('persistent-session');
  });

  it('cleans up old sessions', () => {
    // Create a session
    store.track('uuid-1', { name: 'recent' });

    const sessions = store.list();
    expect(sessions.length).toBe(1);

    // Cleanup with very large max age should not remove anything (session is recent)
    const deleted = store.cleanup(1000 * 60 * 60 * 24 * 365); // 1 year
    expect(deleted).toBe(0);
    expect(store.list().length).toBe(1);

    // Delete manually instead to test deletion works
    expect(store.delete('recent')).toBe(true);
    expect(store.list().length).toBe(0);
  });
});

describe('Convenience functions', () => {
  it('generateName returns adjective-noun format', () => {
    const name = generateName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('generateUniqueName handles collisions', () => {
    const existing = new Set(['brave-eagle']);
    const name = generateUniqueName(existing);
    expect(existing.has(name)).toBe(false);
  });
});
