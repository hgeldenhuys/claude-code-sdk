/**
 * Channel Lifecycle Manager
 *
 * High-level channel operations wrapping the SignalDB REST client.
 * Provides create, join, leave, archive, and query methods for channels.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Channel, ChannelFilter, ChannelType } from '../protocol/types';
import type { ChannelInfo } from './types';

// ============================================================================
// Channel Manager
// ============================================================================

/**
 * Manages channel lifecycle: creation, membership, archiving, and info queries.
 *
 * @example
 * ```typescript
 * const manager = new ChannelManager(client, 'agent-001');
 *
 * const channel = await manager.createChannel('dev-chat', 'project');
 * await manager.joinChannel(channel.id, 'agent-002');
 *
 * const info = await manager.getChannelInfo(channel.id);
 * console.log(`${info.memberCount} members`);
 * ```
 */
export class ChannelManager {
  private readonly client: SignalDBClient;
  private readonly agentId: string;

  constructor(client: SignalDBClient, agentId: string) {
    this.client = client;
    this.agentId = agentId;
  }

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
    return this.client.channels.create({
      name,
      type,
      members: members ?? [],
      createdBy: this.agentId,
    });
  }

  /**
   * Join an existing channel by adding the agent as a member.
   *
   * @param channelId - UUID of the channel to join
   * @param agentId - UUID of the agent joining (defaults to this client's agent)
   * @returns The updated Channel entity
   */
  async joinChannel(channelId: string, agentId?: string): Promise<Channel> {
    const targetAgentId = agentId ?? this.agentId;
    return this.client.channels.addMember(channelId, targetAgentId);
  }

  /**
   * Leave a channel by removing the agent from members.
   *
   * @param channelId - UUID of the channel to leave
   * @param agentId - UUID of the agent leaving (defaults to this client's agent)
   * @returns The updated Channel entity
   */
  async leaveChannel(channelId: string, agentId?: string): Promise<Channel> {
    const targetAgentId = agentId ?? this.agentId;
    return this.client.channels.removeMember(channelId, targetAgentId);
  }

  /**
   * Archive a channel by setting archived metadata.
   * Archived channels are not deleted but marked as inactive.
   *
   * @param channelId - UUID of the channel to archive
   */
  async archiveChannel(channelId: string): Promise<void> {
    // Archive via metadata update - the channel is not deleted,
    // just marked as archived. We fetch, update metadata, and
    // use a targeted approach.
    // SignalDB doesn't have a direct archive endpoint, so we use
    // the channel's metadata to flag it as archived.
    const channel = await this.client.channels.get(channelId);
    // Since the REST client doesn't expose a direct metadata update,
    // we send a system message to the channel marking it archived.
    // The channel still exists but consumers check metadata.archived.
    // For now, we'll leave the channel members and mark it via
    // a "command" message indicating archive status.
    await this.client.messages.send({
      channelId,
      senderId: this.agentId,
      targetType: 'broadcast',
      targetAddress: `broadcast://${channel.name}`,
      messageType: 'command',
      content: JSON.stringify({
        action: 'channel.archive',
        channelId,
        archivedBy: this.agentId,
        archivedAt: new Date().toISOString(),
      }),
    });
  }

  /**
   * Get a channel by its ID.
   *
   * @param channelId - UUID of the channel
   * @returns The Channel entity
   */
  async getChannel(channelId: string): Promise<Channel> {
    return this.client.channels.get(channelId);
  }

  /**
   * List channels with optional filters.
   *
   * @param filter - Optional filter by type or name
   * @returns Array of matching Channel entities
   */
  async listChannels(filter?: ChannelFilter): Promise<Channel[]> {
    return this.client.channels.list(filter);
  }

  /**
   * Get extended info for a channel including member count and last message.
   *
   * @param channelId - UUID of the channel
   * @returns ChannelInfo with derived statistics
   */
  async getChannelInfo(channelId: string): Promise<ChannelInfo> {
    const channel = await this.client.channels.get(channelId);

    // Fetch the most recent message
    const messages = await this.client.messages.listByChannel(channelId, {
      limit: 1,
    });

    const lastMessage = messages.length > 0 ? messages[0]! : null;

    return {
      channel,
      memberCount: channel.members ? channel.members.length : 0,
      lastMessage,
    };
  }
}
