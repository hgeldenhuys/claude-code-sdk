/**
 * Agent Presence Derivation
 *
 * Derives agent status from heartbeat timestamps.
 * Thresholds:
 * - active: heartbeat within 10 seconds
 * - idle: heartbeat between 10 seconds and 5 minutes
 * - offline: heartbeat older than 5 minutes, or null
 */

import type { Agent, AgentStatus } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Active threshold: 10 seconds in milliseconds */
const ACTIVE_THRESHOLD_MS = 10_000;

/** Idle threshold: 5 minutes in milliseconds */
const IDLE_THRESHOLD_MS = 300_000;

// ============================================================================
// Core Derivation
// ============================================================================

/**
 * Derive an agent's presence status from their last heartbeat timestamp.
 *
 * @param heartbeatAt - ISO 8601 timestamp of last heartbeat, or null if never sent
 * @returns AgentStatus: 'active', 'idle', or 'offline'
 */
export function derivePresence(heartbeatAt: string | null): AgentStatus {
  if (heartbeatAt === null) {
    return 'offline';
  }

  const heartbeatTime = new Date(heartbeatAt).getTime();
  const elapsed = Date.now() - heartbeatTime;

  if (elapsed < ACTIVE_THRESHOLD_MS) {
    return 'active';
  }

  if (elapsed < IDLE_THRESHOLD_MS) {
    return 'idle';
  }

  return 'offline';
}

// ============================================================================
// Convenience Checks
// ============================================================================

/**
 * Check if an agent is actively sending heartbeats (within 10 seconds).
 */
export function isActive(agent: Agent): boolean {
  return derivePresence(agent.heartbeatAt) === 'active';
}

/**
 * Check if an agent is idle (heartbeat between 10s and 5min ago).
 */
export function isIdle(agent: Agent): boolean {
  return derivePresence(agent.heartbeatAt) === 'idle';
}

/**
 * Check if an agent is offline (heartbeat >5min ago or never sent).
 */
export function isOffline(agent: Agent): boolean {
  return derivePresence(agent.heartbeatAt) === 'offline';
}

// ============================================================================
// Thresholds
// ============================================================================

/**
 * Get the presence threshold constants in milliseconds.
 *
 * @returns Object with active (10000ms) and idle (300000ms) thresholds
 */
export function getPresenceThresholds(): { active: number; idle: number } {
  return {
    active: ACTIVE_THRESHOLD_MS,
    idle: IDLE_THRESHOLD_MS,
  };
}
