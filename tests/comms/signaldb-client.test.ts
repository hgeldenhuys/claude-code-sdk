/**
 * Tests for SignalDB REST Client
 *
 * Covers: SignalDBClient constructor, agent/channel/message/paste operations,
 * Authorization header, error handling (401, 404, 500)
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { SignalDBClient, SignalDBError } from '../../src/comms/client/signaldb';
import type { Agent, Channel, Message, Paste } from '../../src/comms/protocol/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-project.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_abc123';

function makeClient(): SignalDBClient {
  return new SignalDBClient({
    apiUrl: TEST_API_URL,
    projectKey: TEST_PROJECT_KEY,
  });
}

/** Build a fake Agent response */
function fakeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-uuid-001',
    machineId: 'mac-001',
    sessionId: 'sess-001',
    sessionName: 'jolly-squid',
    projectPath: '/path/to/project',
    status: 'active',
    capabilities: {},
    heartbeatAt: new Date().toISOString(),
    metadata: {},
    registeredAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a fake Channel response */
function fakeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'chan-uuid-001',
    name: 'general',
    type: 'broadcast',
    members: [],
    createdBy: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a fake Message response */
function fakeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-001',
    channelId: 'chan-uuid-001',
    senderId: 'agent-uuid-001',
    targetType: 'agent',
    targetAddress: 'agent://mac-001/sess-002',
    messageType: 'chat',
    content: 'Hello world',
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

/** Build a fake Paste response */
function fakePaste(overrides: Partial<Paste> = {}): Paste {
  return {
    id: 'paste-uuid-001',
    creatorId: 'agent-uuid-001',
    content: 'Paste content here',
    contentType: 'text/plain',
    accessType: 'ttl',
    ttlSeconds: 3600,
    recipientId: null,
    readBy: [],
    readAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  };
}

// Track fetch calls for verification
let fetchCalls: { url: string; init: RequestInit }[] = [];
let originalFetch: typeof globalThis.fetch;

function mockFetch(responseBody: unknown, status = 200): void {
  fetchCalls = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    if (status === 204) {
      return new Response(null, { status: 204, statusText: 'No Content' });
    }
    return new Response(JSON.stringify(responseBody), {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function mockFetchError(status: number, message: string): void {
  fetchCalls = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return new Response(JSON.stringify({ message }), {
      status,
      statusText: 'Error',
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fetchCalls = [];
});

// ============================================================================
// Authorization Header
// ============================================================================

describe('SignalDBClient - Authorization', () => {
  test('includes Bearer token in Authorization header', async () => {
    const client = makeClient();
    mockFetch([]);
    await client.agents.list();

    expect(fetchCalls.length).toBe(1);
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TEST_PROJECT_KEY}`);
  });

  test('includes Content-Type application/json header', async () => {
    const client = makeClient();
    mockFetch([]);
    await client.agents.list();

    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  test('strips trailing slash from API URL', async () => {
    const client = new SignalDBClient({
      apiUrl: 'https://test.signaldb.live/',
      projectKey: 'key',
    });
    mockFetch([]);
    await client.agents.list();

    expect(fetchCalls[0].url).toContain('https://test.signaldb.live/v1/agents');
    expect(fetchCalls[0].url).not.toContain('//v1');
  });
});

// ============================================================================
// Agent Operations
// ============================================================================

describe('SignalDBClient - Agent Operations', () => {
  test('register sends POST /v1/agents with body and returns Agent', async () => {
    const agent = fakeAgent();
    const client = makeClient();
    mockFetch(agent);

    const result = await client.agents.register({
      machineId: 'mac-001',
      sessionId: 'sess-001',
      sessionName: 'jolly-squid',
    });

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/agents`);
    expect(fetchCalls[0].init.method).toBe('POST');
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body.machineId).toBe('mac-001');
    expect(body.sessionId).toBe('sess-001');
    expect(body.sessionName).toBe('jolly-squid');
    expect(result.id).toBe(agent.id);
    expect(result.machineId).toBe('mac-001');
  });

  test('heartbeat sends PATCH /v1/agents/{id}/heartbeat', async () => {
    const agent = fakeAgent();
    const client = makeClient();
    mockFetch(agent);

    await client.agents.heartbeat('agent-uuid-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/agents/agent-uuid-001/heartbeat`);
    expect(fetchCalls[0].init.method).toBe('PATCH');
  });

  test('findByMachineId sends GET /v1/agents with machine_id query param', async () => {
    const client = makeClient();
    mockFetch([fakeAgent()]);

    const result = await client.agents.findByMachineId('mac-001');

    expect(fetchCalls[0].url).toContain('/v1/agents');
    expect(fetchCalls[0].url).toContain('machine_id=mac-001');
    expect(fetchCalls[0].init.method).toBe('GET');
    expect(result.length).toBe(1);
  });

  test('findBySessionId sends GET /v1/agents with session_id query param', async () => {
    const client = makeClient();
    mockFetch([fakeAgent()]);

    const result = await client.agents.findBySessionId('sess-001');

    expect(fetchCalls[0].url).toContain('session_id=sess-001');
    expect(result.length).toBe(1);
  });

  test('list returns Agent[] with no filters', async () => {
    const agents = [fakeAgent(), fakeAgent({ id: 'agent-uuid-002' })];
    const client = makeClient();
    mockFetch(agents);

    const result = await client.agents.list();

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/agents`);
    expect(result.length).toBe(2);
  });

  test('list passes filter params as query string', async () => {
    const client = makeClient();
    mockFetch([]);

    await client.agents.list({ machineId: 'mac-001', status: 'active' });

    expect(fetchCalls[0].url).toContain('machine_id=mac-001');
    expect(fetchCalls[0].url).toContain('status=active');
  });

  test('deregister sends DELETE /v1/agents/{id}', async () => {
    const client = makeClient();
    mockFetch(null, 204);

    await client.agents.deregister('agent-uuid-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/agents/agent-uuid-001`);
    expect(fetchCalls[0].init.method).toBe('DELETE');
  });
});

// ============================================================================
// Channel Operations
// ============================================================================

describe('SignalDBClient - Channel Operations', () => {
  test('create sends POST /v1/channels and returns Channel', async () => {
    const channel = fakeChannel();
    const client = makeClient();
    mockFetch(channel);

    const result = await client.channels.create({
      name: 'general',
      type: 'broadcast',
    });

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/channels`);
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(result.name).toBe('general');
  });

  test('get sends GET /v1/channels/{id}', async () => {
    const channel = fakeChannel();
    const client = makeClient();
    mockFetch(channel);

    const result = await client.channels.get('chan-uuid-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/channels/chan-uuid-001`);
    expect(fetchCalls[0].init.method).toBe('GET');
    expect(result.id).toBe('chan-uuid-001');
  });

  test('getByName sends GET /v1/channels with name query param', async () => {
    const channel = fakeChannel();
    const client = makeClient();
    mockFetch(channel);

    const result = await client.channels.getByName('general');

    expect(fetchCalls[0].url).toContain('name=general');
    expect(result.name).toBe('general');
  });

  test('list returns Channel[] with optional type filter', async () => {
    const channels = [fakeChannel()];
    const client = makeClient();
    mockFetch(channels);

    const result = await client.channels.list({ type: 'broadcast' });

    expect(fetchCalls[0].url).toContain('type=broadcast');
    expect(result.length).toBe(1);
  });

  test('addMember sends POST /v1/channels/{id}/members', async () => {
    const channel = fakeChannel({ members: ['agent-001'] });
    const client = makeClient();
    mockFetch(channel);

    const result = await client.channels.addMember('chan-001', 'agent-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/channels/chan-001/members`);
    expect(fetchCalls[0].init.method).toBe('POST');
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body.agentId).toBe('agent-001');
    expect(result.members).toContain('agent-001');
  });

  test('removeMember sends DELETE /v1/channels/{id}/members/{agentId}', async () => {
    const channel = fakeChannel({ members: [] });
    const client = makeClient();
    mockFetch(channel);

    await client.channels.removeMember('chan-001', 'agent-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/channels/chan-001/members/agent-001`);
    expect(fetchCalls[0].init.method).toBe('DELETE');
  });
});

// ============================================================================
// Message Operations
// ============================================================================

describe('SignalDBClient - Message Operations', () => {
  test('send sends POST /v1/messages and returns Message', async () => {
    const msg = fakeMessage();
    const client = makeClient();
    mockFetch(msg);

    const result = await client.messages.send({
      channelId: 'chan-001',
      senderId: 'agent-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-002',
      messageType: 'chat',
      content: 'Hello world',
    });

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/messages`);
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(result.content).toBe('Hello world');
  });

  test('claim sends PATCH /v1/messages/{id}/claim with agentId', async () => {
    const msg = fakeMessage({ status: 'claimed', claimedBy: 'agent-002' });
    const client = makeClient();
    mockFetch(msg);

    const result = await client.messages.claim('msg-001', 'agent-002');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/messages/msg-001/claim`);
    expect(fetchCalls[0].init.method).toBe('PATCH');
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body.agentId).toBe('agent-002');
    expect(result.status).toBe('claimed');
  });

  test('updateStatus sends PATCH /v1/messages/{id}/status', async () => {
    const msg = fakeMessage({ status: 'delivered' });
    const client = makeClient();
    mockFetch(msg);

    const result = await client.messages.updateStatus('msg-001', 'delivered');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/messages/msg-001/status`);
    expect(fetchCalls[0].init.method).toBe('PATCH');
    const body = JSON.parse(fetchCalls[0].init.body as string);
    expect(body.status).toBe('delivered');
    expect(result.status).toBe('delivered');
  });

  test('listByChannel sends GET /v1/messages with channel_id param', async () => {
    const client = makeClient();
    mockFetch([fakeMessage()]);

    const result = await client.messages.listByChannel('chan-001', { status: 'pending', limit: 10 });

    expect(fetchCalls[0].url).toContain('channel_id=chan-001');
    expect(fetchCalls[0].url).toContain('status=pending');
    expect(fetchCalls[0].url).toContain('limit=10');
    expect(result.length).toBe(1);
  });

  test('listForAgent sends GET /v1/messages with target_agent_id param', async () => {
    const client = makeClient();
    mockFetch([fakeMessage()]);

    const result = await client.messages.listForAgent('agent-001');

    expect(fetchCalls[0].url).toContain('target_agent_id=agent-001');
    expect(result.length).toBe(1);
  });

  test('listByThread sends GET /v1/messages with thread_id param', async () => {
    const client = makeClient();
    mockFetch([fakeMessage()]);

    const result = await client.messages.listByThread('thread-001');

    expect(fetchCalls[0].url).toContain('thread_id=thread-001');
    expect(result.length).toBe(1);
  });
});

// ============================================================================
// Paste Operations
// ============================================================================

describe('SignalDBClient - Paste Operations', () => {
  test('create sends POST /v1/pastes and returns Paste', async () => {
    const paste = fakePaste();
    const client = makeClient();
    mockFetch(paste);

    const result = await client.pastes.create({
      creatorId: 'agent-001',
      content: 'Paste content here',
      accessType: 'ttl',
      ttlSeconds: 3600,
    });

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/pastes`);
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(result.content).toBe('Paste content here');
  });

  test('read sends GET /v1/pastes/{id} with reader_id query param', async () => {
    const paste = fakePaste();
    const client = makeClient();
    mockFetch(paste);

    const result = await client.pastes.read('paste-001', 'agent-002');

    expect(fetchCalls[0].url).toContain('/v1/pastes/paste-001');
    expect(fetchCalls[0].url).toContain('reader_id=agent-002');
    expect(fetchCalls[0].init.method).toBe('GET');
    expect(result.id).toBe('paste-uuid-001');
  });

  test('delete sends DELETE /v1/pastes/{id}', async () => {
    const client = makeClient();
    mockFetch(null, 204);

    await client.pastes.delete('paste-001');

    expect(fetchCalls[0].url).toBe(`${TEST_API_URL}/v1/pastes/paste-001`);
    expect(fetchCalls[0].init.method).toBe('DELETE');
  });

  test('listForAgent sends GET /v1/pastes with agent_id query param', async () => {
    const client = makeClient();
    mockFetch([fakePaste()]);

    const result = await client.pastes.listForAgent('agent-001');

    expect(fetchCalls[0].url).toContain('agent_id=agent-001');
    expect(result.length).toBe(1);
  });
});

// ============================================================================
// Error Handling
// ============================================================================

describe('SignalDBClient - Error Handling', () => {
  test('throws SignalDBError with status 401 for unauthorized', async () => {
    const client = makeClient();
    mockFetchError(401, 'Unauthorized');

    try {
      await client.agents.list();
      expect(true).toBe(false); // Should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(SignalDBError);
      const err = e as SignalDBError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toContain('Unauthorized');
      expect(err.endpoint).toBe('GET /v1/agents');
    }
  });

  test('throws SignalDBError with status 404 for not found', async () => {
    const client = makeClient();
    mockFetchError(404, 'Agent not found');

    try {
      await client.agents.heartbeat('nonexistent-id');
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(SignalDBError);
      const err = e as SignalDBError;
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain('Agent not found');
      expect(err.endpoint).toBe('PATCH /v1/agents/nonexistent-id/heartbeat');
    }
  });

  test('throws SignalDBError with status 500 for server error', async () => {
    const client = makeClient();
    mockFetchError(500, 'Internal Server Error');

    try {
      await client.channels.create({ name: 'test', type: 'broadcast' });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(SignalDBError);
      const err = e as SignalDBError;
      expect(err.statusCode).toBe(500);
      expect(err.message).toContain('Internal Server Error');
    }
  });

  test('SignalDBError has correct name property', async () => {
    const client = makeClient();
    mockFetchError(400, 'Bad Request');

    try {
      await client.agents.register({ machineId: '' });
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(SignalDBError);
      expect((e as SignalDBError).name).toBe('SignalDBError');
    }
  });

  test('handles non-JSON error responses gracefully', async () => {
    const client = makeClient();
    fetchCalls = [];
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, init: init ?? {} });
      return new Response('Not JSON', {
        status: 502,
        statusText: 'Bad Gateway',
      });
    };

    try {
      await client.agents.list();
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(SignalDBError);
      const err = e as SignalDBError;
      expect(err.statusCode).toBe(502);
      // Should fall back to statusText
      expect(err.message).toContain('Bad Gateway');
    }
  });
});
