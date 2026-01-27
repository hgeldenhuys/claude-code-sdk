/**
 * Channel Client Facade
 *
 * Unified entry point for channel messaging. Composes all channel
 * components (lifecycle, publish, subscribe, query, offline queue)
 * into a single ergonomic API.
 */

import { SignalDBClient } from '../client/signaldb';
import type { Address, Channel, ChannelFilter, ChannelType, Message } from '../protocol/types';
import { formatAddress, parseAddress } from '../protocol/address';
import { ChannelManager } from './channel-manager';
import { MessagePublisher } from './publisher';
import { MessageSubscriber } from './subscriber';
import { MessageQuery } from './query';
import { OfflineQueue } from './offline-queue';
import type {
  ChannelConfig,
  ChannelInfo,
  ChannelSubscription,
  PublishOptions,
  QueryOptions,
  ThreadSummary,
} from './types';

// ============================================================================
// Channel Client
// ============================================================================

/**
 * Unified channel messaging client.
 *
 * Composes all channel components behind a clean facade:
 * - **Lifecycle**: createChannel, joinChannel, leaveChannel, archiveChannel
 * - **Publish**: publish messages with threading and metadata
 * - **Subscribe**: real-time SSE message subscriptions
 * - **Query**: message history, thread queries, delivery management
 * - **Offline**: drain pending messages on startup
 *
 * @example
 * ```typescript
 * const client = new ChannelClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 * });
 *
 * // Create and join a channel
 * const ch = await client.createChannel('dev-team', 'project');
 * await client.joinChannel(ch.id, 'agent-002');
 *
 * // Subscribe to real-time messages
 * const sub = client.subscribe(ch.id, (msg) => {
 *   console.log(`[${msg.senderId}]: ${msg.content}`);
 * });
 *
 * // Publish a message
 * await client.publish(ch.id, 'Hello team!', { messageType: 'chat' });
 *
 * // Query message history
 * const history = await client.query(ch.id, { limit: 50 });
 *
 * // Thread operations
 * const thread = await client.getThread('msg-001');
 * const summary = await client.getThreadSummary('msg-001');
 *
 * // Drain offline messages on startup
 * client.onQueuedMessage((msg) => { console.log(msg.content); return true; });
 * await client.drainOfflineQueue();
 *
 * // Cleanup
 * sub.unsubscribe();
 * client.disconnect();
 * ```
 */
export class ChannelClient {
  private readonly config: ChannelConfig;
  private readonly restClient: SignalDBClient;
  private readonly manager: ChannelManager;
  private readonly publisher: MessagePublisher;
  private readonly subscriber: MessageSubscriber;
  private readonly queryClient: MessageQuery;
  private readonly offlineQueue: OfflineQueue;

  constructor(config: ChannelConfig) {
    this.config = config;

    // Create REST client from config
    this.restClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    // Initialize all components
    this.manager = new ChannelManager(this.restClient, config.agentId);
    this.publisher = new MessagePublisher(this.restClient, config.agentId);
    this.subscriber = new MessageSubscriber(config);
    this.queryClient = new MessageQuery(this.restClient, config.agentId);
    this.offlineQueue = new OfflineQueue(this.queryClient, config.agentId);
  }

  // ==========================================================================
  // Channel Lifecycle (delegated to ChannelManager)
  // ==========================================================================

  /**
   * Create a new channel.
   *
   * @param name - Human-readable channel name
   * @param type - Channel type: 'direct', 'project', or 'broadcast'
   * @param members - Optional initial member agent IDs
   * @returns The created Channel entity
   */
  async createChannel(
    name: string,
    type: ChannelType,
    members?: string[],
  ): Promise<Channel> {
    return this.manager.createChannel(name, type, members);
  }

  /**
   * Join an existing channel.
   *
   * @param channelId - UUID of the channel to join
   * @param agentId - UUID of the agent joining (defaults to this client's agent)
   * @returns The updated Channel entity
   */
  async joinChannel(channelId: string, agentId?: string): Promise<Channel> {
    return this.manager.joinChannel(channelId, agentId);
  }

  /**
   * Leave a channel.
   *
   * @param channelId - UUID of the channel to leave
   * @param agentId - UUID of the agent leaving (defaults to this client's agent)
   * @returns The updated Channel entity
   */
  async leaveChannel(channelId: string, agentId?: string): Promise<Channel> {
    return this.manager.leaveChannel(channelId, agentId);
  }

  /**
   * Archive a channel (marks as inactive, does not delete).
   *
   * @param channelId - UUID of the channel to archive
   */
  async archiveChannel(channelId: string): Promise<void> {
    return this.manager.archiveChannel(channelId);
  }

  /**
   * Get a channel by ID.
   *
   * @param channelId - UUID of the channel
   * @returns The Channel entity
   */
  async getChannel(channelId: string): Promise<Channel> {
    return this.manager.getChannel(channelId);
  }

  /**
   * List channels with optional filters.
   *
   * @param filter - Optional filter by type or name
   * @returns Array of matching Channel entities
   */
  async listChannels(filter?: ChannelFilter): Promise<Channel[]> {
    return this.manager.listChannels(filter);
  }

  /**
   * Get extended info for a channel including member count and last message.
   *
   * @param channelId - UUID of the channel
   * @returns ChannelInfo with derived statistics
   */
  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    return this.manager.getChannelInfo(channelId);
  }

  // ==========================================================================
  // Publishing (delegated to MessagePublisher)
  // ==========================================================================

  /**
   * Publish a message to a channel.
   *
   * @param channelId - UUID of the target channel
   * @param content - Message content (text or JSON string)
   * @param options - Optional publish settings (type, threading, expiry, metadata)
   * @returns The created Message entity
   */
  async publish(
    channelId: string,
    content: string,
    options?: PublishOptions,
  ): Promise<Message> {
    return this.publisher.publish(channelId, content, options);
  }

  // ==========================================================================
  // Subscription (delegated to MessageSubscriber)
  // ==========================================================================

  /**
   * Subscribe to real-time messages on a channel.
   *
   * @param channelId - UUID of the channel to subscribe to
   * @param callback - Invoked for each incoming message
   * @returns ChannelSubscription with cleanup function
   */
  subscribe(
    channelId: string,
    callback: (message: Message) => void,
  ): ChannelSubscription {
    return this.subscriber.subscribe(channelId, callback);
  }

  /**
   * Disconnect from the SSE stream and remove all subscriptions.
   */
  disconnect(): void {
    this.subscriber.disconnect();
  }

  // ==========================================================================
  // Query (delegated to MessageQuery)
  // ==========================================================================

  /**
   * Query messages in a channel.
   *
   * @param channelId - UUID of the channel to query
   * @param options - Optional query filters and pagination
   * @returns Array of matching Message entities
   */
  async query(
    channelId: string,
    options?: QueryOptions,
  ): Promise<Message[]> {
    return this.queryClient.query(channelId, options);
  }

  /**
   * Get all messages in a conversation thread.
   *
   * @param threadId - Thread identifier
   * @returns Array of messages in the thread
   */
  async getThread(threadId: string): Promise<Message[]> {
    return this.queryClient.getThread(threadId);
  }

  /**
   * Get summary of a conversation thread.
   *
   * @param threadId - Thread identifier
   * @returns ThreadSummary with message count, participants, and boundary messages
   */
  async getThreadSummary(threadId: string): Promise<ThreadSummary> {
    return this.queryClient.getThreadSummary(threadId);
  }

  /**
   * Get all pending messages for an agent.
   *
   * @param agentId - UUID of the target agent (defaults to this client's agent)
   * @returns Array of pending Message entities
   */
  async getPendingMessages(agentId?: string): Promise<Message[]> {
    return this.queryClient.getPendingMessages(agentId);
  }

  /**
   * Mark a message as delivered.
   *
   * @param messageId - UUID of the message
   */
  async markDelivered(messageId: string): Promise<void> {
    return this.queryClient.markDelivered(messageId);
  }

  /**
   * Mark a message as read.
   *
   * @param messageId - UUID of the message
   */
  async markRead(messageId: string): Promise<void> {
    return this.queryClient.markRead(messageId);
  }

  // ==========================================================================
  // Offline Queue (delegated to OfflineQueue)
  // ==========================================================================

  /**
   * Register a callback for offline queued messages.
   *
   * @param callback - Invoked for each pending message. Return true to acknowledge.
   */
  onQueuedMessage(callback: (message: Message) => boolean | Promise<boolean>): void {
    this.offlineQueue.onMessage(callback);
  }

  /**
   * Drain all pending messages for this agent.
   * Delivers queued messages to registered callbacks and marks as delivered.
   *
   * @returns Number of successfully delivered messages
   */
  async drainOfflineQueue(): Promise<number> {
    return this.offlineQueue.drain();
  }

  // ==========================================================================
  // Address Resolution
  // ==========================================================================

  /**
   * Resolve an address URI string into a typed Address object.
   * Supports all four address types: agent, project, broadcast.
   *
   * @param uri - Address URI (e.g. "broadcast://dev-team")
   * @returns Parsed Address with discriminated type field
   */
  resolveAddress(uri: string): Address {
    return parseAddress(uri);
  }

  /**
   * Format a typed Address object back to its URI string.
   *
   * @param address - Typed Address object
   * @returns URI string (e.g. "broadcast://dev-team")
   */
  formatAddress(address: Address): string {
    return formatAddress(address);
  }
}
