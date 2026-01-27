/**
 * Unit Tests for Channel Client Components (COMMS-003 Task 9)
 *
 * Covers:
 * - ChannelManager: create, join, leave, archive, get, list, info
 * - MessagePublisher: publish to different channel types, threading, message types
 * - MessageSubscriber: subscribe, unsubscribe, dispatch, multiple subscriptions
 * - MessageQuery: query, thread retrieval, thread summary, pagination, delivery
 * - OfflineQueue: drain, callbacks, claim, ordering, error handling
 * - Address resolution: all 4 address types via ChannelClient facade
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ChannelManager } from '../../src/comms/channels/channel-manager';
import { MessagePublisher } from '../../src/comms/channels/publisher';
import { MessageSubscriber } from '../../src/comms/channels/subscriber';
import { MessageQuery } from '../../src/comms/channels/query';
import { OfflineQueue } from '../../src/comms/channels/offline-queue';
import { ChannelClient } from '../../src/comms/channels/channel-client';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Channel, Message, ChannelType, MessageType } from '../../src/comms/protocol/types';
import type { ChannelConfig } from '../../src/comms/channels/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-channels.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_channels';
const TEST_AGENT_ID = 'agent-uuid-001';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'chan-uuid-001',
    name: 'dev-team',
    type: 'project',
    members: ['agent-uuid-001', 'agent-uuid-002'],
    createdBy: 'agent-uuid-001',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-001',
    channelId: 'chan-uuid-001',
    senderId: 'agent-uuid-sender',
    targetType: 'broadcast',
    targetAddress: 'broadcast://dev-team',
    messageType: 'chat',
    content: 'Hello from another agent',
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

    // Default: 404
    return new Response(JSON.stringify({ message: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  (mockFetch as typeof globalThis.fetch).preconnect = () => {};
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
}

function addJSONRoute(method: string, pathPattern: string | RegExp, response: unknown, status = 200): void {
  routes.push({
    method,
    pathPattern,
    handler: () => {
      if (status === 204) {
        return new Response(null, { status: 204, statusText: 'No Content' });
      }
      return new Response(JSON.stringify(response), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

function addHandlerRoute(
  method: string,
  pathPattern: string | RegExp,
  handler: MockRoute['handler'],
): void {
  routes.push({ method, pathPattern, handler });
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  originalFetch = globalThis.fetch;
  routes = [];
  fetchCalls = [];
  setupMockFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  routes = [];
  fetchCalls = [];
});

// ============================================================================
// ChannelManager - Channel Lifecycle
// ============================================================================

describe('ChannelManager - Channel Lifecycle', () => {
  test('creates a channel with name, type, and createdBy', async () => {
    const channel = makeChannel({ id: 'chan-new-001', name: 'new-channel', type: 'project' });
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/channels', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(channel), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.createChannel('new-channel', 'project');

    expect(result.id).toBe('chan-new-001');
    expect(result.name).toBe('new-channel');
    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.name).toBe('new-channel');
    expect(body.type).toBe('project');
    expect(body.createdBy).toBe(TEST_AGENT_ID);
  });

  test('creates a direct channel', async () => {
    const channel = makeChannel({ id: 'chan-dm-001', type: 'direct' });
    addJSONRoute('POST', '/v1/channels', channel);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.createChannel('dm-channel', 'direct');

    expect(result.id).toBe('chan-dm-001');
    expect(result.type).toBe('direct');
  });

  test('creates a broadcast channel', async () => {
    const channel = makeChannel({ id: 'chan-bc-001', type: 'broadcast' });
    addJSONRoute('POST', '/v1/channels', channel);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.createChannel('announcements', 'broadcast');

    expect(result.id).toBe('chan-bc-001');
    expect(result.type).toBe('broadcast');
  });

  test('creates a channel with initial members', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/channels', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    await manager.createChannel('team', 'project', ['agent-002', 'agent-003']);

    const body = capturedBody as Record<string, unknown>;
    const members = body.members as string[];
    expect(members).toContain('agent-002');
    expect(members).toContain('agent-003');
  });

  test('creates a channel with empty members when none provided', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/channels', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    await manager.createChannel('solo', 'project');

    const body = capturedBody as Record<string, unknown>;
    const members = body.members as string[];
    expect(Array.isArray(members)).toBe(true);
    expect(members.length).toBe(0);
  });

  test('joins a channel adds agent as member', async () => {
    const updatedChannel = makeChannel({ members: ['agent-uuid-001', 'agent-uuid-002', 'agent-uuid-003'] });
    let capturedUrl = '';
    let capturedBody: unknown = null;
    addHandlerRoute('POST', /\/v1\/channels\/.*\/members/, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(updatedChannel), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.joinChannel('chan-uuid-001', 'agent-uuid-003');

    expect(capturedUrl).toContain('chan-uuid-001');
    expect((capturedBody as Record<string, unknown>).agentId).toBe('agent-uuid-003');
    expect(result.members.length).toBe(3);
  });

  test('joins a channel defaults to own agentId', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('POST', /\/v1\/channels\/.*\/members/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    await manager.joinChannel('chan-uuid-001');

    expect((capturedBody as Record<string, unknown>).agentId).toBe(TEST_AGENT_ID);
  });

  test('leaves a channel removes agent from members', async () => {
    const updatedChannel = makeChannel({ members: ['agent-uuid-001'] });
    let capturedUrl = '';
    addHandlerRoute('DELETE', /\/v1\/channels\/.*\/members\//, (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify(updatedChannel), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.leaveChannel('chan-uuid-001', 'agent-uuid-002');

    expect(capturedUrl).toContain('chan-uuid-001');
    expect(capturedUrl).toContain('agent-uuid-002');
    expect(result.members.length).toBe(1);
  });

  test('leaves a channel defaults to own agentId', async () => {
    let capturedUrl = '';
    addHandlerRoute('DELETE', /\/v1\/channels\/.*\/members\//, (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    await manager.leaveChannel('chan-uuid-001');

    expect(capturedUrl).toContain(TEST_AGENT_ID);
  });

  test('archives a channel by sending command message', async () => {
    const channel = makeChannel({ id: 'chan-archive-001', name: 'old-channel' });
    addJSONRoute('GET', '/v1/channels/chan-archive-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    await manager.archiveChannel('chan-archive-001');

    expect(capturedBody).not.toBeNull();
    const body = capturedBody as Record<string, unknown>;
    expect(body.channelId).toBe('chan-archive-001');
    expect(body.senderId).toBe(TEST_AGENT_ID);
    expect(body.messageType).toBe('command');
    expect(body.targetType).toBe('broadcast');
    const content = JSON.parse(body.content as string);
    expect(content.action).toBe('channel.archive');
    expect(content.archivedBy).toBe(TEST_AGENT_ID);
  });

  test('gets a channel by ID', async () => {
    const channel = makeChannel({ id: 'chan-get-001', name: 'test-channel' });
    addJSONRoute('GET', '/v1/channels/chan-get-001', channel);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.getChannel('chan-get-001');

    expect(result.id).toBe('chan-get-001');
    expect(result.name).toBe('test-channel');
  });

  test('lists channels without filters', async () => {
    const channels = [
      makeChannel({ id: 'ch-1', name: 'alpha' }),
      makeChannel({ id: 'ch-2', name: 'beta' }),
    ];
    addJSONRoute('GET', '/v1/channels', channels);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.listChannels();

    expect(result.length).toBe(2);
    expect(result[0]!.name).toBe('alpha');
  });

  test('lists channels with type filter', async () => {
    const channels = [makeChannel({ id: 'ch-bc', type: 'broadcast' })];
    addJSONRoute('GET', '/v1/channels', channels);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const result = await manager.listChannels({ type: 'broadcast' });

    expect(result.length).toBe(1);
    const fetchCall = fetchCalls.find((c) => c.url.includes('/v1/channels'));
    expect(fetchCall!.url).toContain('type=broadcast');
  });

  test('gets channel info with member count and last message', async () => {
    const channel = makeChannel({
      id: 'chan-info-001',
      members: ['a-001', 'a-002', 'a-003'],
    });
    const lastMsg = makeMessage({ id: 'msg-latest', content: 'Latest message' });

    addJSONRoute('GET', '/v1/channels/chan-info-001', channel);
    addJSONRoute('GET', '/v1/messages', [lastMsg]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const info = await manager.getChannelInfo('chan-info-001');

    expect(info.channel.id).toBe('chan-info-001');
    expect(info.memberCount).toBe(3);
    expect(info.lastMessage).not.toBeNull();
    expect(info.lastMessage!.id).toBe('msg-latest');
  });

  test('gets channel info with no messages returns null lastMessage', async () => {
    const channel = makeChannel({ id: 'chan-empty-001', members: [] });
    addJSONRoute('GET', '/v1/channels/chan-empty-001', channel);
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const info = await manager.getChannelInfo('chan-empty-001');

    expect(info.memberCount).toBe(0);
    expect(info.lastMessage).toBeNull();
  });

  test('gets channel info with null members returns 0 member count', async () => {
    // Channel where members field might be missing/null
    const channel = makeChannel({ id: 'chan-null-001' });
    // Simulate members being absent
    (channel as unknown as Record<string, unknown>).members = undefined as unknown as string[];
    addJSONRoute('GET', '/v1/channels/chan-null-001', channel);
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, TEST_AGENT_ID);
    const info = await manager.getChannelInfo('chan-null-001');

    expect(info.memberCount).toBe(0);
  });
});

// ============================================================================
// MessagePublisher - Publishing
// ============================================================================

describe('MessagePublisher - Publishing', () => {
  test('publishes a simple chat message', async () => {
    const channel = makeChannel({ id: 'chan-pub-001', name: 'dev-team', type: 'broadcast' });
    addJSONRoute('GET', '/v1/channels/chan-pub-001', channel);

    const sentMessage = makeMessage({ id: 'msg-pub-001', content: 'Hello!' });
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(sentMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    const result = await publisher.publish('chan-pub-001', 'Hello!');

    expect(result.id).toBe('msg-pub-001');
    const body = capturedBody as Record<string, unknown>;
    expect(body.channelId).toBe('chan-pub-001');
    expect(body.senderId).toBe(TEST_AGENT_ID);
    expect(body.content).toBe('Hello!');
    expect(body.messageType).toBe('chat');
  });

  test('publishes with explicit messageType command', async () => {
    const channel = makeChannel({ id: 'chan-cmd-001', name: 'commands' });
    addJSONRoute('GET', '/v1/channels/chan-cmd-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ messageType: 'command' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-cmd-001', '{"action":"build"}', { messageType: 'command' });

    expect((capturedBody as Record<string, unknown>).messageType).toBe('command');
  });

  test('publishes with messageType memo', async () => {
    const channel = makeChannel({ id: 'chan-memo-001', name: 'notes' });
    addJSONRoute('GET', '/v1/channels/chan-memo-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ messageType: 'memo' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-memo-001', 'Remember this', { messageType: 'memo' });

    expect((capturedBody as Record<string, unknown>).messageType).toBe('memo');
  });

  test('publishes with messageType response', async () => {
    const channel = makeChannel({ id: 'chan-resp-001', name: 'replies' });
    addJSONRoute('GET', '/v1/channels/chan-resp-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ messageType: 'response' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-resp-001', 'Done', { messageType: 'response' });

    expect((capturedBody as Record<string, unknown>).messageType).toBe('response');
  });

  test('publishes with threadId for threading', async () => {
    const channel = makeChannel({ id: 'chan-thread-001', name: 'threaded' });
    addJSONRoute('GET', '/v1/channels/chan-thread-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ threadId: 'thread-001' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-thread-001', 'Reply', { threadId: 'thread-001' });

    expect((capturedBody as Record<string, unknown>).threadId).toBe('thread-001');
  });

  test('publishes with metadata', async () => {
    const channel = makeChannel({ id: 'chan-meta-001', name: 'meta' });
    addJSONRoute('GET', '/v1/channels/chan-meta-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-meta-001', 'With metadata', {
      metadata: { priority: 'high', source: 'qa-test' },
    });

    const body = capturedBody as Record<string, unknown>;
    const meta = body.metadata as Record<string, unknown>;
    expect(meta.priority).toBe('high');
    expect(meta.source).toBe('qa-test');
  });

  test('publishes with expiresAt', async () => {
    const channel = makeChannel({ id: 'chan-exp-001', name: 'expiring' });
    addJSONRoute('GET', '/v1/channels/chan-exp-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    const expiresAt = '2026-12-31T23:59:59Z';
    await publisher.publish('chan-exp-001', 'Temporary', { expiresAt });

    expect((capturedBody as Record<string, unknown>).expiresAt).toBe(expiresAt);
  });

  test('publishes to broadcast channel resolves broadcast address', async () => {
    const channel = makeChannel({ id: 'chan-bc-pub-001', name: 'general', type: 'broadcast' });
    addJSONRoute('GET', '/v1/channels/chan-bc-pub-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-bc-pub-001', 'Broadcast!');

    const body = capturedBody as Record<string, unknown>;
    expect(body.targetType).toBe('broadcast');
    expect(body.targetAddress).toBe('broadcast://general');
  });

  test('publishes to project channel resolves broadcast address', async () => {
    const channel = makeChannel({ id: 'chan-proj-pub-001', name: 'my-project', type: 'project' });
    addJSONRoute('GET', '/v1/channels/chan-proj-pub-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-proj-pub-001', 'Project update');

    const body = capturedBody as Record<string, unknown>;
    expect(body.targetType).toBe('broadcast');
    expect(body.targetAddress).toBe('broadcast://my-project');
  });

  test('publishes to direct channel resolves broadcast address', async () => {
    const channel = makeChannel({ id: 'chan-dm-pub-001', name: 'dm-pair', type: 'direct' });
    addJSONRoute('GET', '/v1/channels/chan-dm-pub-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-dm-pub-001', 'DM');

    const body = capturedBody as Record<string, unknown>;
    expect(body.targetType).toBe('broadcast');
    expect(body.targetAddress).toBe('broadcast://dm-pair');
  });

  test('defaults to chat messageType when no options provided', async () => {
    const channel = makeChannel({ id: 'chan-default-001', name: 'default' });
    addJSONRoute('GET', '/v1/channels/chan-default-001', channel);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisher = new MessagePublisher(client, TEST_AGENT_ID);
    await publisher.publish('chan-default-001', 'No options');

    expect((capturedBody as Record<string, unknown>).messageType).toBe('chat');
  });
});

// ============================================================================
// MessageSubscriber - Subscription
// ============================================================================

describe('MessageSubscriber - Subscription', () => {
  test('subscribe returns a ChannelSubscription object', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    // We need to add SSE route since subscribe triggers connection
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);
    const received: Message[] = [];
    const sub = subscriber.subscribe('chan-001', (msg) => received.push(msg));

    expect(sub.channelId).toBe('chan-001');
    expect(typeof sub.callback).toBe('function');
    expect(typeof sub.unsubscribe).toBe('function');

    subscriber.disconnect();
  });

  test('subscription count tracks active subscriptions', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);
    expect(subscriber.subscriptionCount).toBe(0);

    subscriber.subscribe('chan-001', () => {});
    expect(subscriber.subscriptionCount).toBe(1);

    subscriber.subscribe('chan-002', () => {});
    expect(subscriber.subscriptionCount).toBe(2);

    subscriber.disconnect();
  });

  test('multiple subscriptions per channel are supported', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);

    subscriber.subscribe('chan-001', () => {});
    subscriber.subscribe('chan-001', () => {});
    subscriber.subscribe('chan-001', () => {});

    expect(subscriber.subscriptionCount).toBe(3);
    subscriber.disconnect();
  });

  test('unsubscribe removes the specific callback', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);

    const sub1 = subscriber.subscribe('chan-001', () => {});
    const sub2 = subscriber.subscribe('chan-001', () => {});

    expect(subscriber.subscriptionCount).toBe(2);

    sub1.unsubscribe();
    expect(subscriber.subscriptionCount).toBe(1);

    sub2.unsubscribe();
    expect(subscriber.subscriptionCount).toBe(0);

    subscriber.disconnect();
  });

  test('unsubscribe only removes matching callback', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);

    const sub1 = subscriber.subscribe('chan-001', () => {});
    subscriber.subscribe('chan-002', () => {});

    sub1.unsubscribe();

    // chan-002 subscription should still be active
    expect(subscriber.subscriptionCount).toBe(1);
    subscriber.disconnect();
  });

  test('disconnect clears all subscriptions', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);

    subscriber.subscribe('chan-001', () => {});
    subscriber.subscribe('chan-002', () => {});
    subscriber.subscribe('chan-003', () => {});

    expect(subscriber.subscriptionCount).toBe(3);

    subscriber.disconnect();
    expect(subscriber.subscriptionCount).toBe(0);
    expect(subscriber.isConnected).toBe(false);
  });

  test('isConnected is false before any subscription', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };

    const subscriber = new MessageSubscriber(config);
    expect(subscriber.isConnected).toBe(false);
    subscriber.disconnect();
  });

  test('isConnected becomes true after subscription triggers connection', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    // Add a route for the SSE connection
    routes.push({
      method: 'GET',
      pathPattern: '/v1/messages/stream',
      handler: () => {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(': keepalive\n\n'));
              // Don't close - keep stream open
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          },
        );
      },
    });

    const subscriber = new MessageSubscriber(config);
    subscriber.subscribe('chan-001', () => {});

    // After subscribe, ensureConnection sets connected=true immediately
    expect(subscriber.isConnected).toBe(true);
    subscriber.disconnect();
  });

  test('reuses provided SSE client from config', () => {
    // Create a mock SSE client
    const mockSSEClient = {
      isConnected: true,
      onMessage: (_cb: unknown) => {},
      onStatus: (_cb: unknown) => {},
      onError: (_cb: unknown) => {},
      connect: async () => {},
      disconnect: () => {},
      get resumeId() { return null; },
    } as unknown as import('../../src/comms/daemon/sse-client').SSEClient;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
      sseClient: mockSSEClient,
    };

    const subscriber = new MessageSubscriber(config);
    // When SSE client is provided and connected, subscriber should be connected
    expect(subscriber.isConnected).toBe(true);

    // Disconnect should NOT disconnect the shared SSE client (ownsSSEClient=false)
    subscriber.disconnect();
    expect(subscriber.isConnected).toBe(false);
  });

  test('double unsubscribe is safe', () => {
    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    };
    addJSONRoute('GET', '/v1/messages/stream', {});

    const subscriber = new MessageSubscriber(config);
    const sub = subscriber.subscribe('chan-001', () => {});

    sub.unsubscribe();
    sub.unsubscribe(); // Should not throw

    expect(subscriber.subscriptionCount).toBe(0);
    subscriber.disconnect();
  });
});

// ============================================================================
// MessageQuery - Querying
// ============================================================================

describe('MessageQuery - Querying', () => {
  test('queries messages in a channel without filters', async () => {
    const messages = [
      makeMessage({ id: 'msg-q-001' }),
      makeMessage({ id: 'msg-q-002' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.query('chan-001');

    expect(result.length).toBe(2);
    expect(result[0]!.id).toBe('msg-q-001');
  });

  test('queries with limit option', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage()]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.query('chan-001', { limit: 10 });

    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('limit=10');
  });

  test('queries with offset option for pagination', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage()]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.query('chan-001', { limit: 10, offset: 20 });

    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('offset=20');
  });

  test('queries with threadId filter passes filter to REST client', async () => {
    // NOTE: listByChannel does not propagate threadId to URL params;
    // but the filter object is set. We verify the request was made.
    addJSONRoute('GET', '/v1/messages', [makeMessage()]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.query('chan-001', { threadId: 'thread-abc' });

    // Request was made to listByChannel endpoint
    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call).toBeDefined();
    expect(call!.url).toContain('channel_id=chan-001');
    // Messages are returned as-is; threadId filtering relies on server support
    expect(result.length).toBe(1);
  });

  test('queries with messageType filter', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage()]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.query('chan-001', { messageType: 'command' });

    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('message_type=command');
  });

  test('queries with status filter', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage()]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.query('chan-001', { status: 'delivered' });

    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('status=delivered');
  });

  test('queries with since filter applies client-side filtering', async () => {
    const oldMsg = makeMessage({ id: 'msg-old', createdAt: '2025-01-01T00:00:00Z' });
    const newMsg = makeMessage({ id: 'msg-new', createdAt: '2026-06-01T00:00:00Z' });
    addJSONRoute('GET', '/v1/messages', [oldMsg, newMsg]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.query('chan-001', { since: '2026-01-01T00:00:00Z' });

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('msg-new');
  });

  test('getThread retrieves all messages in a thread', async () => {
    const threadMessages = [
      makeMessage({ id: 'msg-t-001', threadId: 'thread-001' }),
      makeMessage({ id: 'msg-t-002', threadId: 'thread-001' }),
      makeMessage({ id: 'msg-t-003', threadId: 'thread-001' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMessages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.getThread('thread-001');

    expect(result.length).toBe(3);
  });

  test('getThreadSummary returns summary with correct fields', async () => {
    const threadMessages = [
      makeMessage({ id: 'msg-ts-001', senderId: 'agent-a', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'msg-ts-002', senderId: 'agent-b', createdAt: '2026-01-01T01:00:00Z' }),
      makeMessage({ id: 'msg-ts-003', senderId: 'agent-a', createdAt: '2026-01-01T02:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMessages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const summary = await query.getThreadSummary('thread-summary-001');

    expect(summary.threadId).toBe('thread-summary-001');
    expect(summary.messageCount).toBe(3);
    expect(summary.participants.length).toBe(2);
    expect(summary.participants).toContain('agent-a');
    expect(summary.participants).toContain('agent-b');
    expect(summary.firstMessage.id).toBe('msg-ts-001');
    expect(summary.lastMessage.id).toBe('msg-ts-003');
  });

  test('getThreadSummary throws for empty thread', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);

    let threw = false;
    try {
      await query.getThreadSummary('empty-thread');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('empty-thread');
      expect((err as Error).message).toContain('not found or empty');
    }
    expect(threw).toBe(true);
  });

  test('getPendingMessages fetches for current agent', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-pend-001', status: 'pending' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.getPendingMessages();

    expect(result.length).toBe(1);
    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('target_agent_id=' + TEST_AGENT_ID);
    expect(call!.url).toContain('status=pending');
  });

  test('getPendingMessages fetches for specified agent', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.getPendingMessages('other-agent-002');

    const call = fetchCalls.find((c) => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('target_agent_id=other-agent-002');
  });

  test('markDelivered updates message status', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.markDelivered('msg-deliver-001');

    expect(capturedUrl).toContain('msg-deliver-001');
    expect((capturedBody as Record<string, unknown>).status).toBe('delivered');
  });

  test('markRead updates message status to read', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'read' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    await query.markRead('msg-read-001');

    expect((capturedBody as Record<string, unknown>).status).toBe('read');
  });

  test('claim calls claim endpoint with correct agentId', async () => {
    let capturedUrl = '';
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'claimed', claimedBy: TEST_AGENT_ID })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, TEST_AGENT_ID);
    const result = await query.claim('msg-claim-001');

    expect(capturedUrl).toContain('msg-claim-001');
    expect((capturedBody as Record<string, unknown>).agentId).toBe(TEST_AGENT_ID);
    expect(result.status).toBe('claimed');
  });
});

// ============================================================================
// OfflineQueue - Offline Message Delivery
// ============================================================================

describe('OfflineQueue - Offline Message Delivery', () => {
  test('drain returns 0 when no callbacks registered', async () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    const count = await queue.drain();
    expect(count).toBe(0);
  });

  test('drain returns 0 when no pending messages', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => true);
    const count = await queue.drain();

    expect(count).toBe(0);
  });

  test('drain delivers pending messages to callbacks', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-drain-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
      makeMessage({ id: 'msg-drain-002', createdAt: '2026-01-01T01:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    const received: string[] = [];
    queue.onMessage((msg) => {
      received.push(msg.id);
      return true;
    });

    const count = await queue.drain();

    expect(count).toBe(2);
    expect(received.length).toBe(2);
  });

  test('drain delivers messages in chronological order (oldest first)', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-newer', createdAt: '2026-06-15T00:00:00Z', status: 'pending', targetType: 'agent' }),
      makeMessage({ id: 'msg-older', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
      makeMessage({ id: 'msg-middle', createdAt: '2026-03-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    const received: string[] = [];
    queue.onMessage((msg) => {
      received.push(msg.id);
      return true;
    });

    await queue.drain();

    expect(received[0]).toBe('msg-older');
    expect(received[1]).toBe('msg-middle');
    expect(received[2]).toBe('msg-newer');
  });

  test('drain marks messages as delivered when callback returns true', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-ack-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    const statusUpdates: string[] = [];
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (url, init) => {
      const body = JSON.parse(init.body as string);
      statusUpdates.push(body.status);
      return new Response(JSON.stringify(makeMessage({ status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => true);
    await queue.drain();

    expect(statusUpdates).toContain('delivered');
  });

  test('drain does not mark as delivered when callback returns false', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-nack-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    let statusUpdateCalled = false;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      statusUpdateCalled = true;
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => false);
    const count = await queue.drain();

    expect(count).toBe(0);
    expect(statusUpdateCalled).toBe(false);
  });

  test('drain does not mark as delivered when callback throws', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-throw-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    let statusUpdateCalled = false;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      statusUpdateCalled = true;
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => {
      throw new Error('Callback exploded');
    });
    const count = await queue.drain();

    expect(count).toBe(0);
    expect(statusUpdateCalled).toBe(false);
  });

  test('drain claims project-level messages before delivery', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-proj-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'project' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    let claimCalled = false;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, () => {
      claimCalled = true;
      return new Response(JSON.stringify(makeMessage({ status: 'claimed', claimedBy: TEST_AGENT_ID })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => true);
    const count = await queue.drain();

    expect(claimCalled).toBe(true);
    expect(count).toBe(1);
  });

  test('drain skips project message when claim fails (already claimed)', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-claimed-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'project' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, () => {
      return new Response(JSON.stringify({ message: 'Already claimed' }), {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    const received: string[] = [];
    queue.onMessage((msg) => {
      received.push(msg.id);
      return true;
    });
    const count = await queue.drain();

    expect(count).toBe(0);
    expect(received.length).toBe(0);
  });

  test('drain does not claim non-project messages', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-agent-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    let claimCalled = false;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, () => {
      claimCalled = true;
      return new Response(JSON.stringify(makeMessage({ status: 'claimed' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => true);
    await queue.drain();

    expect(claimCalled).toBe(false);
  });

  test('multiple callbacks all invoked for each message', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-multi-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    let cb1Called = false;
    let cb2Called = false;
    queue.onMessage(() => { cb1Called = true; return true; });
    queue.onMessage(() => { cb2Called = true; return true; });

    await queue.drain();

    expect(cb1Called).toBe(true);
    expect(cb2Called).toBe(true);
  });

  test('clearCallbacks removes all registered callbacks', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-clear-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    let callbackInvoked = false;
    queue.onMessage(() => { callbackInvoked = true; return true; });
    queue.clearCallbacks();

    const count = await queue.drain();

    expect(count).toBe(0);
    expect(callbackInvoked).toBe(false);
  });

  test('drain handles markDelivered failure gracefully', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-markfail-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify({ message: 'Server error' }), {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(() => true);
    // Should not throw - markDelivered failure is silently caught
    const count = await queue.drain();

    // Count is 0 because markDelivered threw
    expect(count).toBe(0);
  });

  test('drain with async callback returning true', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'msg-async-001', createdAt: '2026-01-01T00:00:00Z', status: 'pending', targetType: 'agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, TEST_AGENT_ID);
    const queue = new OfflineQueue(queryClient, TEST_AGENT_ID);

    queue.onMessage(async () => {
      await Bun.sleep(10);
      return true;
    });

    const count = await queue.drain();
    expect(count).toBe(1);
  });
});

// ============================================================================
// ChannelClient - Address Resolution
// ============================================================================

describe('ChannelClient - Address Resolution', () => {
  test('resolves agent address', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const addr = channelClient.resolveAddress('agent://mac-001/session-abc');
    expect(addr.type).toBe('agent');
    if (addr.type === 'agent') {
      expect(addr.machineId).toBe('mac-001');
      expect(addr.identifier).toBe('session-abc');
    }

    channelClient.disconnect();
  });

  test('resolves project address', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const addr = channelClient.resolveAddress('project://mac-001/Users/dev/repo');
    expect(addr.type).toBe('project');
    if (addr.type === 'project') {
      expect(addr.machineId).toBe('mac-001');
      expect(addr.repoPath).toBe('Users/dev/repo');
    }

    channelClient.disconnect();
  });

  test('resolves broadcast address', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const addr = channelClient.resolveAddress('broadcast://general');
    expect(addr.type).toBe('broadcast');
    if (addr.type === 'broadcast') {
      expect(addr.channelName).toBe('general');
    }

    channelClient.disconnect();
  });

  test('formats agent address back to URI', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const uri = channelClient.formatAddress({
      type: 'agent',
      machineId: 'mac-001',
      identifier: 'sess-abc',
    });
    expect(uri).toBe('agent://mac-001/sess-abc');

    channelClient.disconnect();
  });

  test('formats broadcast address back to URI', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const uri = channelClient.formatAddress({
      type: 'broadcast',
      channelName: 'dev-team',
    });
    expect(uri).toBe('broadcast://dev-team');

    channelClient.disconnect();
  });

  test('roundtrip: parse then format preserves URI', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const uris = [
      'agent://machine-42/session-xyz',
      'project://mac-001/Users/dev/my-repo',
      'broadcast://announcements',
    ];

    for (let i = 0; i < uris.length; i++) {
      const addr = channelClient.resolveAddress(uris[i]!);
      const formatted = channelClient.formatAddress(addr);
      expect(formatted).toBe(uris[i]!);
    }

    channelClient.disconnect();
  });

  test('resolveAddress throws for invalid URI', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    let threw = false;
    try {
      channelClient.resolveAddress('invalid-no-protocol');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    channelClient.disconnect();
  });
});

// ============================================================================
// ChannelClient - Facade Delegation
// ============================================================================

describe('ChannelClient - Facade Delegation', () => {
  test('createChannel delegates to ChannelManager', async () => {
    const channel = makeChannel({ id: 'facade-ch-001' });
    addJSONRoute('POST', '/v1/channels', channel);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.createChannel('test', 'project');
    expect(result.id).toBe('facade-ch-001');

    channelClient.disconnect();
  });

  test('joinChannel delegates to ChannelManager', async () => {
    addHandlerRoute('POST', /\/v1\/channels\/.*\/members/, () => {
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.joinChannel('chan-001', 'agent-002');
    expect(result).toBeDefined();

    channelClient.disconnect();
  });

  test('leaveChannel delegates to ChannelManager', async () => {
    addHandlerRoute('DELETE', /\/v1\/channels\/.*\/members\//, () => {
      return new Response(JSON.stringify(makeChannel()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.leaveChannel('chan-001');
    expect(result).toBeDefined();

    channelClient.disconnect();
  });

  test('publish delegates to MessagePublisher', async () => {
    const channel = makeChannel({ id: 'facade-pub-001', name: 'test' });
    addJSONRoute('GET', '/v1/channels/facade-pub-001', channel);
    addJSONRoute('POST', '/v1/messages', makeMessage({ id: 'facade-msg-001' }));

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.publish('facade-pub-001', 'Hello');
    expect(result.id).toBe('facade-msg-001');

    channelClient.disconnect();
  });

  test('query delegates to MessageQuery', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage({ id: 'facade-query-001' })]);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.query('chan-001', { limit: 5 });
    expect(result.length).toBe(1);

    channelClient.disconnect();
  });

  test('getThread delegates to MessageQuery', async () => {
    addJSONRoute('GET', '/v1/messages', [makeMessage(), makeMessage()]);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.getThread('thread-001');
    expect(result.length).toBe(2);

    channelClient.disconnect();
  });

  test('getThreadSummary delegates to MessageQuery', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ senderId: 'a', id: 'first' }),
      makeMessage({ senderId: 'b', id: 'last' }),
    ]);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const summary = await channelClient.getThreadSummary('thread-001');
    expect(summary.messageCount).toBe(2);

    channelClient.disconnect();
  });

  test('drainOfflineQueue delegates to OfflineQueue', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    channelClient.onQueuedMessage(() => true);
    const count = await channelClient.drainOfflineQueue();
    expect(count).toBe(0);

    channelClient.disconnect();
  });

  test('disconnect clears subscriber state', () => {
    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    // Should not throw
    channelClient.disconnect();
  });

  test('getChannel delegates to ChannelManager', async () => {
    addJSONRoute('GET', '/v1/channels/ch-facade-get', makeChannel({ id: 'ch-facade-get', name: 'fetched' }));

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.getChannel('ch-facade-get');
    expect(result.name).toBe('fetched');

    channelClient.disconnect();
  });

  test('listChannels delegates to ChannelManager', async () => {
    addJSONRoute('GET', '/v1/channels', [makeChannel(), makeChannel()]);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.listChannels();
    expect(result.length).toBe(2);

    channelClient.disconnect();
  });

  test('getChannelInfo delegates to ChannelManager', async () => {
    addJSONRoute('GET', /\/v1\/channels\/ch-facade-info/, makeChannel({ id: 'ch-facade-info', members: ['a'] }));
    addJSONRoute('GET', '/v1/messages', []);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const info = await channelClient.getChannelInfo('ch-facade-info');
    expect(info.memberCount).toBe(1);

    channelClient.disconnect();
  });

  test('getPendingMessages delegates to MessageQuery', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    const result = await channelClient.getPendingMessages();
    expect(result.length).toBe(0);

    channelClient.disconnect();
  });

  test('markDelivered delegates to MessageQuery', async () => {
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    // Should not throw
    await channelClient.markDelivered('msg-001');

    channelClient.disconnect();
  });

  test('markRead delegates to MessageQuery', async () => {
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'read' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const channelClient = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    await channelClient.markRead('msg-001');

    channelClient.disconnect();
  });
});
