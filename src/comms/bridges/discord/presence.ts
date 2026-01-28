/**
 * Presence Sync
 *
 * Synchronizes SignalDB agent presence to Discord embeds.
 * Polls agents periodically and formats status with colors.
 */

import { SignalDBClient } from '../../client/signaldb';
import type { Agent, AgentStatus } from '../../protocol/types';
import type { DiscordBotConfig, DiscordEmbed, PresenceConfig } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Default presence update interval: 30 seconds */
const DEFAULT_UPDATE_INTERVAL_MS = 30_000;

/** Status colors for Discord embeds */
const STATUS_COLORS: Record<AgentStatus, number> = {
  active: 0x00ff00, // Green
  idle: 0xffff00, // Yellow
  offline: 0xff0000, // Red
};

/** Default status emojis */
const DEFAULT_STATUS_EMOJI: PresenceConfig['statusEmoji'] = {
  active: ':green_circle:',
  idle: ':yellow_circle:',
  offline: ':red_circle:',
};

// ============================================================================
// Presence Sync
// ============================================================================

/**
 * Synchronizes SignalDB agent presence to Discord.
 *
 * Polls the agent registry at configurable intervals and provides
 * formatted Discord embeds for agent status display.
 *
 * @example
 * ```typescript
 * const presence = new PresenceSync(config);
 *
 * presence.onUpdate((agents) => {
 *   console.log(`${agents.length} agents online`);
 * });
 *
 * presence.start(); // Start polling
 *
 * // Get formatted embed for a specific agent
 * const embed = presence.formatAgentEmbed(agent);
 *
 * presence.stop(); // Stop polling
 * ```
 */
export class PresenceSync {
  private readonly config: DiscordBotConfig;
  private readonly presenceConfig: PresenceConfig;
  private readonly signalDBClient: SignalDBClient;

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private lastAgents: Agent[] = [];
  private updateCallbacks: Array<(agents: Agent[]) => void> = [];

  constructor(config: DiscordBotConfig, presenceConfig?: Partial<PresenceConfig>) {
    this.config = config;
    this.presenceConfig = {
      updateIntervalMs: presenceConfig?.updateIntervalMs ?? DEFAULT_UPDATE_INTERVAL_MS,
      statusEmoji: presenceConfig?.statusEmoji ?? DEFAULT_STATUS_EMOJI,
    };

    this.signalDBClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Start the presence sync polling loop.
   *
   * @param intervalMs - Optional override for poll interval
   */
  start(intervalMs?: number): void {
    if (this.isRunning) return;

    this.isRunning = true;
    const interval = intervalMs ?? this.presenceConfig.updateIntervalMs;

    // Initial sync
    this.syncPresence().catch(() => {
      // Ignore initial errors, will retry
    });

    // Start polling
    this.pollInterval = setInterval(() => {
      this.syncPresence().catch(() => {
        // Log but don't stop on errors
      });
    }, interval);
  }

  /**
   * Stop the presence sync polling loop.
   */
  stop(): void {
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  /**
   * Register callback for presence updates.
   *
   * @param callback - Called with list of agents on each sync
   */
  onUpdate(callback: (agents: Agent[]) => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Get the most recently synced agents.
   */
  getLastAgents(): Agent[] {
    return this.lastAgents;
  }

  /**
   * Manually trigger a presence sync.
   */
  async syncPresence(): Promise<Agent[]> {
    const agents = await this.signalDBClient.agents.list();
    this.lastAgents = agents;
    this.emitUpdate(agents);
    return agents;
  }

  /**
   * Format an agent as a Discord embed with status color.
   *
   * @param agent - SignalDB agent to format
   * @returns Discord embed object
   */
  formatAgentEmbed(agent: Agent): DiscordEmbed {
    const statusEmoji = this.presenceConfig.statusEmoji[agent.status];
    const statusColor = STATUS_COLORS[agent.status];

    const fields = [
      {
        name: 'Status',
        value: `${statusEmoji} ${agent.status}`,
        inline: true,
      },
      {
        name: 'Machine',
        value: agent.machineId.slice(0, 12) || 'Unknown',
        inline: true,
      },
    ];

    if (agent.projectPath) {
      fields.push({
        name: 'Project',
        value: this.formatProjectPath(agent.projectPath),
        inline: false,
      });
    }

    if (agent.sessionId) {
      fields.push({
        name: 'Session',
        value: agent.sessionId.slice(0, 8),
        inline: true,
      });
    }

    if (agent.heartbeatAt) {
      fields.push({
        name: 'Last Seen',
        value: this.formatRelativeTime(agent.heartbeatAt),
        inline: true,
      });
    }

    // Add capabilities if present
    const capabilities = Object.keys(agent.capabilities || {});
    if (capabilities.length > 0) {
      fields.push({
        name: 'Capabilities',
        value: capabilities.slice(0, 5).join(', ') + (capabilities.length > 5 ? '...' : ''),
        inline: false,
      });
    }

    return {
      title: agent.sessionName || `Agent ${agent.id.slice(0, 8)}`,
      color: statusColor,
      fields,
      footer: {
        text: `ID: ${agent.id}`,
      },
      timestamp: agent.registeredAt,
    };
  }

  /**
   * Format multiple agents as a summary embed.
   *
   * @param agents - List of agents to summarize
   * @returns Discord embed with agent counts
   */
  formatSummaryEmbed(agents: Agent[]): DiscordEmbed {
    const counts = {
      active: 0,
      idle: 0,
      offline: 0,
    };

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      counts[agent.status]++;
    }

    const emoji = this.presenceConfig.statusEmoji;

    return {
      title: 'Agent Presence Summary',
      color: 0x5865f2, // Discord blurple
      fields: [
        {
          name: `${emoji.active} Active`,
          value: String(counts.active),
          inline: true,
        },
        {
          name: `${emoji.idle} Idle`,
          value: String(counts.idle),
          inline: true,
        },
        {
          name: `${emoji.offline} Offline`,
          value: String(counts.offline),
          inline: true,
        },
        {
          name: 'Total',
          value: String(agents.length),
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the color for an agent status.
   *
   * @param status - Agent status
   * @returns Discord color integer
   */
  getStatusColor(status: AgentStatus): number {
    return STATUS_COLORS[status];
  }

  /**
   * Get the emoji for an agent status.
   *
   * @param status - Agent status
   * @returns Status emoji string
   */
  getStatusEmoji(status: AgentStatus): string {
    return this.presenceConfig.statusEmoji[status];
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Emit update to all registered callbacks.
   */
  private emitUpdate(agents: Agent[]): void {
    for (let i = 0; i < this.updateCallbacks.length; i++) {
      try {
        this.updateCallbacks[i]!(agents);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Format a project path for display (shorten if too long).
   */
  private formatProjectPath(path: string): string {
    if (path.length <= 40) return path;

    const parts = path.split('/');
    if (parts.length <= 3) return path;

    // Show first and last two parts
    return `${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }

  /**
   * Format an ISO timestamp as relative time.
   */
  private formatRelativeTime(isoTimestamp: string): string {
    const timestamp = new Date(isoTimestamp).getTime();
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60_000) {
      return 'Just now';
    }

    if (diff < 3600_000) {
      const mins = Math.floor(diff / 60_000);
      return `${mins}m ago`;
    }

    if (diff < 86400_000) {
      const hours = Math.floor(diff / 3600_000);
      return `${hours}h ago`;
    }

    const days = Math.floor(diff / 86400_000);
    return `${days}d ago`;
  }
}
