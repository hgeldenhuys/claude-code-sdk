/**
 * Discord Gateway Client
 *
 * WebSocket client for Discord Gateway API with auto-reconnection.
 * Also manages SignalDB SSE connection for bidirectional bridging.
 */

import { SSEClient } from '../../daemon/sse-client';
import type { Message } from '../../protocol/types';
import type {
  DiscordBotConfig,
  DiscordEventCallback,
  DiscordGatewayPayload,
  DiscordHelloData,
  DiscordIdentifyData,
  DiscordInteraction,
  DiscordMessage,
  DiscordPresenceUpdate,
  DiscordReadyData,
  GatewayConnectionStatus,
} from './types';
import { DiscordGatewayOpcode, DiscordIntent } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord Gateway URL (v10) */
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

/** Initial reconnect delay */
const RECONNECT_BASE_MS = 1000;

/** Maximum reconnect delay */
const RECONNECT_MAX_MS = 30000;

/** Reconnect delay multiplier */
const RECONNECT_MULTIPLIER = 2;

// ============================================================================
// Discord Gateway
// ============================================================================

/**
 * Discord Gateway client with SignalDB SSE integration.
 *
 * Handles:
 * - Discord WebSocket connection with HELLO -> IDENTIFY -> READY flow
 * - Heartbeat loop with proper interval
 * - SignalDB SSE subscription for outbound messages
 * - Auto-reconnection with exponential backoff
 *
 * @example
 * ```typescript
 * const gateway = new DiscordGateway(config);
 *
 * gateway.onDiscordMessage((msg) => {
 *   console.log('Discord:', msg.content);
 * });
 *
 * gateway.onSignalDBMessage((msg) => {
 *   console.log('SignalDB:', msg.content);
 * });
 *
 * await gateway.connect();
 * ```
 */
export class DiscordGateway {
  private readonly config: DiscordBotConfig;

  // Discord WebSocket state
  private ws: WebSocket | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private discordConnected = false;
  private shouldReconnect = true;
  private currentBackoffMs = RECONNECT_BASE_MS;

  // SignalDB SSE state
  private sseClient: SSEClient | null = null;
  private signalDBConnected = false;

  // Event callbacks
  private messageCallbacks: DiscordEventCallback<DiscordMessage>[] = [];
  private interactionCallbacks: DiscordEventCallback<DiscordInteraction>[] = [];
  private presenceCallbacks: DiscordEventCallback<DiscordPresenceUpdate>[] = [];
  private readyCallbacks: DiscordEventCallback<DiscordReadyData>[] = [];
  private signalDBMessageCallbacks: Array<(message: Message) => void> = [];
  private statusCallbacks: Array<(status: GatewayConnectionStatus) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];

  constructor(config: DiscordBotConfig) {
    this.config = config;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Connect to both Discord Gateway and SignalDB SSE.
   * Returns when both connections are established.
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true;

    // Connect to Discord Gateway
    await this.connectDiscord();

    // Connect to SignalDB SSE
    await this.connectSignalDB();
  }

  /**
   * Disconnect from both Discord and SignalDB.
   */
  disconnect(): void {
    this.shouldReconnect = false;

    // Disconnect Discord
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Graceful shutdown');
      this.ws = null;
    }

    this.discordConnected = false;

    // Disconnect SignalDB
    if (this.sseClient) {
      this.sseClient.disconnect();
      this.sseClient = null;
    }

    this.signalDBConnected = false;
    this.emitStatus();
  }

  /**
   * Get current connection status.
   */
  isConnected(): GatewayConnectionStatus {
    return {
      discord: this.discordConnected,
      signaldb: this.signalDBConnected,
    };
  }

  // ==========================================================================
  // Event Registration
  // ==========================================================================

  /**
   * Register callback for Discord MESSAGE_CREATE events.
   */
  onDiscordMessage(callback: DiscordEventCallback<DiscordMessage>): void {
    this.messageCallbacks.push(callback);
  }

  /**
   * Register callback for Discord INTERACTION_CREATE events.
   */
  onDiscordInteraction(callback: DiscordEventCallback<DiscordInteraction>): void {
    this.interactionCallbacks.push(callback);
  }

  /**
   * Register callback for Discord PRESENCE_UPDATE events.
   */
  onDiscordPresence(callback: DiscordEventCallback<DiscordPresenceUpdate>): void {
    this.presenceCallbacks.push(callback);
  }

  /**
   * Register callback for Discord READY event.
   */
  onDiscordReady(callback: DiscordEventCallback<DiscordReadyData>): void {
    this.readyCallbacks.push(callback);
  }

  /**
   * Register callback for SignalDB messages via SSE.
   */
  onSignalDBMessage(callback: (message: Message) => void): void {
    this.signalDBMessageCallbacks.push(callback);
  }

  /**
   * Register callback for connection status changes.
   */
  onStatus(callback: (status: GatewayConnectionStatus) => void): void {
    this.statusCallbacks.push(callback);
  }

  /**
   * Register callback for errors.
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  // ==========================================================================
  // Discord Connection
  // ==========================================================================

  private async connectDiscord(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = this.resumeGatewayUrl || DISCORD_GATEWAY_URL;
      this.ws = new WebSocket(url);

      let resolved = false;

      this.ws.onopen = () => {
        // Wait for HELLO before considering connected
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as DiscordGatewayPayload;
          this.handleGatewayPayload(payload);

          // Resolve on READY
          if (payload.t === 'READY' && !resolved) {
            resolved = true;
            resolve();
          }
        } catch (err) {
          this.emitError(err instanceof Error ? err : new Error(String(err)));
        }
      };

      this.ws.onerror = (event) => {
        const error = new Error(`Discord WebSocket error: ${event.type}`);
        this.emitError(error);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      };

      this.ws.onclose = (event) => {
        this.discordConnected = false;
        this.emitStatus();

        if (this.heartbeatInterval) {
          clearInterval(this.heartbeatInterval);
          this.heartbeatInterval = null;
        }

        // Reconnect if appropriate
        if (this.shouldReconnect && event.code !== 1000) {
          this.scheduleDiscordReconnect();
        }

        if (!resolved) {
          resolved = true;
          reject(new Error(`Discord WebSocket closed: ${event.code} ${event.reason}`));
        }
      };
    });
  }

  private handleGatewayPayload(payload: DiscordGatewayPayload): void {
    // Track sequence number
    if (payload.s !== null) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case DiscordGatewayOpcode.Hello:
        this.handleHello(payload.d as DiscordHelloData);
        break;

      case DiscordGatewayOpcode.HeartbeatACK:
        // Heartbeat acknowledged, connection is healthy
        break;

      case DiscordGatewayOpcode.Reconnect:
        // Discord requests reconnect
        this.ws?.close(4000, 'Reconnect requested');
        break;

      case DiscordGatewayOpcode.InvalidSession:
        // Session invalid, need to re-identify
        this.sessionId = null;
        this.resumeGatewayUrl = null;
        if (this.shouldReconnect) {
          this.scheduleDiscordReconnect();
        }
        break;

      case DiscordGatewayOpcode.Dispatch:
        this.handleDispatch(payload.t!, payload.d);
        break;
    }
  }

  private handleHello(data: DiscordHelloData): void {
    // Start heartbeat loop
    const interval = data.heartbeat_interval;
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);

    // Send initial heartbeat immediately (with jitter)
    setTimeout(() => {
      this.sendHeartbeat();
    }, Math.random() * interval);

    // Send IDENTIFY
    this.sendIdentify();
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Heartbeat,
      d: this.lastSequence,
      s: null,
      t: null,
    };

    this.ws.send(JSON.stringify(payload));
  }

  private sendIdentify(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const identifyData: DiscordIdentifyData = {
      token: this.config.discordToken,
      intents:
        DiscordIntent.Guilds |
        DiscordIntent.GuildMessages |
        DiscordIntent.DirectMessages |
        DiscordIntent.MessageContent,
      properties: {
        os: 'linux',
        browser: 'claude-code-sdk',
        device: 'claude-code-sdk',
      },
    };

    const payload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Identify,
      d: identifyData,
      s: null,
      t: null,
    };

    this.ws.send(JSON.stringify(payload));
  }

  private handleDispatch(eventName: string, data: unknown): void {
    switch (eventName) {
      case 'READY': {
        const readyData = data as DiscordReadyData;
        this.sessionId = readyData.session_id;
        this.resumeGatewayUrl = readyData.resume_gateway_url;
        this.discordConnected = true;
        this.currentBackoffMs = RECONNECT_BASE_MS; // Reset backoff on success
        this.emitStatus();
        this.emitReady(readyData);
        break;
      }

      case 'MESSAGE_CREATE': {
        const message = data as DiscordMessage;
        // Ignore bot's own messages
        if (!message.author.bot) {
          this.emitMessage(message);
        }
        break;
      }

      case 'INTERACTION_CREATE': {
        const interaction = data as DiscordInteraction;
        this.emitInteraction(interaction);
        break;
      }

      case 'PRESENCE_UPDATE': {
        const presence = data as DiscordPresenceUpdate;
        this.emitPresence(presence);
        break;
      }
    }
  }

  private async scheduleDiscordReconnect(): Promise<void> {
    if (!this.shouldReconnect) return;

    const delay = this.currentBackoffMs;
    this.currentBackoffMs = Math.min(
      this.currentBackoffMs * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS
    );

    await Bun.sleep(delay);

    if (this.shouldReconnect) {
      try {
        await this.connectDiscord();
      } catch {
        // Will retry via onclose handler
      }
    }
  }

  // ==========================================================================
  // SignalDB Connection
  // ==========================================================================

  private async connectSignalDB(): Promise<void> {
    this.sseClient = new SSEClient(
      this.config.apiUrl,
      this.config.projectKey,
      {
        endpoint: '/v1/messages/stream',
        reconnectBaseMs: RECONNECT_BASE_MS,
        reconnectMaxMs: RECONNECT_MAX_MS,
        reconnectMultiplier: RECONNECT_MULTIPLIER,
        lastEventId: null,
      },
      { agentId: this.config.agentId }
    );

    this.sseClient.onMessage((message) => {
      this.emitSignalDBMessage(message);
    });

    this.sseClient.onStatus((connected) => {
      this.signalDBConnected = connected;
      this.emitStatus();
    });

    this.sseClient.onError((error) => {
      this.emitError(error);
    });

    await this.sseClient.connect();
  }

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  private emitMessage(message: DiscordMessage): void {
    for (let i = 0; i < this.messageCallbacks.length; i++) {
      try {
        const result = this.messageCallbacks[i]!(message);
        if (result instanceof Promise) {
          result.catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitInteraction(interaction: DiscordInteraction): void {
    for (let i = 0; i < this.interactionCallbacks.length; i++) {
      try {
        const result = this.interactionCallbacks[i]!(interaction);
        if (result instanceof Promise) {
          result.catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitPresence(presence: DiscordPresenceUpdate): void {
    for (let i = 0; i < this.presenceCallbacks.length; i++) {
      try {
        const result = this.presenceCallbacks[i]!(presence);
        if (result instanceof Promise) {
          result.catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitReady(data: DiscordReadyData): void {
    for (let i = 0; i < this.readyCallbacks.length; i++) {
      try {
        const result = this.readyCallbacks[i]!(data);
        if (result instanceof Promise) {
          result.catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitSignalDBMessage(message: Message): void {
    for (let i = 0; i < this.signalDBMessageCallbacks.length; i++) {
      try {
        this.signalDBMessageCallbacks[i]!(message);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private emitStatus(): void {
    const status = this.isConnected();
    for (let i = 0; i < this.statusCallbacks.length; i++) {
      try {
        this.statusCallbacks[i]!(status);
      } catch {
        // Ignore callback errors
      }
    }
  }

  private emitError(error: Error): void {
    for (let i = 0; i < this.errorCallbacks.length; i++) {
      try {
        this.errorCallbacks[i]!(error);
      } catch {
        // Ignore callback errors
      }
    }
  }
}
