/**
 * Discord Bot Facade
 *
 * Unified entry point for the Discord-SignalDB bridge.
 * Composes all components into a single manageable bot instance.
 */

import { ChannelClient } from '../../channels/channel-client';
import { MemoClient } from '../../memos/memo-client';
import { PasteClient } from '../../pastes/paste-client';
import { DiscordChatHandler } from './chat-handler';
import { SlashCommandManager } from './commands';
import { MessageFormatter } from './formatter';
import { DiscordGateway } from './gateway';
import { MessageBridge } from './message-bridge';
import { PresenceSync } from './presence';
import { DiscordRateLimiter } from './rate-limiter';
import { ThreadMapper } from './thread-mapper';
import type {
  DiscordBotConfig,
  DiscordBotStatus,
  DiscordChannelMapping,
  GatewayConnectionStatus,
  PresenceConfig,
} from './types';

// ============================================================================
// Discord Bot
// ============================================================================

/**
 * Discord Bot facade composing all bridge components.
 *
 * Provides a single entry point for:
 * - Discord Gateway connection (WebSocket)
 * - SignalDB SSE subscription
 * - Slash command registration and handling
 * - Thread mapping (Discord <-> SignalDB)
 * - Presence sync (agent status -> Discord embeds)
 * - Message formatting
 * - Rate limiting
 * - Bidirectional message bridging
 *
 * @example
 * ```typescript
 * const bot = new DiscordBot({
 *   discordToken: process.env.DISCORD_TOKEN!,
 *   guildId: process.env.DISCORD_GUILD_ID!,
 *   apiUrl: process.env.SIGNALDB_API_URL!,
 *   projectKey: process.env.SIGNALDB_PROJECT_KEY!,
 *   agentId: process.env.SIGNALDB_AGENT_ID!,
 * });
 *
 * // Add channel mappings
 * bot.addChannelMapping({
 *   discordChannelId: '123456789',
 *   signalDBChannelId: 'uuid-here',
 *   direction: 'bidirectional',
 * });
 *
 * // Start the bot
 * await bot.start();
 *
 * // Check status
 * const status = bot.getStatus();
 * console.log(status.connection);
 *
 * // Graceful shutdown
 * await bot.stop();
 * ```
 */
export class DiscordBot {
  private readonly config: DiscordBotConfig;
  private readonly gateway: DiscordGateway;
  private readonly commandManager: SlashCommandManager;
  private readonly chatHandler: DiscordChatHandler;
  private readonly threadMapper: ThreadMapper;
  private readonly presenceSync: PresenceSync;
  private readonly formatter: MessageFormatter;
  private readonly rateLimiter: DiscordRateLimiter;
  private readonly messageBridge: MessageBridge;

  // Clients for slash command handlers
  private readonly channelClient: ChannelClient;
  private readonly memoClient: MemoClient;
  private readonly pasteClient: PasteClient;

  private channelMappings: DiscordChannelMapping[] = [];
  private startTime: number | null = null;
  private isRunning = false;

  constructor(config: DiscordBotConfig, presenceConfig?: Partial<PresenceConfig>) {
    this.config = {
      ...config,
      commandPrefix: config.commandPrefix ?? '!',
      rateLimitPerUser: config.rateLimitPerUser ?? 10,
    };

    // Initialize SignalDB clients
    this.channelClient = new ChannelClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
      agentId: config.agentId,
    });

    this.memoClient = new MemoClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
      agentId: config.agentId,
    });

    this.pasteClient = new PasteClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
      agentId: config.agentId,
    });

    // Initialize Discord components
    this.gateway = new DiscordGateway(this.config);

    this.commandManager = new SlashCommandManager(this.config, {
      channel: this.channelClient,
      memo: this.memoClient,
      paste: this.pasteClient,
    });

    this.threadMapper = new ThreadMapper(this.config);
    this.presenceSync = new PresenceSync(this.config, presenceConfig);
    this.formatter = new MessageFormatter(undefined, this.pasteClient);
    this.chatHandler = new DiscordChatHandler(this.config, this.formatter);
    this.rateLimiter = new DiscordRateLimiter(this.config.rateLimitPerUser);

    this.messageBridge = new MessageBridge(
      this.config,
      this.gateway,
      this.channelClient,
      this.threadMapper,
      this.formatter,
      this.rateLimiter,
      this.channelMappings
    );
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the Discord bot.
   *
   * 1. Connect to Discord Gateway
   * 2. Connect to SignalDB SSE
   * 3. Register slash commands
   * 4. Start presence sync
   * 5. Start message bridge
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Bot is already running');
    }

    this.startTime = Date.now();
    this.isRunning = true;

    try {
      // Connect to both gateways
      await this.gateway.connect();

      // Register slash commands with Discord
      await this.commandManager.registerCommands(this.config.guildId);

      // Set up interaction handler -- route /chat to ChatHandler, rest to CommandManager
      this.gateway.onDiscordInteraction(async (interaction) => {
        if (interaction.data?.name === 'chat') {
          await this.chatHandler.handleChatCommand(interaction);
        } else {
          await this.commandManager.handleInteraction(interaction);
        }
      });

      // Set up message handler -- check for tracked chat threads before bridging
      this.gateway.onDiscordMessage(async (message) => {
        if (this.chatHandler.isTrackedThread(message.channel_id)) {
          await this.chatHandler.handleThreadMessage(message);
        }
        // Note: MessageBridge also registers its own message handler in start()
      });

      // Start presence sync
      this.presenceSync.start();

      // Start message bridge
      this.messageBridge.start();
    } catch (err) {
      this.isRunning = false;
      this.startTime = null;
      throw err;
    }
  }

  /**
   * Stop the Discord bot gracefully.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Stop components in reverse order
    this.messageBridge.stop();
    this.chatHandler.dispose();
    this.presenceSync.stop();
    this.gateway.disconnect();
    this.channelClient.disconnect();

    this.startTime = null;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  /**
   * Add a channel mapping between Discord and SignalDB.
   *
   * @param mapping - Channel mapping configuration
   */
  addChannelMapping(mapping: DiscordChannelMapping): void {
    this.channelMappings.push(mapping);
    this.messageBridge.addChannelMapping(mapping);
  }

  /**
   * Remove a channel mapping.
   *
   * @param discordChannelId - Discord channel ID to remove
   */
  removeChannelMapping(discordChannelId: string): void {
    this.channelMappings = this.channelMappings.filter(
      (m) => m.discordChannelId !== discordChannelId
    );
    this.messageBridge.removeChannelMapping(discordChannelId);
  }

  /**
   * Get all channel mappings.
   */
  getChannelMappings(): DiscordChannelMapping[] {
    return [...this.channelMappings];
  }

  // ==========================================================================
  // Status
  // ==========================================================================

  /**
   * Get the bot's current status and metrics.
   */
  getStatus(): DiscordBotStatus {
    const connection = this.gateway.isConnected();
    const bridgeStats = this.messageBridge.getStats();

    return {
      connection,
      threadMappings: this.threadMapper.getMappingCount(),
      channelMappings: this.channelMappings.length,
      messagesFromDiscord: bridgeStats.messagesFromDiscord,
      messagesFromSignalDB: bridgeStats.messagesFromSignalDB,
      rateLimitedUsers: this.rateLimiter.getRateLimitedUserCount(),
      uptimeMs: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  /**
   * Check if the bot is connected to both Discord and SignalDB.
   */
  isConnected(): GatewayConnectionStatus {
    return this.gateway.isConnected();
  }

  /**
   * Check if the bot is running.
   */
  isActive(): boolean {
    return this.isRunning;
  }

  // ==========================================================================
  // Component Access
  // ==========================================================================

  /**
   * Get the gateway instance for advanced operations.
   */
  getGateway(): DiscordGateway {
    return this.gateway;
  }

  /**
   * Get the chat handler instance.
   */
  getChatHandler(): DiscordChatHandler {
    return this.chatHandler;
  }

  /**
   * Get the thread mapper instance.
   */
  getThreadMapper(): ThreadMapper {
    return this.threadMapper;
  }

  /**
   * Get the presence sync instance.
   */
  getPresenceSync(): PresenceSync {
    return this.presenceSync;
  }

  /**
   * Get the message formatter instance.
   */
  getFormatter(): MessageFormatter {
    return this.formatter;
  }

  /**
   * Get the rate limiter instance.
   */
  getRateLimiter(): DiscordRateLimiter {
    return this.rateLimiter;
  }

  /**
   * Get the channel client for direct SignalDB operations.
   */
  getChannelClient(): ChannelClient {
    return this.channelClient;
  }

  /**
   * Get the memo client for direct SignalDB operations.
   */
  getMemoClient(): MemoClient {
    return this.memoClient;
  }

  /**
   * Get the paste client for direct SignalDB operations.
   */
  getPasteClient(): PasteClient {
    return this.pasteClient;
  }
}
