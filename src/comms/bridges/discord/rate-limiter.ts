/**
 * Discord Rate Limiter
 *
 * Sliding window rate limiting per Discord user.
 * Default: 10 messages per minute per user.
 */

import type { DiscordRateLimitResult } from './types';

// ============================================================================
// Constants
// ============================================================================

/** One minute in milliseconds */
const ONE_MINUTE_MS = 60_000;

/** Default rate limit: messages per minute */
const DEFAULT_RATE_LIMIT = 10;

// ============================================================================
// Discord Rate Limiter
// ============================================================================

/**
 * Sliding window rate limiter for Discord users.
 *
 * Tracks message timestamps per user and enforces a configurable
 * rate limit (default: 10 messages per minute).
 *
 * @example
 * ```typescript
 * const limiter = new DiscordRateLimiter(10); // 10 msgs/min
 *
 * const result = limiter.checkLimit('user-123');
 * if (result.allowed) {
 *   limiter.recordMessage('user-123');
 *   // Process message
 * } else {
 *   // Reject with rate limit response
 *   console.log(`Retry after ${result.retryAfterMs}ms`);
 * }
 * ```
 */
export class DiscordRateLimiter {
  private readonly limitPerMinute: number;

  /** User ID -> array of message timestamps (ms since epoch) */
  private readonly windows: Map<string, number[]> = new Map();

  constructor(limitPerMinute?: number) {
    this.limitPerMinute = limitPerMinute ?? DEFAULT_RATE_LIMIT;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Check if a user is within their rate limit.
   *
   * Prunes expired timestamps before checking.
   *
   * @param userId - Discord user snowflake ID
   * @returns Rate limit check result
   */
  checkLimit(userId: string): DiscordRateLimitResult {
    const now = Date.now();
    const timestamps = this.getTimestamps(userId);

    // Prune expired entries
    this.pruneExpired(timestamps, now);

    const currentCount = timestamps.length;
    const remaining = Math.max(0, this.limitPerMinute - currentCount);

    if (currentCount < this.limitPerMinute) {
      return {
        allowed: true,
        remaining: remaining - 1, // Account for upcoming message
        retryAfterMs: 0,
      };
    }

    // Calculate retry delay: time until oldest entry expires
    const oldestTimestamp = timestamps[0];
    const retryAfterMs =
      oldestTimestamp !== undefined ? Math.max(0, oldestTimestamp + ONE_MINUTE_MS - now) : 0;

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs,
    };
  }

  /**
   * Record that a user sent a message.
   *
   * @param userId - Discord user snowflake ID
   */
  recordMessage(userId: string): void {
    const timestamps = this.getTimestamps(userId);
    timestamps.push(Date.now());
  }

  /**
   * Get the current message count for a user within the window.
   *
   * @param userId - Discord user snowflake ID
   * @returns Current count within the rate limit window
   */
  getCurrentCount(userId: string): number {
    const timestamps = this.getTimestamps(userId);
    this.pruneExpired(timestamps, Date.now());
    return timestamps.length;
  }

  /**
   * Reset rate limit state for a specific user.
   *
   * @param userId - Discord user snowflake ID
   */
  resetUser(userId: string): void {
    this.windows.delete(userId);
  }

  /**
   * Reset all rate limit state.
   */
  resetAll(): void {
    this.windows.clear();
  }

  /**
   * Get the number of users currently being tracked.
   *
   * @returns Number of users with active rate limit windows
   */
  getTrackedUserCount(): number {
    return this.windows.size;
  }

  /**
   * Get the number of users currently rate-limited.
   *
   * @returns Number of users who have hit their limit
   */
  getRateLimitedUserCount(): number {
    const now = Date.now();
    let count = 0;

    for (const [_userId, timestamps] of this.windows) {
      this.pruneExpired(timestamps, now);
      if (timestamps.length >= this.limitPerMinute) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get the configured rate limit.
   *
   * @returns Messages per minute limit
   */
  getLimit(): number {
    return this.limitPerMinute;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get or create the timestamps array for a user.
   */
  private getTimestamps(userId: string): number[] {
    let timestamps = this.windows.get(userId);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(userId, timestamps);
    }
    return timestamps;
  }

  /**
   * Remove timestamps older than the window from the array (in-place).
   */
  private pruneExpired(timestamps: number[], now: number): void {
    const cutoff = now - ONE_MINUTE_MS;
    let i = 0;
    while (i < timestamps.length && (timestamps[i] ?? 0) < cutoff) {
      i++;
    }
    if (i > 0) {
      timestamps.splice(0, i);
    }
  }
}
