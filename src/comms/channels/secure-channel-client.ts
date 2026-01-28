/**
 * Secure Channel Client
 *
 * Wraps ChannelClient with security enforcement:
 * - Rate limiting on publish, createChannel, joinChannel
 * - Content validation on publish content
 * - Audit logging on all mutations
 */

import type { Channel, ChannelFilter, ChannelType, Message } from '../protocol/types';
import type { SecurityManager } from '../security/security-manager';
import { SecurityMiddleware } from '../security/middleware';
import type { ChannelClient } from './channel-client';
import type {
  ChannelInfo,
  ChannelSubscription,
  PublishOptions,
  QueryOptions,
  ThreadSummary,
} from './types';

// ============================================================================
// Secure Channel Client
// ============================================================================

/**
 * Security-wrapped channel client.
 *
 * Delegates all operations to the underlying ChannelClient while
 * enforcing rate limits, validating content, and logging audits.
 *
 * @example
 * ```typescript
 * const secure = new SecureChannelClient(channelClient, securityManager, 'agent-001');
 *
 * // Publish is rate-limited, validated, and audited
 * await secure.publish('channel-id', 'Hello!');
 *
 * // Channel creation is rate-limited and audited
 * await secure.createChannel('dev-team', 'project');
 * ```
 */
export class SecureChannelClient {
  private readonly inner: ChannelClient;
  private readonly middleware: SecurityMiddleware;

  constructor(
    inner: ChannelClient,
    security: SecurityManager,
    agentId: string,
    machineId?: string,
  ) {
    this.inner = inner;
    this.middleware = new SecurityMiddleware(security, agentId, machineId);
  }

  // ==========================================================================
  // Channel Lifecycle (rate-limited + audited)
  // ==========================================================================

  async createChannel(
    name: string,
    type: ChannelType,
    members?: string[],
  ): Promise<Channel> {
    this.middleware.checkAndRecord('channel_create');

    const start = Date.now();
    try {
      const channel = await this.inner.createChannel(name, type, members);
      await this.middleware.audit({
        receiverId: '',
        command: `channel.create:${name}`,
        result: 'success',
        durationMs: Date.now() - start,
      });
      return channel;
    } catch (error) {
      await this.middleware.audit({
        receiverId: '',
        command: `channel.create:${name}`,
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  async joinChannel(channelId: string, agentId?: string): Promise<Channel> {
    const start = Date.now();
    try {
      const channel = await this.inner.joinChannel(channelId, agentId);
      await this.middleware.audit({
        receiverId: channelId,
        command: 'channel.join',
        result: 'success',
        durationMs: Date.now() - start,
      });
      return channel;
    } catch (error) {
      await this.middleware.audit({
        receiverId: channelId,
        command: 'channel.join',
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  async leaveChannel(channelId: string, agentId?: string): Promise<Channel> {
    const start = Date.now();
    const channel = await this.inner.leaveChannel(channelId, agentId);
    await this.middleware.audit({
      receiverId: channelId,
      command: 'channel.leave',
      result: 'success',
      durationMs: Date.now() - start,
    });
    return channel;
  }

  async archiveChannel(channelId: string): Promise<void> {
    const start = Date.now();
    await this.inner.archiveChannel(channelId);
    await this.middleware.audit({
      receiverId: channelId,
      command: 'channel.archive',
      result: 'success',
      durationMs: Date.now() - start,
    });
  }

  // ==========================================================================
  // Publishing (rate-limited + validated + audited)
  // ==========================================================================

  async publish(
    channelId: string,
    content: string,
    options?: PublishOptions,
  ): Promise<Message> {
    this.middleware.checkAndRecord('message');

    const sanitized = this.middleware.validateAndSanitize(content);

    const start = Date.now();
    try {
      const message = await this.inner.publish(channelId, sanitized, options);
      await this.middleware.audit({
        receiverId: channelId,
        command: 'channel.publish',
        result: 'success',
        durationMs: Date.now() - start,
      });
      return message;
    } catch (error) {
      await this.middleware.audit({
        receiverId: channelId,
        command: 'channel.publish',
        result: `failure:${(error as Error).message}`,
        durationMs: Date.now() - start,
      });
      throw error;
    }
  }

  // ==========================================================================
  // Read-only operations (pass-through, no security needed)
  // ==========================================================================

  async getChannel(channelId: string): Promise<Channel> {
    return this.inner.getChannel(channelId);
  }

  async listChannels(filter?: ChannelFilter): Promise<Channel[]> {
    return this.inner.listChannels(filter);
  }

  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    return this.inner.getChannelInfo(channelId);
  }

  subscribe(
    channelId: string,
    callback: (message: Message) => void,
  ): ChannelSubscription {
    return this.inner.subscribe(channelId, callback);
  }

  disconnect(): void {
    this.inner.disconnect();
  }

  async query(channelId: string, options?: QueryOptions): Promise<Message[]> {
    return this.inner.query(channelId, options);
  }

  async getThread(threadId: string): Promise<Message[]> {
    return this.inner.getThread(threadId);
  }

  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    return this.inner.getThreadSummary(threadId);
  }

  async getPendingMessages(agentId?: string): Promise<Message[]> {
    return this.inner.getPendingMessages(agentId);
  }

  async markDelivered(messageId: string): Promise<void> {
    return this.inner.markDelivered(messageId);
  }

  async markRead(messageId: string): Promise<void> {
    return this.inner.markRead(messageId);
  }
}
