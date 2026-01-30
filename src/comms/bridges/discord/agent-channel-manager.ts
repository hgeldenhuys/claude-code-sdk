/**
 * Agent Channel Manager
 *
 * Auto-creates and archives Discord channels based on agent presence.
 * Each online agent gets a Discord channel named #session-name.
 * Messages in agent channels are routed to the corresponding agent.
 *
 * Flow:
 *   Agent comes online → channel created in "Agents" category
 *   Agent goes offline (>30min) → channel deleted
 *   Agent status changes → channel topic updated with status emoji
 */

import type { Agent } from '../../protocol/types';
import type { AgentChannelInfo, DiscordBotConfig } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord API base URL */
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord channel type for text channels */
const CHANNEL_TYPE_TEXT = 0;

/** Discord channel type for categories */
const CHANNEL_TYPE_CATEGORY = 4;

/** Name for the auto-created agent category */
const AGENT_CATEGORY_NAME = 'Agents';

/** How long an agent must be offline before its channel is archived (ms) */
const OFFLINE_ARCHIVE_DELAY_MS = 30 * 60 * 1000; // 30 minutes

/** Status emoji for channel topics */
const STATUS_EMOJI: Record<string, string> = {
  active: '\u{1F7E2}',  // green circle
  idle: '\u{1F7E1}',    // yellow circle
  offline: '\u{1F534}', // red circle
};

// ============================================================================
// Discord Channel Type (from API)
// ============================================================================

interface DiscordChannelObject {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  topic: string | null;
  position: number;
}

// ============================================================================
// Agent Channel Manager
// ============================================================================

/**
 * Manages Discord channels that map 1:1 to online agents.
 *
 * When agents come online, a text channel is created under the "Agents" category.
 * When agents go offline for >30 minutes, the channel is deleted.
 * Channel topics show the agent's status, machine, and project.
 *
 * @example
 * ```typescript
 * const manager = new AgentChannelManager(config);
 *
 * // On startup
 * await manager.ensureCategory();
 * await manager.reconcileOnStartup();
 *
 * // On presence update
 * presenceSync.onUpdate(agents => manager.syncAgentChannels(agents));
 *
 * // Check if a message is in an agent channel
 * if (manager.isAgentChannel(message.channel_id)) {
 *   const info = manager.getAgentForChannel(message.channel_id);
 *   // Route message to agent...
 * }
 * ```
 */
export class AgentChannelManager {
  private readonly config: DiscordBotConfig;

  /** Map: sessionName -> Discord channel ID */
  private readonly agentChannels: Map<string, string> = new Map();

  /** Map: Discord channel ID -> AgentChannelInfo */
  private readonly channelAgents: Map<string, AgentChannelInfo> = new Map();

  /** Tracks when agents went offline (sessionName -> timestamp) */
  private readonly offlineTimestamps: Map<string, number> = new Map();

  /** The Discord category ID for agent channels */
  private categoryId: string | null = null;

  constructor(config: DiscordBotConfig) {
    this.config = config;
    this.categoryId = config.agentCategoryId ?? null;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Ensure the "Agents" category exists in the guild.
   * Creates it if missing. Uses config.agentCategoryId if provided.
   */
  async ensureCategory(): Promise<string> {
    // If we already have a category ID from config or previous call, verify it
    if (this.categoryId) {
      const exists = await this.channelExists(this.categoryId);
      if (exists) return this.categoryId;
    }

    // Search for existing "Agents" category
    const channels = await this.getGuildChannels();
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i]!;
      if (ch.type === CHANNEL_TYPE_CATEGORY && ch.name === AGENT_CATEGORY_NAME) {
        this.categoryId = ch.id;
        return ch.id;
      }
    }

    // Create the category
    const category = await this.createChannel({
      name: AGENT_CATEGORY_NAME,
      type: CHANNEL_TYPE_CATEGORY,
    });

    this.categoryId = category.id;
    return category.id;
  }

  /**
   * On startup, reconcile existing Discord channels with agent state.
   * Picks up channels that were created in a previous bot session.
   */
  async reconcileOnStartup(): Promise<void> {
    if (!this.categoryId) return;

    const channels = await this.getGuildChannels();

    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i]!;
      // Only look at text channels under our category
      if (ch.type !== CHANNEL_TYPE_TEXT || ch.parent_id !== this.categoryId) continue;

      // Channel name is the agent session name
      const sessionName = ch.name;
      this.agentChannels.set(sessionName, ch.id);

      // Parse agent info from topic if available
      const info = this.parseTopicInfo(ch.topic, sessionName, ch.id);
      if (info) {
        this.channelAgents.set(ch.id, info);
      }
    }
  }

  /**
   * Sync Discord channels with the current list of agents.
   * Creates channels for new agents, archives stale offline agents,
   * and updates topics for status changes.
   */
  async syncAgentChannels(agents: Agent[]): Promise<void> {
    if (!this.categoryId) return;

    // Build a set of current agent session names
    const currentAgents = new Map<string, Agent>();
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      if (agent.sessionName) {
        currentAgents.set(agent.sessionName, agent);
      }
    }

    // Create channels for agents that don't have one
    for (const [sessionName, agent] of currentAgents) {
      if (agent.status === 'offline') continue; // Don't create channels for offline agents

      if (!this.agentChannels.has(sessionName)) {
        await this.createAgentChannel(agent);
      } else {
        // Update topic if status changed
        const channelId = this.agentChannels.get(sessionName)!;
        const existing = this.channelAgents.get(channelId);
        if (existing && existing.status !== agent.status) {
          await this.updateChannelTopic(channelId, agent);
          existing.status = agent.status;
        }
      }

      // Clear offline timestamp if agent is back
      this.offlineTimestamps.delete(sessionName);
    }

    // Check for channels whose agents are offline -- archive after delay
    const channelNames = Array.from(this.agentChannels.keys());
    for (let i = 0; i < channelNames.length; i++) {
      const sessionName = channelNames[i]!;
      const agent = currentAgents.get(sessionName);

      if (!agent || agent.status === 'offline') {
        // Track when agent went offline
        if (!this.offlineTimestamps.has(sessionName)) {
          this.offlineTimestamps.set(sessionName, Date.now());
        }

        const offlineSince = this.offlineTimestamps.get(sessionName)!;
        if (Date.now() - offlineSince > OFFLINE_ARCHIVE_DELAY_MS) {
          await this.archiveAgentChannel(sessionName);
          this.offlineTimestamps.delete(sessionName);
        } else if (agent) {
          // Update topic to show offline status
          const channelId = this.agentChannels.get(sessionName)!;
          const existing = this.channelAgents.get(channelId);
          if (existing && existing.status !== 'offline') {
            await this.updateChannelTopic(channelId, agent);
            existing.status = 'offline';
          }
        }
      }
    }
  }

  /**
   * Create a Discord channel for an agent.
   */
  async createAgentChannel(agent: Agent): Promise<string> {
    if (!this.categoryId) {
      throw new Error('Category not initialized. Call ensureCategory() first.');
    }

    const sessionName = agent.sessionName ?? agent.id.slice(0, 8);
    const topic = this.buildTopic(agent);

    const channel = await this.createChannel({
      name: sessionName,
      type: CHANNEL_TYPE_TEXT,
      parent_id: this.categoryId,
      topic,
    });

    // Store mappings
    this.agentChannels.set(sessionName, channel.id);
    this.channelAgents.set(channel.id, {
      sessionName,
      machineId: agent.machineId,
      agentId: agent.id,
      discordChannelId: channel.id,
      status: agent.status,
      createdAt: Date.now(),
    });

    // Post welcome card
    await this.postWelcomeCard(channel.id, agent);

    return channel.id;
  }

  /**
   * Archive (delete) a Discord channel for an agent.
   */
  async archiveAgentChannel(sessionName: string): Promise<void> {
    const channelId = this.agentChannels.get(sessionName);
    if (!channelId) return;

    try {
      await this.discordRequest('DELETE', `/channels/${channelId}`);
    } catch {
      // Channel may already be deleted
    }

    this.agentChannels.delete(sessionName);
    this.channelAgents.delete(channelId);
  }

  /**
   * Update a channel's topic to reflect agent status.
   */
  async updateChannelTopic(channelId: string, agent: Agent): Promise<void> {
    const topic = this.buildTopic(agent);
    try {
      await this.discordRequest('PATCH', `/channels/${channelId}`, { topic });
    } catch {
      // Topic update failures are non-critical
    }
  }

  /**
   * Post a welcome embed when an agent channel is first created.
   * Shows agent identity, machine, project, and usage instructions.
   */
  private async postWelcomeCard(channelId: string, agent: Agent): Promise<void> {
    const emoji = STATUS_EMOJI[agent.status] ?? '';
    const sessionName = agent.sessionName ?? agent.id.slice(0, 8);

    // Shorten project path
    let project = agent.projectPath ?? 'unknown';
    const segments = project.split('/');
    if (segments.length > 2) {
      project = segments.slice(-2).join('/');
    }

    const embed = {
      title: `${emoji} ${sessionName}`,
      color: agent.status === 'active' ? 0x00ff00 : agent.status === 'idle' ? 0xffff00 : 0xff0000,
      fields: [
        { name: 'Machine', value: agent.machineId || 'unknown', inline: true },
        { name: 'Project', value: project, inline: true },
        { name: 'Status', value: agent.status, inline: true },
      ],
      description: 'Type a message to chat with this agent.\nReplies appear in threads.',
      footer: { text: `Session: ${agent.sessionId?.slice(0, 8) ?? 'n/a'} | Agent: ${agent.id.slice(0, 8)}` },
      timestamp: new Date().toISOString(),
    };

    try {
      await this.discordRequest('POST', `/channels/${channelId}/messages`, {
        embeds: [embed],
      });
    } catch {
      // Welcome card failure is non-critical
    }
  }

  /**
   * Get the agent info for a Discord channel ID.
   * Returns undefined if the channel is not an agent channel.
   */
  getAgentForChannel(channelId: string): AgentChannelInfo | undefined {
    return this.channelAgents.get(channelId);
  }

  /**
   * Check if a Discord channel ID is an agent channel.
   */
  isAgentChannel(channelId: string): boolean {
    return this.channelAgents.has(channelId);
  }

  /**
   * Get the number of active agent channels.
   */
  getChannelCount(): number {
    return this.agentChannels.size;
  }

  /**
   * Get the category ID.
   */
  getCategoryId(): string | null {
    return this.categoryId;
  }

  // ==========================================================================
  // Discord REST Helpers
  // ==========================================================================

  /**
   * Make an authenticated request to the Discord API.
   */
  private async discordRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${DISCORD_API_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bot ${this.config.discordToken}`,
    };

    const init: RequestInit = { method, headers };

    if (body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Discord API ${method} ${path}: ${res.status} ${error}`);
    }

    // DELETE returns 204 No Content
    if (res.status === 204) return null;
    return res.json();
  }

  /**
   * Get all channels in the guild.
   */
  private async getGuildChannels(): Promise<DiscordChannelObject[]> {
    return this.discordRequest(
      'GET',
      `/guilds/${this.config.guildId}/channels`,
    ) as Promise<DiscordChannelObject[]>;
  }

  /**
   * Check if a channel exists.
   */
  private async channelExists(channelId: string): Promise<boolean> {
    try {
      await this.discordRequest('GET', `/channels/${channelId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a Discord channel.
   */
  private async createChannel(data: {
    name: string;
    type: number;
    parent_id?: string;
    topic?: string;
  }): Promise<DiscordChannelObject> {
    return this.discordRequest(
      'POST',
      `/guilds/${this.config.guildId}/channels`,
      data as unknown as Record<string, unknown>,
    ) as Promise<DiscordChannelObject>;
  }

  // ==========================================================================
  // Topic Formatting
  // ==========================================================================

  /**
   * Build a channel topic string from agent info.
   * Format: "🟢 active | machine: m4.local | project: my-app"
   */
  private buildTopic(agent: Agent): string {
    const emoji = STATUS_EMOJI[agent.status] ?? '';
    const parts = [`${emoji} ${agent.status}`];

    if (agent.machineId) {
      parts.push(`machine: ${agent.machineId}`);
    }

    if (agent.projectPath) {
      // Shorten project path to last 2 segments
      const segments = agent.projectPath.split('/');
      const short = segments.length > 2
        ? segments.slice(-2).join('/')
        : agent.projectPath;
      parts.push(`project: ${short}`);
    }

    return parts.join(' | ');
  }

  /**
   * Parse agent info from a channel topic.
   * Used during reconciliation on startup.
   */
  private parseTopicInfo(
    topic: string | null,
    sessionName: string,
    channelId: string,
  ): AgentChannelInfo | null {
    if (!topic) return null;

    // Extract status from topic (e.g., "🟢 active | machine: m4.local")
    let status: AgentChannelInfo['status'] = 'offline';
    if (topic.includes('active')) status = 'active';
    else if (topic.includes('idle')) status = 'idle';

    // Extract machine ID
    let machineId = '';
    const machineMatch = topic.match(/machine:\s*([^\s|]+)/);
    if (machineMatch) {
      machineId = machineMatch[1]!;
    }

    return {
      sessionName,
      machineId,
      agentId: '', // Will be updated on next sync
      discordChannelId: channelId,
      status,
      createdAt: Date.now(),
    };
  }
}
