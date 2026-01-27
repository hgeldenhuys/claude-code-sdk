/**
 * Tests for Agent Registry
 *
 * Covers: AgentRegistry lifecycle (register, deregister, heartbeat, discover),
 * resolveAddress for all address types, getPresence, startHeartbeatLoop
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import { AgentRegistry } from '../../src/comms/registry/agent-registry';
import type { Agent, Channel } from '../../src/comms/protocol/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-project.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_registry';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
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

function makeChannel(overrides: Partial<Channel> = {}): Channel {
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

// ============================================================================
// Mock Fetch Infrastructure
// ============================================================================

type MockRoute = {
  method: string;
  pathPattern: string | RegExp;
  response: unknown;
  status?: number;
};

let routes: MockRoute[] = [];
let fetchLog: { method: string; url: string; body?: unknown }[] = [];
let originalFetch: typeof globalThis.fetch;

function setupMockFetch(): void {
  fetchLog = [];
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body) {
      try {
        body = JSON.parse(init.body as string);
      } catch {
        body = init.body;
      }
    }
    fetchLog.push({ method, url, body });

    // Match against routes
    for (const route of routes) {
      const pathMatch = typeof route.pathPattern === 'string'
        ? url.includes(route.pathPattern)
        : route.pathPattern.test(url);

      if (route.method === method && pathMatch) {
        const status = route.status ?? 200;
        if (status === 204) {
          return new Response(null, { status: 204, statusText: 'No Content' });
        }
        return new Response(JSON.stringify(route.response), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Default: return empty array for GET, empty object for others
    if (method === 'GET') {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function addRoute(method: string, pathPattern: string | RegExp, response: unknown, status?: number): void {
  routes.push({ method, pathPattern, response, status });
}

function makeClientAndRegistry(): { client: SignalDBClient; registry: AgentRegistry } {
  const client = new SignalDBClient({
    apiUrl: TEST_API_URL,
    projectKey: TEST_PROJECT_KEY,
  });
  const registry = new AgentRegistry(client);
  return { client, registry };
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  originalFetch = globalThis.fetch;
  routes = [];
  fetchLog = [];
  setupMockFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  routes = [];
  fetchLog = [];
});

// ============================================================================
// Registration Lifecycle
// ============================================================================

describe('AgentRegistry - Registration', () => {
  test('register calls client.agents.register with correct data', async () => {
    const expectedAgent = makeAgent();
    addRoute('POST', '/v1/agents', expectedAgent);

    const { registry } = makeClientAndRegistry();
    const result = await registry.register({
      machineId: 'mac-001',
      sessionId: 'sess-001',
      sessionName: 'jolly-squid',
      projectPath: '/path/to/project',
    });

    expect(result.id).toBe('agent-uuid-001');
    expect(result.machineId).toBe('mac-001');
    expect(fetchLog.length).toBe(1);
    expect(fetchLog[0].method).toBe('POST');
    expect(fetchLog[0].url).toContain('/v1/agents');
    const body = fetchLog[0].body as Record<string, unknown>;
    expect(body.machineId).toBe('mac-001');
    expect(body.sessionId).toBe('sess-001');
    expect(body.sessionName).toBe('jolly-squid');
  });

  test('register sets empty capabilities when not provided', async () => {
    addRoute('POST', '/v1/agents', makeAgent());

    const { registry } = makeClientAndRegistry();
    await registry.register({
      machineId: 'mac-001',
      sessionId: 'sess-001',
    });

    const body = fetchLog[0].body as Record<string, unknown>;
    expect(body.capabilities).toEqual({});
  });

  test('deregister calls client.agents.deregister', async () => {
    addRoute('DELETE', '/v1/agents/agent-uuid-001', null, 204);

    const { registry } = makeClientAndRegistry();
    await registry.deregister('agent-uuid-001');

    expect(fetchLog.length).toBe(1);
    expect(fetchLog[0].method).toBe('DELETE');
    expect(fetchLog[0].url).toContain('/v1/agents/agent-uuid-001');
  });
});

// ============================================================================
// Heartbeat
// ============================================================================

describe('AgentRegistry - Heartbeat', () => {
  test('heartbeat calls client.agents.heartbeat', async () => {
    addRoute('PATCH', '/heartbeat', makeAgent());

    const { registry } = makeClientAndRegistry();
    await registry.heartbeat('agent-uuid-001');

    expect(fetchLog.length).toBe(1);
    expect(fetchLog[0].method).toBe('PATCH');
    expect(fetchLog[0].url).toContain('/v1/agents/agent-uuid-001/heartbeat');
  });
});

// ============================================================================
// Discovery
// ============================================================================

describe('AgentRegistry - Discovery', () => {
  test('discover with no filter returns all agents', async () => {
    const agents = [makeAgent(), makeAgent({ id: 'agent-002' })];
    addRoute('GET', '/v1/agents', agents);

    const { registry } = makeClientAndRegistry();
    const result = await registry.discover();

    expect(result.length).toBe(2);
  });

  test('discover with filter passes params', async () => {
    addRoute('GET', '/v1/agents', [makeAgent()]);

    const { registry } = makeClientAndRegistry();
    const result = await registry.discover({ machineId: 'mac-001', status: 'active' });

    expect(result.length).toBe(1);
    expect(fetchLog[0].url).toContain('machine_id=mac-001');
    expect(fetchLog[0].url).toContain('status=active');
  });
});

// ============================================================================
// Address Resolution
// ============================================================================

describe('AgentRegistry - resolveAddress', () => {
  test('resolves agent:// address by sessionId match', async () => {
    const agent = makeAgent({ sessionId: 'sess-001', machineId: 'mac-001' });
    // findBySessionId route
    addRoute('GET', /session_id=sess-001/, [agent]);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('agent://mac-001/sess-001');

    expect(result.length).toBe(1);
    expect(result[0].id).toBe('agent-uuid-001');
  });

  test('resolves agent:// address by sessionName fallback', async () => {
    const agent = makeAgent({ sessionName: 'jolly-squid', machineId: 'mac-001' });
    // findBySessionId returns nothing
    addRoute('GET', /session_id=jolly-squid/, []);
    // findByMachineId returns agents
    addRoute('GET', /machine_id=mac-001/, [agent]);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('agent://mac-001/jolly-squid');

    expect(result.length).toBe(1);
    expect(result[0].sessionName).toBe('jolly-squid');
  });

  test('resolves agent:// returns empty when no match', async () => {
    // findBySessionId returns nothing
    addRoute('GET', /session_id=nonexistent/, []);
    // findByMachineId returns agent that doesnt match
    addRoute('GET', /machine_id=mac-001/, [
      makeAgent({ sessionName: 'other-name', sessionId: 'other-id' }),
    ]);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('agent://mac-001/nonexistent');

    expect(result.length).toBe(0);
  });

  test('resolves project:// address by machineId and projectPath', async () => {
    const agent = makeAgent({ machineId: 'mac-001', projectPath: '/path/to/repo' });
    addRoute('GET', '/v1/agents', [agent]);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('project://mac-001/path/to/repo');

    expect(result.length).toBe(1);
    expect(fetchLog[0].url).toContain('machine_id=mac-001');
    expect(fetchLog[0].url).toContain('project_path=path');
  });

  test('resolves broadcast:// address through channel members', async () => {
    const channel = makeChannel({ name: 'general', members: ['agent-001', 'agent-002'] });
    const agents = [
      makeAgent({ id: 'agent-001' }),
      makeAgent({ id: 'agent-002' }),
      makeAgent({ id: 'agent-003' }),
    ];
    addRoute('GET', /name=general/, channel);
    addRoute('GET', '/v1/agents', agents);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('broadcast://general');

    // Should return agents that are members (agent-001 and agent-002)
    expect(result.length).toBe(2);
    const ids = result.map((a: Agent) => a.id);
    expect(ids).toContain('agent-001');
    expect(ids).toContain('agent-002');
  });

  test('resolves broadcast:// returns empty for no members', async () => {
    const channel = makeChannel({ name: 'empty-channel', members: [] });
    addRoute('GET', /name=empty-channel/, channel);

    const { registry } = makeClientAndRegistry();
    const result = await registry.resolveAddress('broadcast://empty-channel');

    expect(result.length).toBe(0);
  });
});

// ============================================================================
// Presence
// ============================================================================

describe('AgentRegistry - getPresence', () => {
  test('derives active presence from recent heartbeat', async () => {
    const agent = makeAgent({
      id: 'agent-001',
      heartbeatAt: new Date().toISOString(),
    });
    addRoute('GET', '/v1/agents', [agent]);

    const { registry } = makeClientAndRegistry();
    const status = await registry.getPresence('agent-001');

    expect(status).toBe('active');
  });

  test('derives idle presence from older heartbeat', async () => {
    const agent = makeAgent({
      id: 'agent-001',
      heartbeatAt: new Date(Date.now() - 60000).toISOString(),
    });
    addRoute('GET', '/v1/agents', [agent]);

    const { registry } = makeClientAndRegistry();
    const status = await registry.getPresence('agent-001');

    expect(status).toBe('idle');
  });

  test('derives offline presence from very old heartbeat', async () => {
    const agent = makeAgent({
      id: 'agent-001',
      heartbeatAt: new Date(Date.now() - 600000).toISOString(),
    });
    addRoute('GET', '/v1/agents', [agent]);

    const { registry } = makeClientAndRegistry();
    const status = await registry.getPresence('agent-001');

    expect(status).toBe('offline');
  });

  test('returns offline for unknown agent', async () => {
    addRoute('GET', '/v1/agents', []);

    const { registry } = makeClientAndRegistry();
    const status = await registry.getPresence('nonexistent');

    expect(status).toBe('offline');
  });
});

// ============================================================================
// Heartbeat Loop
// ============================================================================

describe('AgentRegistry - startHeartbeatLoop', () => {
  test('returns a cleanup function', () => {
    addRoute('PATCH', '/heartbeat', makeAgent());

    const { registry } = makeClientAndRegistry();
    const cleanup = registry.startHeartbeatLoop('agent-001', 60000);

    expect(typeof cleanup).toBe('function');
    // Clean up the interval
    cleanup();
  });

  test('cleanup function stops the interval', async () => {
    addRoute('PATCH', '/heartbeat', makeAgent());

    const { registry } = makeClientAndRegistry();
    const cleanup = registry.startHeartbeatLoop('agent-001', 50);

    // Let it tick once
    await new Promise((resolve) => setTimeout(resolve, 80));
    const callCountBefore = fetchLog.length;

    // Stop the loop
    cleanup();

    // Wait to verify no more calls
    await new Promise((resolve) => setTimeout(resolve, 120));
    const callCountAfter = fetchLog.length;

    // After cleanup, no more calls should have been made
    expect(callCountAfter).toBe(callCountBefore);
  });

  test('heartbeat loop sends heartbeats at specified interval', async () => {
    addRoute('PATCH', '/heartbeat', makeAgent());

    const { registry } = makeClientAndRegistry();
    const cleanup = registry.startHeartbeatLoop('agent-001', 50);

    // Wait for a few heartbeats
    await new Promise((resolve) => setTimeout(resolve, 180));
    cleanup();

    // Should have at least 2 heartbeats (at 50ms, 100ms, 150ms)
    const heartbeatCalls = fetchLog.filter((c) => c.url.includes('/heartbeat'));
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of heartbeatCalls) {
      expect(call.method).toBe('PATCH');
    }
  });
});

// ============================================================================
// Full Lifecycle Integration
// ============================================================================

describe('AgentRegistry - Full Lifecycle', () => {
  test('register -> heartbeat -> discover -> deregister', async () => {
    const agent = makeAgent();
    addRoute('POST', '/v1/agents', agent);
    addRoute('PATCH', '/heartbeat', agent);
    addRoute('GET', '/v1/agents', [agent]);
    addRoute('DELETE', /\/v1\/agents\/agent-uuid-001$/, null, 204);

    const { registry } = makeClientAndRegistry();

    // 1. Register
    const registered = await registry.register({
      machineId: 'mac-001',
      sessionId: 'sess-001',
    });
    expect(registered.id).toBe('agent-uuid-001');

    // 2. Heartbeat
    await registry.heartbeat(registered.id);

    // 3. Discover
    const discovered = await registry.discover({ machineId: 'mac-001' });
    expect(discovered.length).toBe(1);

    // 4. Deregister
    await registry.deregister(registered.id);

    // Verify all 4 calls were made
    expect(fetchLog.length).toBe(4);
    expect(fetchLog[0].method).toBe('POST');
    expect(fetchLog[1].method).toBe('PATCH');
    expect(fetchLog[2].method).toBe('GET');
    expect(fetchLog[3].method).toBe('DELETE');
  });
});
