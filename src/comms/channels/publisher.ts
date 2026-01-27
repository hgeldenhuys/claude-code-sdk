/**
 * Message Publisher
 *
 * Publishes messages to channels via the SignalDB REST client.
 * Resolves target addresses from channel metadata and supports
 * all message types with threading.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Channel, Message } from '../protocol/types';
import { formatAddress } from '../protocol/address';
import type { Address } from '../protocol/types';
import type { PublishOptions } from './types';

// ============================================================================
// Publisher
// ============================================================================

/**
 * Publishes messages to channels with address resolution and threading support.
 *
 * @example
 * ```typescript
 * const publisher = new MessagePublisher(client, 'agent-001');
 *
 * // Simple chat message
 * const msg = await publisher.publish(channelId, 'Hello team!');
 *
 * // Threaded command message
 * const cmd = await publisher.publish(channelId, '{"action":"build"}', {
 *   messageType: 'command',
 *   threadId: msg.id,
 * });
 * ```
 */
export class MessagePublisher {
  private readonly client: SignalDBClient;
  private readonly agentId: string;

  constructor(client: SignalDBClient, agentId: string) {
    this.client = client;
    this.agentId = agentId;
  }

  /**
   * Publish a message to a channel.
   *
   * Resolves the channel's target address from its type and name.
   * Defaults to 'chat' message type if not specified.
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
    // Fetch channel to resolve the target address
    const channel = await this.client.channels.get(channelId);
    const address = resolveChannelAddress(channel);

    return this.client.messages.send({
      channelId,
      senderId: this.agentId,
      targetType: address.type,
      targetAddress: formatAddress(address),
      messageType: options?.messageType ?? 'chat',
      content,
      metadata: options?.metadata,
      threadId: options?.threadId,
      expiresAt: options?.expiresAt,
    });
  }
}

// ============================================================================
// Address Resolution
// ============================================================================

/**
 * Derive a target Address from a Channel entity.
 *
 * - broadcast channels -> broadcast://channel-name
 * - project channels -> broadcast://channel-name (project scope managed by members)
 * - direct channels -> broadcast://channel-name (1:1 scoped by members)
 *
 * All channel types use the broadcast address scheme because messages
 * are routed through the channel, not directly to an agent.
 */
function resolveChannelAddress(channel: Channel): Address {
  return {
    type: 'broadcast',
    channelName: channel.name,
  };
}
