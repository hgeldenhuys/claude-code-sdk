/**
 * Discord Bot Bridge Types
 *
 * Type definitions for the Discord-SignalDB bridge.
 * No external discord.js dependency - types are defined inline.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration for the Discord bot bridge.
 */
export interface DiscordBotConfig {
  /** Discord bot token for authentication */
  discordToken: string;
  /** Discord guild (server) ID to operate in */
  guildId: string;
  /** SignalDB API base URL */
  apiUrl: string;
  /** SignalDB project API key */
  projectKey: string;
  /** Agent ID for this bot in SignalDB */
  agentId: string;
  /** Prefix for legacy text commands (default: '!') */
  commandPrefix?: string;
  /** Rate limit: messages per minute per user (default: 10) */
  rateLimitPerUser?: number;
  /** Discord category ID for agent channels (auto-created if missing) */
  agentCategoryId?: string;
  /** Discord user IDs allowed to manage agent access (bot owners) */
  ownerUserIds?: string[];
}

/**
 * Mapping between Discord channels and SignalDB channels.
 */
export interface DiscordChannelMapping {
  /** Discord channel snowflake ID */
  discordChannelId: string;
  /** SignalDB channel UUID */
  signalDBChannelId: string;
  /** Message flow direction */
  direction: 'bidirectional' | 'discord-to-signaldb' | 'signaldb-to-discord';
}

/**
 * Bidirectional mapping between Discord threads and SignalDB threads.
 */
export interface ThreadMapping {
  /** Discord thread snowflake ID */
  discordThreadId: string;
  /** SignalDB thread UUID */
  signalDBThreadId: string;
  /** When the mapping was created */
  createdAt: string;
}

/**
 * Presence sync configuration.
 */
export interface PresenceConfig {
  /** How often to sync presence (ms), default: 30000 */
  updateIntervalMs: number;
  /** Emoji prefix for status display */
  statusEmoji: {
    active: string;
    idle: string;
    offline: string;
  };
}

/**
 * Message formatting configuration.
 */
export interface MessageFormatConfig {
  /** Maximum message length before truncation (Discord limit: 2000) */
  maxLength: number;
  /** Suffix to append when truncating */
  truncationSuffix: string;
  /** Default language for code blocks */
  codeBlockLang: string;
}

// ============================================================================
// Slash Command Types
// ============================================================================

/**
 * Discord slash command option types.
 */
export type SlashCommandOptionType = 'SUB_COMMAND' | 'STRING' | 'INTEGER' | 'BOOLEAN' | 'USER' | 'CHANNEL' | 'ROLE';

/**
 * Discord slash command option definition.
 */
export interface SlashCommandOption {
  /** Option name (lowercase, no spaces) */
  name: string;
  /** Option description for Discord UI */
  description: string;
  /** Option type */
  type: SlashCommandOptionType;
  /** Whether this option is required */
  required?: boolean;
  /** Predefined choices for this option */
  choices?: Array<{ name: string; value: string }>;
  /** Nested options (for SUB_COMMAND type) */
  options?: SlashCommandOption[];
}

/**
 * Discord slash command definition.
 */
export interface SlashCommandDef {
  /** Command name (lowercase, no spaces) */
  name: string;
  /** Command description for Discord UI */
  description: string;
  /** Command options/arguments */
  options?: SlashCommandOption[];
}

// ============================================================================
// Discord Gateway Event Types
// ============================================================================

/**
 * Discord gateway opcodes.
 */
export enum DiscordGatewayOpcode {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  PresenceUpdate = 3,
  VoiceStateUpdate = 4,
  Resume = 6,
  Reconnect = 7,
  RequestGuildMembers = 8,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatACK = 11,
}

/**
 * Discord gateway intents (bitfield).
 */
export enum DiscordIntent {
  Guilds = 1 << 0,
  GuildMembers = 1 << 1,
  GuildMessages = 1 << 9,
  GuildMessageReactions = 1 << 10,
  DirectMessages = 1 << 12,
  MessageContent = 1 << 15,
}

/**
 * Base Discord gateway payload.
 */
export interface DiscordGatewayPayload {
  /** Opcode */
  op: DiscordGatewayOpcode;
  /** Event data (for Dispatch) */
  d: unknown;
  /** Sequence number (for Dispatch) */
  s: number | null;
  /** Event name (for Dispatch) */
  t: string | null;
}

/**
 * HELLO payload data from Discord.
 */
export interface DiscordHelloData {
  /** Heartbeat interval in milliseconds */
  heartbeat_interval: number;
}

/**
 * IDENTIFY payload data to send to Discord.
 */
export interface DiscordIdentifyData {
  token: string;
  intents: number;
  properties: {
    os: string;
    browser: string;
    device: string;
  };
}

/**
 * READY event data from Discord.
 */
export interface DiscordReadyData {
  v: number;
  user: DiscordUser;
  guilds: Array<{ id: string; unavailable?: boolean }>;
  session_id: string;
  resume_gateway_url: string;
  application: { id: string; flags: number };
}

/**
 * Discord user object.
 */
export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  bot?: boolean;
  system?: boolean;
  global_name?: string | null;
}

/**
 * Discord message object from MESSAGE_CREATE event.
 */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp: string | null;
  tts: boolean;
  mention_everyone: boolean;
  mentions: DiscordUser[];
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  thread?: DiscordThread;
  referenced_message?: DiscordMessage | null;
}

/**
 * Discord attachment object.
 */
export interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
  height?: number;
  width?: number;
}

/**
 * Discord embed object.
 */
export interface DiscordEmbed {
  title?: string;
  type?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: { url: string; height?: number; width?: number };
  thumbnail?: { url: string; height?: number; width?: number };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * Discord thread object.
 */
export interface DiscordThread {
  id: string;
  guild_id?: string;
  parent_id: string | null;
  owner_id?: string;
  name: string;
  type: number;
  member_count?: number;
  message_count?: number;
  archived?: boolean;
  auto_archive_duration?: number;
  archive_timestamp?: string;
  locked?: boolean;
}

/**
 * Discord interaction object from INTERACTION_CREATE event.
 */
export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: DiscordInteractionType;
  data?: DiscordInteractionData;
  guild_id?: string;
  channel_id?: string;
  member?: DiscordGuildMember;
  user?: DiscordUser;
  token: string;
  version: number;
  message?: DiscordMessage;
}

/**
 * Discord interaction types.
 */
export enum DiscordInteractionType {
  Ping = 1,
  ApplicationCommand = 2,
  MessageComponent = 3,
  ApplicationCommandAutocomplete = 4,
  ModalSubmit = 5,
}

/**
 * Discord interaction data (for slash commands).
 */
export interface DiscordInteractionData {
  id: string;
  name: string;
  type: number;
  resolved?: DiscordResolvedData;
  options?: DiscordInteractionOption[];
  guild_id?: string;
  target_id?: string;
}

/**
 * Discord resolved data for interactions.
 */
export interface DiscordResolvedData {
  users?: Record<string, DiscordUser>;
  members?: Record<string, Partial<DiscordGuildMember>>;
  channels?: Record<string, Partial<DiscordThread>>;
}

/**
 * Discord interaction option.
 */
export interface DiscordInteractionOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordInteractionOption[];
  focused?: boolean;
}

/**
 * Discord guild member object.
 */
export interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
  avatar?: string | null;
  roles: string[];
  joined_at: string;
  deaf: boolean;
  mute: boolean;
}

/**
 * Discord presence update object.
 */
export interface DiscordPresenceUpdate {
  user: Partial<DiscordUser> & { id: string };
  guild_id?: string;
  status: 'online' | 'dnd' | 'idle' | 'invisible' | 'offline';
  activities: DiscordActivity[];
  client_status: {
    desktop?: string;
    mobile?: string;
    web?: string;
  };
}

/**
 * Discord activity object.
 */
export interface DiscordActivity {
  name: string;
  type: number;
  url?: string | null;
  created_at: number;
  details?: string | null;
  state?: string | null;
}

// ============================================================================
// Internal Bridge Types
// ============================================================================

/**
 * Connection status for the gateway.
 */
export interface GatewayConnectionStatus {
  /** Connected to Discord WebSocket */
  discord: boolean;
  /** Connected to SignalDB SSE */
  signaldb: boolean;
}

/**
 * Rate limit check result.
 */
export interface DiscordRateLimitResult {
  /** Whether the action is allowed */
  allowed: boolean;
  /** Remaining actions in current window */
  remaining: number;
  /** Milliseconds until limit resets (if not allowed) */
  retryAfterMs: number;
}

/**
 * Discord API response for creating a thread.
 */
export interface DiscordThreadCreateResponse {
  id: string;
  name: string;
  parent_id: string;
  guild_id: string;
  type: number;
}

/**
 * Discord API response for sending a message.
 */
export interface DiscordMessageCreateResponse {
  id: string;
  channel_id: string;
  content: string;
  timestamp: string;
  author: DiscordUser;
}

/**
 * Discord interaction response types.
 */
export enum DiscordInteractionCallbackType {
  Pong = 1,
  ChannelMessageWithSource = 4,
  DeferredChannelMessageWithSource = 5,
  DeferredUpdateMessage = 6,
  UpdateMessage = 7,
  ApplicationCommandAutocompleteResult = 8,
  Modal = 9,
}

/**
 * Discord interaction response payload.
 */
export interface DiscordInteractionResponse {
  type: DiscordInteractionCallbackType;
  data?: {
    tts?: boolean;
    content?: string;
    embeds?: DiscordEmbed[];
    flags?: number;
    components?: unknown[];
  };
}

/**
 * Discord message flags.
 */
export enum DiscordMessageFlags {
  Crossposted = 1 << 0,
  IsCrosspost = 1 << 1,
  SuppressEmbeds = 1 << 2,
  SourceMessageDeleted = 1 << 3,
  Urgent = 1 << 4,
  HasThread = 1 << 5,
  Ephemeral = 1 << 6,
  Loading = 1 << 7,
}

/**
 * Active chat conversation between a Discord user and an AI agent.
 * Created when a user uses /chat and maintained for thread follow-ups.
 */
export interface ChatConversation {
  /** Discord thread ID (thread has its own channel ID) */
  discordThreadId: string;
  /** SignalDB thread ID for continuation */
  signalDBThreadId: string;
  /** Target agent for this conversation */
  agentId: string;
  /** Agent display name */
  agentName: string;
  /** Machine ID of the agent */
  agentMachineId: string;
  /** When this conversation was created */
  createdAt: number;
  /** Last activity timestamp (for cleanup) */
  lastActivityAt: number;
  /** Discord user who started the conversation */
  discordUserId: string;
}

/**
 * Info about a Discord channel mapped to an agent.
 * Stored by AgentChannelManager for routing messages.
 */
export interface AgentChannelInfo {
  /** Agent session name (used as channel name) */
  sessionName: string;
  /** Agent machine ID */
  machineId: string;
  /** Agent SignalDB ID */
  agentId: string;
  /** Discord channel ID */
  discordChannelId: string;
  /** Agent status at last sync */
  status: 'active' | 'idle' | 'offline';
  /** When this mapping was created */
  createdAt: number;
}

/**
 * Callback types for Discord events.
 */
export type DiscordEventCallback<T> = (event: T) => void | Promise<void>;

/**
 * Discord bot status including metrics.
 */
export interface DiscordBotStatus {
  /** Gateway connection status */
  connection: GatewayConnectionStatus;
  /** Number of active thread mappings */
  threadMappings: number;
  /** Number of registered channel mappings */
  channelMappings: number;
  /** Messages processed (Discord -> SignalDB) */
  messagesFromDiscord: number;
  /** Messages processed (SignalDB -> Discord) */
  messagesFromSignalDB: number;
  /** Current rate limit state per user */
  rateLimitedUsers: number;
  /** Bot uptime in milliseconds */
  uptimeMs: number;
  /** Number of active agent channels */
  agentChannelCount: number;
}
