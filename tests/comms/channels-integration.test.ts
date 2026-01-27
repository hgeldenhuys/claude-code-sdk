/**
 * Integration Tests for End-to-End Channel Messaging (COMMS-003 Task 10)
 *
 * Covers:
 * - Full lifecycle: create -> join -> publish -> subscribe -> leave -> archive
 * - Real-time delivery: online agent receives via SSE callback
 * - Offline queueing: messages queued pending, delivered on drain
 * - Threading: send message, reply with threadId, query returns both
 * - Multi-channel: agent subscribed to 3 channels receives correct messages
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { ChannelClient } from '../../src/comms/channels/channel-client';
import { ChannelManager } from '../../src/comms/channels/channel-manager';
import { MessagePublisher } from '../../src/comms/channels/publisher';
import { MessageSubscriber } from '../../src/comms/channels/subscriber';
import { MessageQuery } from '../../src/comms/channels/query';
import { OfflineQueue } from '../../src/comms/channels/offline-queue';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Channel, Message } from '../../src/comms/protocol/types';
import type { ChannelConfig } from '../../src/comms/channels/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-integration.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_integration';
const AGENT_A = 'agent-alice-001';
const AGENT_B = 'agent-bob-002';
const AGENT_C = 'agent-charlie-003';

let msgIdCounter = 0;
let chanIdCounter = 0;

function nextMsgId(): string {
  return `msg-int-${++msgIdCounter}`;
}

function nextChanId(): string {
  return `chan-int-${++chanIdCounter}`;
}

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: nextChanId(),
    name: 'integration-channel',
    type: 'project',
    members: [AGENT_A, AGENT_B],
    createdBy: AGENT_A,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: nextMsgId(),
    channelId: 'chan-int-001',
    senderId: AGENT_A,
    targetType: 'broadcast',
    targetAddress: 'broadcast://integration-channel',
    messageType: 'chat',
    content: 'Integration test message',
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

    // Default fallbacks
    if (method === 'GET') {
      return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
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

/**
 * Create a long-lived SSE stream.
 */
function createLiveSSEStream(): {
  stream: ReadableStream<Uint8Array>;
  push: (data: string) => void;
  close: () => void;
} {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  return {
    stream,
    push: (data: string) => {
      if (controller) {
        try { controller.enqueue(encoder.encode(data)); } catch { /* closed */ }
      }
    },
    close: () => {
      if (controller) {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  };
}

function addLiveSSERoute(pathPattern: string | RegExp): ReturnType<typeof createLiveSSEStream> {
  const live = createLiveSSEStream();
  routes.push({
    method: 'GET',
    pathPattern,
    handler: () => {
      return new Response(live.stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    },
  });
  return live;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let liveStream: ReturnType<typeof createLiveSSEStream> | null = null;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  routes = [];
  fetchCalls = [];
  msgIdCounter = 0;
  chanIdCounter = 0;
  liveStream = null;
  setupMockFetch();
});

afterEach(() => {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
  globalThis.fetch = originalFetch;
  routes = [];
  fetchCalls = [];
});

// ============================================================================
// Full Lifecycle
// ============================================================================

describe('Channel Integration - Full Lifecycle', () => {
  test('create -> join -> publish -> query -> leave -> archive', async () => {
    // Step 1: Create channel
    const channel = makeChannel({ id: 'lifecycle-ch-001', name: 'lifecycle-test', type: 'project', members: [] });
    addHandlerRoute('POST', '/v1/channels', (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ ...channel, name: body.name, type: body.type, createdBy: body.createdBy }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, AGENT_A);

    const created = await manager.createChannel('lifecycle-test', 'project');
    expect(created.name).toBe('lifecycle-test');
    expect(created.type).toBe('project');

    // Step 2: Join channel
    // Clear routes and re-add specific ones to prevent pattern conflicts
    routes = [];
    setupMockFetch();
    const joinedChannel = { ...channel, members: [AGENT_A, AGENT_B] };
    addHandlerRoute('POST', /\/v1\/channels\/.*\/members/, () => {
      return new Response(JSON.stringify(joinedChannel), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const joined = await manager.joinChannel('lifecycle-ch-001', AGENT_B);
    expect(joined.members).toContain(AGENT_B);

    // Step 3: Publish a message
    addJSONRoute('GET', '/v1/channels/lifecycle-ch-001', joinedChannel);
    const sentMsg = makeMessage({ channelId: 'lifecycle-ch-001', senderId: AGENT_A, content: 'Hello lifecycle!' });
    addHandlerRoute('POST', '/v1/messages', () => {
      return new Response(JSON.stringify(sentMsg), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const publisher = new MessagePublisher(client, AGENT_A);
    const published = await publisher.publish('lifecycle-ch-001', 'Hello lifecycle!');
    expect(published.content).toBe('Hello lifecycle!');

    // Step 4: Query messages
    addJSONRoute('GET', '/v1/messages', [sentMsg]);
    const query = new MessageQuery(client, AGENT_B);
    const history = await query.query('lifecycle-ch-001');
    expect(history.length).toBe(1);
    expect(history[0]!.content).toBe('Hello lifecycle!');

    // Step 5: Leave channel
    const leftChannel = { ...channel, members: [AGENT_A] };
    addHandlerRoute('DELETE', /\/v1\/channels\/.*\/members\//, () => {
      return new Response(JSON.stringify(leftChannel), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const left = await manager.leaveChannel('lifecycle-ch-001', AGENT_B);
    expect(left.members).not.toContain(AGENT_B);

    // Step 6: Archive channel
    addJSONRoute('GET', '/v1/channels/lifecycle-ch-001', leftChannel);
    let archiveMessageSent = false;
    // Override POST /v1/messages to capture archive command
    routes = routes.filter((r) => !(r.method === 'POST' && typeof r.pathPattern === 'string' && r.pathPattern === '/v1/messages'));
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      const body = JSON.parse(init.body as string);
      if (body.messageType === 'command') {
        const content = JSON.parse(body.content);
        if (content.action === 'channel.archive') {
          archiveMessageSent = true;
        }
      }
      return new Response(JSON.stringify(makeMessage()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await manager.archiveChannel('lifecycle-ch-001');
    expect(archiveMessageSent).toBe(true);
  });

  test('create channel with initial members has correct membership', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/channels', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeChannel({
        members: [AGENT_A, AGENT_B, AGENT_C],
      })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, AGENT_A);
    const ch = await manager.createChannel('team', 'project', [AGENT_A, AGENT_B, AGENT_C]);

    expect(ch.members.length).toBe(3);
    const body = capturedBody as Record<string, unknown>;
    const members = body.members as string[];
    expect(members).toContain(AGENT_A);
    expect(members).toContain(AGENT_B);
    expect(members).toContain(AGENT_C);
  });

  test('channel info reflects current state after operations', async () => {
    const channel = makeChannel({
      id: 'info-lifecycle-001',
      name: 'info-test',
      members: [AGENT_A, AGENT_B, AGENT_C],
    });
    const lastMsg = makeMessage({ id: 'latest-msg', content: 'Latest', channelId: 'info-lifecycle-001' });

    addJSONRoute('GET', '/v1/channels/info-lifecycle-001', channel);
    addJSONRoute('GET', '/v1/messages', [lastMsg]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, AGENT_A);

    const info = await manager.getChannelInfo('info-lifecycle-001');
    expect(info.memberCount).toBe(3);
    expect(info.lastMessage).not.toBeNull();
    expect(info.lastMessage!.content).toBe('Latest');
  });

  test('listChannels returns created channels', async () => {
    const channels = [
      makeChannel({ name: 'alpha', type: 'project' }),
      makeChannel({ name: 'beta', type: 'broadcast' }),
      makeChannel({ name: 'gamma', type: 'direct' }),
    ];
    addJSONRoute('GET', '/v1/channels', channels);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const manager = new ChannelManager(client, AGENT_A);

    const result = await manager.listChannels();
    expect(result.length).toBe(3);
  });

  test('full ChannelClient facade lifecycle', async () => {
    const channel = makeChannel({ id: 'facade-lifecycle-001', name: 'facade-test' });
    addJSONRoute('POST', '/v1/channels', channel);
    addHandlerRoute('POST', /\/v1\/channels\/.*\/members/, () => {
      return new Response(JSON.stringify({ ...channel, members: [AGENT_A, AGENT_B] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    addJSONRoute('GET', '/v1/channels/facade-lifecycle-001', channel);
    addJSONRoute('POST', '/v1/messages', makeMessage({ content: 'Facade hello' }));
    addJSONRoute('GET', '/v1/messages', [makeMessage({ content: 'Facade hello' })]);
    addHandlerRoute('DELETE', /\/v1\/channels\/.*\/members\//, () => {
      return new Response(JSON.stringify({ ...channel, members: [AGENT_A] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const cc = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    });

    // Create
    const created = await cc.createChannel('facade-test', 'project');
    expect(created.id).toBe('facade-lifecycle-001');

    // Join
    const joined = await cc.joinChannel('facade-lifecycle-001', AGENT_B);
    expect(joined.members).toContain(AGENT_B);

    // Publish
    const msg = await cc.publish('facade-lifecycle-001', 'Facade hello');
    expect(msg.content).toBe('Facade hello');

    // Query
    const history = await cc.query('facade-lifecycle-001');
    expect(history.length).toBe(1);

    // Leave
    const left = await cc.leaveChannel('facade-lifecycle-001', AGENT_B);
    expect(left.members).not.toContain(AGENT_B);

    cc.disconnect();
  });
});

// ============================================================================
// Real-Time Delivery
// ============================================================================

describe('Channel Integration - Real-Time Delivery', () => {
  test('subscriber receives message pushed via SSE', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);
    const received: Message[] = [];
    subscriber.subscribe('chan-realtime-001', (msg) => received.push(msg));

    await Bun.sleep(100);

    // Push a message through SSE
    const msg = makeMessage({
      channelId: 'chan-realtime-001',
      content: 'Real-time hello!',
      senderId: AGENT_B,
    });
    live.push(`data: ${JSON.stringify(msg)}\n\n`);

    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0]!.content).toBe('Real-time hello!');
    expect(received[0]!.senderId).toBe(AGENT_B);

    subscriber.disconnect();
  });

  test('subscriber filters messages by channelId', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const chan1Messages: Message[] = [];
    const chan2Messages: Message[] = [];
    subscriber.subscribe('chan-filter-001', (msg) => chan1Messages.push(msg));
    subscriber.subscribe('chan-filter-002', (msg) => chan2Messages.push(msg));

    await Bun.sleep(100);

    // Push messages for different channels
    const msg1 = makeMessage({ channelId: 'chan-filter-001', content: 'For channel 1' });
    const msg2 = makeMessage({ channelId: 'chan-filter-002', content: 'For channel 2' });
    const msg3 = makeMessage({ channelId: 'chan-filter-003', content: 'For channel 3 (unsubscribed)' });

    live.push(`data: ${JSON.stringify(msg1)}\n\n`);
    live.push(`data: ${JSON.stringify(msg2)}\n\n`);
    live.push(`data: ${JSON.stringify(msg3)}\n\n`);

    await Bun.sleep(200);

    expect(chan1Messages.length).toBe(1);
    expect(chan1Messages[0]!.content).toBe('For channel 1');
    expect(chan2Messages.length).toBe(1);
    expect(chan2Messages[0]!.content).toBe('For channel 2');

    subscriber.disconnect();
  });

  test('multiple subscribers on same channel all receive message', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const received1: Message[] = [];
    const received2: Message[] = [];
    const received3: Message[] = [];
    subscriber.subscribe('chan-multi-sub-001', (msg) => received1.push(msg));
    subscriber.subscribe('chan-multi-sub-001', (msg) => received2.push(msg));
    subscriber.subscribe('chan-multi-sub-001', (msg) => received3.push(msg));

    await Bun.sleep(100);

    const msg = makeMessage({ channelId: 'chan-multi-sub-001', content: 'Broadcast to all' });
    live.push(`data: ${JSON.stringify(msg)}\n\n`);

    await Bun.sleep(200);

    expect(received1.length).toBe(1);
    expect(received2.length).toBe(1);
    expect(received3.length).toBe(1);
    expect(received1[0]!.content).toBe('Broadcast to all');

    subscriber.disconnect();
  });

  test('unsubscribed callback does not receive further messages', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const received: Message[] = [];
    const sub = subscriber.subscribe('chan-unsub-001', (msg) => received.push(msg));

    await Bun.sleep(100);

    // First message arrives
    const msg1 = makeMessage({ channelId: 'chan-unsub-001', content: 'Before unsub' });
    live.push(`data: ${JSON.stringify(msg1)}\n\n`);
    await Bun.sleep(100);

    expect(received.length).toBe(1);

    // Unsubscribe
    sub.unsubscribe();

    // Second message should NOT arrive
    const msg2 = makeMessage({ channelId: 'chan-unsub-001', content: 'After unsub' });
    live.push(`data: ${JSON.stringify(msg2)}\n\n`);
    await Bun.sleep(100);

    expect(received.length).toBe(1);
    expect(received[0]!.content).toBe('Before unsub');

    subscriber.disconnect();
  });

  test('callback errors do not prevent other callbacks from receiving', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const received: Message[] = [];
    // First callback throws
    subscriber.subscribe('chan-err-001', () => { throw new Error('Callback error'); });
    // Second callback should still work
    subscriber.subscribe('chan-err-001', (msg) => received.push(msg));

    await Bun.sleep(100);

    const msg = makeMessage({ channelId: 'chan-err-001', content: 'Still delivered' });
    live.push(`data: ${JSON.stringify(msg)}\n\n`);

    await Bun.sleep(200);

    expect(received.length).toBe(1);
    expect(received[0]!.content).toBe('Still delivered');

    subscriber.disconnect();
  });
});

// ============================================================================
// Offline Queueing
// ============================================================================

describe('Channel Integration - Offline Queueing', () => {
  test('drain fetches and delivers pending messages', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'offline-001', content: 'Queued 1', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'offline-002', content: 'Queued 2', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T01:00:00Z' }),
      makeMessage({ id: 'offline-003', content: 'Queued 3', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T02:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, AGENT_A);
    const queue = new OfflineQueue(queryClient, AGENT_A);

    const deliveredContent: string[] = [];
    queue.onMessage((msg) => {
      deliveredContent.push(msg.content);
      return true;
    });

    const count = await queue.drain();

    expect(count).toBe(3);
    expect(deliveredContent.length).toBe(3);
    // Verify chronological order
    expect(deliveredContent[0]).toBe('Queued 1');
    expect(deliveredContent[1]).toBe('Queued 2');
    expect(deliveredContent[2]).toBe('Queued 3');
  });

  test('drain with mixed acknowledged and rejected messages', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'mix-001', content: 'Accept', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'mix-002', content: 'Reject', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T01:00:00Z' }),
      makeMessage({ id: 'mix-003', content: 'Accept', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T02:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    const markedDelivered: string[] = [];
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (url) => {
      // Extract message ID from URL
      const match = url.match(/\/v1\/messages\/([^/]+)\/status/);
      if (match) markedDelivered.push(match[1]!);
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, AGENT_A);
    const queue = new OfflineQueue(queryClient, AGENT_A);

    queue.onMessage((msg) => msg.content !== 'Reject');
    const count = await queue.drain();

    expect(count).toBe(2);
    expect(markedDelivered).toContain('mix-001');
    expect(markedDelivered).toContain('mix-003');
    expect(markedDelivered).not.toContain('mix-002');
  });

  test('drain claims project messages, skips already claimed', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'claim-ok-001', status: 'pending', targetType: 'project', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'claim-fail-002', status: 'pending', targetType: 'project', createdAt: '2026-01-01T01:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    // First claim succeeds, second fails (already claimed by another agent)
    let claimCallCount = 0;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, (url) => {
      claimCallCount++;
      if (url.includes('claim-fail-002')) {
        return new Response(JSON.stringify({ message: 'Already claimed' }), {
          status: 409,
          statusText: 'Conflict',
          headers: { 'Content-Type': 'application/json' },
        });
      }
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
    const queryClient = new MessageQuery(client, AGENT_A);
    const queue = new OfflineQueue(queryClient, AGENT_A);

    const deliveredIds: string[] = [];
    queue.onMessage((msg) => {
      deliveredIds.push(msg.id);
      return true;
    });
    const count = await queue.drain();

    expect(claimCallCount).toBe(2);
    expect(count).toBe(1);
    expect(deliveredIds).toContain('claim-ok-001');
    expect(deliveredIds).not.toContain('claim-fail-002');
  });

  test('ChannelClient drainOfflineQueue integrates with onQueuedMessage', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'facade-q-001', content: 'Queued via facade', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, () => {
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const cc = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    });

    const received: string[] = [];
    cc.onQueuedMessage((msg) => {
      received.push(msg.content);
      return true;
    });

    const count = await cc.drainOfflineQueue();

    expect(count).toBe(1);
    expect(received[0]).toBe('Queued via facade');

    cc.disconnect();
  });

  test('drain with no registered callbacks returns 0', async () => {
    const pendingMsgs = [
      makeMessage({ id: 'no-cb-001', status: 'pending', targetType: 'agent', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', pendingMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const queryClient = new MessageQuery(client, AGENT_A);
    const queue = new OfflineQueue(queryClient, AGENT_A);

    const count = await queue.drain();
    expect(count).toBe(0);
  });
});

// ============================================================================
// Threading
// ============================================================================

describe('Channel Integration - Threading', () => {
  test('send message then reply with threadId', async () => {
    const channel = makeChannel({ id: 'thread-ch-001', name: 'threaded' });
    addJSONRoute('GET', '/v1/channels/thread-ch-001', channel);

    const originalMsg = makeMessage({
      id: 'thread-orig-001',
      channelId: 'thread-ch-001',
      senderId: AGENT_A,
      content: 'Original question',
      threadId: null,
    });

    const replyMsg = makeMessage({
      id: 'thread-reply-001',
      channelId: 'thread-ch-001',
      senderId: AGENT_B,
      content: 'Reply to question',
      threadId: 'thread-orig-001',
    });

    let publishCount = 0;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      publishCount++;
      const body = JSON.parse(init.body as string);
      if (publishCount === 1) {
        return new Response(JSON.stringify(originalMsg), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ...replyMsg, threadId: body.threadId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const publisherA = new MessagePublisher(client, AGENT_A);
    const publisherB = new MessagePublisher(client, AGENT_B);

    // Send original
    const orig = await publisherA.publish('thread-ch-001', 'Original question');
    expect(orig.id).toBe('thread-orig-001');

    // Reply with threadId
    const reply = await publisherB.publish('thread-ch-001', 'Reply to question', {
      threadId: orig.id,
    });
    expect(reply.threadId).toBe('thread-orig-001');
  });

  test('getThread returns all messages in thread order', async () => {
    const threadMsgs = [
      makeMessage({ id: 'th-001', content: 'First', senderId: AGENT_A, threadId: 'th-001', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'th-002', content: 'Second', senderId: AGENT_B, threadId: 'th-001', createdAt: '2026-01-01T01:00:00Z' }),
      makeMessage({ id: 'th-003', content: 'Third', senderId: AGENT_A, threadId: 'th-001', createdAt: '2026-01-01T02:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, AGENT_A);

    const thread = await query.getThread('th-001');
    expect(thread.length).toBe(3);
    expect(thread[0]!.content).toBe('First');
    expect(thread[2]!.content).toBe('Third');
  });

  test('getThreadSummary returns correct participants and boundaries', async () => {
    const threadMsgs = [
      makeMessage({ id: 'ts-001', senderId: AGENT_A, createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'ts-002', senderId: AGENT_B, createdAt: '2026-01-01T01:00:00Z' }),
      makeMessage({ id: 'ts-003', senderId: AGENT_C, createdAt: '2026-01-01T02:00:00Z' }),
      makeMessage({ id: 'ts-004', senderId: AGENT_A, createdAt: '2026-01-01T03:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, AGENT_A);

    const summary = await query.getThreadSummary('thread-summary-int');
    expect(summary.threadId).toBe('thread-summary-int');
    expect(summary.messageCount).toBe(4);
    expect(summary.participants.length).toBe(3);
    expect(summary.participants).toContain(AGENT_A);
    expect(summary.participants).toContain(AGENT_B);
    expect(summary.participants).toContain(AGENT_C);
    expect(summary.firstMessage.id).toBe('ts-001');
    expect(summary.lastMessage.id).toBe('ts-004');
  });

  test('thread with single participant has 1 participant', async () => {
    const threadMsgs = [
      makeMessage({ id: 'solo-001', senderId: AGENT_A }),
      makeMessage({ id: 'solo-002', senderId: AGENT_A }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, AGENT_A);

    const summary = await query.getThreadSummary('solo-thread');
    expect(summary.participants.length).toBe(1);
    expect(summary.participants[0]).toBe(AGENT_A);
  });

  test('getThreadSummary throws for nonexistent thread', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const query = new MessageQuery(client, AGENT_A);

    let threw = false;
    try {
      await query.getThreadSummary('nonexistent-thread');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('nonexistent-thread');
    }
    expect(threw).toBe(true);
  });
});

// ============================================================================
// Multi-Channel
// ============================================================================

describe('Channel Integration - Multi-Channel', () => {
  test('agent subscribed to 3 channels receives correct messages on each', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const alphaMessages: Message[] = [];
    const betaMessages: Message[] = [];
    const gammaMessages: Message[] = [];

    subscriber.subscribe('chan-alpha', (msg) => alphaMessages.push(msg));
    subscriber.subscribe('chan-beta', (msg) => betaMessages.push(msg));
    subscriber.subscribe('chan-gamma', (msg) => gammaMessages.push(msg));

    await Bun.sleep(100);

    // Push messages interleaved across channels
    const msgs = [
      makeMessage({ channelId: 'chan-alpha', content: 'Alpha 1' }),
      makeMessage({ channelId: 'chan-beta', content: 'Beta 1' }),
      makeMessage({ channelId: 'chan-gamma', content: 'Gamma 1' }),
      makeMessage({ channelId: 'chan-alpha', content: 'Alpha 2' }),
      makeMessage({ channelId: 'chan-beta', content: 'Beta 2' }),
      makeMessage({ channelId: 'chan-gamma', content: 'Gamma 2' }),
    ];

    for (let i = 0; i < msgs.length; i++) {
      live.push(`data: ${JSON.stringify(msgs[i])}\n\n`);
    }

    await Bun.sleep(300);

    expect(alphaMessages.length).toBe(2);
    expect(betaMessages.length).toBe(2);
    expect(gammaMessages.length).toBe(2);

    expect(alphaMessages[0]!.content).toBe('Alpha 1');
    expect(alphaMessages[1]!.content).toBe('Alpha 2');
    expect(betaMessages[0]!.content).toBe('Beta 1');
    expect(betaMessages[1]!.content).toBe('Beta 2');
    expect(gammaMessages[0]!.content).toBe('Gamma 1');
    expect(gammaMessages[1]!.content).toBe('Gamma 2');

    subscriber.disconnect();
  });

  test('unsubscribing from one channel does not affect others', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const alphaMessages: Message[] = [];
    const betaMessages: Message[] = [];
    const gammaMessages: Message[] = [];

    const subAlpha = subscriber.subscribe('chan-alpha', (msg) => alphaMessages.push(msg));
    subscriber.subscribe('chan-beta', (msg) => betaMessages.push(msg));
    subscriber.subscribe('chan-gamma', (msg) => gammaMessages.push(msg));

    await Bun.sleep(100);

    // Unsubscribe from alpha
    subAlpha.unsubscribe();

    // Push messages to all 3 channels
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-alpha', content: 'Alpha post-unsub' }))}\n\n`);
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-beta', content: 'Beta still active' }))}\n\n`);
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-gamma', content: 'Gamma still active' }))}\n\n`);

    await Bun.sleep(200);

    // Alpha should not have received (unsubscribed)
    expect(alphaMessages.length).toBe(0);
    // Beta and Gamma should still receive
    expect(betaMessages.length).toBe(1);
    expect(gammaMessages.length).toBe(1);

    subscriber.disconnect();
  });

  test('messages for unsubscribed channels are silently dropped', async () => {
    const live = addLiveSSERoute('/v1/messages/stream');
    liveStream = live;

    const config: ChannelConfig = {
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: AGENT_A,
    };

    const subscriber = new MessageSubscriber(config);

    const receivedAll: Message[] = [];
    subscriber.subscribe('chan-only', (msg) => receivedAll.push(msg));

    await Bun.sleep(100);

    // Push messages for subscribed and unsubscribed channels
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-only', content: 'Mine' }))}\n\n`);
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-other', content: 'Not mine' }))}\n\n`);
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-another', content: 'Also not mine' }))}\n\n`);
    live.push(`data: ${JSON.stringify(makeMessage({ channelId: 'chan-only', content: 'Also mine' }))}\n\n`);

    await Bun.sleep(200);

    expect(receivedAll.length).toBe(2);
    expect(receivedAll[0]!.content).toBe('Mine');
    expect(receivedAll[1]!.content).toBe('Also mine');

    subscriber.disconnect();
  });
});
