/**
 * Discord Slash Command Manager
 *
 * Registers and handles Discord slash commands that bridge to SignalDB.
 * Commands: /agent list, /agent message, /agent status, /paste create, /memo send
 */

import { ChannelClient } from '../../channels/channel-client';
import { SignalDBClient } from '../../client/signaldb';
import { MemoClient } from '../../memos/memo-client';
import type { MemoPriority } from '../../memos/types';
import { PasteClient } from '../../pastes/paste-client';
import type { Agent } from '../../protocol/types';
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
const OPTION_TYPE_STRING = 3;
const OPTION_TYPE_BOOLEAN = 5;

// ============================================================================
// Command Definitions
// ============================================================================

/**
 * Slash command definitions for registration with Discord.
 */
const SLASH_COMMANDS: SlashCommandDef[] = [
  {
    name: 'agent',
    description: 'Manage SignalDB agents',
    options: [
      {
        name: 'list',
        description: 'List all registered agents',
        type: 'STRING',
        required: false,
      },
      {
        name: 'message',
        description: 'Send a message to an agent',
        type: 'STRING',
        required: false,
      },
      {
        name: 'status',
        description: 'Check agent status by ID',
        type: 'STRING',
        required: false,
      },
    ],
  },
  {
    name: 'paste',
    description: 'Create and share pastes',
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
  {
    name: 'memo',
    description: 'Send memos to agents',
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
];

// ============================================================================
// Slash Command Manager
// ============================================================================

/**
 * Manages Discord slash command registration and handling.
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

  // ==========================================================================
  // Command Registration
  // ==========================================================================

  /**
   * Register slash commands with Discord for a specific guild.
   *
   * @param guildId - Discord guild ID to register commands in
   */
  async registerCommands(guildId: string): Promise<void> {
    const applicationId = await this.getApplicationId();

    const url = `${DISCORD_API_BASE}/applications/${applicationId}/guilds/${guildId}/commands`;

    // Convert our command definitions to Discord API format
    const commands = SLASH_COMMANDS.map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
      type: APPLICATION_COMMAND_TYPE_CHAT_INPUT,
      options: cmd.options?.map((opt) => ({
        name: opt.name,
        description: opt.description,
        type: this.mapOptionType(opt.type),
        required: opt.required ?? false,
        choices: opt.choices,
      })),
    }));

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
        return 4;
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
        case 'agent':
          await this.handleAgentCommand(interaction);
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
   * Handle /agent subcommands.
   */
  private async handleAgentCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];
    const subcommand = this.getOptionValue(options, 'list')
      ? 'list'
      : this.getOptionValue(options, 'message')
        ? 'message'
        : this.getOptionValue(options, 'status')
          ? 'status'
          : 'list';

    // Defer reply for async operations
    await this.deferReply(interaction);

    switch (subcommand) {
      case 'list': {
        const agents = await this.signalDBClient.agents.list();
        const embeds: DiscordEmbed[] = [];
        const displayAgents = agents.slice(0, 10);
        for (let i = 0; i < displayAgents.length; i++) {
          const agent = displayAgents[i] as Agent;
          embeds.push({
            title: agent.sessionName || agent.id.slice(0, 8),
            color: this.statusColor(agent.status),
            fields: [
              { name: 'Status', value: agent.status, inline: true },
              { name: 'Machine', value: agent.machineId.slice(0, 8), inline: true },
              { name: 'Project', value: agent.projectPath || 'N/A', inline: false },
            ],
          });
        }

        await this.editReply(interaction, {
          content: `Found ${agents.length} agents:`,
          embeds,
        });
        break;
      }

      case 'message': {
        const targetId = this.getOptionValue(options, 'message') as string;
        // This would need more options in the actual command
        await this.editReply(interaction, {
          content: `To message agent ${targetId}, use the thread below.`,
        });
        break;
      }

      case 'status': {
        const agentId = this.getOptionValue(options, 'status') as string;
        const agents = await this.signalDBClient.agents.list();
        let agent: Agent | undefined;
        for (let i = 0; i < agents.length; i++) {
          const a = agents[i] as Agent;
          if (a.id === agentId || a.id.startsWith(agentId)) {
            agent = a;
            break;
          }
        }

        if (!agent) {
          await this.editReply(interaction, { content: `Agent not found: ${agentId}` });
          return;
        }

        const embed: DiscordEmbed = {
          title: agent.sessionName || agent.id,
          color: this.statusColor(agent.status),
          fields: [
            { name: 'ID', value: agent.id, inline: false },
            { name: 'Status', value: agent.status, inline: true },
            { name: 'Machine ID', value: agent.machineId, inline: true },
            { name: 'Project', value: agent.projectPath || 'N/A', inline: false },
            { name: 'Session', value: agent.sessionId || 'N/A', inline: true },
            {
              name: 'Last Heartbeat',
              value: agent.heartbeatAt || 'Never',
              inline: true,
            },
          ],
        };

        await this.editReply(interaction, { embeds: [embed] });
        break;
      }
    }
  }

  /**
   * Handle /paste command.
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
          value: content.length > 100 ? `${content.slice(0, 100)}...` : content,
          inline: false,
        },
      ],
    };

    await this.editReply(interaction, { embeds: [embed] });
  }

  /**
   * Handle /memo command.
   */
  private async handleMemoCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options || [];

    const to = this.getOptionValue(options, 'to') as string;
    const subject = this.getOptionValue(options, 'subject') as string;
    const body = this.getOptionValue(options, 'body') as string;
    const priority = (this.getOptionValue(options, 'priority') as string) || 'normal';

    if (!to || !subject || !body) {
      await this.respondEphemeral(interaction, 'to, subject, and body are required.');
      return;
    }

    await this.deferReply(interaction);

    const memo = await this.memoClient.compose({
      to: to.includes('://') ? to : `agent://${to}`,
      subject,
      body,
      priority: (priority || 'P2') as MemoPriority,
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
}
