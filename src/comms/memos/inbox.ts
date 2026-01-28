/**
 * MemoInbox - Inbox/outbox queries with filtering and sorting
 *
 * Queries memos for an agent, filtering by category/priority/status,
 * sorting by priority then recency, with pagination support.
 */

import type { Message, MessageFilter } from '../protocol/types';
import type { SignalDBClient } from '../client/signaldb';
import type { MemoConfig, MemoFilter, MemoView } from './types';
import { messageToMemoView } from './composer';

/** Priority sort weight: lower = higher priority */
const PRIORITY_ORDER: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export class MemoInbox {
  private readonly client: SignalDBClient;
  private readonly config: MemoConfig;

  constructor(client: SignalDBClient, config: MemoConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Get memos addressed to this agent (inbox).
   */
  async inbox(filters?: MemoFilter): Promise<MemoView[]> {
    const msgFilter: MessageFilter = {
      messageType: 'memo',
    };

    if (filters?.status) {
      msgFilter.status = filters.status;
    }
    if (filters?.limit) {
      msgFilter.limit = filters.limit;
    }
    if (filters?.offset) {
      msgFilter.offset = filters.offset;
    }

    const messages = await this.client.messages.listForAgent(this.config.agentId, msgFilter);

    let memos = this.filterMemos(messages, filters);

    // Sort: P0 first, then by createdAt descending within same priority
    memos.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 99;
      const pb = PRIORITY_ORDER[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      // Same priority: newer first
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return memos;
  }

  /**
   * Get memos sent by this agent (outbox).
   */
  async outbox(filters?: MemoFilter): Promise<MemoView[]> {
    const msgFilter: MessageFilter = {
      messageType: 'memo',
    };

    if (filters?.limit) {
      msgFilter.limit = filters.limit;
    }
    if (filters?.offset) {
      msgFilter.offset = filters.offset;
    }

    // Use listByChannel and filter by senderId locally
    const channelId = this.config.channelId ?? 'default';
    const messages = await this.client.messages.listByChannel(channelId, msgFilter);

    // Filter to only memos sent by this agent
    const sentMessages: Message[] = [];
    for (const msg of messages) {
      if (msg.senderId === this.config.agentId && msg.messageType === 'memo') {
        sentMessages.push(msg);
      }
    }

    return this.filterMemos(sentMessages, filters);
  }

  /**
   * Count unread memos (pending + delivered status).
   */
  async getUnreadCount(): Promise<number> {
    const messages = await this.client.messages.listForAgent(this.config.agentId, {
      messageType: 'memo',
    });

    let count = 0;
    for (const msg of messages) {
      if (msg.status === 'pending' || msg.status === 'delivered') {
        count++;
      }
    }
    return count;
  }

  /**
   * Convert messages to MemoView[] with client-side filtering.
   */
  private filterMemos(messages: Message[], filters?: MemoFilter): MemoView[] {
    const memos: MemoView[] = [];

    for (const msg of messages) {
      // Only include memo type messages
      if (msg.messageType !== 'memo') continue;

      const view = messageToMemoView(msg);

      // Apply client-side filters
      if (filters?.category && view.category !== filters.category) continue;
      if (filters?.priority && view.priority !== filters.priority) continue;
      if (filters?.unreadOnly) {
        if (view.status === 'read' || view.status === 'expired') continue;
      }

      memos.push(view);
    }

    return memos;
  }
}
