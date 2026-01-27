/**
 * Message Query
 *
 * Query messages in channels with filtering, pagination, threading,
 * and delivery status management via the SignalDB REST client.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Message, MessageFilter, MessageStatus } from '../protocol/types';
import type { QueryOptions, ThreadSummary } from './types';

// ============================================================================
// Query
// ============================================================================

/**
 * Queries messages in channels with threading and delivery management.
 *
 * @example
 * ```typescript
 * const query = new MessageQuery(client, 'agent-001');
 *
 * // Get recent messages
 * const msgs = await query.query(channelId, { limit: 20 });
 *
 * // Get a thread
 * const thread = await query.getThread('thread-abc');
 * const summary = await query.getThreadSummary('thread-abc');
 *
 * // Manage delivery
 * const pending = await query.getPendingMessages();
 * await query.markDelivered(pending[0].id);
 * ```
 */
export class MessageQuery {
  private readonly client: SignalDBClient;
  private readonly agentId: string;

  constructor(client: SignalDBClient, agentId: string) {
    this.client = client;
    this.agentId = agentId;
  }

  /**
   * Query messages in a channel with optional filters.
   *
   * @param channelId - UUID of the channel to query
   * @param options - Optional query filters and pagination
   * @returns Array of matching Message entities, ordered by creation time
   */
  async query(channelId: string, options?: QueryOptions): Promise<Message[]> {
    const filter: MessageFilter = {};

    if (options) {
      if (options.limit !== undefined) filter.limit = options.limit;
      if (options.offset !== undefined) filter.offset = options.offset;
      if (options.threadId) filter.threadId = options.threadId;
      if (options.status) filter.status = options.status as MessageStatus;
      if (options.messageType) filter.messageType = options.messageType;
    }

    const messages = await this.client.messages.listByChannel(channelId, filter);

    // Apply client-side 'since' filter if specified
    if (options?.since) {
      const sinceTime = new Date(options.since).getTime();
      const filtered: Message[] = [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        if (new Date(msg.createdAt).getTime() >= sinceTime) {
          filtered.push(msg);
        }
      }
      return filtered;
    }

    return messages;
  }

  /**
   * Get all messages in a conversation thread.
   *
   * @param threadId - Thread identifier (typically the first message's ID)
   * @returns Array of messages in the thread, ordered by creation time
   */
  async getThread(threadId: string): Promise<Message[]> {
    return this.client.messages.listByThread(threadId);
  }

  /**
   * Get a summary of a conversation thread.
   *
   * @param threadId - Thread identifier
   * @returns ThreadSummary with message count, participants, and boundary messages
   * @throws Error if the thread is empty
   */
  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    const messages = await this.client.messages.listByThread(threadId);

    if (messages.length === 0) {
      throw new Error(`Thread "${threadId}" not found or empty`);
    }

    // Collect unique participants
    const participantSet = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      participantSet.add(messages[i]!.senderId);
    }

    const participants: string[] = [];
    for (const p of participantSet) {
      participants.push(p);
    }

    return {
      threadId,
      messageCount: messages.length,
      participants,
      firstMessage: messages[0]!,
      lastMessage: messages[messages.length - 1]!,
    };
  }

  /**
   * Get all pending messages for an agent.
   * Used during startup to drain the offline queue.
   *
   * @param agentId - UUID of the target agent (defaults to this client's agent)
   * @returns Array of pending Message entities
   */
  async getPendingMessages(agentId?: string): Promise<Message[]> {
    const targetId = agentId ?? this.agentId;
    return this.client.messages.listForAgent(targetId, {
      status: 'pending',
    });
  }

  /**
   * Mark a message as delivered.
   *
   * @param messageId - UUID of the message to mark delivered
   */
  async markDelivered(messageId: string): Promise<void> {
    await this.client.messages.updateStatus(messageId, 'delivered');
  }

  /**
   * Mark a message as read.
   *
   * @param messageId - UUID of the message to mark read
   */
  async markRead(messageId: string): Promise<void> {
    await this.client.messages.updateStatus(messageId, 'read');
  }

  /**
   * Claim a pending message for processing by this agent.
   *
   * @param messageId - UUID of the message to claim
   * @returns The claimed Message entity
   */
  async claim(messageId: string): Promise<Message> {
    return this.client.messages.claim(messageId, this.agentId);
  }
}
