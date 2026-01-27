/**
 * Rate Limiter
 *
 * Sliding window rate limiting per agent per action.
 * Stores timestamps in memory and prunes expired entries on each check.
 */

import type { RateLimitAction, RateLimitConfig, RateLimitResult, RateLimitViolation } from './types';

// ============================================================================
// Constants
// ============================================================================

/** One minute in milliseconds */
const ONE_MINUTE_MS = 60_000;

/** One hour in milliseconds */
const ONE_HOUR_MS = 3_600_000;

// ============================================================================
// Rate Limiter
// ============================================================================

/**
 * Sliding window rate limiter for agent actions.
 *
 * Default limits:
 * - 60 messages per minute
 * - 10 channel creates per hour
 * - 100 paste creates per hour
 *
 * The sliding window algorithm stores timestamps of recent actions.
 * On each check, expired timestamps are pruned, and the remaining
 * count is compared against the limit.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({
 *   messagesPerMinute: 60,
 *   channelCreatesPerHour: 10,
 *   pasteCreatesPerHour: 100,
 * });
 *
 * const result = limiter.checkLimit('agent-001', 'message');
 * if (result.allowed) {
 *   limiter.recordAction('agent-001', 'message');
 *   // proceed with message
 * } else {
 *   // reject with 429, retry after result.retryAfterMs
 * }
 * ```
 */
export class RateLimiter {
  private readonly config: RateLimitConfig;
  /**
   * Nested map: agentId -> action -> array of timestamps (ms since epoch).
   */
  private readonly windows: Map<string, Map<RateLimitAction, number[]>>;

  constructor(config?: Partial<RateLimitConfig>) {
    this.config = {
      messagesPerMinute: config?.messagesPerMinute ?? 60,
      channelCreatesPerHour: config?.channelCreatesPerHour ?? 10,
      pasteCreatesPerHour: config?.pasteCreatesPerHour ?? 100,
    };
    this.windows = new Map();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if an action is allowed for an agent within the rate limit.
   *
   * Prunes expired timestamps before checking.
   *
   * @param agentId - Agent requesting the action
   * @param action - Type of action to rate-limit
   * @returns Result with allowed status, remaining capacity, and retry delay
   */
  checkLimit(agentId: string, action: RateLimitAction): RateLimitResult {
    const { maxActions, windowMs } = this.getLimitForAction(action);
    const now = Date.now();
    const timestamps = this.getTimestamps(agentId, action);

    // Prune expired entries
    this.pruneExpired(timestamps, now, windowMs);

    const currentCount = timestamps.length;
    const remaining = Math.max(0, maxActions - currentCount);

    if (currentCount < maxActions) {
      return {
        allowed: true,
        remaining: remaining - 1, // Account for the action about to be recorded
        retryAfterMs: 0,
      };
    }

    // Calculate retry delay: time until the oldest entry expires
    const oldestTimestamp = timestamps[0];
    const retryAfterMs = oldestTimestamp !== undefined
      ? Math.max(0, (oldestTimestamp + windowMs) - now)
      : 0;

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  /**
   * Record that an action was performed by an agent.
   *
   * @param agentId - Agent performing the action
   * @param action - Type of action performed
   */
  recordAction(agentId: string, action: RateLimitAction): void {
    const timestamps = this.getTimestamps(agentId, action);
    timestamps.push(Date.now());
  }

  /**
   * Reset all rate limit state for an agent.
   *
   * @param agentId - Agent to reset
   */
  resetAgent(agentId: string): void {
    this.windows.delete(agentId);
  }

  /**
   * Create a SecurityViolation for a rate limit breach.
   *
   * @param agentId - The agent that exceeded the limit
   * @param action - The action type that was rate-limited
   * @param result - The check result showing the violation
   * @returns A RateLimitViolation object
   */
  createViolation(
    agentId: string,
    action: RateLimitAction,
    result: RateLimitResult,
  ): RateLimitViolation {
    const { maxActions } = this.getLimitForAction(action);
    return {
      type: 'rate_limit',
      timestamp: new Date().toISOString(),
      agentId,
      message: `Rate limit exceeded for action "${action}": ${maxActions} per window`,
      action,
      currentCount: maxActions, // At limit
      maxAllowed: maxActions,
      retryAfterMs: result.retryAfterMs,
    };
  }

  /**
   * Get the current action count for an agent (for diagnostics).
   *
   * @param agentId - Agent to check
   * @param action - Action type
   * @returns Current count within the window
   */
  getCurrentCount(agentId: string, action: RateLimitAction): number {
    const { windowMs } = this.getLimitForAction(action);
    const timestamps = this.getTimestamps(agentId, action);
    this.pruneExpired(timestamps, Date.now(), windowMs);
    return timestamps.length;
  }

  // ==========================================================================
  // Internal Helpers
  // ==========================================================================

  /**
   * Get the max actions and window size for a given action type.
   */
  private getLimitForAction(action: RateLimitAction): {
    maxActions: number;
    windowMs: number;
  } {
    switch (action) {
      case 'message':
        return { maxActions: this.config.messagesPerMinute, windowMs: ONE_MINUTE_MS };
      case 'channel_create':
        return { maxActions: this.config.channelCreatesPerHour, windowMs: ONE_HOUR_MS };
      case 'paste_create':
        return { maxActions: this.config.pasteCreatesPerHour, windowMs: ONE_HOUR_MS };
    }
  }

  /**
   * Get or create the timestamps array for an agent+action pair.
   */
  private getTimestamps(agentId: string, action: RateLimitAction): number[] {
    let agentWindows = this.windows.get(agentId);
    if (!agentWindows) {
      agentWindows = new Map();
      this.windows.set(agentId, agentWindows);
    }

    let timestamps = agentWindows.get(action);
    if (!timestamps) {
      timestamps = [];
      agentWindows.set(action, timestamps);
    }

    return timestamps;
  }

  /**
   * Remove timestamps older than the window from the array (in-place).
   */
  private pruneExpired(timestamps: number[], now: number, windowMs: number): void {
    const cutoff = now - windowMs;
    let i = 0;
    while (i < timestamps.length && (timestamps[i] ?? 0) < cutoff) {
      i++;
    }
    if (i > 0) {
      timestamps.splice(0, i);
    }
  }
}
