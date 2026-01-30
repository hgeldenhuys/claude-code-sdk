/**
 * SSE Subscription Client
 *
 * Subscribes to a SignalDB Server-Sent Events stream for real-time
 * message delivery. Uses raw fetch with ReadableStream (no EventSource
 * polyfill needed in Bun).
 *
 * Features:
 * - Custom SSE text protocol parsing (data:, id:, event: fields)
 * - Exponential backoff reconnection (1s, 2s, 4s, 8s, max 30s)
 * - Last-Event-ID tracking for resume after reconnect
 * - Callback-based message delivery
 * - Structured logging via createLogger
 * - Health status monitoring (reconnect count, last connected/event times)
 * - Keepalive ping with logging on failure
 */

import type { Message } from '../protocol/types';
import type { SSEConfig, SSEEvent } from './types';
import { createLogger } from './logger';

const log = createLogger('sse-client');

// ============================================================================
// Types
// ============================================================================

/** Callback invoked when a parsed Message arrives from the SSE stream. */
export type SSEMessageCallback = (message: Message) => void;

/** Callback invoked when SSE connection status changes. */
export type SSEStatusCallback = (connected: boolean) => void;

/** Callback invoked on connection errors. */
export type SSEErrorCallback = (error: Error) => void;

/** Health status snapshot for diagnostics. */
export interface SSEHealthStatus {
  connected: boolean;
  lastConnectedAt: number;
  lastEventAt: number;
  reconnectCount: number;
}

// ============================================================================
// SSE Text Protocol Parser
// ============================================================================

/**
 * Parse a single SSE frame (delimited by double newline) into an SSEEvent.
 *
 * SSE format:
 *   id: <event-id>\n
 *   event: <event-type>\n
 *   data: <json-payload>\n
 *   \n
 *
 * Fields can appear in any order. Multiple "data:" lines are joined with newlines.
 */
function parseSSEFrame(frame: string): SSEEvent | null {
  let id: string | null = null;
  let event = 'message';
  const dataLines: string[] = [];

  const lines = frame.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line === '') continue;

    // Skip comments
    if (line.startsWith(':')) continue;

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx);
    // Value starts after colon + optional space
    const rawValue = line.slice(colonIdx + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    switch (field) {
      case 'id':
        id = value;
        break;
      case 'event':
        event = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      // retry: field is handled at connection level, not per-event
    }
  }

  // No data means no event to emit
  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join('\n');
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    // If not valid JSON, pass as raw string
    data = rawData;
  }

  return { id, event, data };
}

// ============================================================================
// SSEClient
// ============================================================================

/**
 * Server-Sent Events client for SignalDB message streams.
 *
 * Uses raw fetch with ReadableStream for Bun compatibility.
 * Implements exponential backoff reconnection with Last-Event-ID resume.
 *
 * @example
 * ```typescript
 * const sse = new SSEClient(
 *   'https://my-project.signaldb.live',
 *   'sk_live_...',
 *   { endpoint: '/v1/messages/stream', ... },
 *   { machineId: 'mac-001' },
 * );
 *
 * sse.onMessage((msg) => console.log('Got message:', msg.id));
 * sse.onStatus((connected) => console.log('SSE connected:', connected));
 * await sse.connect();
 * ```
 */
export class SSEClient {
  private readonly apiUrl: string;
  private readonly projectKey: string;
  private readonly config: SSEConfig;
  private readonly queryParams: Record<string, string>;

  private messageCallbacks: SSEMessageCallback[] = [];
  private statusCallbacks: SSEStatusCallback[] = [];
  private errorCallbacks: SSEErrorCallback[] = [];

  private abortController: AbortController | null = null;
  private connected = false;
  private reconnecting = false;
  private shouldReconnect = true;
  private currentBackoffMs: number;
  private lastEventId: string | null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastEventTime: number = Date.now();

  // Health tracking
  private lastConnectedAt: number = 0;
  private reconnectCount: number = 0;

  constructor(
    apiUrl: string,
    projectKey: string,
    config: SSEConfig,
    queryParams?: Record<string, string>,
  ) {
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.projectKey = projectKey;
    this.config = config;
    this.queryParams = queryParams ?? {};
    this.currentBackoffMs = config.reconnectBaseMs;
    this.lastEventId = config.lastEventId;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Register a callback for incoming messages.
   */
  onMessage(cb: SSEMessageCallback): void {
    this.messageCallbacks.push(cb);
  }

  /**
   * Register a callback for connection status changes.
   */
  onStatus(cb: SSEStatusCallback): void {
    this.statusCallbacks.push(cb);
  }

  /**
   * Register a callback for connection errors.
   */
  onError(cb: SSEErrorCallback): void {
    this.errorCallbacks.push(cb);
  }

  /**
   * Whether the client is currently connected to the SSE stream.
   */
  get isConnected(): boolean {
    return this.connected;
  }

  /**
   * The last received event ID (for diagnostics / resume).
   */
  get resumeId(): string | null {
    return this.lastEventId;
  }

  /**
   * Get health status snapshot for diagnostics.
   */
  getHealthStatus(): SSEHealthStatus {
    return {
      connected: this.connected,
      lastConnectedAt: this.lastConnectedAt,
      lastEventAt: this.lastEventTime,
      reconnectCount: this.reconnectCount,
    };
  }

  /**
   * Connect to the SSE stream.
   * Returns when the initial connection is established or fails.
   * Reconnection happens automatically in the background.
   */
  async connect(): Promise<void> {
    this.shouldReconnect = true;
    log.info('Connecting to SSE stream', { url: `${this.apiUrl}${this.config.endpoint}` });
    await this.doConnect();
  }

  /**
   * Disconnect from the SSE stream and stop reconnecting.
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.reconnecting = false;
    this.stopKeepalive();

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.connected) {
      this.connected = false;
      this.emitStatus(false);
    }

    log.info('Disconnected from SSE stream');
  }

  // --------------------------------------------------------------------------
  // Keepalive
  // --------------------------------------------------------------------------

  /**
   * Start keepalive timer that pings the API every 15s of idle.
   * If the ping fails, abort and reconnect immediately.
   */
  private startKeepalive(): void {
    this.stopKeepalive();

    this.keepaliveTimer = setInterval(async () => {
      const idleMs = Date.now() - this.lastEventTime;
      if (idleMs < 12000) return;

      try {
        const resp = await fetch(`${this.apiUrl}/v1/agents?limit=1`, {
          headers: { Authorization: `Bearer ${this.projectKey}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) {
          throw new Error(`Keepalive failed: ${resp.status}`);
        }
        log.debug('Keepalive ping OK', { idleMs });
      } catch (err) {
        // Keepalive failed -- stream is dead regardless of shouldReconnect.
        // Always abort so that processStream exits and triggers reconnect.
        log.warn('Keepalive ping failed, aborting stream', {
          idleMs,
          error: err instanceof Error ? err.message : String(err),
        });
        if (this.abortController) {
          this.abortController.abort();
        }
      }
    }, 15000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // --------------------------------------------------------------------------
  // Connection Logic
  // --------------------------------------------------------------------------

  private async doConnect(): Promise<void> {
    // Build URL with query params
    const params = new URLSearchParams();
    for (const key of Object.keys(this.queryParams)) {
      const value = this.queryParams[key];
      if (value !== undefined) {
        params.set(key, value);
      }
    }

    const qs = params.toString();
    const url = `${this.apiUrl}${this.config.endpoint}${qs ? '?' + qs : ''}`;

    // Set up headers
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.projectKey}`,
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };

    if (this.lastEventId) {
      headers['Last-Event-ID'] = this.lastEventId;
    }

    // Create abort controller for this connection
    this.abortController = new AbortController();

    log.debug('Opening SSE connection', { url, lastEventId: this.lastEventId });

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error('SSE response has no body');
      }

      // Connected successfully - reset backoff
      this.connected = true;
      this.lastConnectedAt = Date.now();
      this.currentBackoffMs = this.config.reconnectBaseMs;
      this.lastEventTime = Date.now();
      this.emitStatus(true);
      this.startKeepalive();

      log.info('SSE stream connected', { url, resumeId: this.lastEventId });

      // Process the stream in background (don't await - let caller continue)
      this.processStream(response.body).catch((err) => {
        // Handle stream errors
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          log.error('SSE stream processing error', {
            error: err instanceof Error ? err.message : String(err),
          });
          this.emitError(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (err) {
      // Ignore abort errors during intentional disconnect
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }

      log.error('SSE connection failed', {
        error: err instanceof Error ? err.message : String(err),
      });

      this.connected = false;
      this.emitStatus(false);
      this.emitError(err instanceof Error ? err : new Error(String(err)));

      // Schedule reconnect if allowed
      if (this.shouldReconnect) {
        await this.scheduleReconnect();
      }
    }
  }

  /**
   * Process the ReadableStream from the SSE response.
   * Buffers incoming chunks and splits on double-newline boundaries.
   */
  private async processStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Stream ended (server closed connection)
          log.warn('SSE stream ended (server closed connection)');
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Split on double-newline (SSE frame delimiter)
        let delimIdx: number;
        while ((delimIdx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, delimIdx);
          buffer = buffer.slice(delimIdx + 2);

          const event = parseSSEFrame(frame);
          if (event) {
            // Track last event ID for resumption and reset idle timer
            if (event.id !== null) {
              this.lastEventId = event.id;
            }
            this.lastEventTime = Date.now();

            // Emit message if it's an insert event from SignalDB
            // SignalDB sends: event: insert, data: {id, data: {...message fields}, ts}
            // Note: SignalDB uses snake_case, but Message interface uses camelCase
            if (event.event === 'insert' && event.data && typeof event.data === 'object') {
              const wrapper = event.data as { id?: string; data?: Record<string, unknown>; ts?: number };
              if (wrapper.id && wrapper.data) {
                // Convert snake_case keys to camelCase
                const msg: Message = {
                  id: wrapper.id,
                  channelId: (wrapper.data.channel_id ?? '') as string,
                  senderId: (wrapper.data.sender_id ?? '') as string,
                  targetType: (wrapper.data.target_type ?? '') as string,
                  targetAddress: (wrapper.data.target_address ?? '') as string,
                  messageType: (wrapper.data.message_type ?? 'chat') as Message['messageType'],
                  content: (wrapper.data.content ?? '') as string,
                  metadata: (wrapper.data.metadata ?? {}) as Record<string, unknown>,
                  status: (wrapper.data.status ?? 'pending') as Message['status'],
                  claimedBy: (wrapper.data.claimed_by ?? null) as string | null,
                  claimedAt: (wrapper.data.claimed_at ?? null) as string | null,
                  threadId: (wrapper.data.thread_id ?? null) as string | null,
                  createdAt: (wrapper.data.created_at ?? new Date().toISOString()) as string,
                  expiresAt: (wrapper.data.expires_at ?? null) as string | null,
                };
                if (msg.content !== undefined) {
                  log.debug('SSE message received', {
                    messageId: msg.id.slice(0, 8),
                    senderId: msg.senderId.slice(0, 8),
                    type: msg.messageType,
                  });
                  this.emitMessage(msg);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      throw err;
    } finally {
      reader.releaseLock();
    }

    // Stream ended - reconnect if allowed
    this.connected = false;
    this.stopKeepalive();
    this.emitStatus(false);

    if (this.shouldReconnect) {
      await this.scheduleReconnect();
    }
  }

  // --------------------------------------------------------------------------
  // Reconnection with Exponential Backoff
  // --------------------------------------------------------------------------

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting || !this.shouldReconnect) return;
    this.reconnecting = true;
    this.reconnectCount++;

    const delay = this.currentBackoffMs;

    log.info('Scheduling SSE reconnect', {
      delayMs: delay,
      reconnectCount: this.reconnectCount,
    });

    // Calculate next backoff (exponential with cap)
    this.currentBackoffMs = Math.min(
      this.currentBackoffMs * this.config.reconnectMultiplier,
      this.config.reconnectMaxMs,
    );

    await Bun.sleep(delay);

    this.reconnecting = false;

    if (this.shouldReconnect) {
      await this.doConnect();
    }
  }

  // --------------------------------------------------------------------------
  // Event Emission
  // --------------------------------------------------------------------------

  private emitMessage(message: Message): void {
    for (let i = 0; i < this.messageCallbacks.length; i++) {
      try {
        this.messageCallbacks[i]!(message);
      } catch (err) {
        log.warn('Message callback error', {
          messageId: message.id.slice(0, 8),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private emitStatus(connected: boolean): void {
    for (let i = 0; i < this.statusCallbacks.length; i++) {
      try {
        this.statusCallbacks[i]!(connected);
      } catch (err) {
        log.warn('Status callback error', {
          connected,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private emitError(error: Error): void {
    for (let i = 0; i < this.errorCallbacks.length; i++) {
      try {
        this.errorCallbacks[i]!(error);
      } catch (err) {
        log.warn('Error callback error', {
          originalError: error.message,
          callbackError: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
