/**
 * Tests for Agent Presence Derivation
 *
 * Covers: derivePresence, isActive, isIdle, isOffline, getPresenceThresholds
 */

import { describe, test, expect } from 'bun:test';
import {
  derivePresence,
  isActive,
  isIdle,
  isOffline,
  getPresenceThresholds,
} from '../../src/comms/protocol/presence';
import type { Agent } from '../../src/comms/protocol/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create an ISO timestamp by subtracting milliseconds from Date.now().
 */
function heartbeatAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Create a minimal Agent object for testing presence convenience functions.
 */
function makeAgent(heartbeatAt: string | null): Agent {
  return {
    id: 'test-agent-id',
    machineId: 'test-machine',
    sessionId: 'test-session',
    sessionName: 'test-name',
    projectPath: '/test/path',
    status: 'active',
    capabilities: {},
    heartbeatAt,
    metadata: {},
    registeredAt: new Date().toISOString(),
  };
}

// ============================================================================
// derivePresence
// ============================================================================

describe('derivePresence', () => {
  test('returns "active" for heartbeat 0ms ago', () => {
    const ts = heartbeatAgo(0);
    expect(derivePresence(ts)).toBe('active');
  });

  test('returns "active" for heartbeat 5000ms ago', () => {
    const ts = heartbeatAgo(5000);
    expect(derivePresence(ts)).toBe('active');
  });

  test('returns "active" for heartbeat 9999ms ago (boundary)', () => {
    const ts = heartbeatAgo(9999);
    expect(derivePresence(ts)).toBe('active');
  });

  test('returns "idle" for heartbeat 10000ms ago (boundary)', () => {
    // At exactly 10000ms, elapsed >= ACTIVE_THRESHOLD_MS (10000), so NOT active
    // elapsed < IDLE_THRESHOLD_MS (300000), so idle
    const ts = heartbeatAgo(10000);
    expect(derivePresence(ts)).toBe('idle');
  });

  test('returns "idle" for heartbeat 10001ms ago', () => {
    const ts = heartbeatAgo(10001);
    expect(derivePresence(ts)).toBe('idle');
  });

  test('returns "idle" for heartbeat 150000ms ago (midway)', () => {
    const ts = heartbeatAgo(150000);
    expect(derivePresence(ts)).toBe('idle');
  });

  test('returns "idle" for heartbeat 299999ms ago (boundary)', () => {
    const ts = heartbeatAgo(299999);
    expect(derivePresence(ts)).toBe('idle');
  });

  test('returns "offline" for heartbeat 300000ms ago (boundary)', () => {
    // At exactly 300000ms, elapsed >= IDLE_THRESHOLD_MS (300000), so offline
    const ts = heartbeatAgo(300000);
    expect(derivePresence(ts)).toBe('offline');
  });

  test('returns "offline" for heartbeat 300001ms ago', () => {
    const ts = heartbeatAgo(300001);
    expect(derivePresence(ts)).toBe('offline');
  });

  test('returns "offline" for heartbeat 600000ms ago', () => {
    const ts = heartbeatAgo(600000);
    expect(derivePresence(ts)).toBe('offline');
  });

  test('returns "offline" for null heartbeat', () => {
    expect(derivePresence(null)).toBe('offline');
  });
});

// ============================================================================
// isActive / isIdle / isOffline convenience functions
// ============================================================================

describe('isActive', () => {
  test('returns true for agent with recent heartbeat', () => {
    const agent = makeAgent(heartbeatAgo(0));
    expect(isActive(agent)).toBe(true);
  });

  test('returns false for agent with old heartbeat', () => {
    const agent = makeAgent(heartbeatAgo(15000));
    expect(isActive(agent)).toBe(false);
  });

  test('returns false for agent with null heartbeat', () => {
    const agent = makeAgent(null);
    expect(isActive(agent)).toBe(false);
  });
});

describe('isIdle', () => {
  test('returns true for agent with heartbeat 30s ago', () => {
    const agent = makeAgent(heartbeatAgo(30000));
    expect(isIdle(agent)).toBe(true);
  });

  test('returns false for agent with recent heartbeat (active)', () => {
    const agent = makeAgent(heartbeatAgo(1000));
    expect(isIdle(agent)).toBe(false);
  });

  test('returns false for agent with heartbeat 10min ago (offline)', () => {
    const agent = makeAgent(heartbeatAgo(600000));
    expect(isIdle(agent)).toBe(false);
  });

  test('returns false for agent with null heartbeat', () => {
    const agent = makeAgent(null);
    expect(isIdle(agent)).toBe(false);
  });
});

describe('isOffline', () => {
  test('returns true for agent with heartbeat 6min ago', () => {
    const agent = makeAgent(heartbeatAgo(360000));
    expect(isOffline(agent)).toBe(true);
  });

  test('returns true for agent with null heartbeat', () => {
    const agent = makeAgent(null);
    expect(isOffline(agent)).toBe(true);
  });

  test('returns false for agent with recent heartbeat', () => {
    const agent = makeAgent(heartbeatAgo(0));
    expect(isOffline(agent)).toBe(false);
  });

  test('returns false for idle agent', () => {
    const agent = makeAgent(heartbeatAgo(60000));
    expect(isOffline(agent)).toBe(false);
  });
});

// ============================================================================
// getPresenceThresholds
// ============================================================================

describe('getPresenceThresholds', () => {
  test('returns correct active threshold (10000ms)', () => {
    const thresholds = getPresenceThresholds();
    expect(thresholds.active).toBe(10000);
  });

  test('returns correct idle threshold (300000ms)', () => {
    const thresholds = getPresenceThresholds();
    expect(thresholds.idle).toBe(300000);
  });

  test('idle threshold is greater than active threshold', () => {
    const thresholds = getPresenceThresholds();
    expect(thresholds.idle).toBeGreaterThan(thresholds.active);
  });
});
