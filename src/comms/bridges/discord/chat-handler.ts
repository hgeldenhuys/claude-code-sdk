/**
 * Discord Chat Handler
 *
 * Handles /chat slash command interactions and threaded follow-up messages.
 * Sends messages to AI agents via SignalDB, polls for responses, and
 * manages Discord threads for conversation continuation.
 *
 * Flow:
 *   /chat agent message -> defer reply -> resolve agent -> send to SignalDB
 *     -> poll for response -> edit reply -> create thread
 *
 *   Thread follow-up -> detect tracked thread -> typing indicator
 *     -> send with threadId -> poll -> post in thread
 */

import { SignalDBClient } from '../../client/signaldb';
import { resolveAgent } from '../../protocol/agent-resolver';
import type { Message } from '../../protocol/types';
import type { MessageFormatter } from './formatter';
import type {
  ChatConversation,
  DiscordBotConfig,
  DiscordEmbed,
  DiscordInteraction,
  DiscordInteractionOption,
  DiscordInteractionResponse,
  DiscordMessage,
  DiscordMessageCreateResponse,
} from './types';
import {
  DiscordInteractionCallbackType,
  DiscordMessageFlags,
} from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord API base URL */
const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Default timeout waiting for AI response (seconds) */
const DEFAULT_TIMEOUT_S = 120;

/** Poll interval when waiting for response (ms) */
const POLL_INTERVAL_MS = 2000;

/** Typing indicator refresh interval (ms) -- Discord typing lasts ~10s */
const TYPING_INTERVAL_MS = 8000;

/** Conversation inactivity cleanup threshold (ms) -- 1 hour */
const CONVERSATION_CLEANUP_MS = 60 * 60 * 1000;

/** Cleanup interval (ms) -- check every 10 minutes */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

/** Discord thread type for public threads */
const THREAD_TYPE_PUBLIC = 11;

// ============================================================================
// Discord Chat Handler
// ============================================================================

/**
 * Manages /chat slash command interactions and threaded follow-ups.
 *
 * Each /chat command creates a conversation tracked by Discord thread ID.
 * Follow-up messages in that thread are automatically routed to the same
 * AI agent with the same SignalDB threadId for context continuity.
 *
 * @example
 * ```typescript
 * const handler = new DiscordChatHandler(config, formatter);
 *
 * // Wire into gateway
 * gateway.onDiscordInteraction(async (interaction) => {
 *   if (interaction.data?.name === 'chat') {
 *     await handler.handleChatCommand(interaction);
 *   }
 * });
 *
 * gateway.onDiscordMessage(async (message) => {
 *   if (handler.isTrackedThread(message.channel_id)) {
 *     await handler.handleThreadMessage(message);
 *   }
 * });
 *
 * // Cleanup on shutdown
 * handler.dispose();
 * ```
 */
export class DiscordChatHandler {
  private readonly config: DiscordBotConfig;
  private readonly signalDBClient: SignalDBClient;
  private readonly formatter: MessageFormatter;

  /** Active conversations: Discord thread ID -> ChatConversation */
  private readonly conversations: Map<string, ChatConversation> = new Map();

  /** Cleanup timer reference */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DiscordBotConfig, formatter: MessageFormatter) {
    this.config = config;

    this.signalDBClient = new SignalDBClient({
      apiUrl: config.apiUrl,
      projectKey: config.projectKey,
    });

    this.formatter = formatter;

    // Start periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleConversations();
    }, CLEANUP_INTERVAL_MS);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Handle a /chat slash command interaction.
   *
   * 1. Parse agent name + message from options
   * 2. Defer reply (shows "thinking...")
   * 3. Resolve agent via shared resolveAgent()
   * 4. Send message to SignalDB
   * 5. Poll for response
   * 6. Edit deferred reply with AI response
   * 7. Create Discord thread for follow-ups
   * 8. Store conversation mapping
   */
  async handleChatCommand(interaction: DiscordInteraction): Promise<void> {
    const options = interaction.data?.options ?? [];
    const agentQuery = this.getOptionValue(options, 'agent') as string;
    const message = this.getOptionValue(options, 'message') as string;
    const timeoutS = (this.getOptionValue(options, 'timeout') as number) ?? DEFAULT_TIMEOUT_S;

    if (!agentQuery || !message) {
      await this.respondEphemeral(interaction, 'Both agent and message are required.');
      return;
    }

    // Defer reply -- shows "Bot is thinking..."
    await this.deferReply(interaction);

    // Resolve agent
    const agent = await resolveAgent(this.signalDBClient, agentQuery);
    if (!agent) {
      await this.editReply(interaction, {
        content: `No active agent found for "${agentQuery}". Use \`/agents\` to see available agents.`,
      });
      return;
    }

    const agentName = agent.sessionName ?? agent.id.slice(0, 8);
    const targetAddress = `agent://${agent.machineId}/${agent.sessionName ?? agent.sessionId ?? agent.id}`;

    // Send message to SignalDB
    const discordUser = interaction.member?.user?.username
      ?? interaction.user?.username
      ?? 'unknown';

    let sent: Message;
    try {
      sent = await this.signalDBClient.messages.send({
        channelId: '',
        senderId: this.config.agentId,
        targetType: 'agent',
        targetAddress,
        messageType: 'command',
        content: message,
        metadata: {
          source: 'discord',
          discordUser,
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.editReply(interaction, {
        content: `Failed to send message to ${agentName}: ${errorMsg}`,
      });
      return;
    }

    // Poll for response
    const response = await this.pollForResponse(sent.id, sent.createdAt, timeoutS);

    if (!response) {
      await this.editReply(interaction, {
        content: `No response from **${agentName}** within ${timeoutS}s. The agent may still be processing.\n\nMessage ID: \`${sent.id.slice(0, 8)}\``,
      });
      return;
    }

    // Format and edit the deferred reply
    const formattedContent = await this.formatter.formatForDiscord(response.content);
    const replyData = await this.editReply(interaction, {
      content: formattedContent,
    });

    // Create a Discord thread on the response message for follow-ups
    if (replyData && interaction.channel_id) {
      const threadTitle = `${agentName}: ${message.slice(0, 50)}${message.length > 50 ? '...' : ''}`;

      try {
        const thread = await this.createThread(
          interaction.channel_id,
          replyData.id,
          threadTitle,
        );

        // Store conversation mapping
        const conversation: ChatConversation = {
          discordThreadId: thread.id,
          signalDBThreadId: sent.id,
          agentId: agent.id,
          agentName,
          agentMachineId: agent.machineId,
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          discordUserId: interaction.member?.user?.id ?? interaction.user?.id ?? '',
        };

        this.conversations.set(thread.id, conversation);
      } catch {
        // Thread creation failed -- conversation still works, just no follow-ups
      }
    }
  }

  /**
   * Handle a follow-up message in a tracked conversation thread.
   *
   * 1. Look up conversation by Discord thread channel ID
   * 2. Start typing indicator
   * 3. Send message to SignalDB with threadId
   * 4. Poll for response
   * 5. Post response in the Discord thread
   * 6. Stop typing indicator
   */
  async handleThreadMessage(message: DiscordMessage): Promise<void> {
    const conversation = this.conversations.get(message.channel_id);
    if (!conversation) return;

    // Update activity timestamp
    conversation.lastActivityAt = Date.now();

    // Build target address
    const targetAddress = `agent://${conversation.agentMachineId}/${conversation.agentName}`;

    // Start typing indicator (repeated every 8s)
    const typingInterval = this.startTypingIndicator(message.channel_id);

    try {
      // Send to SignalDB with thread continuation
      const sent = await this.signalDBClient.messages.send({
        channelId: '',
        senderId: this.config.agentId,
        targetType: 'agent',
        targetAddress,
        messageType: 'command',
        content: message.content,
        threadId: conversation.signalDBThreadId,
        metadata: {
          source: 'discord',
          discordUser: message.author.username,
        },
      });

      // Poll for response
      const response = await this.pollForResponse(
        sent.id,
        sent.createdAt,
        DEFAULT_TIMEOUT_S,
        conversation.signalDBThreadId,
      );

      if (response) {
        const formatted = await this.formatter.formatForDiscord(response.content);
        await this.postToDiscordChannel(message.channel_id, formatted);
      } else {
        await this.postToDiscordChannel(
          message.channel_id,
          `No response from **${conversation.agentName}** within ${DEFAULT_TIMEOUT_S}s. The agent may still be processing.`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.postToDiscordChannel(
        message.channel_id,
        `Error communicating with ${conversation.agentName}: ${errorMsg}`,
      );
    } finally {
      clearInterval(typingInterval);
    }
  }

  /**
   * Check if a Discord channel ID corresponds to a tracked conversation thread.
   */
  isTrackedThread(channelId: string): boolean {
    return this.conversations.has(channelId);
  }

  /**
   * Get the number of active conversations.
   */
  getConversationCount(): number {
    return this.conversations.size;
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.conversations.clear();
  }

  // ==========================================================================
  // Polling
  // ==========================================================================

  /**
   * Poll SignalDB for a response to a sent message.
   *
   * @param sentId - ID of the sent message
   * @param sentCreatedAt - Timestamp of the sent message
   * @param timeoutS - Maximum seconds to wait
   * @param threadId - Optional thread ID for continuation (defaults to sentId)
   * @returns Response message or null on timeout
   */
  private async pollForResponse(
    sentId: string,
    sentCreatedAt: string,
    timeoutS: number,
    threadId?: string,
  ): Promise<Message | null> {
    const pollThreadId = threadId ?? sentId;
    const deadline = Date.now() + timeoutS * 1000;

    while (Date.now() < deadline) {
      await Bun.sleep(POLL_INTERVAL_MS);

      const thread = await this.signalDBClient.messages.listByThread(pollThreadId);

      for (let i = 0; i < thread.length; i++) {
        const msg = thread[i]!;
        if (msg.id === sentId) continue;
        if (msg.messageType !== 'response') continue;

        // Accept responses newer than our sent message
        if (msg.createdAt > sentCreatedAt) {
          return msg;
        }

        // For new threads (no threadId param), any response works
        if (!threadId) {
          return msg;
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // Discord API Helpers
  // ==========================================================================

  /**
   * Send a deferred reply (shows "Bot is thinking...").
   */
  private async deferReply(interaction: DiscordInteraction): Promise<void> {
    const response: DiscordInteractionResponse = {
      type: DiscordInteractionCallbackType.DeferredChannelMessageWithSource,
    };

    const url = `${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to defer reply: ${res.status} ${error}`);
    }
  }

  /**
   * Edit the deferred reply with actual content.
   * Returns the message object from Discord for thread creation.
   */
  private async editReply(
    interaction: DiscordInteraction,
    data: { content?: string; embeds?: DiscordEmbed[] },
  ): Promise<DiscordMessageCreateResponse | null> {
    const applicationId = await this.getApplicationId();
    const url = `${DISCORD_API_BASE}/webhooks/${applicationId}/${interaction.token}/messages/@original`;

    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to edit reply: ${res.status} ${error}`);
    }

    return res.json() as Promise<DiscordMessageCreateResponse>;
  }

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

    const url = `${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to respond: ${res.status} ${error}`);
    }
  }

  /**
   * Create a public thread on a message.
   */
  private async createThread(
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<{ id: string; name: string }> {
    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}/threads`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: name.slice(0, 100), // Discord thread name limit
        type: THREAD_TYPE_PUBLIC,
        auto_archive_duration: 60, // Archive after 60 minutes of inactivity
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create thread: ${res.status} ${error}`);
    }

    return res.json() as Promise<{ id: string; name: string }>;
  }

  /**
   * Post a message to a Discord channel.
   */
  private async postToDiscordChannel(
    channelId: string,
    content: string,
  ): Promise<DiscordMessageCreateResponse> {
    const url = `${DISCORD_API_BASE}/channels/${channelId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to post message: ${res.status} ${error}`);
    }

    return res.json() as Promise<DiscordMessageCreateResponse>;
  }

  /**
   * Start sending typing indicators to a channel.
   * Returns an interval handle to clear when done.
   */
  private startTypingIndicator(channelId: string): ReturnType<typeof setInterval> {
    const sendTyping = async () => {
      try {
        await fetch(`${DISCORD_API_BASE}/channels/${channelId}/typing`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${this.config.discordToken}`,
          },
        });
      } catch {
        // Typing indicator failures are non-critical
      }
    };

    // Send immediately, then repeat
    sendTyping();
    return setInterval(sendTyping, TYPING_INTERVAL_MS);
  }

  /**
   * Fetch the application ID from Discord.
   */
  private async getApplicationId(): Promise<string> {
    const res = await fetch(`${DISCORD_API_BASE}/oauth2/applications/@me`, {
      headers: {
        Authorization: `Bot ${this.config.discordToken}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to get application ID: ${res.status}`);
    }

    const data = (await res.json()) as { id: string };
    return data.id;
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get an option value from interaction options.
   */
  private getOptionValue(
    options: DiscordInteractionOption[],
    name: string,
  ): string | number | boolean | undefined {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      if (opt.name === name) return opt.value;
    }
    return undefined;
  }

  /**
   * Remove conversations that have been inactive for over 1 hour.
   */
  private cleanupStaleConversations(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, conv] of this.conversations) {
      if (now - conv.lastActivityAt > CONVERSATION_CLEANUP_MS) {
        keysToDelete.push(key);
      }
    }

    for (let i = 0; i < keysToDelete.length; i++) {
      this.conversations.delete(keysToDelete[i]!);
    }
  }
}
