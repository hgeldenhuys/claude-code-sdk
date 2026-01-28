/**
 * Channel Messaging Module
 *
 * Real-time bidirectional messaging between agents via channels.
 *
 * @example
 * ```typescript
 * import {
 *   ChannelClient,
 *   ChannelManager,
 *   MessagePublisher,
 *   MessageSubscriber,
 *   MessageQuery,
 *   OfflineQueue,
 * } from 'claude-code-sdk/comms/channels';
 *
 * const client = new ChannelClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 *   agentId: 'agent-001',
 * });
 * ```
 */

// Types
export type {
  ChannelConfig,
  ChannelSubscription,
  PublishOptions,
  QueryOptions,
  ChannelInfo,
  ThreadSummary,
} from './types';

// Channel lifecycle
export { ChannelManager } from './channel-manager';

// Message publishing
export { MessagePublisher } from './publisher';

// Real-time subscription
export { MessageSubscriber } from './subscriber';

// Message queries and threading
export { MessageQuery } from './query';

// Offline message delivery
export { OfflineQueue, type QueuedMessageCallback } from './offline-queue';

// Unified facade
export { ChannelClient } from './channel-client';

// Secure wrapper
export { SecureChannelClient } from './secure-channel-client';
