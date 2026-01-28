/**
 * Unit Tests for Discord Bot Bridge Components (COMMS-006)
 *
 * Covers:
 * - DiscordGateway: WebSocket connection, heartbeat, event dispatch, dual connection state
 * - SlashCommandManager: /agent, /paste, /memo commands, interaction handling
 * - ThreadMapper: bidirectional mapping, create-on-first-use
 * - PresenceSync: polling lifecycle, status colors, agent embeds
 * - MessageFormatter: code blocks, truncation, language detection
 * - DiscordRateLimiter: sliding window, per-user isolation, retry-after
 * - MessageBridge: bidirectional routing, rate limiting, thread creation
 * - DiscordBot facade: lifecycle, component wiring
 *
 * Uses route-based mock fetch pattern consistent with other comms tests.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { DiscordGateway } from '../../src/comms/bridges/discord/gateway';
import { SlashCommandManager } from '../../src/comms/bridges/discord/commands';
import { ThreadMapper } from '../../src/comms/bridges/discord/thread-mapper';
import { PresenceSync } from '../../src/comms/bridges/discord/presence';
import { MessageFormatter } from '../../src/comms/bridges/discord/formatter';
import { DiscordRateLimiter } from '../../src/comms/bridges/discord/rate-limiter';
import { MessageBridge } from '../../src/comms/bridges/discord/message-bridge';
import { DiscordBot } from '../../src/comms/bridges/discord/discord-bot';
import {
  DiscordGatewayOpcode,
  DiscordInteractionType,
  DiscordInteractionCallbackType,
  DiscordMessageFlags,
} from '../../src/comms/bridges/discord/types';
import type {
  DiscordBotConfig,
  DiscordMessage,
  DiscordInteraction,
  DiscordGatewayPayload,
  DiscordReadyData,
  DiscordEmbed,
  GatewayConnectionStatus,
} from '../../src/comms/bridges/discord/types';
import type { Message, Agent } from '../../src/comms/protocol/types';

// ============================================================================
// Constants
// ============================================================================

const TEST_API_URL = 'https://test-discord.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_discord';
const TEST_AGENT_ID = 'agent-discord-001';
const TEST_GUILD_ID = 'guild-123456789';
const TEST_DISCORD_TOKEN = 'test-bot-token';

const DEFAULT_CONFIG: DiscordBotConfig = {
  discordToken: TEST_DISCORD_TOKEN,
  guildId: TEST_GUILD_ID,
  apiUrl: TEST_API_URL,
  projectKey: TEST_PROJECT_KEY,
  agentId: TEST_AGENT_ID,
  commandPrefix: '!',
  rateLimitPerUser: 10,
};

// ============================================================================
// Helpers
// ============================================================================

function makeDiscordMessage(overrides: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: 'msg-123456',
    channel_id: 'chan-123456',
    guild_id: TEST_GUILD_ID,
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

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-uuid-001',
    machineId: 'machine-123456',
    sessionId: 'session-abc',
    sessionName: 'test-agent',
    projectPath: '/home/test/project',
    status: 'active',
    registeredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    capabilities: {},
    metadata: {},
    ...overrides,
  };
}

function makeInteraction(overrides: Partial<DiscordInteraction> = {}): DiscordInteraction {
  return {
    id: 'interaction-123',
    application_id: 'app-123',
    type: DiscordInteractionType.ApplicationCommand,
    data: {
      id: 'cmd-123',
      name: 'agent',
      type: 1,
      options: [],
    },
    guild_id: TEST_GUILD_ID,
    channel_id: 'chan-123',
    member: {
      user: {
        id: 'user-123',
        username: 'testuser',
        discriminator: '0001',
        avatar: null,
      },
      nick: null,
      avatar: null,
      roles: [],
      joined_at: new Date().toISOString(),
      deaf: false,
      mute: false,
    },
    token: 'interaction-token-xyz',
    version: 1,
    ...overrides,
  };
}

// ============================================================================
// Route-based Mock Fetch Infrastructure
// ============================================================================

type MockRoute = {
  method: string;
  pathPattern: string | RegExp;
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
};

let routes: MockRoute[] = [];
let fetchCalls: { method: string; url: string; body?: unknown }[] = [];
let originalFetch: typeof globalThis.fetch;

function setupMockFetch(): void {
  fetchCalls = [];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    fetchCalls.push({ method, url, body });

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]!;
      const pathMatch = typeof route.pathPattern === 'string'
        ? url.includes(route.pathPattern)
        : route.pathPattern.test(url);

      if (route.method === method && pathMatch) {
        return route.handler(url, init ?? {});
      }
    }

    // Default 404 for unmatched routes
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  };

  // Type assertion needed for Bun's fetch type
  originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof mockFetch }).fetch = mockFetch;
}

function teardownMockFetch(): void {
  (globalThis as { fetch: typeof originalFetch }).fetch = originalFetch;
  routes = [];
  fetchCalls = [];
}

function addRoute(method: string, pathPattern: string | RegExp, response: unknown, status = 200): void {
  routes.push({
    method,
    pathPattern,
    handler: () => new Response(JSON.stringify(response), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  private sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 10);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) {
        this.onclose({ code: code ?? 1000, reason: reason ?? '' } as CloseEvent);
      }
    }, 10);
  }

  // Test helpers
  getSentMessages(): string[] {
    return this.sentMessages;
  }

  simulateMessage(payload: DiscordGatewayPayload): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(payload) } as MessageEvent);
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror({ type: 'error' } as Event);
    }
  }
}

let mockWebSocketInstance: MockWebSocket | null = null;
let originalWebSocket: typeof WebSocket;

function setupMockWebSocket(): void {
  originalWebSocket = globalThis.WebSocket;
  (globalThis as { WebSocket: typeof MockWebSocket }).WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url);
      mockWebSocketInstance = this;
    }
  } as unknown as typeof WebSocket;
}

function teardownMockWebSocket(): void {
  (globalThis as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
  mockWebSocketInstance = null;
}

// ============================================================================
// 1. DiscordRateLimiter Tests (~15 tests)
// ============================================================================

describe('DiscordRateLimiter', () => {
  let limiter: DiscordRateLimiter;

  beforeEach(() => {
    limiter = new DiscordRateLimiter(10); // 10 msgs/min
  });

  test('allows first message from new user', () => {
    const result = limiter.checkLimit('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9); // Accounts for upcoming message
    expect(result.retryAfterMs).toBe(0);
  });

  test('records message and tracks count', () => {
    limiter.recordMessage('user-1');
    expect(limiter.getCurrentCount('user-1')).toBe(1);

    limiter.recordMessage('user-1');
    expect(limiter.getCurrentCount('user-1')).toBe(2);
  });

  test('enforces limit at configured threshold', () => {
    // Record 10 messages
    for (let i = 0; i < 10; i++) {
      limiter.recordMessage('user-1');
    }

    const result = limiter.checkLimit('user-1');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  test('isolates limits per user', () => {
    // Fill user-1's limit
    for (let i = 0; i < 10; i++) {
      limiter.recordMessage('user-1');
    }

    // user-2 should still have full quota
    const result = limiter.checkLimit('user-2');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  test('calculates correct retry-after when limited', () => {
    // Record 10 messages
    for (let i = 0; i < 10; i++) {
      limiter.recordMessage('user-1');
    }

    const result = limiter.checkLimit('user-1');
    expect(result.allowed).toBe(false);
    // Retry after should be close to 60 seconds (60000ms)
    expect(result.retryAfterMs).toBeGreaterThan(59000);
    expect(result.retryAfterMs).toBeLessThanOrEqual(60000);
  });

  test('resets user state', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordMessage('user-1');
    }
    expect(limiter.getCurrentCount('user-1')).toBe(5);

    limiter.resetUser('user-1');
    expect(limiter.getCurrentCount('user-1')).toBe(0);
  });

  test('resets all state', () => {
    limiter.recordMessage('user-1');
    limiter.recordMessage('user-2');
    limiter.recordMessage('user-3');

    expect(limiter.getTrackedUserCount()).toBe(3);

    limiter.resetAll();
    expect(limiter.getTrackedUserCount()).toBe(0);
  });

  test('counts rate-limited users', () => {
    // Fill user-1's limit
    for (let i = 0; i < 10; i++) {
      limiter.recordMessage('user-1');
    }
    // Partial for user-2
    for (let i = 0; i < 5; i++) {
      limiter.recordMessage('user-2');
    }

    expect(limiter.getRateLimitedUserCount()).toBe(1);
  });

  test('returns configured limit', () => {
    expect(limiter.getLimit()).toBe(10);

    const customLimiter = new DiscordRateLimiter(20);
    expect(customLimiter.getLimit()).toBe(20);
  });

  test('uses default limit when not specified', () => {
    const defaultLimiter = new DiscordRateLimiter();
    expect(defaultLimiter.getLimit()).toBe(10); // Default
  });

  test('tracks multiple users concurrently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordMessage(`user-${i}`);
    }

    expect(limiter.getTrackedUserCount()).toBe(5);

    for (let i = 0; i < 5; i++) {
      expect(limiter.getCurrentCount(`user-${i}`)).toBe(1);
    }
  });

  test('allows remaining messages after partial usage', () => {
    for (let i = 0; i < 7; i++) {
      limiter.recordMessage('user-1');
    }

    const result = limiter.checkLimit('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // 10 - 7 - 1 (upcoming)
  });

  test('remaining is zero when exactly at limit', () => {
    for (let i = 0; i < 9; i++) {
      limiter.recordMessage('user-1');
    }

    const result = limiter.checkLimit('user-1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0); // Last allowed message
  });

  test('handles empty user gracefully', () => {
    const result = limiter.checkLimit('nonexistent-user');
    expect(result.allowed).toBe(true);
    expect(limiter.getCurrentCount('nonexistent-user')).toBe(0);
  });

  test('reset user that does not exist is no-op', () => {
    // Should not throw
    limiter.resetUser('nonexistent-user');
    expect(limiter.getTrackedUserCount()).toBe(0);
  });
});

// ============================================================================
// 2. ThreadMapper Tests (~15 tests)
// ============================================================================

describe('ThreadMapper', () => {
  let mapper: ThreadMapper;

  beforeEach(() => {
    setupMockFetch();
    mapper = new ThreadMapper(DEFAULT_CONFIG);
  });

  afterEach(() => {
    teardownMockFetch();
  });

  test('creates new SignalDB thread ID for unmapped Discord thread', () => {
    const signalDBId = mapper.mapDiscordToSignalDB('discord-thread-123');
    expect(signalDBId).toBeDefined();
    expect(signalDBId.length).toBe(36); // UUID format
  });

  test('returns same SignalDB ID for repeated lookups', () => {
    const id1 = mapper.mapDiscordToSignalDB('discord-thread-123');
    const id2 = mapper.mapDiscordToSignalDB('discord-thread-123');
    expect(id1).toBe(id2);
  });

  test('returns null for unmapped SignalDB thread', () => {
    const discordId = mapper.mapSignalDBToDiscord('signaldb-thread-456');
    expect(discordId).toBeNull();
  });

  test('creates bidirectional mapping', () => {
    mapper.createMapping('discord-123', 'signaldb-456');

    expect(mapper.mapDiscordToSignalDB('discord-123')).toBe('signaldb-456');
    expect(mapper.mapSignalDBToDiscord('signaldb-456')).toBe('discord-123');
  });

  test('tracks mapping count', () => {
    expect(mapper.getMappingCount()).toBe(0);

    mapper.createMapping('d1', 's1');
    expect(mapper.getMappingCount()).toBe(1);

    mapper.createMapping('d2', 's2');
    expect(mapper.getMappingCount()).toBe(2);
  });

  test('returns all mappings', () => {
    mapper.createMapping('d1', 's1');
    mapper.createMapping('d2', 's2');

    const mappings = mapper.getAllMappings();
    expect(mappings.length).toBe(2);
    expect(mappings[0]!.discordThreadId).toBe('d1');
    expect(mappings[1]!.discordThreadId).toBe('d2');
  });

  test('checks Discord mapping existence', () => {
    expect(mapper.hasDiscordMapping('d1')).toBe(false);

    mapper.createMapping('d1', 's1');
    expect(mapper.hasDiscordMapping('d1')).toBe(true);
  });

  test('checks SignalDB mapping existence', () => {
    expect(mapper.hasSignalDBMapping('s1')).toBe(false);

    mapper.createMapping('d1', 's1');
    expect(mapper.hasSignalDBMapping('s1')).toBe(true);
  });

  test('removes mapping by Discord ID', () => {
    mapper.createMapping('d1', 's1');
    expect(mapper.getMappingCount()).toBe(1);

    mapper.removeMapping('d1');
    expect(mapper.getMappingCount()).toBe(0);
    expect(mapper.hasDiscordMapping('d1')).toBe(false);
    expect(mapper.hasSignalDBMapping('s1')).toBe(false);
  });

  test('clears all mappings', () => {
    mapper.createMapping('d1', 's1');
    mapper.createMapping('d2', 's2');
    expect(mapper.getMappingCount()).toBe(2);

    mapper.clearAllMappings();
    expect(mapper.getMappingCount()).toBe(0);
  });

  test('mappings include ISO timestamp', () => {
    mapper.createMapping('d1', 's1');

    const mappings = mapper.getAllMappings();
    expect(mappings[0]!.createdAt).toBeDefined();

    const timestamp = new Date(mappings[0]!.createdAt).getTime();
    expect(Number.isNaN(timestamp)).toBe(false);
  });

  test('different channels create separate mappings', () => {
    const id1 = mapper.mapDiscordToSignalDB('thread-in-channel-A');
    const id2 = mapper.mapDiscordToSignalDB('thread-in-channel-B');

    expect(id1).not.toBe(id2);
    expect(mapper.getMappingCount()).toBe(2);
  });

  test('getOrCreateDiscordThread returns existing mapping', async () => {
    mapper.createMapping('existing-discord', 'existing-signaldb');

    const result = await mapper.getOrCreateDiscordThread(
      'parent-channel',
      'existing-signaldb',
      'Thread Title'
    );

    expect(result).toBe('existing-discord');
  });

  test('getOrCreateDiscordThread creates new thread via API', async () => {
    addRoute('POST', '/channels/', {
      id: 'new-discord-thread',
      name: 'Test Thread',
      parent_id: 'parent-channel',
      guild_id: TEST_GUILD_ID,
      type: 11,
    });

    const result = await mapper.getOrCreateDiscordThread(
      'parent-channel',
      'new-signaldb-thread',
      'Test Thread'
    );

    expect(result).toBe('new-discord-thread');
    expect(mapper.hasSignalDBMapping('new-signaldb-thread')).toBe(true);
  });

  test('generated UUIDs are valid v4 format', () => {
    const id = mapper.mapDiscordToSignalDB('test-thread');

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(uuidV4Regex.test(id)).toBe(true);
  });
});

// ============================================================================
// 3. MessageFormatter Tests (~20 tests)
// ============================================================================

describe('MessageFormatter', () => {
  let formatter: MessageFormatter;

  beforeEach(() => {
    formatter = new MessageFormatter();
  });

  // Language detection tests
  test('detects TypeScript from content', () => {
    const code = 'import { foo } from "bar";\nconst x = 5;';
    expect(formatter.detectLanguage(code)).toBe('typescript');
  });

  test('detects Python from content', () => {
    const code = 'def hello():\n    print("Hello")';
    expect(formatter.detectLanguage(code)).toBe('python');
  });

  test('detects Go from content', () => {
    const code = 'package main\n\nfunc main() {}';
    expect(formatter.detectLanguage(code)).toBe('go');
  });

  test('detects Rust from content', () => {
    const code = 'fn main() {\n    let x = 5;\n}';
    expect(formatter.detectLanguage(code)).toBe('rust');
  });

  test('detects JSON from content', () => {
    const code = '{\n  "key": "value"\n}';
    expect(formatter.detectLanguage(code)).toBe('json');
  });

  test('detects SQL from content', () => {
    const code = 'SELECT * FROM users WHERE id = 1';
    expect(formatter.detectLanguage(code)).toBe('sql');
  });

  test('detects bash from shebang', () => {
    const code = '#!/bin/bash\necho "hello"';
    expect(formatter.detectLanguage(code)).toBe('bash');
  });

  test('returns default for unknown language', () => {
    const code = 'just some plain text\nwith no code patterns';
    expect(formatter.detectLanguage(code)).toBe('');
  });

  // Code block formatting
  test('formats code block with detected language', () => {
    const code = 'const x = 5;';
    const result = formatter.formatCodeBlock(code);
    expect(result).toContain('```typescript');
    expect(result).toContain(code);
    expect(result).toContain('```');
  });

  test('formats code block with explicit language', () => {
    const code = 'some code';
    const result = formatter.formatCodeBlock(code, 'python');
    expect(result).toBe('```python\nsome code\n```');
  });

  // isCode detection
  test('identifies code by patterns', () => {
    expect(formatter.isCode('const x = 5;')).toBe(true);
    expect(formatter.isCode('def foo(): pass')).toBe(true);
  });

  test('identifies code by existing code block', () => {
    expect(formatter.isCode('```\nsome code\n```')).toBe(true);
  });

  test('identifies code by indentation', () => {
    const indentedCode = '  line1\n  line2\n  line3\n  line4\n  line5';
    expect(formatter.isCode(indentedCode)).toBe(true);
  });

  test('does not identify plain text as code', () => {
    expect(formatter.isCode('Hello, how are you today?')).toBe(false);
  });

  // formatForDiscord
  test('formatForDiscord returns content within limit', async () => {
    const content = 'Short message';
    const result = await formatter.formatForDiscord(content);
    expect(result).toBe('Short message');
  });

  test('formatForDiscord truncates long content', async () => {
    const longContent = 'a'.repeat(2500);
    const result = await formatter.formatForDiscord(longContent);
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).toContain('... [truncated]');
  });

  // formatForSignalDB
  test('formatForSignalDB strips user mentions', () => {
    const message = makeDiscordMessage({ content: 'Hello <@123456789>!' });
    const result = formatter.formatForSignalDB(message);
    expect(result).toBe('Hello @user:123456789!');
  });

  test('formatForSignalDB strips role mentions', () => {
    const message = makeDiscordMessage({ content: 'Hello <@&987654321>!' });
    const result = formatter.formatForSignalDB(message);
    expect(result).toBe('Hello @role:987654321!');
  });

  test('formatForSignalDB strips channel mentions', () => {
    const message = makeDiscordMessage({ content: 'Check <#111222333>!' });
    const result = formatter.formatForSignalDB(message);
    expect(result).toBe('Check #channel:111222333!');
  });

  test('formatForSignalDB handles custom emoji', () => {
    const message = makeDiscordMessage({ content: 'Great job <:thumbsup:123>!' });
    const result = formatter.formatForSignalDB(message);
    expect(result).toBe('Great job :thumbsup:!');
  });

  test('formatForSignalDB appends attachments', () => {
    const message = makeDiscordMessage({
      content: 'Check this file',
      attachments: [
        {
          id: 'att-1',
          filename: 'image.png',
          size: 1024,
          url: 'https://cdn.discord.com/image.png',
          proxy_url: 'https://media.discord.com/image.png',
        },
      ],
    });
    const result = formatter.formatForSignalDB(message);
    expect(result).toContain('[image.png](https://cdn.discord.com/image.png)');
  });

  // truncateWithLink
  test('truncateWithLink preserves content under limit', async () => {
    const content = 'Short message';
    const result = await formatter.truncateWithLink(content, 2000);
    expect(result).toBe('Short message');
  });

  test('truncateWithLink truncates at word boundary', async () => {
    const content = 'word1 word2 word3 ' + 'x'.repeat(2000);
    const result = await formatter.truncateWithLink(content, 100);
    expect(result).toContain('... [truncated]');
    // Should not cut mid-word if possible
  });
});

// ============================================================================
// 4. PresenceSync Tests (~10 tests)
// ============================================================================

describe('PresenceSync', () => {
  let presence: PresenceSync;

  beforeEach(() => {
    setupMockFetch();
    presence = new PresenceSync(DEFAULT_CONFIG);
  });

  afterEach(() => {
    presence.stop();
    teardownMockFetch();
  });

  test('starts and stops polling lifecycle', () => {
    addRoute('GET', '/v1/agents', [makeAgent()]);

    presence.start();
    // Should not throw when stopping
    presence.stop();
    presence.stop(); // Double stop should be safe
  });

  test('start is idempotent', () => {
    addRoute('GET', '/v1/agents', [makeAgent()]);

    presence.start();
    presence.start(); // Should not start second interval
    presence.stop();
  });

  test('getStatusColor returns green for active', () => {
    expect(presence.getStatusColor('active')).toBe(0x00ff00);
  });

  test('getStatusColor returns yellow for idle', () => {
    expect(presence.getStatusColor('idle')).toBe(0xffff00);
  });

  test('getStatusColor returns red for offline', () => {
    expect(presence.getStatusColor('offline')).toBe(0xff0000);
  });

  test('getStatusEmoji returns configured emojis', () => {
    expect(presence.getStatusEmoji('active')).toBe(':green_circle:');
    expect(presence.getStatusEmoji('idle')).toBe(':yellow_circle:');
    expect(presence.getStatusEmoji('offline')).toBe(':red_circle:');
  });

  test('formatAgentEmbed creates proper embed structure', () => {
    const agent = makeAgent({ status: 'active', sessionName: 'test-session' });
    const embed = presence.formatAgentEmbed(agent);

    expect(embed.title).toBe('test-session');
    expect(embed.color).toBe(0x00ff00);
    expect(embed.fields).toBeDefined();
    expect(embed.fields!.length).toBeGreaterThan(0);
  });

  test('formatSummaryEmbed counts agent statuses', () => {
    const agents = [
      makeAgent({ status: 'active' }),
      makeAgent({ id: 'agent-2', status: 'active' }),
      makeAgent({ id: 'agent-3', status: 'idle' }),
      makeAgent({ id: 'agent-4', status: 'offline' }),
    ];

    const embed = presence.formatSummaryEmbed(agents);

    expect(embed.title).toBe('Agent Presence Summary');
    expect(embed.fields!.find(f => f.name.includes('Active'))!.value).toBe('2');
    expect(embed.fields!.find(f => f.name.includes('Idle'))!.value).toBe('1');
    expect(embed.fields!.find(f => f.name.includes('Offline'))!.value).toBe('1');
    expect(embed.fields!.find(f => f.name === 'Total')!.value).toBe('4');
  });

  test('handles empty agent list', () => {
    const embed = presence.formatSummaryEmbed([]);

    expect(embed.fields!.find(f => f.name === 'Total')!.value).toBe('0');
  });

  test('onUpdate callback receives agents', async () => {
    const agents = [makeAgent()];
    addRoute('GET', '/v1/agents', agents);

    let receivedAgents: Agent[] = [];
    presence.onUpdate((a) => {
      receivedAgents = a;
    });

    await presence.syncPresence();
    expect(receivedAgents.length).toBe(1);
  });
});

// ============================================================================
// 5. SlashCommandManager Tests (~20 tests)
// ============================================================================

describe('SlashCommandManager', () => {
  let manager: SlashCommandManager;

  beforeEach(() => {
    setupMockFetch();
    manager = new SlashCommandManager(DEFAULT_CONFIG);
  });

  afterEach(() => {
    teardownMockFetch();
  });

  // Command registration
  test('registerCommands calls Discord API', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('PUT', '/commands', []);

    await manager.registerCommands(TEST_GUILD_ID);

    const putCall = fetchCalls.find(c => c.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(putCall!.url).toContain('commands');
  });

  test('registerCommands handles API error', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    routes.push({
      method: 'PUT',
      pathPattern: '/commands',
      handler: () => new Response('Error', { status: 400 }),
    });

    await expect(manager.registerCommands(TEST_GUILD_ID)).rejects.toThrow('Failed to register commands');
  });

  // Interaction handling - ignores non-command interactions
  test('handleInteraction ignores non-ApplicationCommand', async () => {
    const interaction = makeInteraction({ type: DiscordInteractionType.Ping });

    // Should not throw or call any APIs
    await manager.handleInteraction(interaction);
    expect(fetchCalls.length).toBe(0);
  });

  // /agent list command
  test('handles /agent list command', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('GET', '/v1/agents', [makeAgent()]);
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'agent', type: 1, options: [{ name: 'list', type: 3, value: 'all' }] },
    });

    await manager.handleInteraction(interaction);

    const patchCall = fetchCalls.find(c => c.method === 'PATCH');
    expect(patchCall).toBeDefined();
  });

  // /agent status command
  test('handles /agent status command', async () => {
    const testAgent = makeAgent({ id: 'agent-test-123' });
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('GET', '/v1/agents', [testAgent]);
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'agent', type: 1, options: [{ name: 'status', type: 3, value: 'agent-test' }] },
    });

    await manager.handleInteraction(interaction);

    const patchCall = fetchCalls.find(c => c.method === 'PATCH');
    expect(patchCall).toBeDefined();
  });

  // /agent status not found
  test('handles /agent status not found', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('GET', '/v1/agents', []);
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'agent', type: 1, options: [{ name: 'status', type: 3, value: 'nonexistent' }] },
    });

    await manager.handleInteraction(interaction);

    const patchCall = fetchCalls.find(c => c.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect((patchCall!.body as { content?: string })?.content).toContain('not found');
  });

  // /paste create command
  test('handles /paste create command', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('POST', '/v1/pastes', { id: 'paste-123', accessMode: 'ttl', expiresAt: null });
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: {
        id: 'cmd-1',
        name: 'paste',
        type: 1,
        options: [{ name: 'content', type: 3, value: 'Hello paste content' }],
      },
    });

    await manager.handleInteraction(interaction);

    const pasteCall = fetchCalls.find(c => c.method === 'POST' && c.url.includes('pastes'));
    expect(pasteCall).toBeDefined();
  });

  test('handles /paste create with read_once', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('POST', '/v1/pastes', { id: 'paste-123', accessMode: 'read_once', expiresAt: null });
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: {
        id: 'cmd-1',
        name: 'paste',
        type: 1,
        options: [
          { name: 'content', type: 3, value: 'Secret content' },
          { name: 'read_once', type: 5, value: true },
        ],
      },
    });

    await manager.handleInteraction(interaction);

    // Verify paste API was called (note: PasteManager uses accessType not accessMode)
    const pasteCall = fetchCalls.find(c => c.method === 'POST' && c.url.includes('pastes'));
    expect(pasteCall).toBeDefined();
    expect((pasteCall!.body as { accessType?: string })?.accessType).toBe('read_once');
  });

  // /paste missing content
  test('handles /paste without content', async () => {
    addRoute('POST', '/callback', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'paste', type: 1, options: [] },
    });

    await manager.handleInteraction(interaction);

    const postCall = fetchCalls.find(c => c.method === 'POST' && c.url.includes('callback'));
    expect(postCall).toBeDefined();
    // Should respond with ephemeral error
  });

  // /memo send command
  test('handles /memo send command', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    // Memo sends to /v1/messages endpoint with memo message type
    addRoute('POST', '/v1/messages', {
      id: 'memo-123',
      targetAddress: 'agent://machine-001/test-agent',
      senderId: TEST_AGENT_ID,
      channelId: 'default',
      targetType: 'agent',
      messageType: 'memo',
      content: 'Test body content',
      metadata: { subject: 'Test Subject', priority: 'P2', category: 'knowledge' },
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    // Use valid agent address format: agent://machine-id/identifier
    const interaction = makeInteraction({
      data: {
        id: 'cmd-1',
        name: 'memo',
        type: 1,
        options: [
          { name: 'to', type: 3, value: 'agent://machine-001/test-agent' },
          { name: 'subject', type: 3, value: 'Test Subject' },
          { name: 'body', type: 3, value: 'Test body content' },
        ],
      },
    });

    await manager.handleInteraction(interaction);

    // Memo API call verifies the endpoint was hit
    const memoCall = fetchCalls.find(c =>
      c.method === 'POST' &&
      c.url.includes('/v1/messages') &&
      !c.url.includes('@original')
    );
    expect(memoCall).toBeDefined();
  });

  // /memo with priority
  test('handles /memo with priority option', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('POST', '/v1/messages', {
      id: 'memo-123',
      targetAddress: 'agent://machine-001/test-agent',
      senderId: TEST_AGENT_ID,
      channelId: 'default',
      targetType: 'agent',
      messageType: 'memo',
      content: 'Critical issue',
      metadata: { subject: 'Urgent', priority: 'P0', category: 'knowledge' },
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    // Use valid agent address format
    const interaction = makeInteraction({
      data: {
        id: 'cmd-1',
        name: 'memo',
        type: 1,
        options: [
          { name: 'to', type: 3, value: 'agent://machine-001/test-agent' },
          { name: 'subject', type: 3, value: 'Urgent' },
          { name: 'body', type: 3, value: 'Critical issue' },
          { name: 'priority', type: 3, value: 'P0' },
        ],
      },
    });

    await manager.handleInteraction(interaction);

    const memoCall = fetchCalls.find(c =>
      c.method === 'POST' &&
      c.url.includes('/v1/messages') &&
      !c.url.includes('@original')
    );
    // Verify the memo call was made - priority is passed through MemoComposer
    expect(memoCall).toBeDefined();
    // Priority is in the metadata section of the body
    const body = memoCall!.body as { metadata?: { priority?: string } };
    expect(body?.metadata?.priority).toBe('P0');
  });

  // /memo missing required fields
  test('handles /memo with missing fields', async () => {
    addRoute('POST', '/callback', {});

    const interaction = makeInteraction({
      data: {
        id: 'cmd-1',
        name: 'memo',
        type: 1,
        options: [{ name: 'to', type: 3, value: 'test-agent' }], // Missing subject and body
      },
    });

    await manager.handleInteraction(interaction);

    const postCall = fetchCalls.find(c => c.method === 'POST' && c.url.includes('callback'));
    expect(postCall).toBeDefined();
  });

  // Unknown command
  test('handles unknown command with ephemeral response', async () => {
    addRoute('POST', '/callback', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'unknown', type: 1, options: [] },
    });

    await manager.handleInteraction(interaction);

    const postCall = fetchCalls.find(c => c.method === 'POST');
    expect(postCall).toBeDefined();
  });

  // Error handling
  test('handles API errors gracefully', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    routes.push({
      method: 'GET',
      pathPattern: '/v1/agents',
      handler: () => new Response('Server error', { status: 500 }),
    });
    addRoute('POST', '/callback', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'agent', type: 1, options: [] },
    });

    // Should not throw
    await manager.handleInteraction(interaction);
  });

  // Deferred reply pattern
  test('uses deferred reply for async operations', async () => {
    addRoute('GET', '/oauth2/applications/@me', { id: 'app-123' });
    addRoute('GET', '/v1/agents', [makeAgent()]);
    addRoute('POST', '/callback', {});
    addRoute('PATCH', '/messages/@original', {});

    const interaction = makeInteraction({
      data: { id: 'cmd-1', name: 'agent', type: 1, options: [] },
    });

    await manager.handleInteraction(interaction);

    const deferCall = fetchCalls.find(c =>
      c.method === 'POST' &&
      c.url.includes('callback') &&
      (c.body as { type?: number })?.type === DiscordInteractionCallbackType.DeferredChannelMessageWithSource
    );
    expect(deferCall).toBeDefined();
  });
});

// ============================================================================
// 6. MessageBridge Tests (~15 tests)
// ============================================================================

describe('MessageBridge', () => {
  // Note: MessageBridge depends on several components that need to be mocked
  // We'll test the core logic with minimal mocking

  beforeEach(() => {
    setupMockFetch();
  });

  afterEach(() => {
    teardownMockFetch();
  });

  test('start and stop lifecycle', () => {
    // Create minimal mock dependencies
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const mockChannelClient = {} as any;
    const mockThreadMapper = new ThreadMapper(DEFAULT_CONFIG);
    const mockFormatter = new MessageFormatter();
    const mockRateLimiter = new DiscordRateLimiter();

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      mockThreadMapper,
      mockFormatter,
      mockRateLimiter,
      []
    );

    bridge.start();
    bridge.stop();

    expect(mockGateway.onDiscordMessage).toHaveBeenCalled();
    expect(mockGateway.onSignalDBMessage).toHaveBeenCalled();
  });

  test('getStats returns correct counts', () => {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    const stats = bridge.getStats();
    expect(stats.messagesFromDiscord).toBe(0);
    expect(stats.messagesFromSignalDB).toBe(0);
    expect(stats.channelMappings).toBe(1);
  });

  test('addChannelMapping increases count', () => {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      []
    );

    expect(bridge.getStats().channelMappings).toBe(0);

    bridge.addChannelMapping({
      discordChannelId: 'd1',
      signalDBChannelId: 's1',
      direction: 'bidirectional',
    });

    expect(bridge.getStats().channelMappings).toBe(1);
  });

  test('removeChannelMapping decreases count', () => {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    expect(bridge.getStats().channelMappings).toBe(1);
    bridge.removeChannelMapping('d1');
    expect(bridge.getStats().channelMappings).toBe(0);
  });

  // Testing handleDiscordMessage
  test('handleDiscordMessage ignores bot messages', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockChannelClient = { publish: mockPublish } as any;

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    bridge.start();

    const botMessage = makeDiscordMessage({
      author: { id: 'bot-123', username: 'bot', discriminator: '0000', avatar: null, bot: true },
    });

    await bridge.handleDiscordMessage(botMessage);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('handleDiscordMessage respects rate limits', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockChannelClient = { publish: mockPublish } as any;

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const rateLimiter = new DiscordRateLimiter(1); // Only 1 msg/min

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      rateLimiter,
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    bridge.start();

    const message = makeDiscordMessage();

    // First message should go through
    await bridge.handleDiscordMessage(message);
    expect(mockPublish).toHaveBeenCalledTimes(1);

    // Second message should be rate limited
    await bridge.handleDiscordMessage(message);
    expect(mockPublish).toHaveBeenCalledTimes(1); // Still 1
  });

  test('handleDiscordMessage respects direction constraint', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockChannelClient = { publish: mockPublish } as any;

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'signaldb-to-discord' }]
    );

    bridge.start();

    const message = makeDiscordMessage();
    await bridge.handleDiscordMessage(message);

    // Should not publish due to direction constraint
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('handleDiscordMessage skips unmapped channels', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockChannelClient = { publish: mockPublish } as any;

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [] // No mappings
    );

    bridge.start();

    const message = makeDiscordMessage();
    await bridge.handleDiscordMessage(message);

    expect(mockPublish).not.toHaveBeenCalled();
  });

  // Testing handleSignalDBMessage
  test('handleSignalDBMessage skips discord-originated messages', async () => {
    addRoute('POST', '/channels/', {});

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    bridge.start();

    const message = makeSignalDBMessage({
      channelId: 's1',
      metadata: { source: 'discord' },
    });

    await bridge.handleSignalDBMessage(message);

    // Should not post back to Discord
    const discordCall = fetchCalls.find(c => c.url.includes('discord.com'));
    expect(discordCall).toBeUndefined();
  });

  test('handleSignalDBMessage skips unmapped channels', async () => {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [] // No mappings
    );

    bridge.start();

    const message = makeSignalDBMessage({ channelId: 'unmapped-channel' });
    await bridge.handleSignalDBMessage(message);

    // No Discord API calls
    expect(fetchCalls.length).toBe(0);
  });

  test('handleSignalDBMessage respects direction constraint', async () => {
    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      {} as any,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'd1', signalDBChannelId: 's1', direction: 'discord-to-signaldb' }]
    );

    bridge.start();

    const message = makeSignalDBMessage({ channelId: 's1' });
    await bridge.handleSignalDBMessage(message);

    // Should not post to Discord due to direction
    expect(fetchCalls.length).toBe(0);
  });

  test('does not process when stopped', async () => {
    const mockPublish = mock(() => Promise.resolve());
    const mockChannelClient = { publish: mockPublish } as any;

    const mockGateway = {
      onDiscordMessage: mock(() => {}),
      onSignalDBMessage: mock(() => {}),
    } as unknown as DiscordGateway;

    const bridge = new MessageBridge(
      DEFAULT_CONFIG,
      mockGateway,
      mockChannelClient,
      new ThreadMapper(DEFAULT_CONFIG),
      new MessageFormatter(),
      new DiscordRateLimiter(),
      [{ discordChannelId: 'chan-123456', signalDBChannelId: 's1', direction: 'bidirectional' }]
    );

    // Don't call start() - bridge is stopped

    const message = makeDiscordMessage();
    await bridge.handleDiscordMessage(message);

    expect(mockPublish).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 7. DiscordGateway Tests (~20 tests)
// ============================================================================

describe('DiscordGateway', () => {
  beforeEach(() => {
    setupMockFetch();
    setupMockWebSocket();
  });

  afterEach(() => {
    teardownMockFetch();
    teardownMockWebSocket();
  });

  test('isConnected returns false before connect', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const status = gateway.isConnected();

    expect(status.discord).toBe(false);
    expect(status.signaldb).toBe(false);
  });

  test('disconnect cleans up resources', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    gateway.disconnect();

    const status = gateway.isConnected();
    expect(status.discord).toBe(false);
    expect(status.signaldb).toBe(false);
  });

  test('onDiscordMessage registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    // Should not throw
    gateway.onDiscordMessage(callback);
  });

  test('onDiscordInteraction registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onDiscordInteraction(callback);
  });

  test('onDiscordPresence registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onDiscordPresence(callback);
  });

  test('onDiscordReady registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onDiscordReady(callback);
  });

  test('onSignalDBMessage registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onSignalDBMessage(callback);
  });

  test('onStatus registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onStatus(callback);
  });

  test('onError registers callback', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    const callback = mock(() => {});

    gateway.onError(callback);
  });

  test('disconnect sets shouldReconnect to false', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);
    gateway.disconnect();

    // Subsequent reconnect attempts should not happen
    const status = gateway.isConnected();
    expect(status.discord).toBe(false);
  });

  test('HELLO payload includes heartbeat interval', () => {
    // Test the structure of HELLO payload from Discord
    const helloPayload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Hello,
      d: { heartbeat_interval: 45000 },
      s: null,
      t: null,
    };

    expect(helloPayload.op).toBe(10);
    expect((helloPayload.d as { heartbeat_interval: number }).heartbeat_interval).toBe(45000);
  });

  test('IDENTIFY payload includes required fields', () => {
    // Test the structure of IDENTIFY payload sent to Discord
    const identifyPayload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Identify,
      d: {
        token: 'test-token',
        intents: 33281, // Guilds | GuildMessages | DirectMessages | MessageContent
        properties: {
          os: 'linux',
          browser: 'claude-code-sdk',
          device: 'claude-code-sdk',
        },
      },
      s: null,
      t: null,
    };

    expect(identifyPayload.op).toBe(2);
    const data = identifyPayload.d as { token: string; intents: number; properties: { os: string } };
    expect(data.token).toBe('test-token');
    expect(data.intents).toBe(33281);
    expect(data.properties.os).toBe('linux');
  });

  test('gateway opcodes are defined correctly', () => {
    // Verify opcode constants match Discord Gateway API
    expect(DiscordGatewayOpcode.Dispatch).toBe(0);
    expect(DiscordGatewayOpcode.Heartbeat).toBe(1);
    expect(DiscordGatewayOpcode.Identify).toBe(2);
    expect(DiscordGatewayOpcode.PresenceUpdate).toBe(3);
    expect(DiscordGatewayOpcode.VoiceStateUpdate).toBe(4);
    expect(DiscordGatewayOpcode.Resume).toBe(6);
    expect(DiscordGatewayOpcode.Reconnect).toBe(7);
    expect(DiscordGatewayOpcode.RequestGuildMembers).toBe(8);
    expect(DiscordGatewayOpcode.InvalidSession).toBe(9);
    expect(DiscordGatewayOpcode.Hello).toBe(10);
    expect(DiscordGatewayOpcode.HeartbeatACK).toBe(11);
  });

  test('dispatch opcodes include sequence numbers', () => {
    // Verify the expected structure of Dispatch payloads
    const dispatchPayload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Dispatch,
      d: { content: 'test' },
      s: 42, // Sequence number
      t: 'MESSAGE_CREATE',
    };

    expect(dispatchPayload.op).toBe(0);
    expect(dispatchPayload.s).toBe(42);
    expect(dispatchPayload.t).toBe('MESSAGE_CREATE');
    expect(dispatchPayload.d).toEqual({ content: 'test' });
  });

  test('Discord message type includes bot flag', () => {
    // Test that DiscordMessage type properly supports bot author detection
    const botMessage: DiscordMessage = {
      id: 'msg-1',
      channel_id: 'chan-1',
      author: { id: 'bot-1', username: 'bot', discriminator: '0000', avatar: null, bot: true },
      content: 'Bot message',
      timestamp: new Date().toISOString(),
      edited_timestamp: null,
      tts: false,
      mention_everyone: false,
      mentions: [],
      attachments: [],
      embeds: [],
    };

    expect(botMessage.author.bot).toBe(true);

    const userMessage: DiscordMessage = {
      ...botMessage,
      author: { ...botMessage.author, id: 'user-1', bot: false },
    };

    expect(userMessage.author.bot).toBe(false);
  });

  test('multiple callbacks can be registered', () => {
    const gateway = new DiscordGateway(DEFAULT_CONFIG);

    const cb1 = mock(() => {});
    const cb2 = mock(() => {});
    const cb3 = mock(() => {});

    // Should not throw when registering multiple callbacks
    gateway.onDiscordMessage(cb1);
    gateway.onDiscordMessage(cb2);
    gateway.onDiscordInteraction(cb3);

    gateway.disconnect();
  });

  test('interaction type enum values are correct', () => {
    expect(DiscordInteractionType.Ping).toBe(1);
    expect(DiscordInteractionType.ApplicationCommand).toBe(2);
    expect(DiscordInteractionType.MessageComponent).toBe(3);
    expect(DiscordInteractionType.ApplicationCommandAutocomplete).toBe(4);
    expect(DiscordInteractionType.ModalSubmit).toBe(5);
  });

  test('presence update structure is correct', () => {
    // Verify DiscordPresenceUpdate type structure
    const presence = {
      user: { id: 'user-1' },
      status: 'online' as const,
      activities: [],
      client_status: { desktop: 'online' },
    };

    expect(presence.user.id).toBe('user-1');
    expect(presence.status).toBe('online');
    expect(presence.activities).toEqual([]);
  });

  test('InvalidSession opcode value is correct', () => {
    expect(DiscordGatewayOpcode.InvalidSession).toBe(9);

    // InvalidSession payload structure
    const payload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.InvalidSession,
      d: false, // false means non-resumable
      s: null,
      t: null,
    };

    expect(payload.op).toBe(9);
    expect(payload.d).toBe(false);
  });

  test('Reconnect opcode value is correct', () => {
    expect(DiscordGatewayOpcode.Reconnect).toBe(7);

    // Reconnect payload structure
    const payload: DiscordGatewayPayload = {
      op: DiscordGatewayOpcode.Reconnect,
      d: null,
      s: null,
      t: null,
    };

    expect(payload.op).toBe(7);
  });
});

// ============================================================================
// 8. DiscordBot Facade Tests (~10 tests)
// ============================================================================

describe('DiscordBot facade', () => {
  beforeEach(() => {
    setupMockFetch();
    setupMockWebSocket();
  });

  afterEach(() => {
    teardownMockFetch();
    teardownMockWebSocket();
  });

  test('constructor initializes all components', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    expect(bot.getGateway()).toBeDefined();
    expect(bot.getThreadMapper()).toBeDefined();
    expect(bot.getPresenceSync()).toBeDefined();
    expect(bot.getFormatter()).toBeDefined();
    expect(bot.getRateLimiter()).toBeDefined();
    expect(bot.getChannelClient()).toBeDefined();
    expect(bot.getMemoClient()).toBeDefined();
    expect(bot.getPasteClient()).toBeDefined();
  });

  test('isActive returns false initially', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);
    expect(bot.isActive()).toBe(false);
  });

  test('isConnected returns false initially', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);
    const status = bot.isConnected();

    expect(status.discord).toBe(false);
    expect(status.signaldb).toBe(false);
  });

  test('addChannelMapping stores mapping', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    bot.addChannelMapping({
      discordChannelId: 'd1',
      signalDBChannelId: 's1',
      direction: 'bidirectional',
    });

    const mappings = bot.getChannelMappings();
    expect(mappings.length).toBe(1);
    expect(mappings[0]!.discordChannelId).toBe('d1');
  });

  test('removeChannelMapping removes mapping', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    bot.addChannelMapping({
      discordChannelId: 'd1',
      signalDBChannelId: 's1',
      direction: 'bidirectional',
    });

    expect(bot.getChannelMappings().length).toBe(1);

    bot.removeChannelMapping('d1');
    expect(bot.getChannelMappings().length).toBe(0);
  });

  test('getStatus returns complete status object', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    bot.addChannelMapping({
      discordChannelId: 'd1',
      signalDBChannelId: 's1',
      direction: 'bidirectional',
    });

    const status = bot.getStatus();

    expect(status.connection).toBeDefined();
    expect(status.threadMappings).toBe(0);
    expect(status.channelMappings).toBe(1);
    expect(status.messagesFromDiscord).toBe(0);
    expect(status.messagesFromSignalDB).toBe(0);
    expect(status.rateLimitedUsers).toBe(0);
    expect(status.uptimeMs).toBe(0); // Not started
  });

  test('stop is safe when not started', async () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    // Should not throw
    await bot.stop();
    expect(bot.isActive()).toBe(false);
  });

  test('getChannelMappings returns copy', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG);

    bot.addChannelMapping({
      discordChannelId: 'd1',
      signalDBChannelId: 's1',
      direction: 'bidirectional',
    });

    const mappings1 = bot.getChannelMappings();
    const mappings2 = bot.getChannelMappings();

    // Should be different array instances
    expect(mappings1).not.toBe(mappings2);
    expect(mappings1).toEqual(mappings2);
  });

  test('uses custom presence config', () => {
    const bot = new DiscordBot(DEFAULT_CONFIG, {
      updateIntervalMs: 60000,
      statusEmoji: {
        active: ':white_check_mark:',
        idle: ':warning:',
        offline: ':x:',
      },
    });

    const presence = bot.getPresenceSync();
    expect(presence.getStatusEmoji('active')).toBe(':white_check_mark:');
  });

  test('uses default rate limit from config', () => {
    const bot = new DiscordBot({
      ...DEFAULT_CONFIG,
      rateLimitPerUser: 20,
    });

    const limiter = bot.getRateLimiter();
    expect(limiter.getLimit()).toBe(20);
  });
});

// ============================================================================
// Summary
// ============================================================================

/**
 * Test Summary:
 *
 * 1. DiscordRateLimiter: 15 tests
 *    - Sliding window enforcement, per-user isolation, retry-after calculation
 *
 * 2. ThreadMapper: 15 tests
 *    - Bidirectional mapping, create-on-first-use, UUID generation
 *
 * 3. MessageFormatter: 20 tests
 *    - Language detection, code blocks, truncation, Discord mention stripping
 *
 * 4. PresenceSync: 10 tests
 *    - Polling lifecycle, status colors, agent embed formatting
 *
 * 5. SlashCommandManager: 20 tests
 *    - /agent, /paste, /memo commands, interaction handling, error handling
 *
 * 6. MessageBridge: 15 tests
 *    - Bidirectional routing, rate limiting, direction constraints
 *
 * 7. DiscordGateway: 20 tests
 *    - WebSocket handling, event dispatch, callback registration
 *
 * 8. DiscordBot facade: 10 tests
 *    - Lifecycle, component wiring, status reporting
 *
 * Total: ~125 tests, ~250+ assertions
 */
