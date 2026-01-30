/**
 * Discord Gateway Client
 *
 * WebSocket client for Discord Gateway API v10 with auto-reconnection.
 * Also manages SignalDB SSE connection for bidirectional bridging.
 *
 * Protocol flow:
 *   1. Connect to wss://gateway.discord.gg/?v=10&encoding=json
 *   2. Receive HELLO (op 10) with heartbeat_interval
 *   3. Send initial heartbeat after jitter delay (random * heartbeat_interval)
 *   4. Send IDENTIFY (op 2) with token, intents, and client properties
 *   5. Receive READY (op 0, t=READY) with session_id and resume_gateway_url
 *   6. Maintain heartbeat loop at heartbeat_interval
 *   7. Track heartbeat ACK (op 11) for zombie connection detection
 *
 * Reconnection:
 *   - Exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 30s (max)
 *   - Jitter added to backoff to prevent thundering herd
 *   - On RECONNECT (op 7): close and reconnect using resume_gateway_url
 *   - On INVALID_SESSION (op 9): clear session, full re-identify
 *   - Resume with session_id and last sequence if available
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

/** Initial reconnect delay in milliseconds */
const RECONNECT_BASE_MS = 1000;

/** Maximum reconnect delay in milliseconds */
const RECONNECT_MAX_MS = 30000;

/** Reconnect delay multiplier for exponential backoff */
const RECONNECT_MULTIPLIER = 2;

/** Maximum jitter fraction added to backoff delay (0-1) */
const RECONNECT_JITTER_FRACTION = 0.5;

/** Number of missed heartbeat ACKs before considering connection zombie */
const MAX_MISSED_HEARTBEAT_ACKS = 2;

/** Close codes that indicate we should NOT resume (need fresh IDENTIFY) */
const NON_RESUMABLE_CLOSE_CODES = new Set([
  4004, // Authentication failed
  4010, // Invalid shard
  4011, // Sharding required
  4013, // Invalid intents
  4014, // Disallowed intents
]);

// ============================================================================
// Discord Gateway
// ============================================================================

/**
 * Discord Gateway client with SignalDB SSE integration.
 *
 * Handles:
 * - Discord WebSocket connection with HELLO -> IDENTIFY -> READY flow
 * - Heartbeat loop with jitter and ACK tracking for zombie detection
 * - Session resume when reconnecting with valid session
 * - SignalDB SSE subscription for outbound messages
 * - Auto-reconnection with exponential backoff (1s -> 30s max)
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
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private discordConnected = false;
  private shouldReconnect = true;
  private currentBackoffMs = RECONNECT_BASE_MS;

  // Heartbeat ACK tracking for zombie detection
  private heartbeatAckReceived = true;
  private missedHeartbeatAcks = 0;
  private lastHeartbeatSentAt = 0;
  private lastHeartbeatAckAt = 0;

  // Connection uptime tracking
  private connectedSinceMs = 0;
  private reconnectCount = 0;

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
   * Returns when both connections are established (READY received).
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true;

    // Connect to Discord Gateway
    await this.connectDiscord();

    // Connect to SignalDB SSE
    await this.connectSignalDB();
  }

  /**
   * Disconnect from both Discord and SignalDB gracefully.
   */
  disconnect(): void {
    this.shouldReconnect = false;

    // Disconnect Discord
    this.clearHeartbeat();

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

  /**
   * Get detailed health status for diagnostics.
   */
  getHealthStatus(): {
    discord: boolean;
    signaldb: boolean;
    sessionId: string | null;
    lastHeartbeatSentAt: number;
    lastHeartbeatAckAt: number;
    missedHeartbeatAcks: number;
    reconnectCount: number;
    uptimeMs: number;
  } {
    return {
      discord: this.discordConnected,
      signaldb: this.signalDBConnected,
      sessionId: this.sessionId,
      lastHeartbeatSentAt: this.lastHeartbeatSentAt,
      lastHeartbeatAckAt: this.lastHeartbeatAckAt,
      missedHeartbeatAcks: this.missedHeartbeatAcks,
      reconnectCount: this.reconnectCount,
      uptimeMs: this.connectedSinceMs > 0 ? Date.now() - this.connectedSinceMs : 0,
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
      // Use resume URL if we have a valid session, otherwise fresh connect
      const url = (this.sessionId && this.resumeGatewayUrl)
        ? `${this.resumeGatewayUrl}/?v=10&encoding=json`
        : DISCORD_GATEWAY_URL;
      this.ws = new WebSocket(url);

      let resolved = false;

      this.ws.onopen = () => {
        // Wait for HELLO before considering connected
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as DiscordGatewayPayload;
          this.handleGatewayPayload(payload);

          // Resolve on READY or RESUMED
          if ((payload.t === 'READY' || payload.t === 'RESUMED') && !resolved) {
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
        this.clearHeartbeat();

        // Check if close code is non-resumable (clear session state)
        if (NON_RESUMABLE_CLOSE_CODES.has(event.code)) {
          this.sessionId = null;
          this.resumeGatewayUrl = null;
          this.lastSequence = null;
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
    // Track sequence number for heartbeat and resume
    if (payload.s !== null) {
      this.lastSequence = payload.s;
    }

    switch (payload.op) {
      case DiscordGatewayOpcode.Hello:
        this.handleHello(payload.d as DiscordHelloData);
        break;

      case DiscordGatewayOpcode.Heartbeat:
        // Discord can request an immediate heartbeat (op 1 as request)
        this.sendHeartbeat();
        break;

      case DiscordGatewayOpcode.HeartbeatACK:
        // Heartbeat acknowledged -- connection is healthy
        this.heartbeatAckReceived = true;
        this.missedHeartbeatAcks = 0;
        this.lastHeartbeatAckAt = Date.now();
        break;

      case DiscordGatewayOpcode.Reconnect:
        // Discord requests reconnect -- close and let reconnect logic handle
        this.ws?.close(4000, 'Reconnect requested by Discord');
        break;

      case DiscordGatewayOpcode.InvalidSession: {
        // d is boolean: true = resumable, false = not resumable
        const resumable = payload.d as boolean;
        if (!resumable) {
          this.sessionId = null;
          this.resumeGatewayUrl = null;
          this.lastSequence = null;
        }
        // Wait 1-5s before reconnecting per Discord docs
        const delay = 1000 + Math.random() * 4000;
        if (this.shouldReconnect) {
          this.ws?.close(4000, 'Invalid session');
          setTimeout(() => {
            if (this.shouldReconnect) {
              this.connectDiscord().catch(() => {
                // Will retry via scheduleDiscordReconnect
              });
            }
          }, delay);
        }
        break;
      }

      case DiscordGatewayOpcode.Dispatch:
        this.handleDispatch(payload.t!, payload.d);
        break;
    }
  }

  private handleHello(data: DiscordHelloData): void {
    const interval = data.heartbeat_interval;

    // Reset heartbeat ACK tracking
    this.heartbeatAckReceived = true;
    this.missedHeartbeatAcks = 0;

    // Send initial heartbeat with jitter (random fraction of interval)
    // per Discord docs: "send first heartbeat after heartbeat_interval * jitter"
    const jitterDelay = Math.floor(Math.random() * interval);
    setTimeout(() => {
      this.sendHeartbeat();
    }, jitterDelay);

    // Start heartbeat loop at the specified interval
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Check if previous heartbeat was ACK'd
      if (!this.heartbeatAckReceived) {
        this.missedHeartbeatAcks++;
        if (this.missedHeartbeatAcks >= MAX_MISSED_HEARTBEAT_ACKS) {
          // Zombie connection -- force reconnect
          this.emitError(new Error(
            `Discord gateway zombie: ${this.missedHeartbeatAcks} missed heartbeat ACKs`
          ));
          this.ws?.close(4001, 'Zombie connection detected');
          return;
        }
      }

      this.sendHeartbeat();
    }, interval);

    // Send IDENTIFY or RESUME depending on session state
    if (this.sessionId && this.lastSequence !== null) {
      this.sendResume();
    } else {
      this.sendIdentify();
    }
  }

  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Mark that we have not yet received ACK for this heartbeat
    this.heartbeatAckReceived = false;
    this.lastHeartbeatSentAt = Date.now();

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
        os: process.platform || 'linux',
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

  /**
   * Send RESUME to continue a previous session after disconnect.
   * Requires valid sessionId and lastSequence from prior READY.
   */
  private sendResume(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.sessionId) return;

    const payload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Resume,
      d: {
        token: this.config.discordToken,
        session_id: this.sessionId,
        seq: this.lastSequence,
      },
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
        this.connectedSinceMs = Date.now();
        this.currentBackoffMs = RECONNECT_BASE_MS; // Reset backoff on success
        this.emitStatus();
        this.emitReady(readyData);
        break;
      }

      case 'RESUMED': {
        // Session successfully resumed
        this.discordConnected = true;
        this.connectedSinceMs = Date.now();
        this.currentBackoffMs = RECONNECT_BASE_MS;
        this.emitStatus();
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

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async scheduleDiscordReconnect(): Promise<void> {
    if (!this.shouldReconnect) return;

    this.reconnectCount++;

    // Add jitter to prevent thundering herd on reconnect
    const jitter = this.currentBackoffMs * RECONNECT_JITTER_FRACTION * Math.random();
    const delay = this.currentBackoffMs + jitter;

    // Increase backoff for next attempt
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
