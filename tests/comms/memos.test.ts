/**
 * Unit Tests for Memo Components (COMMS-004 Task 9)
 *
 * Covers:
 * - MemoComposer: compose, validate, send, address resolution, TTL, metadata
 * - MemoInbox: inbox, outbox, filtering, sorting, pagination, unread count
 * - MemoClaimer: claim, deliver, markRead, expire, state machine, 409 handling
 * - MemoThreading: reply, thread retrieval, thread summary, chronological ordering
 *
 * Uses route-based mock fetch pattern consistent with channels.test.ts.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoComposer, messageToMemoView } from '../../src/comms/memos/composer';
import { MemoInbox } from '../../src/comms/memos/inbox';
import { MemoClaimer } from '../../src/comms/memos/claiming';
import { MemoThreading } from '../../src/comms/memos/threading';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Message } from '../../src/comms/protocol/types';
import type { MemoConfig } from '../../src/comms/memos/types';

// ============================================================================
// Constants
// ============================================================================

const TEST_API_URL = 'https://test-memos.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_memos';
const TEST_AGENT_ID = 'agent-memo-001';
const TEST_CHANNEL_ID = 'chan-memo-001';

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
    content: 'Test memo body',
    metadata: {
      subject: 'Test Subject',
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
// MemoComposer - Compose and Send
// ============================================================================

describe('MemoComposer - Compose and Send', () => {
  test('compose with all fields produces correct MessageSend structure', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Important Finding',
      body: 'Found a bug in the parser',
      category: 'finding',
      priority: 'P0',
      threadId: 'thread-abc',
      metadata: { source: 'qa' },
    });

    expect(result.channelId).toBe(TEST_CHANNEL_ID);
    expect(result.senderId).toBe(TEST_AGENT_ID);
    expect(result.targetType).toBe('agent');
    expect(result.targetAddress).toBe('agent://mac-001/other-agent');
    expect(result.content).toBe('Found a bug in the parser');
    expect(result.threadId).toBe('thread-abc');
  });

  test('compose sets messageType to memo', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Test',
      body: 'Body text',
    });

    expect(result.messageType).toBe('memo');
  });

  test('compose stores subject in metadata.subject', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'My Subject',
      body: 'Body',
    });

    expect(result.metadata!.subject).toBe('My Subject');
  });

  test('compose stores category in metadata with default knowledge', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.metadata!.category).toBe('knowledge');
  });

  test('compose stores explicit category in metadata', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Test',
      body: 'Body',
      category: 'question',
    });

    expect(result.metadata!.category).toBe('question');
  });

  test('compose stores priority in metadata with default P2', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.metadata!.priority).toBe('P2');
  });

  test('compose stores explicit priority in metadata', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other-agent',
      subject: 'Urgent',
      body: 'Critical issue',
      priority: 'P0',
    });

    expect(result.metadata!.priority).toBe('P0');
  });

  test('compose resolves agent:// address', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/session-xyz',
      subject: 'Agent memo',
      body: 'Body',
    });

    expect(result.targetType).toBe('agent');
    expect(result.targetAddress).toBe('agent://mac-001/session-xyz');
  });

  test('compose resolves project:// address', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'project://mac-001/my-repo',
      subject: 'Project memo',
      body: 'Body',
    });

    expect(result.targetType).toBe('project');
    expect(result.targetAddress).toBe('project://mac-001/my-repo');
  });

  test('compose resolves broadcast:// address', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'broadcast://announcements',
      subject: 'Broadcast memo',
      body: 'Body',
    });

    expect(result.targetType).toBe('broadcast');
    expect(result.targetAddress).toBe('broadcast://announcements');
  });

  test('compose maps body to content', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Test',
      body: 'This is the body content',
    });

    expect(result.content).toBe('This is the body content');
  });

  test('compose passes threadId through', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Threaded',
      body: 'Reply',
      threadId: 'thread-123',
    });

    expect(result.threadId).toBe('thread-123');
  });

  test('compose converts expiresIn to expiresAt ISO string', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const before = Date.now();
    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Expiring',
      body: 'Body',
      expiresIn: 3600, // 1 hour
    });
    const after = Date.now();

    expect(result.expiresAt).toBeDefined();
    const expiresDate = new Date(result.expiresAt!).getTime();
    // Should be roughly 1 hour from now
    expect(expiresDate).toBeGreaterThanOrEqual(before + 3600 * 1000 - 100);
    expect(expiresDate).toBeLessThanOrEqual(after + 3600 * 1000 + 100);
  });

  test('compose throws for empty subject', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      composer.compose({
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

  test('compose throws for empty body', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      composer.compose({
        to: 'agent://mac-001/other',
        subject: 'Test',
        body: '',
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('body');
    }
    expect(threw).toBe(true);
  });

  test('compose throws for invalid address', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      composer.compose({
        to: 'invalid-no-protocol',
        subject: 'Test',
        body: 'Body',
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('compose throws for empty address', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      composer.compose({
        to: '',
        subject: 'Test',
        body: 'Body',
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('address');
    }
    expect(threw).toBe(true);
  });

  test('compose merges custom metadata into message metadata', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'With metadata',
      body: 'Body',
      metadata: { source: 'test-runner', version: 2 },
    });

    expect(result.metadata!.source).toBe('test-runner');
    expect(result.metadata!.version).toBe(2);
    // Standard fields still present
    expect(result.metadata!.subject).toBe('With metadata');
    expect(result.metadata!.category).toBe('knowledge');
    expect(result.metadata!.priority).toBe('P2');
  });

  test('send calls client.messages.send with correct payload', async () => {
    const sentMessage = makeMessage({ id: 'msg-sent-001' });
    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(sentMessage), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const composer = new MemoComposer(client, DEFAULT_CONFIG);

    const result = await composer.send({
      to: 'agent://mac-001/other-agent',
      subject: 'Sent Memo',
      body: 'This was sent',
    });

    expect(result.id).toBe('msg-sent-001');
    const body = capturedBody as Record<string, unknown>;
    expect(body.messageType).toBe('memo');
    expect(body.content).toBe('This was sent');
    expect(body.senderId).toBe(TEST_AGENT_ID);
  });

  test('compose uses config default category when not specified', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const config: MemoConfig = { ...DEFAULT_CONFIG, defaultCategory: 'finding' };
    const composer = new MemoComposer(client, config);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.metadata!.category).toBe('finding');
  });

  test('compose uses config default priority when not specified', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const config: MemoConfig = { ...DEFAULT_CONFIG, defaultPriority: 'P1' };
    const composer = new MemoComposer(client, config);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.metadata!.priority).toBe('P1');
  });

  test('compose explicit category overrides config default', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const config: MemoConfig = { ...DEFAULT_CONFIG, defaultCategory: 'finding' };
    const composer = new MemoComposer(client, config);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Test',
      body: 'Body',
      category: 'action-item',
    });

    expect(result.metadata!.category).toBe('action-item');
  });

  test('compose without channelId uses default', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const config: MemoConfig = { apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY, agentId: TEST_AGENT_ID };
    const composer = new MemoComposer(client, config);

    const result = composer.compose({
      to: 'agent://mac-001/other',
      subject: 'Test',
      body: 'Body',
    });

    expect(result.channelId).toBe('default');
  });
});

// ============================================================================
// MemoInbox - Inbox and Outbox
// ============================================================================

describe('MemoInbox - Inbox and Outbox', () => {
  test('inbox calls listForAgent with messageType=memo filter', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    await inbox.inbox();

    const call = fetchCalls.find(c => c.url.includes('/v1/messages'));
    expect(call).toBeDefined();
    expect(call!.url).toContain('target_agent_id=' + TEST_AGENT_ID);
    expect(call!.url).toContain('message_type=memo');
  });

  test('inbox returns MemoView[] with parsed metadata', async () => {
    const messages = [
      makeMessage({
        id: 'inbox-001',
        content: 'Memo body text',
        metadata: { subject: 'Parsed Subject', category: 'finding', priority: 'P1' },
      }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox();

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('inbox-001');
    expect(result[0]!.subject).toBe('Parsed Subject');
    expect(result[0]!.body).toBe('Memo body text');
    expect(result[0]!.category).toBe('finding');
    expect(result[0]!.priority).toBe('P1');
  });

  test('inbox filters by category', async () => {
    const messages = [
      makeMessage({ id: 'cat-1', metadata: { subject: 'A', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'cat-2', metadata: { subject: 'B', category: 'finding', priority: 'P2' } }),
      makeMessage({ id: 'cat-3', metadata: { subject: 'C', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox({ category: 'finding' });

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('cat-2');
  });

  test('inbox filters by priority', async () => {
    const messages = [
      makeMessage({ id: 'pri-1', metadata: { subject: 'A', category: 'knowledge', priority: 'P0' } }),
      makeMessage({ id: 'pri-2', metadata: { subject: 'B', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'pri-3', metadata: { subject: 'C', category: 'knowledge', priority: 'P0' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox({ priority: 'P0' });

    expect(result.length).toBe(2);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]!.priority).toBe('P0');
    }
  });

  test('inbox passes status filter to server', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    await inbox.inbox({ status: 'pending' });

    const call = fetchCalls.find(c => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('status=pending');
  });

  test('inbox unreadOnly excludes read and expired', async () => {
    const messages = [
      makeMessage({ id: 'ur-1', status: 'pending', metadata: { subject: 'A', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'ur-2', status: 'delivered', metadata: { subject: 'B', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'ur-3', status: 'read', metadata: { subject: 'C', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'ur-4', status: 'expired', metadata: { subject: 'D', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox({ unreadOnly: true });

    expect(result.length).toBe(2);
    const ids = result.map(m => m.id);
    expect(ids).toContain('ur-1');
    expect(ids).toContain('ur-2');
  });

  test('inbox sorts P0 before P1 before P2 before P3', async () => {
    const now = Date.now();
    const messages = [
      makeMessage({ id: 'sort-p3', createdAt: new Date(now).toISOString(), metadata: { subject: 'P3', category: 'knowledge', priority: 'P3' } }),
      makeMessage({ id: 'sort-p0', createdAt: new Date(now).toISOString(), metadata: { subject: 'P0', category: 'knowledge', priority: 'P0' } }),
      makeMessage({ id: 'sort-p2', createdAt: new Date(now).toISOString(), metadata: { subject: 'P2', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'sort-p1', createdAt: new Date(now).toISOString(), metadata: { subject: 'P1', category: 'knowledge', priority: 'P1' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox();

    expect(result[0]!.priority).toBe('P0');
    expect(result[1]!.priority).toBe('P1');
    expect(result[2]!.priority).toBe('P2');
    expect(result[3]!.priority).toBe('P3');
  });

  test('inbox same priority sorts newer first (createdAt desc)', async () => {
    const messages = [
      makeMessage({ id: 'time-old', createdAt: '2026-01-01T00:00:00Z', metadata: { subject: 'Old', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'time-new', createdAt: '2026-06-15T00:00:00Z', metadata: { subject: 'New', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'time-mid', createdAt: '2026-03-01T00:00:00Z', metadata: { subject: 'Mid', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox();

    expect(result[0]!.id).toBe('time-new');
    expect(result[1]!.id).toBe('time-mid');
    expect(result[2]!.id).toBe('time-old');
  });

  test('inbox pagination limit passes to API', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    await inbox.inbox({ limit: 5 });

    const call = fetchCalls.find(c => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('limit=5');
  });

  test('inbox pagination offset passes to API', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    await inbox.inbox({ offset: 3 });

    const call = fetchCalls.find(c => c.url.includes('/v1/messages'));
    expect(call!.url).toContain('offset=3');
  });

  test('outbox returns memos sent by this agent', async () => {
    const messages = [
      makeMessage({ id: 'out-1', senderId: TEST_AGENT_ID }),
      makeMessage({ id: 'out-2', senderId: 'other-agent' }),
      makeMessage({ id: 'out-3', senderId: TEST_AGENT_ID }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.outbox();

    expect(result.length).toBe(2);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]!.senderId).toBe(TEST_AGENT_ID);
    }
  });

  test('getUnreadCount counts pending + delivered memos', async () => {
    const messages = [
      makeMessage({ id: 'cnt-1', status: 'pending' }),
      makeMessage({ id: 'cnt-2', status: 'delivered' }),
      makeMessage({ id: 'cnt-3', status: 'read' }),
      makeMessage({ id: 'cnt-4', status: 'expired' }),
      makeMessage({ id: 'cnt-5', status: 'pending' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const count = await inbox.getUnreadCount();

    expect(count).toBe(3); // 2 pending + 1 delivered
  });

  test('messageToMemoView parses subject from metadata', () => {
    const msg = makeMessage({ metadata: { subject: 'Parsed Subject', category: 'knowledge', priority: 'P2' } });
    const view = messageToMemoView(msg);
    expect(view.subject).toBe('Parsed Subject');
  });

  test('messageToMemoView parses category from metadata', () => {
    const msg = makeMessage({ metadata: { subject: 'S', category: 'action-item', priority: 'P2' } });
    const view = messageToMemoView(msg);
    expect(view.category).toBe('action-item');
  });

  test('messageToMemoView parses priority from metadata', () => {
    const msg = makeMessage({ metadata: { subject: 'S', category: 'knowledge', priority: 'P1' } });
    const view = messageToMemoView(msg);
    expect(view.priority).toBe('P1');
  });

  test('messageToMemoView handles missing metadata gracefully with defaults', () => {
    const msg = makeMessage({ metadata: {} });
    const view = messageToMemoView(msg);
    expect(view.subject).toBe('(no subject)');
    expect(view.category).toBe('knowledge');
    expect(view.priority).toBe('P2');
  });

  test('empty inbox returns empty array', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox();
    expect(result.length).toBe(0);
  });

  test('messages with messageType != memo are filtered out by filterMemos', async () => {
    const messages = [
      makeMessage({ id: 'memo-1', messageType: 'memo' }),
      makeMessage({ id: 'chat-1', messageType: 'chat' }),
      makeMessage({ id: 'cmd-1', messageType: 'command' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox();

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('memo-1');
  });

  test('outbox filters out non-memo messages from this agent', async () => {
    const messages = [
      makeMessage({ id: 'out-memo', senderId: TEST_AGENT_ID, messageType: 'memo' }),
      makeMessage({ id: 'out-chat', senderId: TEST_AGENT_ID, messageType: 'chat' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.outbox();

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('out-memo');
  });

  test('inbox combines category and unreadOnly filters', async () => {
    const messages = [
      makeMessage({ id: 'cf-1', status: 'pending', metadata: { subject: 'A', category: 'finding', priority: 'P2' } }),
      makeMessage({ id: 'cf-2', status: 'read', metadata: { subject: 'B', category: 'finding', priority: 'P2' } }),
      makeMessage({ id: 'cf-3', status: 'pending', metadata: { subject: 'C', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const inbox = new MemoInbox(client, DEFAULT_CONFIG);

    const result = await inbox.inbox({ category: 'finding', unreadOnly: true });

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('cf-1');
  });

  test('messageToMemoView maps content to body', () => {
    const msg = makeMessage({ content: 'Full body here' });
    const view = messageToMemoView(msg);
    expect(view.body).toBe('Full body here');
  });

  test('messageToMemoView maps targetAddress to "to"', () => {
    const msg = makeMessage({ targetAddress: 'agent://mac-001/other' });
    const view = messageToMemoView(msg);
    expect(view.to).toBe('agent://mac-001/other');
  });
});

// ============================================================================
// MemoClaimer - Claiming and State Machine
// ============================================================================

describe('MemoClaimer - Claiming and State Machine', () => {
  test('claim on pending memo returns success=true', async () => {
    const claimedMsg = makeMessage({
      id: 'claim-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
      claimedAt: new Date().toISOString(),
    });
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, claimedMsg);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.claim('claim-001');

    expect(result.success).toBe(true);
    expect(result.memo).toBeDefined();
    expect(result.memo!.id).toBe('claim-001');
  });

  test('claim on already-claimed memo returns success=false', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already claimed' }, 409);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.claim('already-claimed-001');

    expect(result.success).toBe(false);
    expect(result.memo).toBeUndefined();
  });

  test('claim sets claimedBy in response', async () => {
    const claimedMsg = makeMessage({
      id: 'claim-by-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
    });
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, claimedMsg);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.claim('claim-by-001');

    expect(result.claimedBy).toBe(TEST_AGENT_ID);
  });

  test('deliver validates current state then transitions to delivered', async () => {
    // validateTransition fetches messages to check current state
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'deliver-001', status: 'claimed' }),
    ]);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'deliver-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.deliver('deliver-001');

    expect(result.status).toBe('delivered');
  });

  test('markRead validates current state then transitions to read', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'read-001', status: 'delivered' }),
    ]);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'read-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.markRead('read-001');

    expect(result.status).toBe('read');
  });

  test('expire validates current state then transitions to expired', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-001', status: 'pending' }),
    ]);
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'expire-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.expire('expire-001');

    expect(result.status).toBe('expired');
  });

  test('claim sends correct agentId in request body', async () => {
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'claimed', claimedBy: TEST_AGENT_ID })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    await claimer.claim('body-check-001');

    expect((capturedBody as Record<string, unknown>).agentId).toBe(TEST_AGENT_ID);
  });

  test('deliver sends status=delivered in request body', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'deliver-body-001', status: 'claimed' }),
    ]);
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'delivered' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    await claimer.deliver('deliver-body-001');

    expect((capturedBody as Record<string, unknown>).status).toBe('delivered');
  });

  test('markRead sends status=read in request body', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'read-body-001', status: 'delivered' }),
    ]);
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'read' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    await claimer.markRead('read-body-001');

    expect((capturedBody as Record<string, unknown>).status).toBe('read');
  });

  test('expire sends status=expired in request body', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-body-001', status: 'pending' }),
    ]);
    let capturedBody: unknown = null;
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/status/, (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ status: 'expired' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    await claimer.expire('expire-body-001');

    expect((capturedBody as Record<string, unknown>).status).toBe('expired');
  });

  test('claim handles 409 conflict gracefully without throwing', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Already claimed' }, 409);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    // Should NOT throw
    const result = await claimer.claim('conflict-001');
    expect(result.success).toBe(false);
  });

  test('claim rethrows non-409 errors', async () => {
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, { message: 'Server error' }, 500);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await claimer.claim('error-001');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('deliver throws on invalid transition from pending', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'invalid-001', status: 'pending' }),
    ]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await claimer.deliver('invalid-001');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Invalid memo state transition');
      expect((err as Error).message).toContain('pending');
      expect((err as Error).message).toContain('delivered');
    }
    expect(threw).toBe(true);
  });

  test('markRead throws on invalid transition from pending', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'invalid-002', status: 'pending' }),
    ]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await claimer.markRead('invalid-002');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Invalid memo state transition');
    }
    expect(threw).toBe(true);
  });

  test('deliver throws when memo not found', async () => {
    addJSONRoute('GET', '/v1/messages', []); // Empty list = memo not found

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await claimer.deliver('not-found-001');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Memo not found');
    }
    expect(threw).toBe(true);
  });

  test('full lifecycle: claim -> deliver -> markRead', async () => {
    // Step 1: Claim
    const claimedMsg = makeMessage({ id: 'lifecycle-001', status: 'claimed', claimedBy: TEST_AGENT_ID });
    addJSONRoute('PATCH', /\/v1\/messages\/lifecycle-001\/claim/, claimedMsg);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const claimed = await claimer.claim('lifecycle-001');
    expect(claimed.success).toBe(true);

    // Clear routes for next step
    routes = [];

    // Step 2: Deliver - validateTransition needs to find the memo as 'claimed'
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'lifecycle-001', status: 'claimed' }),
    ]);
    addHandlerRoute('PATCH', /\/v1\/messages\/lifecycle-001\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'lifecycle-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const delivered = await claimer.deliver('lifecycle-001');
    expect(delivered.status).toBe('delivered');

    // Clear routes for next step
    routes = [];

    // Step 3: Read - validateTransition needs to find the memo as 'delivered'
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'lifecycle-001', status: 'delivered' }),
    ]);
    addHandlerRoute('PATCH', /\/v1\/messages\/lifecycle-001\/status/, (_url, init) => {
      const body = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'lifecycle-001', status: body.status })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const read = await claimer.markRead('lifecycle-001');
    expect(read.status).toBe('read');
  });

  test('claim returns MemoView with parsed metadata', async () => {
    const claimedMsg = makeMessage({
      id: 'claim-view-001',
      status: 'claimed',
      claimedBy: TEST_AGENT_ID,
      metadata: { subject: 'Claimed Subject', category: 'question', priority: 'P1' },
    });
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, claimedMsg);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.claim('claim-view-001');

    expect(result.memo!.subject).toBe('Claimed Subject');
    expect(result.memo!.category).toBe('question');
    expect(result.memo!.priority).toBe('P1');
  });

  test('expire can transition from claimed state', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-claimed', status: 'claimed' }),
    ]);
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/status/, makeMessage({ id: 'expire-claimed', status: 'expired' }));

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.expire('expire-claimed');
    expect(result.status).toBe('expired');
  });

  test('expire can transition from delivered state', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-delivered', status: 'delivered' }),
    ]);
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/status/, makeMessage({ id: 'expire-delivered', status: 'expired' }));

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.expire('expire-delivered');
    expect(result.status).toBe('expired');
  });

  test('expire can transition from read state', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-read', status: 'read' }),
    ]);
    addJSONRoute('PATCH', /\/v1\/messages\/.*\/status/, makeMessage({ id: 'expire-read', status: 'expired' }));

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    const result = await claimer.expire('expire-read');
    expect(result.status).toBe('expired');
  });

  test('expire throws when already expired', async () => {
    addJSONRoute('GET', '/v1/messages', [
      makeMessage({ id: 'expire-already', status: 'expired' }),
    ]);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await claimer.expire('expire-already');
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Invalid memo state transition');
    }
    expect(threw).toBe(true);
  });

  test('claim calls correct URL with memo ID', async () => {
    let capturedUrl = '';
    addHandlerRoute('PATCH', /\/v1\/messages\/.*\/claim/, (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify(makeMessage({ status: 'claimed', claimedBy: TEST_AGENT_ID })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const claimer = new MemoClaimer(client, DEFAULT_CONFIG);

    await claimer.claim('specific-id-xyz');

    expect(capturedUrl).toContain('specific-id-xyz');
    expect(capturedUrl).toContain('/claim');
  });
});

// ============================================================================
// MemoThreading - Reply Chains and Thread Queries
// ============================================================================

describe('MemoThreading - Reply Chains and Thread Queries', () => {
  test('reply fetches parent and creates memo with threadId = parent.id when no threadId', async () => {
    // fetchMemoById calls listForAgent
    const parentMsg = makeMessage({
      id: 'parent-001',
      threadId: null,
      senderId: 'other-agent',
      targetAddress: 'agent://mac-001/other-agent',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'reply-001', threadId: 'parent-001' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    await threading.reply('parent-001', {
      subject: 'Reply',
      body: 'Reply body',
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.threadId).toBe('parent-001');
  });

  test('reply uses parent.threadId if parent already in thread', async () => {
    const parentMsg = makeMessage({
      id: 'parent-002',
      threadId: 'existing-thread',
      senderId: 'other-agent',
      targetAddress: 'agent://mac-001/other-agent',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'reply-002', threadId: 'existing-thread' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    await threading.reply('parent-002', {
      subject: 'Reply in thread',
      body: 'Reply body',
    });

    const body = capturedBody as Record<string, unknown>;
    expect(body.threadId).toBe('existing-thread');
  });

  test('reply addresses based on parent senderId', async () => {
    const parentMsg = makeMessage({
      id: 'parent-003',
      senderId: 'sender-agent-xyz',
      threadId: null,
      targetAddress: 'agent://mac-001/other-address',
    });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'reply-003' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    await threading.reply('parent-003', {
      subject: 'Reply',
      body: 'Reply body',
    });

    const body = capturedBody as Record<string, unknown>;
    // Address should contain the sender's agent ID
    expect((body.targetAddress as string)).toContain('sender-agent-xyz');
  });

  test('reply throws when parent not found', async () => {
    addJSONRoute('GET', '/v1/messages', []); // Empty = not found

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    let threw = false;
    try {
      await threading.reply('not-found-parent', {
        subject: 'Reply',
        body: 'Body',
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain('Parent memo not found');
    }
    expect(threw).toBe(true);
  });

  test('getThread returns memos sorted chronologically', async () => {
    const messages = [
      makeMessage({ id: 'thread-3', createdAt: '2026-01-03T00:00:00Z', threadId: 'thread-t1' }),
      makeMessage({ id: 'thread-1', createdAt: '2026-01-01T00:00:00Z', threadId: 'thread-t1' }),
      makeMessage({ id: 'thread-2', createdAt: '2026-01-02T00:00:00Z', threadId: 'thread-t1' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const result = await threading.getThread('thread-t1');

    expect(result.length).toBe(3);
    expect(result[0]!.id).toBe('thread-1');
    expect(result[1]!.id).toBe('thread-2');
    expect(result[2]!.id).toBe('thread-3');
  });

  test('getThread transforms to MemoView[]', async () => {
    const messages = [
      makeMessage({
        id: 'thread-view-1',
        metadata: { subject: 'Thread Subject', category: 'finding', priority: 'P1' },
      }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const result = await threading.getThread('thread-view');

    expect(result[0]!.subject).toBe('Thread Subject');
    expect(result[0]!.category).toBe('finding');
    expect(result[0]!.priority).toBe('P1');
  });

  test('getThreadSummary returns correct participant list (unique senderIds)', async () => {
    const messages = [
      makeMessage({ id: 'ts-1', senderId: 'agent-a', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'ts-2', senderId: 'agent-b', createdAt: '2026-01-02T00:00:00Z' }),
      makeMessage({ id: 'ts-3', senderId: 'agent-a', createdAt: '2026-01-03T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('summary-thread');

    expect(summary.participants.length).toBe(2);
    expect(summary.participants).toContain('agent-a');
    expect(summary.participants).toContain('agent-b');
  });

  test('getThreadSummary returns correct memoCount', async () => {
    const messages = [
      makeMessage({ id: 'cnt-1', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'cnt-2', createdAt: '2026-01-02T00:00:00Z' }),
      makeMessage({ id: 'cnt-3', createdAt: '2026-01-03T00:00:00Z' }),
      makeMessage({ id: 'cnt-4', createdAt: '2026-01-04T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('count-thread');

    expect(summary.memoCount).toBe(4);
  });

  test('getThreadSummary has correct first/last timestamps', async () => {
    const messages = [
      makeMessage({ id: 'time-1', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'time-2', createdAt: '2026-03-15T00:00:00Z' }),
      makeMessage({ id: 'time-3', createdAt: '2026-06-30T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('time-thread');

    expect(summary.firstTimestamp).toBe('2026-01-01T00:00:00Z');
    expect(summary.lastTimestamp).toBe('2026-06-30T00:00:00Z');
  });

  test('getThreadSummary collects unique categories', async () => {
    const messages = [
      makeMessage({ id: 'cat-1', createdAt: '2026-01-01T00:00:00Z', metadata: { subject: 'A', category: 'knowledge', priority: 'P2' } }),
      makeMessage({ id: 'cat-2', createdAt: '2026-01-02T00:00:00Z', metadata: { subject: 'B', category: 'finding', priority: 'P2' } }),
      makeMessage({ id: 'cat-3', createdAt: '2026-01-03T00:00:00Z', metadata: { subject: 'C', category: 'knowledge', priority: 'P2' } }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('categories-thread');

    expect(summary.categories.length).toBe(2);
    expect(summary.categories).toContain('knowledge');
    expect(summary.categories).toContain('finding');
  });

  test('empty thread returns empty array', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const result = await threading.getThread('empty-thread');

    expect(result.length).toBe(0);
  });

  test('getThreadSummary on empty thread returns zeros', async () => {
    addJSONRoute('GET', '/v1/messages', []);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('empty-summary-thread');

    expect(summary.memoCount).toBe(0);
    expect(summary.participants.length).toBe(0);
    expect(summary.categories.length).toBe(0);
  });

  test('getThread filters out non-memo messages', async () => {
    const messages = [
      makeMessage({ id: 'filter-memo', messageType: 'memo', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'filter-chat', messageType: 'chat', createdAt: '2026-01-02T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const result = await threading.getThread('filter-thread');

    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('filter-memo');
  });

  test('reply sets messageType to memo', async () => {
    const parentMsg = makeMessage({ id: 'parent-type', senderId: 'other', threadId: null, targetAddress: 'agent://mac-001/other' });
    addJSONRoute('GET', '/v1/messages', [parentMsg]);

    let capturedBody: unknown = null;
    addHandlerRoute('POST', '/v1/messages', (_url, init) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify(makeMessage({ id: 'reply-type' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    await threading.reply('parent-type', { subject: 'Reply', body: 'Body' });

    expect((capturedBody as Record<string, unknown>).messageType).toBe('memo');
  });

  test('getThreadSummary rootMemoId is the first memo id', async () => {
    const messages = [
      makeMessage({ id: 'root-001', createdAt: '2026-01-01T00:00:00Z' }),
      makeMessage({ id: 'reply-001', createdAt: '2026-01-02T00:00:00Z' }),
    ];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('root-thread');

    expect(summary.rootMemoId).toBe('root-001');
  });

  test('getThreadSummary threadId matches requested id', async () => {
    const messages = [makeMessage({ id: 'th-1', createdAt: '2026-01-01T00:00:00Z' })];
    addJSONRoute('GET', '/v1/messages', messages);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const threading = new MemoThreading(client, DEFAULT_CONFIG);

    const summary = await threading.getThreadSummary('my-thread-xyz');

    expect(summary.threadId).toBe('my-thread-xyz');
  });
});
