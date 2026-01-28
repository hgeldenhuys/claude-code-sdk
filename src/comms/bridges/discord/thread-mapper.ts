/**
 * Thread Mapper
 *
 * Bidirectional mapping between Discord threads and SignalDB thread IDs.
 * Creates Discord threads on demand for SignalDB conversations.
 */

import type { DiscordBotConfig, DiscordThreadCreateResponse, ThreadMapping } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord API base URL */
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord thread type: public thread */
const THREAD_TYPE_PUBLIC = 11;

/** Auto-archive duration: 1 hour (in minutes) */
const AUTO_ARCHIVE_DURATION = 60;

// ============================================================================
// Thread Mapper
// ============================================================================

/**
 * Manages bidirectional mapping between Discord threads and SignalDB threads.
 *
 * Uses in-memory maps for fast lookup. Thread mappings persist for the
 * lifetime of the bot process.
 *
 * @example
 * ```typescript
 * const mapper = new ThreadMapper(config);
 *
 * // Get or create mapping for Discord -> SignalDB
 * const signalDBThreadId = mapper.mapDiscordToSignalDB('discord-thread-123');
 *
 * // Get existing mapping for SignalDB -> Discord
 * const discordThreadId = mapper.mapSignalDBToDiscord('signaldb-thread-456');
 *
 * // Create Discord thread if needed
 * const thread = await mapper.getOrCreateDiscordThread(
 *   'channel-id',
 *   'signaldb-thread-789',
 *   'Conversation with Agent'
 * );
 * ```
 */
export class ThreadMapper {
  private readonly config: DiscordBotConfig;

  /** Discord thread ID -> SignalDB thread ID */
  private readonly discordToSignalDB: Map<string, string> = new Map();

  /** SignalDB thread ID -> Discord thread ID */
  private readonly signalDBToDiscord: Map<string, string> = new Map();

  /** Full mapping metadata by Discord thread ID */
  private readonly mappings: Map<string, ThreadMapping> = new Map();

  constructor(config: DiscordBotConfig) {
    this.config = config;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Get the SignalDB thread ID for a Discord thread.
   * Creates a new SignalDB thread ID if none exists.
   *
   * @param discordThreadId - Discord thread snowflake ID
   * @returns SignalDB thread UUID
   */
  mapDiscordToSignalDB(discordThreadId: string): string {
    const existing = this.discordToSignalDB.get(discordThreadId);
    if (existing) {
      return existing;
    }

    // Generate a new SignalDB thread ID
    const signalDBThreadId = this.generateThreadId();
    this.createMapping(discordThreadId, signalDBThreadId);
    return signalDBThreadId;
  }

  /**
   * Get the Discord thread ID for a SignalDB thread.
   *
   * @param signalDBThreadId - SignalDB thread UUID
   * @returns Discord thread snowflake ID, or null if not mapped
   */
  mapSignalDBToDiscord(signalDBThreadId: string): string | null {
    return this.signalDBToDiscord.get(signalDBThreadId) || null;
  }

  /**
   * Create a bidirectional mapping between Discord and SignalDB threads.
   *
   * @param discordThreadId - Discord thread snowflake ID
   * @param signalDBThreadId - SignalDB thread UUID
   */
  createMapping(discordThreadId: string, signalDBThreadId: string): void {
    const mapping: ThreadMapping = {
      discordThreadId,
      signalDBThreadId,
      createdAt: new Date().toISOString(),
    };

    this.discordToSignalDB.set(discordThreadId, signalDBThreadId);
    this.signalDBToDiscord.set(signalDBThreadId, discordThreadId);
    this.mappings.set(discordThreadId, mapping);
  }

  /**
   * Get or create a Discord thread for a SignalDB thread.
   *
   * If a Discord thread already exists for this SignalDB thread, returns
   * its ID. Otherwise, creates a new public thread in the specified channel.
   *
   * @param discordChannelId - Parent channel to create thread in
   * @param signalDBThreadId - SignalDB thread UUID
   * @param title - Thread title/name
   * @returns Discord thread snowflake ID
   */
  async getOrCreateDiscordThread(
    discordChannelId: string,
    signalDBThreadId: string,
    title: string
  ): Promise<string> {
    // Check if mapping already exists
    const existing = this.signalDBToDiscord.get(signalDBThreadId);
    if (existing) {
      return existing;
    }

    // Create new Discord thread
    const thread = await this.createDiscordThread(discordChannelId, title);
    this.createMapping(thread.id, signalDBThreadId);
    return thread.id;
  }

  /**
   * Get all thread mappings.
   *
   * @returns Array of all thread mappings
   */
  getAllMappings(): ThreadMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Get the total number of thread mappings.
   *
   * @returns Count of active mappings
   */
  getMappingCount(): number {
    return this.mappings.size;
  }

  /**
   * Check if a Discord thread has a mapping.
   *
   * @param discordThreadId - Discord thread snowflake ID
   * @returns True if mapping exists
   */
  hasDiscordMapping(discordThreadId: string): boolean {
    return this.discordToSignalDB.has(discordThreadId);
  }

  /**
   * Check if a SignalDB thread has a mapping.
   *
   * @param signalDBThreadId - SignalDB thread UUID
   * @returns True if mapping exists
   */
  hasSignalDBMapping(signalDBThreadId: string): boolean {
    return this.signalDBToDiscord.has(signalDBThreadId);
  }

  /**
   * Remove a mapping by Discord thread ID.
   *
   * @param discordThreadId - Discord thread snowflake ID
   */
  removeMapping(discordThreadId: string): void {
    const signalDBThreadId = this.discordToSignalDB.get(discordThreadId);
    if (signalDBThreadId) {
      this.signalDBToDiscord.delete(signalDBThreadId);
    }
    this.discordToSignalDB.delete(discordThreadId);
    this.mappings.delete(discordThreadId);
  }

  /**
   * Clear all mappings.
   */
  clearAllMappings(): void {
    this.discordToSignalDB.clear();
    this.signalDBToDiscord.clear();
    this.mappings.clear();
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Create a Discord thread via the REST API.
   */
  private async createDiscordThread(
    channelId: string,
    name: string
  ): Promise<DiscordThreadCreateResponse> {
    const url = `${DISCORD_API_BASE}/channels/${channelId}/threads`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: this.sanitizeThreadName(name),
        type: THREAD_TYPE_PUBLIC,
        auto_archive_duration: AUTO_ARCHIVE_DURATION,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create thread: ${response.status} ${error}`);
    }

    return response.json() as Promise<DiscordThreadCreateResponse>;
  }

  /**
   * Generate a UUID-like thread ID for SignalDB.
   */
  private generateThreadId(): string {
    // Simple UUID v4 generation
    const hex = '0123456789abcdef';
    let uuid = '';

    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        uuid += '-';
      } else if (i === 14) {
        uuid += '4'; // Version 4
      } else if (i === 19) {
        uuid += hex[(Math.random() * 4) | 8]; // Variant
      } else {
        uuid += hex[(Math.random() * 16) | 0];
      }
    }

    return uuid;
  }

  /**
   * Sanitize thread name for Discord (max 100 chars, no invalid chars).
   */
  private sanitizeThreadName(name: string): string {
    // Remove invalid characters and truncate
    const sanitized = name
      .replace(/[^\w\s-]/g, '')
      .trim()
      .slice(0, 100);

    return sanitized || 'Conversation';
  }
}
