/**
 * MemoClient - Facade composing all memo components
 *
 * Provides a unified API for memo operations:
 * - compose/send memos
 * - inbox/outbox queries
 * - claim/deliver/markRead/expire lifecycle
 * - reply/getThread/getThreadSummary threading
 *
 * @example
 * ```typescript
 * const client = new MemoClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 * });
 *
 * // Send a memo
 * const memo = await client.compose({
 *   to: 'agent://machine-1/agent-002',
 *   subject: 'Build results',
 *   body: 'All tests passed.',
 * });
 *
 * // Check inbox
 * const memos = await client.inbox();
 * const unread = await client.getUnreadCount();
 *
 * // Read and reply
 * const read = await client.read(memos[0].id);
 * const reply = await client.reply(memos[0].id, {
 *   subject: 'Re: Build results',
 *   body: 'Great news!',
 * });
 * ```
 */

import { SignalDBClient } from '../client/signaldb';
import type {
  ClaimResult,
  MemoCompose,
  MemoConfig,
  MemoFilter,
  MemoView,
  ThreadSummary,
} from './types';
import { MemoComposer } from './composer';
import { MemoInbox } from './inbox';
import { MemoClaimer } from './claiming';
import { MemoThreading } from './threading';

export class MemoClient {
  private readonly composer: MemoComposer;
  private readonly inboxClient: MemoInbox;
  private readonly claimer: MemoClaimer;
  private readonly threading: MemoThreading;
  private readonly config: MemoConfig;

  constructor(config: MemoConfig, client?: SignalDBClient) {
    this.config = config;

    // Create REST client from config if not provided
    const restClient = client ?? new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    this.composer = new MemoComposer(restClient, config);
    this.inboxClient = new MemoInbox(restClient, config);
    this.claimer = new MemoClaimer(restClient, config);
    this.threading = new MemoThreading(restClient, config, this.composer);
  }

  // ==========================================================================
  // Compose
  // ==========================================================================

  /**
   * Compose and send a memo.
   */
  async compose(input: MemoCompose): Promise<MemoView> {
    return this.composer.send(input);
  }

  // ==========================================================================
  // Inbox / Outbox
  // ==========================================================================

  /**
   * Get memos in this agent's inbox.
   */
  async inbox(options?: MemoFilter): Promise<MemoView[]> {
    return this.inboxClient.inbox(options);
  }

  /**
   * Get memos sent by this agent.
   */
  async outbox(options?: MemoFilter): Promise<MemoView[]> {
    return this.inboxClient.outbox(options);
  }

  /**
   * Get count of unread memos.
   */
  async getUnreadCount(): Promise<number> {
    return this.inboxClient.getUnreadCount();
  }

  // ==========================================================================
  // Lifecycle (claim, read, archive)
  // ==========================================================================

  /**
   * Claim a pending memo for this agent.
   */
  async claim(memoId: string): Promise<ClaimResult> {
    return this.claimer.claim(memoId);
  }

  /**
   * Read a memo: delivers if status allows, then marks as read.
   * Handles intermediate state transitions automatically.
   */
  async read(memoId: string): Promise<MemoView> {
    // Try deliver first (claimed -> delivered), ignore errors if already delivered
    try {
      await this.claimer.deliver(memoId);
    } catch {
      // May already be in delivered state, continue
    }

    // Mark as read (delivered -> read)
    return this.claimer.markRead(memoId);
  }

  /**
   * Archive (expire) a memo.
   */
  async archive(memoId: string): Promise<MemoView> {
    return this.claimer.expire(memoId);
  }

  // ==========================================================================
  // Threading
  // ==========================================================================

  /**
   * Reply to a memo by its ID.
   */
  async reply(
    memoId: string,
    input: Omit<MemoCompose, 'to' | 'threadId'>,
  ): Promise<MemoView> {
    return this.threading.reply(memoId, input);
  }

  /**
   * Get all memos in a thread.
   */
  async getThread(threadId: string): Promise<MemoView[]> {
    return this.threading.getThread(threadId);
  }

  /**
   * Get summary of a thread.
   */
  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    return this.threading.getThreadSummary(threadId);
  }
}
