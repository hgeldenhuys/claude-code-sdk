/**
 * Channel Messaging Types
 *
 * Configuration, subscription, query, and info types for the
 * channel-based messaging system.
 */

import type { Channel, Message, MessageType } from '../protocol/types';
import type { SSEClient } from '../daemon/sse-client';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the channel messaging client.
 *
 * @example
 * ```typescript
 * const config: ChannelConfig = {
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-uuid-001',
 * };
 * ```
 */
export interface ChannelConfig {
  /** SignalDB API base URL */
  apiUrl: string;
  /** SignalDB project API key */
  projectKey: string;
  /** The current agent's UUID in SignalDB */
  agentId: string;
  /** Optional shared SSE client (e.g. from daemon). If not provided, creates its own. */
  sseClient?: SSEClient;
}

// ============================================================================
// Subscription
// ============================================================================

/**
 * Active subscription to a channel's message stream.
 * Call `unsubscribe()` to stop receiving messages and clean up resources.
 */
export interface ChannelSubscription {
  /** The channel being subscribed to */
  channelId: string;
  /** Callback invoked for each incoming message */
  callback: (message: Message) => void;
  /** Cleanup function that removes this subscription */
  unsubscribe: () => void;
}

// ============================================================================
// Publish Options
// ============================================================================

/**
 * Options for publishing a message to a channel.
 *
 * @example
 * ```typescript
 * await publisher.publish(channelId, 'Hello!', {
 *   messageType: 'chat',
 *   threadId: 'thread-abc',
 *   metadata: { priority: 'high' },
 * });
 * ```
 */
export interface PublishOptions {
  /** Message content type (default: 'chat') */
  messageType?: MessageType;
  /** Thread ID for conversation threading */
  threadId?: string;
  /** ISO 8601 expiration timestamp */
  expiresAt?: string;
  /** Arbitrary metadata attached to the message */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Query Options
// ============================================================================

/**
 * Options for querying messages in a channel.
 *
 * @example
 * ```typescript
 * const messages = await query.query(channelId, {
 *   limit: 50,
 *   messageType: 'command',
 *   since: '2026-01-01T00:00:00Z',
 * });
 * ```
 */
export interface QueryOptions {
  /** Maximum number of messages to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Filter by thread ID */
  threadId?: string;
  /** Filter by message delivery status */
  status?: string;
  /** Filter by message type */
  messageType?: MessageType;
  /** Return only messages created after this ISO 8601 timestamp */
  since?: string;
}

// ============================================================================
// Channel Info
// ============================================================================

/**
 * Extended channel information including derived statistics.
 */
export interface ChannelInfo {
  /** The channel entity */
  channel: Channel;
  /** Number of members in the channel */
  memberCount: number;
  /** The most recent message in the channel (null if no messages) */
  lastMessage: Message | null;
}

// ============================================================================
// Thread Summary
// ============================================================================

/**
 * Summary of a conversation thread within a channel.
 */
export interface ThreadSummary {
  /** The thread identifier */
  threadId: string;
  /** Total number of messages in the thread */
  messageCount: number;
  /** Unique sender IDs that participated in the thread */
  participants: string[];
  /** The first message in the thread */
  firstMessage: Message;
  /** The most recent message in the thread */
  lastMessage: Message;
}
