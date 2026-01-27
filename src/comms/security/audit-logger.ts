/**
 * Audit Logger
 *
 * Batched audit logging for agent command history.
 * Buffers entries and flushes to SignalDB's /v1/audit endpoint
 * in configurable batches.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { AuditEntry, AuditLogConfig } from './types';

// ============================================================================
// Audit Logger
// ============================================================================

/**
 * Buffered audit logger that posts entries to SignalDB.
 *
 * Entries are buffered in memory and flushed either when the batch size
 * is reached or on a timed interval (whichever comes first).
 *
 * @example
 * ```typescript
 * const logger = new AuditLogger(signalDBClient, {
 *   batchSize: 50,
 *   flushIntervalMs: 30000,
 * });
 *
 * // Start auto-flushing (returns cleanup function)
 * const stop = logger.startAutoFlush();
 *
 * // Log entries (buffered, flushed automatically)
 * await logger.log({
 *   timestamp: new Date().toISOString(),
 *   senderId: 'agent-001',
 *   receiverId: 'agent-002',
 *   command: 'execute task T-003',
 *   result: 'success',
 *   durationMs: 1250,
 *   machineId: 'mac-001',
 * });
 *
 * // Manual flush
 * await logger.flush();
 *
 * // Cleanup on shutdown
 * stop();
 * ```
 */
export class AuditLogger {
  private readonly client: SignalDBClient;
  private readonly config: AuditLogConfig;
  private buffer: AuditEntry[];
  private flushTimer: ReturnType<typeof setInterval> | null;

  /**
   * @param client - SignalDB REST client for posting audit entries
   * @param config - Batch size and flush interval configuration
   */
  constructor(client: SignalDBClient, config: AuditLogConfig) {
    this.client = client;
    this.config = config;
    this.buffer = [];
    this.flushTimer = null;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Add an audit entry to the buffer.
   *
   * Triggers an automatic flush if the buffer reaches batchSize.
   *
   * @param entry - The audit entry to log
   */
  async log(entry: AuditEntry): Promise<void> {
    this.buffer.push(entry);

    if (this.buffer.length >= this.config.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flush all buffered audit entries to SignalDB.
   *
   * Posts entries to the /v1/audit endpoint in a single request.
   * Clears the buffer on success. On failure, entries remain in the buffer
   * for the next flush attempt.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    // Snapshot and clear buffer atomically to prevent double-posting
    const entries = this.buffer;
    this.buffer = [];

    try {
      await this.client.request<void>('POST', '/v1/audit', { entries });
    } catch (error) {
      // On failure, prepend entries back to buffer for retry
      this.buffer = [...entries, ...this.buffer];
      throw error;
    }
  }

  /**
   * Start periodic auto-flushing.
   *
   * @returns Cleanup function that stops the auto-flush interval
   */
  startAutoFlush(): () => void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(async () => {
      try {
        await this.flush();
      } catch {
        // Silently retry on next interval; entries remain in buffer
      }
    }, this.config.flushIntervalMs);

    return () => this.stopAutoFlush();
  }

  /**
   * Stop periodic auto-flushing.
   */
  stopAutoFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get the current number of buffered entries (for diagnostics).
   */
  get pendingCount(): number {
    return this.buffer.length;
  }
}
