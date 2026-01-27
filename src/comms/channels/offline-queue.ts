/**
 * Offline Message Queue
 *
 * Handles message delivery for agents that were offline when messages
 * were sent. On startup, fetches pending messages and delivers them
 * to registered callbacks in chronological order.
 */

import type { Message } from '../protocol/types';
import type { MessageQuery } from './query';

// ============================================================================
// Types
// ============================================================================

/**
 * Callback for processing a queued message.
 * Return true to acknowledge delivery, false to retry later.
 */
export type QueuedMessageCallback = (message: Message) => boolean | Promise<boolean>;

// ============================================================================
// Offline Queue
// ============================================================================

/**
 * Drains pending messages for an agent that was offline.
 *
 * On startup, the daemon calls `drain()` to fetch and deliver any
 * messages that accumulated while the agent was offline. Messages
 * are delivered in chronological order and marked 'delivered' after
 * successful callback execution.
 *
 * For project-level messages (addressed to a project, not an agent),
 * the queue claims the message first to prevent duplicate delivery
 * across multiple agents in the same project.
 *
 * @example
 * ```typescript
 * const queue = new OfflineQueue(queryClient, 'agent-001');
 *
 * queue.onMessage((msg) => {
 *   console.log(`Queued message: ${msg.content}`);
 *   return true; // acknowledge
 * });
 *
 * const delivered = await queue.drain();
 * console.log(`Delivered ${delivered} queued messages`);
 * ```
 */
export class OfflineQueue {
  private readonly queryClient: MessageQuery;
  private readonly agentId: string;
  private callbacks: QueuedMessageCallback[];

  constructor(queryClient: MessageQuery, agentId: string) {
    this.queryClient = queryClient;
    this.agentId = agentId;
    this.callbacks = [];
  }

  /**
   * Register a callback for queued message delivery.
   *
   * @param callback - Invoked for each pending message. Return true to acknowledge.
   */
  onMessage(callback: QueuedMessageCallback): void {
    this.callbacks.push(callback);
  }

  /**
   * Remove all registered callbacks.
   */
  clearCallbacks(): void {
    this.callbacks = [];
  }

  /**
   * Drain all pending messages for this agent.
   *
   * Fetches pending messages, claims project-level ones, delivers to
   * callbacks in order, and marks each as 'delivered' on success.
   *
   * @returns Number of successfully delivered messages
   */
  async drain(): Promise<number> {
    if (this.callbacks.length === 0) {
      return 0;
    }

    const pending = await this.queryClient.getPendingMessages(this.agentId);

    if (pending.length === 0) {
      return 0;
    }

    // Sort by creation time (oldest first)
    pending.sort((a, b) => {
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    let deliveredCount = 0;

    for (let i = 0; i < pending.length; i++) {
      const message = pending[i]!;

      // For project-level messages, claim first to prevent duplicate delivery
      if (message.targetType === 'project') {
        try {
          await this.queryClient.claim(message.id);
        } catch {
          // Another agent already claimed it - skip
          continue;
        }
      }

      // Deliver to all callbacks
      let allAcknowledged = true;
      for (let j = 0; j < this.callbacks.length; j++) {
        try {
          const ack = await this.callbacks[j]!(message);
          if (!ack) {
            allAcknowledged = false;
          }
        } catch {
          allAcknowledged = false;
        }
      }

      // Mark as delivered if all callbacks acknowledged
      if (allAcknowledged) {
        try {
          await this.queryClient.markDelivered(message.id);
          deliveredCount++;
        } catch {
          // Failed to mark delivered - will be retried next drain
        }
      }
    }

    return deliveredCount;
  }
}
