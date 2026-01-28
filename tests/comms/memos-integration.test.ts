/**
 * Integration Tests for MemoClient Facade and CLI (COMMS-004 Task 10)
 *
 * Covers:
 * - MemoClient facade: compose, inbox, outbox, read, claim, reply, archive, thread
 * - Claiming integration: full lifecycle, failure scenarios
 * - Threading integration: root + reply chains, thread summary
 * - CLI smoke tests: import, arg parsing, validation
 *
 * Uses route-based mock fetch pattern consistent with channels-integration.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoClient } from '../../src/comms/memos/memo-client';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Message } from '../../src/comms/protocol/types';
import type { MemoConfig } from '../../src/comms/memos/types';

// ============================================================================
// Constants
// ============================================================================

const TEST_API_URL = 'https://test-memos-int.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_memos_int';
const TEST_AGENT_ID = 'agent-int-001';
const TEST_CHANNEL_ID = 'chan-int-001';

const DEFAULT_CONFIG: MemoConfig = {
  apiUrl: TEST_API_URL,
  projectKey: TEST_PROJECT_KEY,
  agentId: TEST_AGENT_ID,
  channelId: TEST_CHANNEL_ID,
};

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-001',
    channelId: TEST_CHANNEL_ID,
    senderId: TEST_AGENT_ID,
    targetType: 'agent',
    targetAddress: 'agent://mac-001/other-agent',
    messageType: 'memo',
    content: 'Integration test body',
    metadata: {
      subject: 'Integration Subject',
      category: 'knowledge',
      priority: 'P2',
    },
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
// MemoClient Facade
// ============================================================================

describe('MemoClient Facade', () => {
  test('compose sends memo and returns MemoView', async () => {
    const sentMsg = makeMessage({ id: 'compose-001', content: 'Facade compose' });
    addJSONRoute('POST', '/v1/messages', sentMsg);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Facade Subject',
      body: 'Facade compose',
    });

    expect(result.id).toBe('compose-001');
    expect(result.body).toBe('Facade compose');
  });

  test('inbox returns composed memos', async () => {
    const messages = [
      makeMessage({ id: 'inbox-001' }),
      makeMessage({ id: 'inbox-002' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.inbox();

    expect(result.length).toBe(2);
    expect(result[0]!.id).toBe('inbox-001');
  });

  test('outbox returns memos sent by this agent', async () => {
    const messages = [
      makeMessage({ id: 'out-001', senderId: TEST_AGENT_ID }),
      makeMessage({ id: 'out-002', senderId: 'other-agent' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.outbox();

    expect(result.length).toBe(1);
    expect(result[0]!.senderId).toBe(TEST_AGENT_ID);
  });

  test('read marks memo as read through deliver then markRead', async () => {
    // read() calls deliver first, then markRead
    // deliver: validateTransition (GET) + updateStatus (PATCH)
    // markRead: validateTransition (GET) + updateStatus (PATCH)

    let getCallCount = 0;
    addHandlerRoute('GET', '/v1/messages', () => {
      getCallCount++;
      // First call for deliver validation: memo is 'claimed'
      // Second call for markRead validation: memo is 'delivered'
      const status = getCallCount <= 1 ? 'claimed' : 'delivered';
      return new Response(JSON.stringify([makeMessage({ id: 'read-001', status })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'read-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.read('read-001');

    expect(result.status).toBe('read');
  });

  test('claim returns success for pending project-addressed memo', async () => {
    const claimedMsg = makeMessage({
      id: 'claim-facade-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
      targetType: 'project',
    });
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, claimedMsg);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('claim-facade-001');

    expect(result.success).toBe(true);
    expect(result.memo).toBeDefined();
  });

  test('claim returns failure for already-claimed memo', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already claimed' }, 409);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('already-claimed-facade');

    expect(result.success).toBe(false);
  });

  test('reply creates threaded memo by ID', async () => {
    // reply fetches parent first via listForAgent
    const parentMsg = makeMessage({
      id: 'parent-facade-001',
      senderId: 'other-agent',
      threadId: null,
      targetAddress: 'agent://mac-001/other-agent',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'reply-facade', threadId: 'parent-facade-001' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.reply('parent-facade-001', {
      subject: 'Reply via facade',
      body: 'Reply body',
    });

    expect(result.threadId).toBe('parent-facade-001');
    expect((capturedBody as Record<string, unknown>).threadId).toBe('parent-facade-001');
  });

  test('archive marks memo as expired', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'archive-001', status: 'read' }),
    ]);
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/status/, makeMessage({ id: 'archive-001', status: 'expired' }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.archive('archive-001');

    expect(result.status).toBe('expired');
  });

  test('getThread returns full thread in order', async () => {
    const threadMsgs = [
      makeMessage({ id: 'th-2', createdAt: '2026-01-02T00:00:00Z', threadId: 'thread-xyz' }),
      makeMessage({ id: 'th-1', createdAt: '2026-01-01T00:00:00Z', threadId: 'thread-xyz' }),
      makeMessage({ id: 'th-3', createdAt: '2026-01-03T00:00:00Z', threadId: 'thread-xyz' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.getThread('thread-xyz');

    expect(result.length).toBe(3);
    expect(result[0]!.id).toBe('th-1');
    expect(result[1]!.id).toBe('th-2');
    expect(result[2]!.id).toBe('th-3');
  });

  test('getUnreadCount returns correct count', async () => {
    const messages = [
      makeMessage({ id: 'ur-1', status: 'pending' }),
      makeMessage({ id: 'ur-2', status: 'delivered' }),
      makeMessage({ id: 'ur-3', status: 'read' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const count = await client.getUnreadCount();

    expect(count).toBe(2);
  });

  test('compose with all options (category, priority, threading, TTL)', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'full-opts' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    await client.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Full Options',
      body: 'Complete memo',
      category: 'action-item',
      priority: 'P0',
      threadId: 'thread-full',
      expiresIn: 7200,
    });

    const body = capturedBody as Record<string, unknown>;
    const meta = body.metadata as Record<string, unknown>;
    expect(meta.category).toBe('action-item');
    expect(meta.priority).toBe('P0');
    expect(body.threadId).toBe('thread-full');
    expect(body.expiresAt).toBeDefined();
  });

  test('priority sorting: P0 memos first in inbox', async () => {
    const messages = [
      makeMessage({ id: 'p2-memo', createdAt: '2026-01-01T00:00:00Z', metadata: { subject: 'Low', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'p0-memo', createdAt: '2026-01-01T00:00:00Z', metadata: { subject: 'Critical', category: 'knowledge', priority: 'P0' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.inbox();

    expect(result[0]!.priority).toBe('P0');
    expect(result[1]!.priority).toBe('P2');
  });

  test('unread filter works through facade', async () => {
    const messages = [
      makeMessage({ id: 'unread-1', status: 'pending', metadata: { subject: 'A', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'unread-2', status: 'read', metadata: { subject: 'B', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.inbox({ unreadOnly: true });

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('unread-1');
  });

  test('MemoClient creates REST client from config when not provided', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    // Constructor with config only (no client)
    const client = new MemoClient(DEFAULT_CONFIG);

    const result = await client.inbox();
    expect(result.length).toBe(0);
  });

  test('getThreadSummary through facade', async () => {
    const threadMsgs = [
      makeMessage({ id: 'sum-1', senderId: 'agent-a', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'sum-2', senderId: 'agent-b', createdAt: '2026-01-02T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const summary = await client.getThreadSummary('summary-facade');

    expect(summary.memoCount).toBe(2);
    expect(summary.participants).toContain('agent-a');
    expect(summary.participants).toContain('agent-b');
  });
});

// ============================================================================
// Claiming Integration
// ============================================================================

describe('Claiming Integration', () => {
  test('full lifecycle: compose -> claim -> deliver -> read', async () => {
    // Step 1: Compose
    addJSONRoute('POST', '/v1/messages', makeMessage({
      id: 'lc-001',
      status: 'pending',
    }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const composed = await client.compose({
      to: 'project://mac-001/my-repo',
      subject: 'Lifecycle Test',
      body: 'Full lifecycle test',
    });
    expect(composed.id).toBe('lc-001');

    // Step 2: Claim
    routes = [];
    addJSONRoute('PATCH', /\/v1\/messages\/lc-001\/claim/, makeMessage({
      id: 'lc-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
    }));

    const claimed = await client.claim('lc-001');
    expect(claimed.success).toBe(true);

    // Step 3: Read (deliver + markRead)
    routes = [];
    let getCount = 0;
    addHandlerRoute('GET', '/v1/messages', () => {
      getCount++;
      const status = getCount <= 1 ? 'claimed' : 'delivered';
      return new Response(JSON.stringify([makeMessage({ id: 'lc-001', status })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'lc-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const readResult = await client.read('lc-001');
    expect(readResult.status).toBe('read');
  });

  test('failed claim: second agent gets success=false', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already claimed' }, 409);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('contested-memo');

    expect(result.success).toBe(false);
  });

  test('claimed memo has claimedBy set', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, makeMessage({
      id: 'claimed-by-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
    }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('claimed-by-001');

    expect(result.claimedBy).toBe(TEST_AGENT_ID);
    expect(result.memo!.claimedBy).toBe(TEST_AGENT_ID);
  });

  test('cannot claim already-delivered memo (409)', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already delivered' }, 409);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('delivered-memo');

    expect(result.success).toBe(false);
  });

  test('cannot claim already-read memo (409)', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already read' }, 409);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('read-memo');

    expect(result.success).toBe(false);
  });

  test('cannot claim expired memo (409)', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Expired' }, 409);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('expired-memo');

    expect(result.success).toBe(false);
  });

  test('project-addressed memo claiming returns claim result', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, makeMessage({
      id: 'proj-claim-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
      targetType: 'project',
      targetAddress: 'project://mac-001/my-repo',
    }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.claim('proj-claim-001');

    expect(result.success).toBe(true);
    expect(result.memo!.id).toBe('proj-claim-001');
  });

  test('archive transitions to expired', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'archive-int-001', status: 'delivered' }),
    ]);
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/status/, makeMessage({ id: 'archive-int-001', status: 'expired' }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.archive('archive-int-001');

    expect(result.status).toBe('expired');
  });
});

// ============================================================================
// Threading Integration
// ============================================================================

describe('Threading Integration', () => {
  test('root memo + reply = thread of 2', async () => {
    // Reply flow: fetch parent (GET), send reply (POST)
    const parentMsg = makeMessage({
      id: 'root-int-001',
      senderId: 'agent-a',
      threadId: null,
      targetAddress: 'agent://mac-001/agent-a',
      createdAt: '2026-01-01T00:00:00Z',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);
    addJSONRoute('POST', '/v1/messages', makeMessage({
      id: 'reply-int-001',
      threadId: 'root-int-001',
      createdAt: '2026-01-02T00:00:00Z',
    }));

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const reply = await client.reply('root-int-001', {
      subject: 'Re: Root',
      body: 'Reply body',
    });

    expect(reply.threadId).toBe('root-int-001');

    // Now verify thread retrieval
    routes = [];
    addJSONRoute('GET', '/v1/messages', [
      parentMsg,
      makeMessage({ id: 'reply-int-001', threadId: 'root-int-001', createdAt: '2026-01-02T00:00:00Z' }),
    ]);

    const thread = await client.getThread('root-int-001');
    expect(thread.length).toBe(2);
  });

  test('multi-level: root -> reply -> reply-to-reply = thread of 3', async () => {
    const threadMsgs = [
      makeMessage({ id: 'root-ml', createdAt: '2026-01-01T00:00:00Z', senderId: 'agent-a' }),
      makeMessage({ id: 'reply-1-ml', createdAt: '2026-01-02T00:00:00Z', senderId: 'agent-b', threadId: 'root-ml' }),
      makeMessage({ id: 'reply-2-ml', createdAt: '2026-01-03T00:00:00Z', senderId: 'agent-a', threadId: 'root-ml' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const thread = await client.getThread('root-ml');

    expect(thread.length).toBe(3);
    expect(thread[0]!.id).toBe('root-ml');
    expect(thread[1]!.id).toBe('reply-1-ml');
    expect(thread[2]!.id).toBe('reply-2-ml');
  });

  test('thread summary has all participants', async () => {
    const threadMsgs = [
      makeMessage({ id: 'part-1', senderId: 'agent-a', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'part-2', senderId: 'agent-b', createdAt: '2026-01-02T00:00:00Z' }),
      makeMessage({ id: 'part-3', senderId: 'agent-c', createdAt: '2026-01-03T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const summary = await client.getThreadSummary('multi-participant');

    expect(summary.participants.length).toBe(3);
    expect(summary.participants).toContain('agent-a');
    expect(summary.participants).toContain('agent-b');
    expect(summary.participants).toContain('agent-c');
  });

  test('thread ordered chronologically', async () => {
    const threadMsgs = [
      makeMessage({ id: 'chrono-3', createdAt: '2026-03-01T00:00:00Z' }),
      makeMessage({ id: 'chrono-1', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'chrono-2', createdAt: '2026-02-01T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const thread = await client.getThread('chrono-thread');

    expect(thread[0]!.id).toBe('chrono-1');
    expect(thread[1]!.id).toBe('chrono-2');
    expect(thread[2]!.id).toBe('chrono-3');
  });

  test('reply inherits parent thread scope', async () => {
    // Parent already has a threadId (it's a reply itself)
    const parentMsg = makeMessage({
      id: 'nested-parent',
      threadId: 'root-thread-id',
      senderId: 'agent-b',
      targetAddress: 'agent://mac-001/agent-b',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'nested-reply', threadId: 'root-thread-id' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const result = await client.reply('nested-parent', {
      subject: 'Re: Nested',
      body: 'Nested reply',
    });

    // Should use parent's threadId, not parent's id
    expect((capturedBody as Record<string, unknown>).threadId).toBe('root-thread-id');
    expect(result.threadId).toBe('root-thread-id');
  });

  test('thread summary categories include all unique categories', async () => {
    const threadMsgs = [
      makeMessage({ id: 'mcat-1', createdAt: '2026-01-01T00:00:00Z', metadata: { subject: 'A', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'mcat-2', createdAt: '2026-01-02T00:00:00Z', metadata: { subject: 'B', category: 'finding', priority: 'P2' } }),
      makeMessage({ id: 'mcat-3', createdAt: '2026-01-03T00:00:00Z', metadata: { subject: 'C', category: 'question', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', threadMsgs);

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    const summary = await client.getThreadSummary('cat-thread');

    expect(summary.categories.length).toBe(3);
    expect(summary.categories).toContain('knowledge');
    expect(summary.categories).toContain('finding');
    expect(summary.categories).toContain('question');
  });

  test('reply to reply preserves root threadId', async () => {
    // The parent has threadId = 'root-001', so reply should also use 'root-001'
    const parentReply = makeMessage({
      id: 'reply-to-reply-parent',
      threadId: 'root-001',
      senderId: 'agent-c',
      targetAddress: 'agent://mac-001/agent-c',
    });
    addJSONRoute('GET', '/v1/messages', [parentReply]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'rtr-result', threadId: 'root-001' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    await client.reply('reply-to-reply-parent', {
      subject: 'Re: Re: Original',
      body: 'Deeply nested reply',
    });

    expect((capturedBody as Record<string, unknown>).threadId).toBe('root-001');
  });
});

// ============================================================================
// CLI Smoke Tests
// ============================================================================

describe('CLI Smoke Tests', () => {
  test('MemoClient import does not throw', () => {
    // Verify the MemoClient can be imported without errors
    expect(MemoClient).toBeDefined();
    expect(typeof MemoClient).toBe('function');
  });

  test('MemoClient constructor accepts config only', () => {
    let threw = false;
    try {
      const client = new MemoClient(DEFAULT_CONFIG);
      expect(client).toBeDefined();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test('MemoClient constructor accepts config and client', () => {
    let threw = false;
    try {
      const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
      const client = new MemoClient(DEFAULT_CONFIG, restClient);
      expect(client).toBeDefined();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test('compose requires subject', async () => {
    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    let threw = false;
    try {
      await client.compose({
        to: 'agent://mac-001/other',
        subject: '',
        body: 'Body',
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('subject');
    }
    expect(threw).toBe(true);
  });

  test('compose requires valid address', async () => {
    const restClient = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const client = new MemoClient(DEFAULT_CONFIG, restClient);

    let threw = false;
    try {
      await client.compose({
        to: 'invalid',
        subject: 'Test',
        body: 'Body',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
