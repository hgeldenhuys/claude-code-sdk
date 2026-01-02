import { describe, test, expect } from 'bun:test';
import { ChangeTracker } from '../src/tracker/index.ts';

describe('ChangeTracker', () => {
  test('should create tracker with default config', () => {
    const tracker = new ChangeTracker();
    expect(tracker).toBeDefined();
    expect(tracker.getLastUpdated()).toBeNull();
  });

  test('should create tracker with custom config', () => {
    const tracker = new ChangeTracker({
      cacheDir: '/custom/cache',
      updateInterval: 12,
    });
    expect(tracker).toBeDefined();
  });

  test('needsRefresh should return true when never updated', () => {
    const tracker = new ChangeTracker();
    expect(tracker.needsRefresh()).toBe(true);
  });

  test('getChanges should return empty array initially', () => {
    const tracker = new ChangeTracker();
    const changes = tracker.getChanges();
    expect(changes).toEqual([]);
  });

  test('getBreakingChanges should return empty array initially', () => {
    const tracker = new ChangeTracker();
    const changes = tracker.getBreakingChanges('0.1.0', '1.0.0');
    expect(changes).toEqual([]);
  });

  test('hasBreakingChangesSince should return false initially', () => {
    const tracker = new ChangeTracker();
    expect(tracker.hasBreakingChangesSince('0.1.0')).toBe(false);
  });

  test('getMigrationGuide should return empty array initially', () => {
    const tracker = new ChangeTracker();
    const guide = tracker.getMigrationGuide('0.1.0', '1.0.0');
    expect(guide).toEqual([]);
  });
});
