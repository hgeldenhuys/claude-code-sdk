/**
 * Message Subscriber
 *
 * Subscribes to real-time message streams via SSE for specific channels.
 * Creates or reuses an SSEClient, filters messages by channelId,
 * and dispatches to registered callbacks.
 */

import type { Message } from '../protocol/types';
import { SSEClient } from '../daemon/sse-client';
import type { SSEConfig } from '../daemon/types';
import type { ChannelConfig, ChannelSubscription } from './types';

// ============================================================================
// Default SSE Config
// ============================================================================

const DEFAULT_SSE_CONFIG: SSEConfig = {
  endpoint: '/v1/messages/stream',
  lastEventId: null,
  reconnectBaseMs: 1_000,
  reconnectMaxMs: 30_000,
  reconnectMultiplier: 2,
};

// ============================================================================
// Subscriber
// ============================================================================

/**
 * Subscribes to channel message streams via SSE.
 *
 * Supports multiple subscriptions per channel. Filters incoming SSE
 * messages by channelId and dispatches to registered callbacks.
 *
 * @example
 * ```typescript
 * const subscriber = new MessageSubscriber(config);
 *
 * const sub = subscriber.subscribe('channel-001', (msg) => {
 *   console.log(`[${msg.senderId}]: ${msg.content}`);
 * });
 *
 * // Later: clean up
 * sub.unsubscribe();
 * subscriber.disconnect();
 * ```
 */
export class MessageSubscriber {
  private readonly config: ChannelConfig;
  private sseClient: SSEClient | null;
  private ownsSSEClient: boolean;
  private readonly subscriptions: Map<string, Array<(message: Message) => void>>;
  private connected: boolean;

  constructor(config: ChannelConfig) {
    this.config = config;
    this.subscriptions = new Map();
    this.connected = false;

    // Reuse provided SSE client or mark that we need to create our own
    if (config.sseClient) {
      this.sseClient = config.sseClient;
      this.ownsSSEClient = false;
      this.setupMessageHandler();
      this.connected = config.sseClient.isConnected;
    } else {
      this.sseClient = null;
      this.ownsSSEClient = true;
    }
  }

  /**
   * Subscribe to messages on a specific channel.
   *
   * Creates the SSE connection on first subscription if not already connected.
   * Multiple subscriptions per channel are supported.
   *
   * @param channelId - UUID of the channel to subscribe to
   * @param callback - Invoked for each message matching the channelId
   * @returns ChannelSubscription with cleanup function
   */
  subscribe(
    channelId: string,
    callback: (message: Message) => void,
  ): ChannelSubscription {
    // Register callback for this channel
    let callbacks = this.subscriptions.get(channelId);
    if (!callbacks) {
      callbacks = [];
      this.subscriptions.set(channelId, callbacks);
    }
    callbacks.push(callback);

    // Ensure SSE connection is established
    if (!this.connected) {
      this.ensureConnection();
    }

    // Return subscription handle with unsubscribe cleanup
    const unsubscribe = () => {
      const cbs = this.subscriptions.get(channelId);
      if (cbs) {
        const idx = cbs.indexOf(callback);
        if (idx !== -1) {
          cbs.splice(idx, 1);
        }
        // Remove channel entry if no more callbacks
        if (cbs.length === 0) {
          this.subscriptions.delete(channelId);
        }
      }
    };

    return {
      channelId,
      callback,
      unsubscribe,
    };
  }

  /**
   * Disconnect from the SSE stream and remove all subscriptions.
   * Only disconnects if we own the SSE client (not shared from daemon).
   */
  disconnect(): void {
    if (this.sseClient && this.ownsSSEClient) {
      this.sseClient.disconnect();
    }
    this.subscriptions.clear();
    this.connected = false;
  }

  /**
   * Whether the subscriber is connected to the SSE stream.
   */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * Number of active subscriptions across all channels.
   */
  get subscriptionCount(): number {
    let count = 0;
    for (const [, callbacks] of this.subscriptions) {
      count += callbacks.length;
    }
    return count;
  }

  // --------------------------------------------------------------------------
  // Internal
  // --------------------------------------------------------------------------

  /**
   * Ensure SSE connection is established. Creates client if needed.
   */
  private ensureConnection(): void {
    if (this.connected && this.sseClient) return;

    if (!this.sseClient) {
      this.sseClient = new SSEClient(
        this.config.apiUrl,
        this.config.projectKey,
        DEFAULT_SSE_CONFIG,
        { agent_id: this.config.agentId },
      );
      this.ownsSSEClient = true;
      this.setupMessageHandler();
    }

    // Fire and forget the connect - reconnection is handled internally
    this.sseClient.connect().catch(() => {
      // Connection errors are handled by SSEClient's onError callbacks
    });

    this.sseClient.onStatus((isConnected) => {
      this.connected = isConnected;
    });

    this.connected = true;
  }

  /**
   * Set up the message handler that dispatches to channel-specific callbacks.
   */
  private setupMessageHandler(): void {
    if (!this.sseClient) return;

    this.sseClient.onMessage((message: Message) => {
      // Filter by channel and dispatch to callbacks
      const callbacks = this.subscriptions.get(message.channelId);
      if (!callbacks || callbacks.length === 0) return;

      for (let i = 0; i < callbacks.length; i++) {
        try {
          callbacks[i]!(message);
        } catch {
          // Don't let callback errors kill the subscription
        }
      }
    });
  }
}
