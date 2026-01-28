/**
 * Message Bridge
 *
 * Bidirectional message routing between Discord and SignalDB.
 * Handles rate limiting, formatting, and thread mapping.
 */

import type { ChannelClient } from '../../channels/channel-client';
import type { Message } from '../../protocol/types';
import type { MessageFormatter } from './formatter';
import type { DiscordGateway } from './gateway';
import type { DiscordRateLimiter } from './rate-limiter';
import type { ThreadMapper } from './thread-mapper';
import type {
  DiscordBotConfig,
  DiscordChannelMapping,
  DiscordMessage,
  DiscordMessageCreateResponse,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord API base URL */
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// ============================================================================
// Message Bridge
// ============================================================================

/**
 * Bridges messages between Discord and SignalDB bidirectionally.
 *
 * - Discord -> SignalDB: Rate limit, format, map thread, publish
 * - SignalDB -> Discord: Format, map thread, post to Discord
 *
 * @example
 * ```typescript
 * const bridge = new MessageBridge(
 *   config,
 *   gateway,
 *   channelClient,
 *   threadMapper,
 *   formatter,
 *   rateLimiter,
 *   channelMappings,
 * );
 *
 * await bridge.start();
 *
 * // Bridge automatically routes messages in both directions
 *
 * await bridge.stop();
 * ```
 */
export class MessageBridge {
  private readonly config: DiscordBotConfig;
  private readonly gateway: DiscordGateway;
  private readonly channelClient: ChannelClient;
  private readonly threadMapper: ThreadMapper;
  private readonly formatter: MessageFormatter;
  private readonly rateLimiter: DiscordRateLimiter;
  private readonly channelMappings: Map<string, DiscordChannelMapping>;

  private isRunning = false;
  private messagesFromDiscord = 0;
  private messagesFromSignalDB = 0;

  constructor(
    config: DiscordBotConfig,
    gateway: DiscordGateway,
    channelClient: ChannelClient,
    threadMapper: ThreadMapper,
    formatter: MessageFormatter,
    rateLimiter: DiscordRateLimiter,
    channelMappings?: DiscordChannelMapping[]
  ) {
    this.config = config;
    this.gateway = gateway;
    this.channelClient = channelClient;
    this.threadMapper = threadMapper;
    this.formatter = formatter;
    this.rateLimiter = rateLimiter;

    // Index channel mappings by Discord channel ID
    this.channelMappings = new Map();
    if (channelMappings) {
      for (let i = 0; i < channelMappings.length; i++) {
        const mapping = channelMappings[i]!;
        this.channelMappings.set(mapping.discordChannelId, mapping);
      }
    }
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Start the message bridge.
   * Subscribes to both Discord and SignalDB message sources.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Listen for Discord messages
    this.gateway.onDiscordMessage(async (message) => {
      await this.handleDiscordMessage(message);
    });

    // Listen for SignalDB messages
    this.gateway.onSignalDBMessage(async (message) => {
      await this.handleSignalDBMessage(message);
    });
  }

  /**
   * Stop the message bridge.
   */
  stop(): void {
    this.isRunning = false;
    // Callbacks remain registered but won't process when not running
  }

  /**
   * Handle a message from Discord -> SignalDB.
   *
   * @param message - Discord message object
   */
  async handleDiscordMessage(message: DiscordMessage): Promise<void> {
    if (!this.isRunning) return;

    // Ignore bot messages
    if (message.author.bot) return;

    // Check rate limit
    const limitResult = this.rateLimiter.checkLimit(message.author.id);
    if (!limitResult.allowed) {
      // Could send ephemeral rate limit warning
      return;
    }

    // Record the message for rate limiting
    this.rateLimiter.recordMessage(message.author.id);

    // Find channel mapping
    const channelId = message.thread?.parent_id || message.channel_id;
    const mapping = this.channelMappings.get(channelId);

    // Determine SignalDB channel
    let signalDBChannelId: string;
    if (mapping) {
      // Check if direction allows Discord -> SignalDB
      if (mapping.direction === 'signaldb-to-discord') {
        return; // Not allowed in this direction
      }
      signalDBChannelId = mapping.signalDBChannelId;
    } else {
      // No mapping, use default channel or skip
      return;
    }

    // Format message for SignalDB
    const content = this.formatter.formatForSignalDB(message);

    // Get or create thread mapping
    let threadId: string | undefined;
    if (message.thread) {
      threadId = this.threadMapper.mapDiscordToSignalDB(message.thread.id);
    }

    try {
      // Publish to SignalDB
      await this.channelClient.publish(signalDBChannelId, content, {
        messageType: 'chat',
        threadId,
        metadata: {
          source: 'discord',
          discordUserId: message.author.id,
          discordUsername: message.author.username,
          discordChannelId: message.channel_id,
          discordMessageId: message.id,
        },
      });

      this.messagesFromDiscord++;
    } catch (err) {
      // Log error but don't crash
      console.error('Failed to publish Discord message to SignalDB:', err);
    }
  }

  /**
   * Handle a message from SignalDB -> Discord.
   *
   * @param message - SignalDB message object
   */
  async handleSignalDBMessage(message: Message): Promise<void> {
    if (!this.isRunning) return;

    // Skip messages that originated from Discord
    if (message.metadata?.source === 'discord') {
      return;
    }

    // Find reverse channel mapping (SignalDB -> Discord)
    let discordChannelId: string | null = null;
    for (const [discordId, mapping] of this.channelMappings) {
      if (
        mapping.signalDBChannelId === message.channelId &&
        mapping.direction !== 'discord-to-signaldb'
      ) {
        discordChannelId = discordId;
        break;
      }
    }

    if (!discordChannelId) {
      // No mapping for this SignalDB channel
      return;
    }

    // Format message for Discord
    const content = await this.formatter.formatForDiscord(message.content);

    // Determine target Discord channel/thread
    let targetChannelId = discordChannelId;

    if (message.threadId) {
      // Check if we have a Discord thread for this SignalDB thread
      const discordThreadId = this.threadMapper.mapSignalDBToDiscord(message.threadId);

      if (discordThreadId) {
        targetChannelId = discordThreadId;
      } else {
        // Create a new Discord thread for this conversation
        try {
          const threadTitle = this.generateThreadTitle(message);
          const newThreadId = await this.threadMapper.getOrCreateDiscordThread(
            discordChannelId,
            message.threadId,
            threadTitle
          );
          targetChannelId = newThreadId;
        } catch (err) {
          // Fall back to posting in the main channel
          console.error('Failed to create Discord thread:', err);
        }
      }
    }

    try {
      // Post to Discord
      await this.postToDiscord(targetChannelId, content);
      this.messagesFromSignalDB++;
    } catch (err) {
      console.error('Failed to post SignalDB message to Discord:', err);
    }
  }

  /**
   * Add a channel mapping.
   *
   * @param mapping - Channel mapping configuration
   */
  addChannelMapping(mapping: DiscordChannelMapping): void {
    this.channelMappings.set(mapping.discordChannelId, mapping);
  }

  /**
   * Remove a channel mapping.
   *
   * @param discordChannelId - Discord channel ID to remove
   */
  removeChannelMapping(discordChannelId: string): void {
    this.channelMappings.delete(discordChannelId);
  }

  /**
   * Get bridge statistics.
   */
  getStats(): {
    messagesFromDiscord: number;
    messagesFromSignalDB: number;
    channelMappings: number;
  } {
    return {
      messagesFromDiscord: this.messagesFromDiscord,
      messagesFromSignalDB: this.messagesFromSignalDB,
      channelMappings: this.channelMappings.size,
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Post a message to a Discord channel via REST API.
   */
  private async postToDiscord(
    channelId: string,
    content: string
  ): Promise<DiscordMessageCreateResponse> {
    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to post to Discord: ${response.status} ${error}`);
    }

    return response.json() as Promise<DiscordMessageCreateResponse>;
  }

  /**
   * Generate a thread title from a message.
   */
  private generateThreadTitle(message: Message): string {
    // Use first 50 chars of content, or fallback to agent info
    if (message.content.length > 0) {
      const title = message.content
        .replace(/```[\s\S]*?```/g, '') // Remove code blocks
        .replace(/\n/g, ' ')
        .trim()
        .slice(0, 50);

      if (title.length > 0) {
        return title + (message.content.length > 50 ? '...' : '');
      }
    }

    return `Thread ${message.threadId?.slice(0, 8) || message.id.slice(0, 8)}`;
  }
}
