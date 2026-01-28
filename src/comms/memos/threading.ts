/**
 * MemoThreading - Reply chains and thread queries
 *
 * Manages threaded memo conversations:
 * - reply() fetches parent by ID, creates a memo in the parent's thread
 * - getThread() retrieves all memos in a thread
 * - getThreadSummary() provides thread metadata
 */

import type { SignalDBClient } from '../client/signaldb';
import type { MemoCategory, MemoCompose, MemoConfig, MemoView, ThreadSummary } from './types';
import { MemoComposer, messageToMemoView } from './composer';

export class MemoThreading {
  private readonly client: SignalDBClient;
  private readonly config: MemoConfig;
  private readonly composer: MemoComposer;

  constructor(client: SignalDBClient, config: MemoConfig, composer?: MemoComposer) {
    this.client = client;
    this.config = config;
    this.composer = composer ?? new MemoComposer(client, config);
  }

  /**
   * Reply to a memo by its ID.
   * Fetches the parent memo, sets threadId to parent's threadId or parent's id,
   * and addresses the reply to the parent's senderId.
   */
  async reply(
    parentMemoId: string,
    input: Omit<MemoCompose, 'to' | 'threadId'>,
  ): Promise<MemoView> {
    // Fetch the parent memo
    const parentMemo = await this.fetchMemoById(parentMemoId);
    if (!parentMemo) {
      throw new Error(`Parent memo not found: ${parentMemoId}`);
    }

    // Use parent's threadId if it has one, otherwise use parent's id
    const threadId = parentMemo.threadId ?? parentMemo.id;

    // Reply goes back to the sender of the parent memo
    // We construct an agent address from the senderId
    const to = parentMemo.to.includes(parentMemo.senderId)
      ? parentMemo.to
      : `agent://${parentMemo.senderId}/reply`;

    const compose: MemoCompose = {
      ...input,
      to,
      threadId,
    };

    return this.composer.send(compose);
  }

  /**
   * Get all memos in a thread, sorted chronologically.
   */
  async getThread(threadId: string): Promise<MemoView[]> {
    const messages = await this.client.messages.listByThread(threadId);

    const memos: MemoView[] = [];
    for (const msg of messages) {
      if (msg.messageType === 'memo') {
        memos.push(messageToMemoView(msg));
      }
    }

    // Sort chronologically (oldest first)
    memos.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return memos;
  }

  /**
   * Get a summary of a thread.
   */
  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    const memos = await this.getThread(threadId);

    if (memos.length === 0) {
      return {
        threadId,
        rootMemoId: '',
        participants: [],
        memoCount: 0,
        firstTimestamp: '',
        lastTimestamp: '',
        categories: [],
      };
    }

    const participants = new Set<string>();
    const categories = new Set<MemoCategory>();

    for (const memo of memos) {
      participants.add(memo.senderId);
      categories.add(memo.category);
    }

    return {
      threadId,
      rootMemoId: memos[0]!.id,
      participants: Array.from(participants),
      memoCount: memos.length,
      firstTimestamp: memos[0]!.createdAt,
      lastTimestamp: memos[memos.length - 1]!.createdAt,
      categories: Array.from(categories),
    };
  }

  /**
   * Fetch a memo by ID from the agent's messages.
   */
  private async fetchMemoById(memoId: string): Promise<MemoView | null> {
    const messages = await this.client.messages.listForAgent(this.config.agentId, {
      messageType: 'memo',
    });

    for (const msg of messages) {
      if (msg.id === memoId) {
        return messageToMemoView(msg);
      }
    }

    return null;
  }
}
