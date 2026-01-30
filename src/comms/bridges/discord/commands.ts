/**
 * Discord Slash Command Manager
 *
 * Registers and handles Discord slash commands that bridge to SignalDB.
 * Commands: /agents, /channels, /send, /memo, /paste
 *
 * Each command responds with formatted Discord embeds containing
 * structured field data from SignalDB.
 */

import { ChannelClient } from '../../channels/channel-client';
import { SignalDBClient } from '../../client/signaldb';
import { MemoClient } from '../../memos/memo-client';
import type { MemoPriority } from '../../memos/types';
import { PasteClient } from '../../pastes/paste-client';
import type { Agent, Channel } from '../../protocol/types';
import type {
  DiscordBotConfig,
  DiscordEmbed,
  DiscordInteraction,
  DiscordInteractionOption,
  DiscordInteractionResponse,
  SlashCommandDef,
} from './types';
import {
  DiscordInteractionCallbackType,
  DiscordInteractionType,
  DiscordMessageFlags,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord API base URL */
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord Application Command types */
const APPLICATION_COMMAND_TYPE_CHAT_INPUT = 1;

/** Discord option type constants */
const OPTION_TYPE_STRING = 3;
const OPTION_TYPE_INTEGER = 4;
const OPTION_TYPE_BOOLEAN = 5;

/** Maximum number of embeds Discord allows per response */
const MAX_EMBEDS_PER_RESPONSE = 10;

// ============================================================================
// Command Definitions
// ============================================================================

/**
 * Slash command definitions for registration with Discord.
 * Five commands as specified: /agents, /channels, /send, /memo, /paste
 */
const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: 'agents',
    description: 'List registered SignalDB agents and their status',
    options: [
      {
        name: 'filter',
        description: 'Filter by status: active, idle, offline, or all (default: all)',
        type: 'STRING',
        required: false,
        choices: [
          { name: 'All', value: 'all' },
          { name: 'Active', value: 'active' },
          { name: 'Idle', value: 'idle' },
          { name: 'Offline', value: 'offline' },
        ],
      },
    ],
  },
  {
    name: 'channels',
    description: 'List SignalDB channels',
    options: [
      {
        name: 'type',
        description: 'Filter by channel type: direct, project, broadcast, or all (default: all)',
        type: 'STRING',
        required: false,
        choices: [
          { name: 'All', value: 'all' },
          { name: 'Direct', value: 'direct' },
          { name: 'Project', value: 'project' },
          { name: 'Broadcast', value: 'broadcast' },
        ],
      },
    ],
  },
  {
    name: 'send',
    description: 'Send a message to a SignalDB agent',
    options: [
      {
        name: 'target',
        description: 'Target agent ID or address (e.g., agent://machine/session)',
        type: 'STRING',
        required: true,
      },
      {
        name: 'message',
        description: 'Message content to send',
        type: 'STRING',
        required: true,
      },
      {
        name: 'channel',
        description: 'Channel ID to send through (optional, uses direct if omitted)',
        type: 'STRING',
        required: false,
      },
    ],
  },
  {
    name: 'memo',
    description: 'Send a memo to a SignalDB agent',
    options: [
      {
        name: 'to',
        description: 'Target agent ID or address',
        type: 'STRING',
        required: true,
      },
      {
        name: 'subject',
        description: 'Memo subject',
        type: 'STRING',
        required: true,
      },
      {
        name: 'body',
        description: 'Memo body',
        type: 'STRING',
        required: true,
      },
      {
        name: 'priority',
        description: 'Priority: P0 (critical), P1 (high), P2 (normal), P3 (low)',
        type: 'STRING',
        required: false,
        choices: [
          { name: 'P0 (Critical)', value: 'P0' },
          { name: 'P1 (High)', value: 'P1' },
          { name: 'P2 (Normal)', value: 'P2' },
          { name: 'P3 (Low)', value: 'P3' },
        ],
      },
    ],
  },
  {
    name: 'chat',
    description: 'Chat with an AI agent and get a response',
    options: [
      {
        name: 'agent',
        description: 'Agent name, session name, or ID (e.g., "realtime-db", "witty-bison")',
        type: 'STRING',
        required: true,
      },
      {
        name: 'message',
        description: 'Message to send to the agent',
        type: 'STRING',
        required: true,
      },
      {
        name: 'timeout',
        description: 'Max seconds to wait for response (default: 120)',
        type: 'INTEGER',
        required: false,
      },
    ],
  },
  {
    name: 'paste',
    description: 'Create and share an ephemeral paste',
    options: [
      {
        name: 'content',
        description: 'Content to paste',
        type: 'STRING',
        required: true,
      },
      {
        name: 'ttl',
        description: 'Time-to-live in seconds (default: 3600)',
        type: 'INTEGER',
        required: false,
      },
      {
        name: 'read_once',
        description: 'Delete after first read',
        type: 'BOOLEAN',
        required: false,
      },
    ],
  },
];

// ============================================================================
// Slash Command Manager
// ============================================================================

/**
 * Manages Discord slash command registration and handling.
 *
 * Registers all 5 commands (/agents, /channels, /send, /memo, /paste)
 * with a Discord guild and handles interactions with formatted embed responses.
 *
 * @example
 * ```typescript
 * const manager = new SlashCommandManager(config, {
 *   channel: channelClient,
 *   memo: memoClient,
 *   paste: pasteClient,
 * });
 *
 * await manager.registerCommands(config.guildId);
 *
 * gateway.onDiscordInteraction(async (interaction) => {
 *   await manager.handleInteraction(interaction);
 * });
 * ```
 */
export class SlashCommandManager {
  private readonly config: DiscordBotConfig;
  private readonly signalDBClient: SignalDBClient;
  private readonly channelClient: ChannelClient;
  private readonly memoClient: MemoClient;
  private readonly pasteClient: PasteClient;

  constructor(
    config: DiscordBotConfig,
    clients?: {
      channel?: ChannelClient;
      memo?: MemoClient;
      paste?: PasteClient;
    }
  ) {
    this.config = config;

    this.signalDBClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    // Use provided clients or create new ones
    this.channelClient =
      clients?.channel ??
      new ChannelClient({
        apiUrl: config.apiUrl,
        projectKey: config.projectKey,
        agentId: config.agentId,
      });

    this.memoClient =
      clients?.memo ??
      new MemoClient({
        apiUrl: config.apiUrl,
        projectKey: config.projectKey,
        agentId: config.agentId,
      });

    this.pasteClient =
      clients?.paste ??
      new PasteClient({
        apiUrl: config.apiUrl,
        projectKey: config.projectKey,
        agentId: config.agentId,
      });
  }

  /**
   * Get the command definitions for external inspection.
   */
  getCommandDefinitions(): SlashCommandDef[] {
    return [...SLASH_COMMANDS];
  }

  // ==========================================================================
  // Command Registration
  // ==========================================================================

  /**
   * Register all slash commands with Discord for a specific guild.
   * Uses bulk overwrite (PUT) which replaces all guild commands atomically.
   *
   * @param guildId - Discord guild ID to register commands in
   */
  async registerCommands(guildId: string): Promise<void> {
    const applicationId = await this.getApplicationId();

    const url = `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`;

    // Convert our command definitions to Discord API format
    const commands = [];
    for (let i = 0; i < SLASH_COMMANDS.length; i++) {
      const cmd = SLASH_COMMANDS[i]!;
      const options = [];
      if (cmd.options) {
        for (let j = 0; j < cmd.options.length; j++) {
          const opt = cmd.options[j]!;
          options.push({
            name: opt.name,
            description: opt.description,
            type: this.mapOptionType(opt.type),
            required: opt.required ?? false,
            choices: opt.choices,
          });
        }
      }
      commands.push({
        name: cmd.name,
        description: cmd.description,
        type: APPLICATION_COMMAND_TYPE_CHAT_INPUT,
        options,
      });
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register commands: ${response.status} ${error}`);
    }
  }

  /**
   * Fetch the application ID from Discord.
   */
  private async getApplicationId(): Promise<string> {
    const response = await fetch(`${DISCORD_API_BASE}/oauth2/applications/@me`, {
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get application ID: ${response.status}`);
    }

    const data = (await response.json()) as { id: string };
    return data.id;
  }

  /**
   * Map our option type strings to Discord option type numbers.
   */
  private mapOptionType(type: string): number {
    switch (type) {
      case 'STRING':
        return OPTION_TYPE_STRING;
      case 'INTEGER':
        return OPTION_TYPE_INTEGER;
      case 'BOOLEAN':
        return OPTION_TYPE_BOOLEAN;
      case 'USER':
        return 6;
      case 'CHANNEL':
        return 7;
      case 'ROLE':
        return 8;
      default:
        return OPTION_TYPE_STRING;
    }
  }

  // ==========================================================================
  // Interaction Handling
  // ==========================================================================

  /**
   * Handle a Discord interaction (slash command).
   *
   * @param interaction - Discord interaction object
   */
  async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    // Only handle application commands
    if (interaction.type !== DiscordInteractionType.ApplicationCommand) {
      return;
    }

    const commandName = interaction.data?.name;
    if (!commandName) return;

    try {
      switch (commandName) {
        case 'agents':
          await this.handleAgentsCommand(interaction);
          break;
        case 'channels':
          await this.handleChannelsCommand(interaction);
          break;
        case 'send':
          await this.handleSendCommand(interaction);
          break;
        case 'chat':
          // Handled by DiscordChatHandler in discord-bot.ts -- should not reach here
          break;
        case 'paste':
          await this.handlePasteCommand(interaction);
          break;
        case 'memo':
          await this.handleMemoCommand(interaction);
          break;
        default:
          await this.respondEphemeral(interaction, `Unknown command: ${commandName}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await this.respondEphemeral(interaction, `Error: ${errorMessage}`);
    }
  }

  // ==========================================================================
  // Command Handlers
  // ==========================================================================

  /**
   * Handle /agents command -- list registered agents with status embeds.
   */
  private async handleAgentsCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];
    const filter = (this.getOptionValue(options, 'filter') as string) || 'all';

    await this.deferReply(interaction);

    const agents = await this.signalDBClient.agents.list();

    // Filter by status if specified
    const filtered: Agent[] = [];
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      if (filter === 'all' || agent.status === filter) {
        filtered.push(agent);
      }
    }

    if (filtered.length === 0) {
      await this.editReply(interaction, {
        content: filter === 'all'
          ? 'No agents registered.'
          : `No agents with status "${filter}".`,
      });
      return;
    }

    // Build embeds (max 10 per Discord response)
    const embeds: DiscordEmbed[] = [];
    const displayCount = Math.min(filtered.length, MAX_EMBEDS_PER_RESPONSE);
    for (let i = 0; i < displayCount; i++) {
      const agent = filtered[i]!;
      embeds.push({
        title: agent.sessionName || `Agent ${agent.id.slice(0, 8)}`,
        color: this.statusColor(agent.status),
        fields: [
          { name: 'Status', value: agent.status, inline: true },
          { name: 'Machine', value: agent.machineId || 'N/A', inline: true },
          { name: 'Project', value: agent.projectPath || 'N/A', inline: false },
          { name: 'Session', value: agent.sessionId || 'N/A', inline: true },
          {
            name: 'Last Heartbeat',
            value: agent.heartbeatAt || 'Never',
            inline: true,
          },
        ],
      });
    }

    const summary = filtered.length > displayCount
      ? `Showing ${displayCount} of ${filtered.length} agents (filtered by: ${filter}):`
      : `Found ${filtered.length} agent${filtered.length === 1 ? '' : 's'}:`;

    await this.editReply(interaction, {
      content: summary,
      embeds,
    });
  }

  /**
   * Handle /channels command -- list SignalDB channels.
   */
  private async handleChannelsCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];
    const typeFilter = (this.getOptionValue(options, 'type') as string) || 'all';

    await this.deferReply(interaction);

    const channels = await this.signalDBClient.channels.list();

    // Filter by type if specified
    const filtered: Channel[] = [];
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i]!;
      if (typeFilter === 'all' || channel.type === typeFilter) {
        filtered.push(channel);
      }
    }

    if (filtered.length === 0) {
      await this.editReply(interaction, {
        content: typeFilter === 'all'
          ? 'No channels found.'
          : `No channels of type "${typeFilter}".`,
      });
      return;
    }

    const embeds: DiscordEmbed[] = [];
    const displayCount = Math.min(filtered.length, MAX_EMBEDS_PER_RESPONSE);
    for (let i = 0; i < displayCount; i++) {
      const channel = filtered[i]!;
      const memberCount = channel.members ? channel.members.length : 0;
      embeds.push({
        title: channel.name || `Channel ${channel.id.slice(0, 8)}`,
        color: this.channelTypeColor(channel.type),
        fields: [
          { name: 'Type', value: channel.type, inline: true },
          { name: 'Members', value: String(memberCount), inline: true },
          { name: 'ID', value: channel.id, inline: false },
          { name: 'Created', value: channel.createdAt || 'N/A', inline: true },
        ],
      });
    }

    const summary = filtered.length > displayCount
      ? `Showing ${displayCount} of ${filtered.length} channels:`
      : `Found ${filtered.length} channel${filtered.length === 1 ? '' : 's'}:`;

    await this.editReply(interaction, {
      content: summary,
      embeds,
    });
  }

  /**
   * Handle /send command -- send a message to a SignalDB agent.
   */
  private async handleSendCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];

    const target = this.getOptionValue(options, 'target') as string;
    const messageContent = this.getOptionValue(options, 'message') as string;
    const channelId = this.getOptionValue(options, 'channel') as string | undefined;

    if (!target || !messageContent) {
      await this.respondEphemeral(interaction, 'Target and message are required.');
      return;
    }

    await this.deferReply(interaction);

    // Resolve target address
    const targetAddress = target.includes('://') ? target : `agent://${target}`;

    try {
      // Send via SignalDB
      const message = await this.signalDBClient.messages.send({
        channelId: channelId || 'direct',
        senderId: this.config.agentId,
        targetType: 'agent',
        targetAddress,
        messageType: 'chat',
        content: messageContent,
        metadata: {
          source: 'discord',
          discordUser: interaction.member?.user?.username
            || interaction.user?.username
            || 'unknown',
        },
      });

      const embed: DiscordEmbed = {
        title: 'Message Sent',
        color: 0x00ff00,
        fields: [
          { name: 'To', value: targetAddress, inline: true },
          { name: 'Status', value: message.status, inline: true },
          { name: 'ID', value: message.id, inline: false },
          {
            name: 'Content',
            value: messageContent.length > 200
              ? `${messageContent.slice(0, 200)}...`
              : messageContent,
            inline: false,
          },
        ],
      };

      await this.editReply(interaction, { embeds: [embed] });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.editReply(interaction, {
        content: `Failed to send message: ${errorMsg}`,
      });
    }
  }

  /**
   * Handle /paste command -- create an ephemeral paste.
   */
  private async handlePasteCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];

    const content = this.getOptionValue(options, 'content') as string;
    const ttl = this.getOptionValue(options, 'ttl') as number | undefined;
    const readOnce = this.getOptionValue(options, 'read_once') as boolean | undefined;

    if (!content) {
      await this.respondEphemeral(interaction, 'Content is required.');
      return;
    }

    await this.deferReply(interaction);

    const paste = await this.pasteClient.create({
      content,
      accessMode: readOnce ? 'read_once' : 'ttl',
      ttlSeconds: ttl ?? 3600,
    });

    const embed: DiscordEmbed = {
      title: 'Paste Created',
      color: 0x00ff00,
      fields: [
        { name: 'ID', value: paste.id, inline: true },
        { name: 'Access', value: paste.accessMode, inline: true },
        {
          name: 'Expires',
          value: paste.expiresAt || 'On first read',
          inline: true,
        },
        {
          name: 'Content Preview',
          value: content.length > 200 ? `${content.slice(0, 200)}...` : content,
          inline: false,
        },
      ],
    };

    await this.editReply(interaction, { embeds: [embed] });
  }

  /**
   * Handle /memo command -- send a memo to an agent.
   */
  private async handleMemoCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];

    const to = this.getOptionValue(options, 'to') as string;
    const subject = this.getOptionValue(options, 'subject') as string;
    const body = this.getOptionValue(options, 'body') as string;
    const priority = (this.getOptionValue(options, 'priority') as string) || 'P2';

    if (!to || !subject || !body) {
      await this.respondEphemeral(interaction, 'to, subject, and body are required.');
      return;
    }

    await this.deferReply(interaction);

    const memo = await this.memoClient.compose({
      to: to.includes('://') ? to : `agent://${to}`,
      subject,
      body,
      priority: priority as MemoPriority,
    });

    const embed: DiscordEmbed = {
      title: 'Memo Sent',
      color: 0x0099ff,
      fields: [
        { name: 'To', value: memo.to, inline: true },
        { name: 'Subject', value: memo.subject, inline: true },
        { name: 'Priority', value: memo.priority, inline: true },
        { name: 'ID', value: memo.id, inline: false },
      ],
    };

    await this.editReply(interaction, { embeds: [embed] });
  }

  // ==========================================================================
  // Response Helpers
  // ==========================================================================

  /**
   * Send an ephemeral response (only visible to the user).
   */
  private async respondEphemeral(interaction: DiscordInteraction, content: string): Promise<void> {
    const response: DiscordInteractionResponse = {
      type: DiscordInteractionCallbackType.ChannelMessageWithSource,
      data: {
        content,
        flags: DiscordMessageFlags.Ephemeral,
      },
    };

    await this.sendInteractionResponse(interaction, response);
  }

  /**
   * Defer the reply (show "thinking..." state).
   */
  private async deferReply(interaction: DiscordInteraction): Promise<void> {
    const response: DiscordInteractionResponse = {
      type: DiscordInteractionCallbackType.DeferredChannelMessageWithSource,
    };

    await this.sendInteractionResponse(interaction, response);
  }

  /**
   * Edit the deferred reply with actual content.
   */
  private async editReply(
    interaction: DiscordInteraction,
    data: {
      content?: string;
      embeds?: DiscordEmbed[];
    }
  ): Promise<void> {
    const applicationId = await this.getApplicationId();
    const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${interaction.token}/messages/@original`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to edit reply: ${response.status} ${error}`);
    }
  }

  /**
   * Send initial interaction response.
   */
  private async sendInteractionResponse(
    interaction: DiscordInteraction,
    response: DiscordInteractionResponse
  ): Promise<void> {
    const url = `${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to respond to interaction: ${res.status} ${error}`);
    }
  }

  /**
   * Get an option value from interaction options.
   */
  private getOptionValue(
    options: DiscordInteractionOption[],
    name: string
  ): string | number | boolean | undefined {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      if (opt.name === name) {
        return opt.value;
      }
    }
    return undefined;
  }

  /**
   * Map agent status to Discord embed color.
   */
  private statusColor(status: string): number {
    switch (status) {
      case 'active':
        return 0x00ff00; // Green
      case 'idle':
        return 0xffff00; // Yellow
      case 'offline':
        return 0xff0000; // Red
      default:
        return 0x808080; // Gray
    }
  }

  /**
   * Map channel type to Discord embed color.
   */
  private channelTypeColor(type: string): number {
    switch (type) {
      case 'direct':
        return 0x5865f2; // Discord blurple
      case 'project':
        return 0x57f287; // Green
      case 'broadcast':
        return 0xfee75c; // Yellow
      default:
        return 0x808080; // Gray
    }
  }
}
