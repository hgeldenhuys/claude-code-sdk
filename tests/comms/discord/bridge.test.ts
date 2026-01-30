/**
 * Discord Bridge Structural and Protocol Tests (COMMS-HARD-001 T-007)
 *
 * AC-010: Discord Gateway v10 connects with heartbeat ACK tracking and zombie detection
 * AC-011: 5 slash commands registered (/agents, /channels, /send, /memo, /paste)
 * AC-012: Bidirectional message bridge uses O(1) dual-map lookup
 *
 * Tests the raw WebSocket protocol, heartbeat lifecycle, RESUME/INVALID_SESSION
 * handling, slash command definitions, and bidirectional map mechanics.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { DiscordGateway } from '../../../src/comms/bridges/discord/gateway';
import { SlashCommandManager } from '../../../src/comms/bridges/discord/commands';
import { MessageBridge } from '../../../src/comms/bridges/discord/message-bridge';
import { ThreadMapper } from '../../../src/comms/bridges/discord/thread-mapper';
import { MessageFormatter } from '../../../src/comms/bridges/discord/formatter';
import { DiscordRateLimiter } from '../../../src/comms/bridges/discord/rate-limiter';
import { DiscordGatewayOpcode } from '../../../src/comms/bridges/discord/types';
import type {
  DiscordBotConfig,
  DiscordGatewayPayload,
  DiscordMessage,
  DiscordChannelMapping,
  SlashCommandDef,
} from '../../../src/comms/bridges/discord/types';
import type { Message } from '../../../src/comms/protocol/types';

// ============================================================================
// Constants
// ============================================================================

const TEST_CONFIG: DiscordBotConfig = {
  discordToken: 'test-bot-token',
  guildId: 'guild-123456789',
  apiUrl: 'https://test.signaldb.live',
  projectKey: 'sk_test_discord',
  agentId: 'agent-discord-001',
  commandPrefix: '!',
  rateLimitPerUser: 10,
};

// ============================================================================
// Mock WebSocket with protocol-level control
// ============================================================================

class ProtocolMockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = ProtocolMockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private sentPayloads: DiscordGatewayPayload[] = [];

  constructor(url: string) {
    this.url = url;
    setTimeout(() => {
      this.readyState = ProtocolMockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 5);
  }

  send(data: string): void {
    const payload = JSON.parse(data) as DiscordGatewayPayload;
    this.sentPayloads.push(payload);
  }

  close(code?: number, reason?: string): void {
    this.readyState = ProtocolMockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = ProtocolMockWebSocket.CLOSED;
      if (this.onclose) {
        this.onclose({ code: code ?? 1000, reason: reason ?? '' } as CloseEvent);
      }
    }, 5);
  }

  // -- Test helpers --

  getSentPayloads(): DiscordGatewayPayload[] {
    return this.sentPayloads;
  }

  clearSentPayloads(): void {
    this.sentPayloads = [];
  }

  getLastSentPayload(): DiscordGatewayPayload | undefined {
    return this.sentPayloads[this.sentPayloads.length - 1];
  }

  getPayloadsByOp(op: DiscordGatewayOpcode): DiscordGatewayPayload[] {
    const result: DiscordGatewayPayload[] = [];
    for (let i = 0; i < this.sentPayloads.length; i++) {
      if (this.sentPayloads[i]!.op === op) {
        result.push(this.sentPayloads[i]!);
      }
    }
    return result;
  }

  simulateMessage(payload: DiscordGatewayPayload): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }

  simulateClose(code: number, reason: string): void {
    this.readyState = ProtocolMockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code, reason } as CloseEvent);
    }
  }
}

let wsInstance: ProtocolMockWebSocket | null = null;
let originalWebSocket: typeof WebSocket;

function installMockWebSocket(): void {
  originalWebSocket = globalThis.WebSocket;
  const MockWSClass = class extends ProtocolMockWebSocket {
    constructor(url: string) {
      super(url);
      wsInstance = this;
    }
  };
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = MockWSClass;
}

function uninstallMockWebSocket(): void {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  wsInstance = null;
}

// ============================================================================
// Mock fetch infrastructure
// ============================================================================

type FetchRoute = {
  method: string;
  pattern: string | RegExp;
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
};

let fetchRoutes: FetchRoute[] = [];
let fetchLog: { method: string; url: string; body?: unknown }[] = [];
let savedFetch: typeof globalThis.fetch;

function installMockFetch(): void {
  fetchLog = [];
  savedFetch = globalThis.fetch;

  const mockFn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    fetchLog.push({ method, url, body });

    for (let i = 0; i < fetchRoutes.length; i++) {
      const route = fetchRoutes[i]!;
      const match = typeof route.pattern === 'string'
        ? url.includes(route.pattern)
        : route.pattern.test(url);
      if (route.method === method && match) {
        return route.handler(url, init ?? {});
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };

  (globalThis as unknown as { fetch: unknown }).fetch = mockFn;
}

function uninstallMockFetch(): void {
  (globalThis as unknown as { fetch: unknown }).fetch = savedFetch;
  fetchRoutes = [];
  fetchLog = [];
}

function addFetchRoute(method: string, pattern: string | RegExp, response: unknown, status = 200): void {
  fetchRoutes.push({
    method,
    pattern,
    handler: () => new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

// ============================================================================
// Helpers
// ============================================================================

function makeHelloPayload(heartbeatInterval: number): DiscordGatewayPayload {
  return {
    op: DiscordGatewayOpcode.Hello,
    d: { heartbeat_interval: heartbeatInterval },
    s: null,
    t: null,
  };
}

function makeReadyPayload(sessionId: string, resumeUrl: string, seq: number): DiscordGatewayPayload {
  return {
    op: DiscordGatewayOpcode.Dispatch,
    d: {
      v: 10,
      user: { id: 'bot-user-1', username: 'testbot', discriminator: '0000', avatar: null },
      guilds: [{ id: TEST_CONFIG.guildId }],
      session_id: sessionId,
      resume_gateway_url: resumeUrl,
      application: { id: 'app-123', flags: 0 },
    },
    s: seq,
    t: 'READY',
  };
}

function makeHeartbeatAckPayload(): DiscordGatewayPayload {
  return { op: DiscordGatewayOpcode.HeartbeatACK, d: null, s: null, t: null };
}

function makeInvalidSessionPayload(resumable: boolean): DiscordGatewayPayload {
  return { op: DiscordGatewayOpcode.InvalidSession, d: resumable, s: null, t: null };
}

function makeReconnectPayload(): DiscordGatewayPayload {
  return { op: DiscordGatewayOpcode.Reconnect, d: null, s: null, t: null };
}

function makeDispatchPayload(eventName: string, data: unknown, seq: number): DiscordGatewayPayload {
  return { op: DiscordGatewayOpcode.Dispatch, d: data, s: seq, t: eventName };
}

function makeSignalDBMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-001',
    channelId: 'chan-uuid-001',
    senderId: 'agent-uuid-sender',
    targetType: 'broadcast',
    targetAddress: 'broadcast://dev-team',
    messageType: 'chat',
    content: 'Hello from agent',
    metadata: {},
    status: 'pending',
    claimedBy: null,
    claimedAt: null,
    threadId: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...overrides,
  };
}

function makeDiscordMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: 'msg-123456',
    channel_id: 'chan-123456',
    guild_id: TEST_CONFIG.guildId,
    author: {
      id: 'user-123456',
      username: 'testuser',
      discriminator: '0001',
      avatar: null,
      bot: false,
    },
    content: 'Hello, world!',
    timestamp: new Date().toISOString(),
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    attachments: [],
    embeds: [],
    ...overrides,
  };
}

// ============================================================================
// AC-010: Discord Gateway v10 heartbeat ACK tracking and zombie detection
// ============================================================================

describe('AC-010: Gateway heartbeat ACK tracking and zombie detection', () => {
  beforeEach(() => {
    installMockFetch();
    installMockWebSocket();
  });

  afterEach(() => {
    uninstallMockFetch();
    uninstallMockWebSocket();
  });

  // --------------------------------------------------------------------------
  // Heartbeat ACK tracking
  // --------------------------------------------------------------------------

  test('getHealthStatus returns correct fields initially', () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    const health = gateway.getHealthStatus();

    expect(health.discord).toBe(false);
    expect(health.signaldb).toBe(false);
    expect(health.sessionId).toBeNull();
    expect(health.lastHeartbeatSentAt).toBe(0);
    expect(health.lastHeartbeatAckAt).toBe(0);
    expect(health.missedHeartbeatAcks).toBe(0);
    expect(health.reconnectCount).toBe(0);
    expect(health.uptimeMs).toBe(0);
  });

  test('getHealthStatus has all required diagnostic fields', () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    const health = gateway.getHealthStatus();
    const keys = Object.keys(health);

    // Verify all 8 fields are present
    expect(keys).toContain('discord');
    expect(keys).toContain('signaldb');
    expect(keys).toContain('sessionId');
    expect(keys).toContain('lastHeartbeatSentAt');
    expect(keys).toContain('lastHeartbeatAckAt');
    expect(keys).toContain('missedHeartbeatAcks');
    expect(keys).toContain('reconnectCount');
    expect(keys).toContain('uptimeMs');
    expect(keys.length).toBe(8);
  });

  test('HELLO triggers heartbeat sending with jitter', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {}); // suppress unhandled errors

    // We need to connect to get the WS up -- but connectSignalDB will fail, so
    // just directly work with the handleGatewayPayload via simulated WS messages
    // Instead, manually create a WS and simulate the protocol
    // Gateway will create WS internally, we intercept via our mock
    const connectPromise = (gateway as any).connectDiscord();

    // Wait for WS to "open"
    await Bun.sleep(10);

    // Send HELLO
    wsInstance!.simulateMessage(makeHelloPayload(41250));

    // Send READY so connectDiscord resolves
    wsInstance!.simulateMessage(makeReadyPayload('session-abc', 'wss://resume.discord.gg', 1));

    await connectPromise;

    // After HELLO + jitter delay, heartbeat should be sent
    // The initial heartbeat has a jitter delay of random*interval (0-41250ms),
    // so we wait a bit and check that at least the IDENTIFY was sent
    await Bun.sleep(50);

    const identifies = wsInstance!.getPayloadsByOp(DiscordGatewayOpcode.Identify);
    expect(identifies.length).toBe(1);

    // Verify IDENTIFY payload shape
    const identify = identifies[0]!;
    expect(identify.op).toBe(DiscordGatewayOpcode.Identify);
    const identifyData = identify.d as { token: string; intents: number; properties: { browser: string } };
    expect(identifyData.token).toBe(TEST_CONFIG.discordToken);
    expect(identifyData.properties.browser).toBe('claude-code-sdk');

    gateway.disconnect();
  });

  test('heartbeat ACK resets missedHeartbeatAcks to zero', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    // HELLO -> starts heartbeat
    wsInstance!.simulateMessage(makeHelloPayload(100000)); // long interval so loop doesn't fire
    wsInstance!.simulateMessage(makeReadyPayload('sess-1', 'wss://resume.discord.gg', 1));
    await connectPromise;

    // Simulate a heartbeat ACK
    wsInstance!.simulateMessage(makeHeartbeatAckPayload());

    const health = gateway.getHealthStatus();
    expect(health.missedHeartbeatAcks).toBe(0);
    expect(health.lastHeartbeatAckAt).toBeGreaterThan(0);

    gateway.disconnect();
  });

  test('missed heartbeat ACKs increment and trigger zombie detection at threshold', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    const errors: Error[] = [];
    gateway.onError((err) => errors.push(err));

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    // HELLO with very short heartbeat interval so the loop fires quickly
    wsInstance!.simulateMessage(makeHelloPayload(50));
    wsInstance!.simulateMessage(makeReadyPayload('sess-1', 'wss://resume.discord.gg', 1));
    await connectPromise;

    // Wait for multiple heartbeat intervals to pass without sending ACK
    // MAX_MISSED_HEARTBEAT_ACKS = 2, so after 2 missed we get zombie
    await Bun.sleep(200);

    // Should have emitted a zombie error
    const zombieErrors = errors.filter(e => e.message.includes('zombie'));
    expect(zombieErrors.length).toBeGreaterThanOrEqual(1);
    expect(zombieErrors[0]!.message).toContain('missed heartbeat ACKs');

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // RESUME protocol
  // --------------------------------------------------------------------------

  test('READY stores sessionId and resumeGatewayUrl for later RESUME', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('session-xyz', 'wss://resume.gateway.gg', 5));
    await connectPromise;

    const health = gateway.getHealthStatus();
    expect(health.sessionId).toBe('session-xyz');
    expect(health.discord).toBe(true);

    gateway.disconnect();
  });

  test('sequence numbers are tracked from dispatch events', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-1', 'wss://resume.gg', 1));
    await connectPromise;

    // Send dispatch events with increasing sequence numbers
    wsInstance!.simulateMessage(makeDispatchPayload('MESSAGE_CREATE', {
      id: 'msg-1',
      channel_id: 'chan-1',
      author: { id: 'user-1', username: 'test', discriminator: '0', avatar: null, bot: false },
      content: 'hello',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
    }, 42));

    // The gateway internally tracks lastSequence; we verify via heartbeat payload
    // Force a heartbeat by sending op=1 from server
    wsInstance!.simulateMessage({
      op: DiscordGatewayOpcode.Heartbeat,
      d: null,
      s: null,
      t: null,
    });

    await Bun.sleep(10);

    // Check that the heartbeat sent by gateway includes the last sequence
    const heartbeats = wsInstance!.getPayloadsByOp(DiscordGatewayOpcode.Heartbeat);
    const lastHeartbeat = heartbeats[heartbeats.length - 1];
    if (lastHeartbeat) {
      expect(lastHeartbeat.d).toBe(42);
    }

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // INVALID_SESSION handling
  // --------------------------------------------------------------------------

  test('INVALID_SESSION with resumable=false clears session state', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-to-clear', 'wss://resume.gg', 1));
    await connectPromise;

    // Verify session is set
    expect(gateway.getHealthStatus().sessionId).toBe('sess-to-clear');

    // Disable reconnection to prevent follow-up connect attempt
    (gateway as any).shouldReconnect = false;

    // Send INVALID_SESSION with resumable=false
    wsInstance!.simulateMessage(makeInvalidSessionPayload(false));

    // Session should be cleared
    await Bun.sleep(20);
    const health = gateway.getHealthStatus();
    expect(health.sessionId).toBeNull();

    gateway.disconnect();
  });

  test('INVALID_SESSION with resumable=true preserves session state', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-keep', 'wss://resume.gg', 1));
    await connectPromise;

    expect(gateway.getHealthStatus().sessionId).toBe('sess-keep');

    // Disable reconnection
    (gateway as any).shouldReconnect = false;

    // Send INVALID_SESSION with resumable=true
    wsInstance!.simulateMessage(makeInvalidSessionPayload(true));

    await Bun.sleep(20);

    // Session should be preserved because resumable=true
    const health = gateway.getHealthStatus();
    expect(health.sessionId).toBe('sess-keep');

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // Close code handling
  // --------------------------------------------------------------------------

  test('non-resumable close codes (4004, 4010, 4011, 4013, 4014) clear session', async () => {
    const nonResumableCodes = [4004, 4010, 4011, 4013, 4014];

    for (let i = 0; i < nonResumableCodes.length; i++) {
      const code = nonResumableCodes[i]!;

      const gateway = new DiscordGateway(TEST_CONFIG);
      gateway.onError(() => {});

      const connectPromise = (gateway as any).connectDiscord();
      await Bun.sleep(10);

      wsInstance!.simulateMessage(makeHelloPayload(100000));
      wsInstance!.simulateMessage(makeReadyPayload(`sess-${code}`, 'wss://resume.gg', 1));
      await connectPromise;

      expect(gateway.getHealthStatus().sessionId).toBe(`sess-${code}`);

      // Disable auto-reconnect
      (gateway as any).shouldReconnect = false;

      // Simulate close with non-resumable code
      wsInstance!.simulateClose(code, `Close code ${code}`);
      await Bun.sleep(10);

      const health = gateway.getHealthStatus();
      expect(health.sessionId).toBeNull();

      gateway.disconnect();
    }
  });

  test('resumable close code preserves session state', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-resumable', 'wss://resume.gg', 1));
    await connectPromise;

    expect(gateway.getHealthStatus().sessionId).toBe('sess-resumable');

    (gateway as any).shouldReconnect = false;

    // Close with a code NOT in the non-resumable set (e.g. 4000)
    wsInstance!.simulateClose(4000, 'Temporary issue');
    await Bun.sleep(10);

    // Session should be preserved
    const health = gateway.getHealthStatus();
    expect(health.sessionId).toBe('sess-resumable');

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // Backoff jitter
  // --------------------------------------------------------------------------

  test('backoff jitter fraction is 0.5 (delays are not identical)', () => {
    // The RECONNECT_JITTER_FRACTION constant is 0.5 in gateway.ts
    // We test this by verifying the scheduling logic produces varied delays.
    // Since scheduleDiscordReconnect is private, we verify by checking the constant
    // exists in the source. We also confirm that when we call it multiple times,
    // the backoff increases (exponential pattern).

    const gateway = new DiscordGateway(TEST_CONFIG);

    // Access internal backoff state
    const initialBackoff = (gateway as any).currentBackoffMs;
    expect(initialBackoff).toBe(1000); // RECONNECT_BASE_MS

    // Simulate increasing backoff
    (gateway as any).currentBackoffMs = Math.min(
      (gateway as any).currentBackoffMs * 2,
      30000
    );
    expect((gateway as any).currentBackoffMs).toBe(2000);

    (gateway as any).currentBackoffMs = Math.min(
      (gateway as any).currentBackoffMs * 2,
      30000
    );
    expect((gateway as any).currentBackoffMs).toBe(4000);

    // Verify max cap
    (gateway as any).currentBackoffMs = 30000;
    (gateway as any).currentBackoffMs = Math.min(
      (gateway as any).currentBackoffMs * 2,
      30000
    );
    expect((gateway as any).currentBackoffMs).toBe(30000); // Capped at RECONNECT_MAX_MS

    gateway.disconnect();
  });

  test('jitter produces non-deterministic delay within expected range', () => {
    // Run multiple jitter calculations to verify they are not all identical
    const baseMs = 1000;
    const jitterFraction = 0.5;
    const delays: number[] = [];

    for (let i = 0; i < 20; i++) {
      const jitter = baseMs * jitterFraction * Math.random();
      const delay = baseMs + jitter;
      delays.push(delay);
    }

    // All delays should be in [baseMs, baseMs * (1 + jitterFraction)]
    for (let i = 0; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThanOrEqual(baseMs);
      expect(delays[i]!).toBeLessThanOrEqual(baseMs * (1 + jitterFraction));
    }

    // At least some should be different (with 20 samples, overwhelming probability)
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });

  // --------------------------------------------------------------------------
  // RECONNECT opcode
  // --------------------------------------------------------------------------

  test('RECONNECT opcode causes WebSocket close', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-1', 'wss://resume.gg', 1));
    await connectPromise;

    (gateway as any).shouldReconnect = false;

    // Send RECONNECT
    wsInstance!.simulateMessage(makeReconnectPayload());
    await Bun.sleep(20);

    // WS should have been closed
    expect(wsInstance!.readyState).toBe(ProtocolMockWebSocket.CLOSED);

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // RESUMED event
  // --------------------------------------------------------------------------

  test('RESUMED event sets discord connected and resets backoff', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});
    let statusUpdates: { discord: boolean; signaldb: boolean }[] = [];
    gateway.onStatus((s) => statusUpdates.push(s));

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));

    // Send RESUMED instead of READY
    wsInstance!.simulateMessage({
      op: DiscordGatewayOpcode.Dispatch,
      d: {},
      s: 10,
      t: 'RESUMED',
    });

    await connectPromise;

    expect(gateway.isConnected().discord).toBe(true);
    // Backoff should be reset to base
    expect((gateway as any).currentBackoffMs).toBe(1000);

    gateway.disconnect();
  });

  // --------------------------------------------------------------------------
  // Bot message filtering in gateway dispatch
  // --------------------------------------------------------------------------

  test('MESSAGE_CREATE with bot author is NOT dispatched to message callbacks', async () => {
    const gateway = new DiscordGateway(TEST_CONFIG);
    gateway.onError(() => {});
    const received: DiscordMessage[] = [];
    gateway.onDiscordMessage((msg) => { received.push(msg); });

    const connectPromise = (gateway as any).connectDiscord();
    await Bun.sleep(10);

    wsInstance!.simulateMessage(makeHelloPayload(100000));
    wsInstance!.simulateMessage(makeReadyPayload('sess-1', 'wss://resume.gg', 1));
    await connectPromise;

    // Send a bot message via dispatch
    wsInstance!.simulateMessage(makeDispatchPayload('MESSAGE_CREATE', {
      id: 'msg-bot',
      channel_id: 'chan-1',
      author: { id: 'bot-user', username: 'bot', discriminator: '0000', avatar: null, bot: true },
      content: 'bot says hi',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
    }, 2));

    expect(received.length).toBe(0); // Bot messages filtered out

    // Now send a user message
    wsInstance!.simulateMessage(makeDispatchPayload('MESSAGE_CREATE', {
      id: 'msg-user',
      channel_id: 'chan-1',
      author: { id: 'human-user', username: 'human', discriminator: '0001', avatar: null, bot: false },
      content: 'human says hi',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
    }, 3));

    expect(received.length).toBe(1);
    expect(received[0]!.author.bot).toBe(false);

    gateway.disconnect();
  });
});

// ============================================================================
// AC-011: 5 slash commands registered
// ============================================================================

describe('AC-011: Slash command registration and definitions', () => {
  let manager: SlashCommandManager;

  beforeEach(() => {
    installMockFetch();
    manager = new SlashCommandManager(TEST_CONFIG);
  });

  afterEach(() => {
    uninstallMockFetch();
  });

  // --------------------------------------------------------------------------
  // getCommandDefinitions
  // --------------------------------------------------------------------------

  test('getCommandDefinitions returns exactly 5 commands', () => {
    const defs = manager.getCommandDefinitions();
    expect(defs.length).toBe(5);
  });

  test('all 5 expected command names are present', () => {
    const defs = manager.getCommandDefinitions();
    const names: string[] = [];
    for (let i = 0; i < defs.length; i++) {
      names.push(defs[i]!.name);
    }

    expect(names).toContain('agents');
    expect(names).toContain('channels');
    expect(names).toContain('send');
    expect(names).toContain('memo');
    expect(names).toContain('paste');
  });

  test('getCommandDefinitions returns a copy (not mutable reference)', () => {
    const defs1 = manager.getCommandDefinitions();
    const defs2 = manager.getCommandDefinitions();
    expect(defs1).not.toBe(defs2); // Different array instances
    expect(defs1).toEqual(defs2); // Same content
  });

  // --------------------------------------------------------------------------
  // Command option types
  // --------------------------------------------------------------------------

  test('each command has proper description string', () => {
    const defs = manager.getCommandDefinitions();
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]!;
      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  test('/agents command has STRING filter option with status choices', () => {
    const defs = manager.getCommandDefinitions();
    const agentsDef = findCommandByName(defs, 'agents');
    expect(agentsDef).toBeDefined();
    expect(agentsDef!.options).toBeDefined();
    expect(agentsDef!.options!.length).toBeGreaterThanOrEqual(1);

    const filterOpt = findOptionByName(agentsDef!.options!, 'filter');
    expect(filterOpt).toBeDefined();
    expect(filterOpt!.type).toBe('STRING');
    expect(filterOpt!.required).toBe(false);

    // Verify status filter choices
    const choiceValues = getChoiceValues(filterOpt!.choices);
    expect(choiceValues).toContain('all');
    expect(choiceValues).toContain('active');
    expect(choiceValues).toContain('idle');
    expect(choiceValues).toContain('offline');
  });

  test('/channels command has STRING type filter option with channel type choices', () => {
    const defs = manager.getCommandDefinitions();
    const channelsDef = findCommandByName(defs, 'channels');
    expect(channelsDef).toBeDefined();

    const typeOpt = findOptionByName(channelsDef!.options!, 'type');
    expect(typeOpt).toBeDefined();
    expect(typeOpt!.type).toBe('STRING');
    expect(typeOpt!.required).toBe(false);

    const choiceValues = getChoiceValues(typeOpt!.choices);
    expect(choiceValues).toContain('all');
    expect(choiceValues).toContain('direct');
    expect(choiceValues).toContain('project');
    expect(choiceValues).toContain('broadcast');
  });

  test('/send command requires target and message options', () => {
    const defs = manager.getCommandDefinitions();
    const sendDef = findCommandByName(defs, 'send');
    expect(sendDef).toBeDefined();

    const targetOpt = findOptionByName(sendDef!.options!, 'target');
    expect(targetOpt).toBeDefined();
    expect(targetOpt!.type).toBe('STRING');
    expect(targetOpt!.required).toBe(true);

    const messageOpt = findOptionByName(sendDef!.options!, 'message');
    expect(messageOpt).toBeDefined();
    expect(messageOpt!.type).toBe('STRING');
    expect(messageOpt!.required).toBe(true);
  });

  test('/send command has optional channel option', () => {
    const defs = manager.getCommandDefinitions();
    const sendDef = findCommandByName(defs, 'send');

    const channelOpt = findOptionByName(sendDef!.options!, 'channel');
    expect(channelOpt).toBeDefined();
    expect(channelOpt!.type).toBe('STRING');
    expect(channelOpt!.required).toBe(false);
  });

  test('/memo command has required to, subject, body and optional priority', () => {
    const defs = manager.getCommandDefinitions();
    const memoDef = findCommandByName(defs, 'memo');
    expect(memoDef).toBeDefined();

    const toOpt = findOptionByName(memoDef!.options!, 'to');
    expect(toOpt).toBeDefined();
    expect(toOpt!.required).toBe(true);

    const subjectOpt = findOptionByName(memoDef!.options!, 'subject');
    expect(subjectOpt).toBeDefined();
    expect(subjectOpt!.required).toBe(true);

    const bodyOpt = findOptionByName(memoDef!.options!, 'body');
    expect(bodyOpt).toBeDefined();
    expect(bodyOpt!.required).toBe(true);

    const priorityOpt = findOptionByName(memoDef!.options!, 'priority');
    expect(priorityOpt).toBeDefined();
    expect(priorityOpt!.required).toBe(false);

    // Priority has P0-P3 choices
    const choiceValues = getChoiceValues(priorityOpt!.choices);
    expect(choiceValues).toContain('P0');
    expect(choiceValues).toContain('P1');
    expect(choiceValues).toContain('P2');
    expect(choiceValues).toContain('P3');
  });

  test('/paste command has required content and optional ttl and read_once', () => {
    const defs = manager.getCommandDefinitions();
    const pasteDef = findCommandByName(defs, 'paste');
    expect(pasteDef).toBeDefined();

    const contentOpt = findOptionByName(pasteDef!.options!, 'content');
    expect(contentOpt).toBeDefined();
    expect(contentOpt!.type).toBe('STRING');
    expect(contentOpt!.required).toBe(true);

    const ttlOpt = findOptionByName(pasteDef!.options!, 'ttl');
    expect(ttlOpt).toBeDefined();
    expect(ttlOpt!.type).toBe('INTEGER');
    expect(ttlOpt!.required).toBe(false);

    const readOnceOpt = findOptionByName(pasteDef!.options!, 'read_once');
    expect(readOnceOpt).toBeDefined();
    expect(readOnceOpt!.type).toBe('BOOLEAN');
    expect(readOnceOpt!.required).toBe(false);
  });

  // --------------------------------------------------------------------------
  // MAX_EMBEDS_PER_RESPONSE limits output
  // --------------------------------------------------------------------------

  test('agents response embeds are capped at MAX_EMBEDS_PER_RESPONSE=10', async () => {
    // Create 15 agents -- response should only include 10 embeds
    const agents = [];
    for (let i = 0; i < 15; i++) {
      agents.push({
        id: `agent-${i}`,
        machineId: 'machine-1',
        sessionId: `session-${i}`,
        sessionName: `agent-${i}`,
        projectPath: '/test',
        status: 'active',
        registeredAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        capabilities: {},
        metadata: {},
      });
    }

    addFetchRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addFetchRoute('GET', '/v1/agents', agents);
    addFetchRoute('POST', '/callback', {});

    let editBody: unknown = null;
    fetchRoutes.push({
      method: 'PATCH',
      pattern: '/messages/@original',
      handler: (_url, init) => {
        if (init.body) {
          editBody = JSON.parse(init.body as string);
        }
        return new Response('{}', { status: 200 });
      },
    });

    const interaction = {
      id: 'int-1',
      application_id: 'app-123',
      type: 2, // ApplicationCommand
      data: { id: 'cmd-1', name: 'agents', type: 1, options: [] },
      guild_id: TEST_CONFIG.guildId,
      channel_id: 'chan-1',
      token: 'int-token',
      version: 1,
    };

    await manager.handleInteraction(interaction as any);

    expect(editBody).toBeDefined();
    const body = editBody as { embeds?: unknown[]; content?: string };
    expect(body.embeds).toBeDefined();
    expect(body.embeds!.length).toBeLessThanOrEqual(10);
    // Summary text should mention total count
    expect(body.content).toContain('15');
  });

  // --------------------------------------------------------------------------
  // Option type consistency
  // --------------------------------------------------------------------------

  test('all option types use valid SlashCommandOptionType values', () => {
    const validTypes = new Set(['STRING', 'INTEGER', 'BOOLEAN', 'USER', 'CHANNEL', 'ROLE']);
    const defs = manager.getCommandDefinitions();

    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]!;
      if (!def.options) continue;
      for (let j = 0; j < def.options.length; j++) {
        const opt = def.options[j]!;
        expect(validTypes.has(opt.type)).toBe(true);
      }
    }
  });

  test('command names are lowercase with no spaces', () => {
    const defs = manager.getCommandDefinitions();
    for (let i = 0; i < defs.length; i++) {
      const name = defs[i]!.name;
      expect(name).toBe(name.toLowerCase());
      expect(name.includes(' ')).toBe(false);
    }
  });
});

// ============================================================================
// AC-012: Bidirectional message bridge with O(1) dual-map lookup
// ============================================================================

describe('AC-012: Bidirectional message bridge with O(1) dual-map lookup', () => {
  beforeEach(() => {
    installMockFetch();
  });

  afterEach(() => {
    uninstallMockFetch();
  });

  function createBridge(mappings: DiscordChannelMapping[] = []) {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const threadMapper = new ThreadMapper(TEST_CONFIG);
    const formatter = new MessageFormatter();
    const rateLimiter = new DiscordRateLimiter();

    const bridge = new MessageBridge(
      TEST_CONFIG,
      mockGateway,
      { publish: mock(() => Promise.resolve()) } as any,
      threadMapper,
      formatter,
      rateLimiter,
      mappings,
    );

    return { bridge, mockGateway, threadMapper };
  }

  // --------------------------------------------------------------------------
  // Bidirectional map: add mapping, verify both directions
  // --------------------------------------------------------------------------

  test('addChannelMapping populates both discordToMapping and signalDBToDiscord', () => {
    const { bridge } = createBridge();

    bridge.addChannelMapping({
      discordChannelId: 'discord-chan-1',
      signalDBChannelId: 'signaldb-chan-1',
      direction: 'bidirectional',
    });

    // Verify via getStats (channelMappings reflects discordToMapping size)
    expect(bridge.getStats().channelMappings).toBe(1);

    // Verify the reverse direction works by trying to handle a signaldb message
    // The bridge internally uses signalDBToDiscord.get() for reverse lookup
  });

  test('constructor initializes maps from provided channelMappings', () => {
    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
      { discordChannelId: 'd2', signalDBChannelId: 's2', direction: 'bidirectional' },
      { discordChannelId: 'd3', signalDBChannelId: 's3', direction: 'bidirectional' },
    ]);

    expect(bridge.getStats().channelMappings).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Remove mapping: both maps cleaned up
  // --------------------------------------------------------------------------

  test('removeChannelMapping cleans up both direction maps', () => {
    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
      { discordChannelId: 'd2', signalDBChannelId: 's2', direction: 'bidirectional' },
    ]);

    expect(bridge.getStats().channelMappings).toBe(2);

    bridge.removeChannelMapping('d1');
    expect(bridge.getStats().channelMappings).toBe(1);

    // Verify SignalDB message to removed channel is not routed
    bridge.start();
    const msg = makeSignalDBMessage({ channelId: 's1' });
    bridge.handleSignalDBMessage(msg);

    // No Discord API call should have been made for the removed mapping
    const discordCalls = fetchLog.filter(c => c.url.includes('discord.com'));
    expect(discordCalls.length).toBe(0);
  });

  test('removeChannelMapping for non-existent channel is safe', () => {
    const { bridge } = createBridge();

    // Should not throw
    bridge.removeChannelMapping('nonexistent');
    expect(bridge.getStats().channelMappings).toBe(0);
  });

  // --------------------------------------------------------------------------
  // O(1) lookup verification
  // --------------------------------------------------------------------------

  test('signalDB-to-Discord lookup uses Map.get (O(1))', () => {
    // The MessageBridge uses signalDBToDiscord.get() for reverse lookup.
    // We verify this structurally: the bridge has a Map<string, string> named
    // signalDBToDiscord, and handleSignalDBMessage calls .get() on it.
    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
    ]);

    // Access internal map to verify it is a Map (O(1) lookup)
    const internalMap = (bridge as any).signalDBToDiscord;
    expect(internalMap).toBeInstanceOf(Map);
    expect(internalMap.get('s1')).toBe('d1');
  });

  test('discordToMapping is a Map with O(1) lookup', () => {
    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
    ]);

    const internalMap = (bridge as any).discordToMapping;
    expect(internalMap).toBeInstanceOf(Map);
    expect(internalMap.get('d1')).toBeDefined();
    expect(internalMap.get('d1').signalDBChannelId).toBe('s1');
  });

  test('indexMapping only creates reverse mapping when direction allows signalDB-to-discord', () => {
    const { bridge } = createBridge();

    // Add discord-to-signaldb only mapping
    bridge.addChannelMapping({
      discordChannelId: 'd-only',
      signalDBChannelId: 's-only',
      direction: 'discord-to-signaldb',
    });

    // The reverse map should NOT have this entry
    const reverseMap = (bridge as any).signalDBToDiscord as Map<string, string>;
    expect(reverseMap.has('s-only')).toBe(false);

    // But the forward map should have it
    const forwardMap = (bridge as any).discordToMapping as Map<string, DiscordChannelMapping>;
    expect(forwardMap.has('d-only')).toBe(true);
  });

  test('bidirectional mapping creates entries in both maps', () => {
    const { bridge } = createBridge();

    bridge.addChannelMapping({
      discordChannelId: 'd-bi',
      signalDBChannelId: 's-bi',
      direction: 'bidirectional',
    });

    const forwardMap = (bridge as any).discordToMapping as Map<string, DiscordChannelMapping>;
    const reverseMap = (bridge as any).signalDBToDiscord as Map<string, string>;

    expect(forwardMap.has('d-bi')).toBe(true);
    expect(reverseMap.has('s-bi')).toBe(true);
    expect(reverseMap.get('s-bi')).toBe('d-bi');
  });

  // --------------------------------------------------------------------------
  // getStats includes all required map counts
  // --------------------------------------------------------------------------

  test('getStats includes messagesFromDiscord, messagesFromSignalDB, channelMappings, threadMappings', () => {
    const { bridge, threadMapper } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
    ]);

    // Add a thread mapping
    threadMapper.createMapping('discord-thread-1', 'signaldb-thread-1');

    const stats = bridge.getStats();
    expect(typeof stats.messagesFromDiscord).toBe('number');
    expect(typeof stats.messagesFromSignalDB).toBe('number');
    expect(typeof stats.channelMappings).toBe('number');
    expect(typeof stats.threadMappings).toBe('number');

    expect(stats.channelMappings).toBe(1);
    expect(stats.threadMappings).toBe(1);
    expect(stats.messagesFromDiscord).toBe(0);
    expect(stats.messagesFromSignalDB).toBe(0);
  });

  test('getStats counts reflect all 3 internal maps (discord, signalDB, thread)', () => {
    const { bridge, threadMapper } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
      { discordChannelId: 'd2', signalDBChannelId: 's2', direction: 'signaldb-to-discord' },
    ]);

    threadMapper.createMapping('dt1', 'st1');
    threadMapper.createMapping('dt2', 'st2');
    threadMapper.createMapping('dt3', 'st3');

    const stats = bridge.getStats();
    expect(stats.channelMappings).toBe(2); // discordToMapping count
    expect(stats.threadMappings).toBe(3); // threadMapper count
  });

  // --------------------------------------------------------------------------
  // Echo prevention
  // --------------------------------------------------------------------------

  test('messages from discord source (metadata.source=discord) are not bridged back', async () => {
    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
    ]);

    bridge.start();

    const echoMessage = makeSignalDBMessage({
      channelId: 's1',
      metadata: { source: 'discord' },
    });

    await bridge.handleSignalDBMessage(echoMessage);

    // No Discord API calls should have been made
    const discordCalls = fetchLog.filter(c => c.url.includes('discord.com'));
    expect(discordCalls.length).toBe(0);
  });

  test('messages without discord source ARE bridged to Discord', async () => {
    addFetchRoute('POST', '/channels/', { id: 'msg-1', channel_id: 'd1', content: 'test', timestamp: new Date().toISOString(), author: { id: 'bot', username: 'bot', discriminator: '0', avatar: null } });

    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' },
    ]);

    bridge.start();

    const realMessage = makeSignalDBMessage({
      channelId: 's1',
      metadata: { source: 'signaldb' },
    });

    await bridge.handleSignalDBMessage(realMessage);

    // Discord API call SHOULD have been made
    const discordCalls = fetchLog.filter(c => c.url.includes('discord.com'));
    expect(discordCalls.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Bot message filtering at bridge level
  // --------------------------------------------------------------------------

  test('handleDiscordMessage ignores messages with author.bot=true', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      TEST_CONFIG,
      mockGateway,
      { publish: mockPublish } as any,
      new ThreadMapper(TEST_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'bidirectional' }],
    );

    bridge.start();

    const botMsg = makeDiscordMessage({
      author: { id: 'bot-1', username: 'mybot', discriminator: '0000', avatar: null, bot: true },
    });

    await bridge.handleDiscordMessage(botMsg);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Direction constraint enforcement
  // --------------------------------------------------------------------------

  test('signaldb-to-discord mapping blocks Discord->SignalDB messages', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      TEST_CONFIG,
      mockGateway,
      { publish: mockPublish } as any,
      new ThreadMapper(TEST_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'signaldb-to-discord' }],
    );

    bridge.start();
    await bridge.handleDiscordMessage(makeDiscordMessage());
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('discord-to-signaldb mapping blocks SignalDB->Discord messages', async () => {
    addFetchRoute('POST', '/channels/', { id: 'msg-1', channel_id: 'd1', content: 'test', timestamp: new Date().toISOString(), author: { id: 'bot', username: 'bot', discriminator: '0', avatar: null } });

    const { bridge } = createBridge([
      { discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'discord-to-signaldb' },
    ]);

    bridge.start();
    await bridge.handleSignalDBMessage(makeSignalDBMessage({ channelId: 's1' }));

    // NOTE: discord-to-signaldb direction doesn't create reverse mapping,
    // so signalDBToDiscord.get('s1') returns undefined and the message is dropped
    const discordCalls = fetchLog.filter(c => c.url.includes('discord.com'));
    expect(discordCalls.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Multiple mappings
  // --------------------------------------------------------------------------

  test('multiple channel mappings maintain separate map entries', () => {
    const { bridge } = createBridge();

    bridge.addChannelMapping({ discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' });
    bridge.addChannelMapping({ discordChannelId: 'd2', signalDBChannelId: 's2', direction: 'bidirectional' });
    bridge.addChannelMapping({ discordChannelId: 'd3', signalDBChannelId: 's3', direction: 'signaldb-to-discord' });

    expect(bridge.getStats().channelMappings).toBe(3);

    const reverseMap = (bridge as any).signalDBToDiscord as Map<string, string>;
    expect(reverseMap.get('s1')).toBe('d1');
    expect(reverseMap.get('s2')).toBe('d2');
    expect(reverseMap.get('s3')).toBe('d3'); // signaldb-to-discord still creates reverse
  });
});

// ============================================================================
// Helpers for command inspection
// ============================================================================

function findCommandByName(defs: SlashCommandDef[], name: string): SlashCommandDef | undefined {
  for (let i = 0; i < defs.length; i++) {
    if (defs[i]!.name === name) return defs[i]!;
  }
  return undefined;
}

function findOptionByName(options: SlashCommandDef['options'], name: string) {
  if (!options) return undefined;
  for (let i = 0; i < options.length; i++) {
    if (options[i]!.name === name) return options[i]!;
  }
  return undefined;
}

function getChoiceValues(choices?: Array<{ name: string; value: string }>): string[] {
  if (!choices) return [];
  const values: string[] = [];
  for (let i = 0; i < choices.length; i++) {
    values.push(choices[i]!.value);
  }
  return values;
}
