/**
 * Discord Bot Bridge
 *
 * Bridges Discord channels to the SignalDB message bus.
 * Users can message agents via Discord, agents respond in Discord threads.
 *
 * Features:
 * - Bidirectional message bridging (Discord <-> SignalDB)
 * - Discord slash commands (/agent, /paste, /memo)
 * - Thread mapping for conversation continuity
 * - Presence display with status colors
 * - Rate limiting per Discord user
 *
 * @example
 * ```typescript
 * import { DiscordBot } from 'claude-code-sdk/comms/bridges/discord';
 *
 * const bot = new DiscordBot({
 *   discordToken: process.env.DISCORD_TOKEN!,
 *   guildId: process.env.DISCORD_GUILD_ID!,
 *   apiUrl: process.env.SIGNALDB_API_URL!,
 *   projectKey: process.env.SIGNALDB_PROJECT_KEY!,
 *   agentId: process.env.SIGNALDB_AGENT_ID!,
 * });
 *
 * bot.addChannelMapping({
 *   discordChannelId: '123456789',
 *   signalDBChannelId: 'channel-uuid',
 *   direction: 'bidirectional',
 * });
 *
 * await bot.start();
 * ```
 *
 * @module comms/bridges/discord
 */

// Main facade
export { DiscordBot } from './discord-bot';

// Core components
export { DiscordGateway } from './gateway';
export { SlashCommandManager } from './commands';
export { ThreadMapper } from './thread-mapper';
export { PresenceSync } from './presence';
export { MessageFormatter } from './formatter';
export { DiscordRateLimiter } from './rate-limiter';
export { MessageBridge } from './message-bridge';

// Types
export type {
  // Configuration
  DiscordBotConfig,
  DiscordChannelMapping,
  ThreadMapping,
  PresenceConfig,
  MessageFormatConfig,
  // Slash commands
  SlashCommandDef,
  SlashCommandOption,
  SlashCommandOptionType,
  // Discord gateway
  DiscordGatewayPayload,
  DiscordHelloData,
  DiscordIdentifyData,
  DiscordReadyData,
  // Discord entities
  DiscordUser,
  DiscordMessage,
  DiscordAttachment,
  DiscordEmbed,
  DiscordThread,
  DiscordGuildMember,
  DiscordActivity,
  // Interactions
  DiscordInteraction,
  DiscordInteractionData,
  DiscordInteractionOption,
  DiscordInteractionResponse,
  DiscordResolvedData,
  // Presence
  DiscordPresenceUpdate,
  // Bridge types
  GatewayConnectionStatus,
  DiscordRateLimitResult,
  DiscordBotStatus,
  DiscordThreadCreateResponse,
  DiscordMessageCreateResponse,
  // Callbacks
  DiscordEventCallback,
} from './types';

// Enums
export {
  DiscordGatewayOpcode,
  DiscordIntent,
  DiscordInteractionType,
  DiscordInteractionCallbackType,
  DiscordMessageFlags,
} from './types';
