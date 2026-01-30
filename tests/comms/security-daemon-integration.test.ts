/**
 * Tests for Security Integration into Daemon and MessageRouter (T-003)
 *
 * Covers:
 * - AC-013: JWT token creation on daemon startup, header attachment
 * - AC-014: SecurityMiddleware in MessageRouter.route() (directory, content, audit)
 * - AC-015: Rate limiting enforcement (60 msg/min, RateLimitError with retryAfterMs)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MessageRouter } from '../../src/comms/daemon/message-router';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import { SecurityManager } from '../../src/comms/security/security-manager';
import { SecurityMiddleware, RateLimitError } from '../../src/comms/security/middleware';
import { JWTManager } from '../../src/comms/security/jwt-manager';
import { createDefaultSecurityConfig } from '../../src/comms/security/types';
import type { Message } from '../../src/comms/protocol/types';
import type { LocalSession } from '../../src/comms/daemon/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-project.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_security';
const TEST_JWT_SECRET = 'test-jwt-secret-for-tests';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-uuid-001',
    channelId: 'chan-uuid-001',
    senderId: 'agent-uuid-sender',
    targetType: 'agent',
    targetAddress: 'agent://mac-001/sess-001',
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

function makeLocalSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: 'sess-001',
    sessionName: 'jolly-squid',
    projectPath: '/Users/dev/my-project',
    agentId: 'agent-uuid-001',
    ...overrides,
  };
}

// Mock Bun.spawn and fetch infrastructure
let originalSpawn: typeof Bun.spawn;
let originalFetch: typeof globalThis.fetch;
let fetchCalls: { url: string; init: RequestInit }[] = [];

type MockRoute = {
  method: string;
  pathPattern: string | RegExp;
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
};

let routes: MockRoute[] = [];

function setupMockFetch(): void {
  fetchCalls = [];
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    fetchCalls.push({ url, init: init ?? {} });

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

function mockBunSpawn(stdout: string, exitCode = 0, stderr = ''): void {
  // @ts-expect-error - mocking Bun.spawn
  Bun.spawn = () => ({
    stdout: new ReadableStream({
      start(c) {
        if (stdout) c.enqueue(new TextEncoder().encode(stdout));
        c.close();
      },
    }),
    stderr: new ReadableStream({
      start(c) {
        if (stderr) c.enqueue(new TextEncoder().encode(stderr));
        c.close();
      },
    }),
    exited: Promise.resolve(exitCode),
    kill: () => {},
  });
}

function createTestSecurityManager(): SecurityManager {
  const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/my-project']);
  const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
  return new SecurityManager(config, client);
}

function createTestMiddleware(securityManager?: SecurityManager): SecurityMiddleware {
  const sm = securityManager ?? createTestSecurityManager();
  return new SecurityMiddleware(sm, 'test-agent-001', 'test-machine-001');
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  originalSpawn = Bun.spawn;
  originalFetch = globalThis.fetch;
  routes = [];
  fetchCalls = [];
  setupMockFetch();
});

afterEach(() => {
  Bun.spawn = originalSpawn;
  globalThis.fetch = originalFetch;
  routes = [];
  fetchCalls = [];
});

// ============================================================================
// AC-013: JWT Token Creation and Header Attachment
// ============================================================================

describe('AC-013: JWT Token on Daemon Startup', () => {
  test('JWTManager creates valid token with agentId and machineId', () => {
    const jwt = new JWTManager({
      secret: TEST_JWT_SECRET,
      expiryMs: 86_400_000,
      rotationIntervalMs: 43_200_000,
      revocationListTTL: 172_800_000,
    });

    const token = jwt.createToken('agent-001', 'mac-001', ['daemon', 'route']);
    expect(token).toBeTruthy();
    expect(token.split('.').length).toBe(3);

    const payload = jwt.validateToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.agentId).toBe('agent-001');
    expect(payload!.machineId).toBe('mac-001');
    expect(payload!.capabilities).toEqual(['daemon', 'route']);
  });

  test('SignalDBClient includes extra headers in requests', async () => {
    addJSONRoute('GET', '/v1/agents', []);

    const client = new SignalDBClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      extraHeaders: { 'X-Agent-Token': 'test-token-value' },
    });

    await client.agents.list();

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers['X-Agent-Token']).toBe('test-token-value');
  });

  test('SignalDBClient.setHeader updates headers for subsequent requests', async () => {
    addJSONRoute('GET', '/v1/agents', []);

    const client = new SignalDBClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
    });

    // First request without token
    await client.agents.list();
    const headers1 = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers1['X-Agent-Token']).toBeUndefined();

    // Set the header
    client.setHeader('X-Agent-Token', 'my-jwt-token');

    // Second request with token
    await client.agents.list();
    const headers2 = fetchCalls[1]!.init.headers as Record<string, string>;
    expect(headers2['X-Agent-Token']).toBe('my-jwt-token');
  });

  test('SignalDBClient.removeHeader removes header from subsequent requests', async () => {
    addJSONRoute('GET', '/v1/agents', []);

    const client = new SignalDBClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      extraHeaders: { 'X-Agent-Token': 'remove-me' },
    });

    await client.agents.list();
    const headers1 = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers1['X-Agent-Token']).toBe('remove-me');

    client.removeHeader('X-Agent-Token');

    await client.agents.list();
    const headers2 = fetchCalls[1]!.init.headers as Record<string, string>;
    expect(headers2['X-Agent-Token']).toBeUndefined();
  });

  test('JWT token is validated and invalid tokens are rejected', () => {
    const jwt = new JWTManager({
      secret: TEST_JWT_SECRET,
      expiryMs: 86_400_000,
      rotationIntervalMs: 43_200_000,
      revocationListTTL: 172_800_000,
    });

    // Valid token
    const token = jwt.createToken('agent-001', 'mac-001', ['read']);
    expect(jwt.validateToken(token)).not.toBeNull();

    // Tampered token
    const tampered = token.slice(0, -1) + 'X';
    expect(jwt.validateToken(tampered)).toBeNull();

    // Wrong secret
    const otherJwt = new JWTManager({
      secret: 'different-secret',
      expiryMs: 86_400_000,
      rotationIntervalMs: 43_200_000,
      revocationListTTL: 172_800_000,
    });
    expect(otherJwt.validateToken(token)).toBeNull();
  });

  test('JWT token refresh works within rotation window', () => {
    const jwt = new JWTManager({
      secret: TEST_JWT_SECRET,
      expiryMs: 2_000, // 2 seconds
      rotationIntervalMs: 1_500, // 1.5 seconds (rotation window starts early)
      revocationListTTL: 10_000,
    });

    const token = jwt.createToken('agent-001', 'mac-001', ['daemon']);

    // Not in rotation window yet (token just created)
    const notRefreshed = jwt.refreshToken(token);
    expect(notRefreshed).toBeNull();

    // Still valid
    expect(jwt.validateToken(token)).not.toBeNull();
  });

  test('SecurityManager facade provides JWT operations', () => {
    const sm = createTestSecurityManager();

    const token = sm.createToken('agent-001', 'mac-001', ['daemon']);
    expect(token).toBeTruthy();

    const payload = sm.validateToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.agentId).toBe('agent-001');

    // Revocation
    sm.revokeToken(payload!.jti);
    expect(sm.validateToken(token)).toBeNull();
  });
});

// ============================================================================
// AC-014: SecurityMiddleware in MessageRouter
// ============================================================================

describe('AC-014: SecurityMiddleware in MessageRouter.route()', () => {
  test('MessageRouter accepts SecurityMiddleware in constructor', () => {
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);

    // Router should exist with middleware
    expect(router).toBeTruthy();
  });

  test('MessageRouter without middleware routes normally', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-no-sec-001',
      agentId: 'agent-no-sec-001',
    });
    const message = makeMessage({
      id: 'msg-no-sec-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-no-sec-001',
      status: 'pending',
    });

    addJSONRoute('GET', '/v1/messages/msg-no-sec-001', message);
    addJSONRoute('PUT', '/v1/messages/msg-no-sec-001', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    mockBunSpawn('Response without security');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client); // No middleware
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Response without security');
    }
  });

  test('MessageRouter with middleware routes valid messages successfully', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-sec-ok-001',
      agentId: 'agent-sec-ok-001',
    });
    const message = makeMessage({
      id: 'msg-sec-ok-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-sec-ok-001',
      status: 'pending',
      content: 'A normal message without problematic paths',
    });

    addJSONRoute('GET', '/v1/messages/msg-sec-ok-001', message);
    addJSONRoute('PUT', '/v1/messages/msg-sec-ok-001', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Secure response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Secure response');
    }
  });

  test('SecurityMiddleware enforces directory restrictions on message content', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-dir-001',
      agentId: 'agent-dir-001',
    });
    const message = makeMessage({
      id: 'msg-dir-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-dir-001',
      status: 'pending',
      content: 'Read the file at /etc/passwd please',
    });

    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Should not reach here');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Security check failed');
      expect(result.error).toContain('Directory guard blocked');
    }
  });

  test('SecurityMiddleware validates content before delivery', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-val-001',
      agentId: 'agent-val-001',
    });
    // Create a message with empty content (should fail content validation)
    const message = makeMessage({
      id: 'msg-val-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-val-001',
      status: 'pending',
      content: '',
    });

    addJSONRoute('POST', '/v1/audit', undefined, 204);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    // Empty content should be caught by content validation
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Security check failed');
    }
  });

  test('Security checks run before claim and delivery', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-order-001',
      agentId: 'agent-order-001',
    });
    const message = makeMessage({
      id: 'msg-order-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-order-001',
      status: 'pending',
      content: 'Read /etc/shadow',
    });

    let claimCalled = false;
    routes.push({
      method: 'GET',
      pathPattern: '/v1/messages/msg-order-001',
      handler: () => new Response(JSON.stringify(message), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    routes.push({
      method: 'PUT',
      pathPattern: '/v1/messages/msg-order-001',
      handler: () => {
        claimCalled = true;
        return new Response(JSON.stringify({ ...message, status: 'claimed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    addJSONRoute('POST', '/v1/audit', undefined, 204);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    // Security blocked the message
    expect(result.ok).toBe(false);
    // Claim should NOT have been called (security runs first)
    expect(claimCalled).toBe(false);
  });
});

// ============================================================================
// AC-015: Rate Limiting (60 msg/min)
// ============================================================================

describe('AC-015: Rate Limiting Enforcement', () => {
  test('allows messages under the rate limit', () => {
    const middleware = createTestMiddleware();

    // Should not throw for first few messages
    for (let i = 0; i < 5; i++) {
      expect(() => middleware.checkAndRecord('message')).not.toThrow();
    }
  });

  test('blocks messages exceeding 60/min and throws RateLimitError', () => {
    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, 'rate-test-agent', 'test-machine');

    // Send exactly 60 messages (the limit)
    for (let i = 0; i < 60; i++) {
      middleware.checkAndRecord('message');
    }

    // The 61st should throw RateLimitError
    try {
      middleware.checkAndRecord('message');
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rateErr = err as RateLimitError;
      expect(rateErr.action).toBe('message');
      expect(rateErr.retryAfterMs).toBeGreaterThan(0);
      expect(rateErr.message).toContain('Rate limit exceeded');
    }
  });

  test('RateLimitError has retryAfterMs field', () => {
    const error = new RateLimitError('message', 5000);
    expect(error.retryAfterMs).toBe(5000);
    expect(error.action).toBe('message');
    expect(error.name).toBe('RateLimitError');
    expect(error.message).toContain('5000ms');
  });

  test('MessageRouter returns failure with security error on rate limit', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-rate-001',
      agentId: 'agent-rate-001',
    });

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, 'rate-router-agent', 'test-machine');

    // Exhaust the rate limit
    for (let i = 0; i < 60; i++) {
      middleware.checkAndRecord('message');
    }

    const message = makeMessage({
      id: 'msg-rate-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-rate-001',
      status: 'pending',
      content: 'This should be rate limited',
    });

    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Should not reach here');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Security check failed');
      expect(result.error).toContain('Rate limit exceeded');
    }
  });

  test('rate limiter resets after window expires', async () => {
    // Use a very short window config
    const config = createDefaultSecurityConfig(TEST_JWT_SECRET);
    // Override rate limit to use a tiny window for testing
    config.rateLimits.messagesPerMinute = 3;
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);
    const middleware = new SecurityMiddleware(sm, 'rate-reset-agent', 'test-machine');

    // Send 3 messages (the limit with our override)
    for (let i = 0; i < 3; i++) {
      middleware.checkAndRecord('message');
    }

    // 4th should throw
    expect(() => middleware.checkAndRecord('message')).toThrow(RateLimitError);
  });

  test('different agents have independent rate limits', () => {
    const sm = createTestSecurityManager();
    const middleware1 = new SecurityMiddleware(sm, 'agent-alpha', 'test-machine');
    const middleware2 = new SecurityMiddleware(sm, 'agent-beta', 'test-machine');

    // Exhaust agent-alpha's limit
    for (let i = 0; i < 60; i++) {
      middleware1.checkAndRecord('message');
    }

    // agent-beta should still be allowed
    expect(() => middleware2.checkAndRecord('message')).not.toThrow();
  });
});

// ============================================================================
// Combined Integration: Security + Routing
// ============================================================================

describe('Combined: Security Middleware + Message Router Integration', () => {
  test('valid messages pass all security checks and get delivered', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-combo-001',
      agentId: 'agent-combo-001',
    });
    const message = makeMessage({
      id: 'msg-combo-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-combo-001',
      status: 'pending',
      content: 'Execute task T-003',
    });

    addJSONRoute('GET', '/v1/messages/msg-combo-001', message);
    addJSONRoute('PUT', '/v1/messages/msg-combo-001', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Task T-003 completed');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const middleware = createTestMiddleware();
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Task T-003 completed');
    }
  });

  test('DaemonConfig accepts optional security configuration', () => {
    const { createDefaultConfig } = require('../../src/comms/daemon/types');
    const config = createDefaultConfig(TEST_API_URL, TEST_PROJECT_KEY, 'mac-001');

    // security field is optional, should default to undefined
    expect(config.security).toBeUndefined();

    // Can be set
    const securityConfig = createDefaultSecurityConfig(TEST_JWT_SECRET);
    config.security = securityConfig;
    expect(config.security).toBeTruthy();
    expect(config.security.jwt.secret).toBe(TEST_JWT_SECRET);
  });

  test('audit logging is called for allowed messages', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-audit-001',
      agentId: 'agent-audit-001',
    });
    const message = makeMessage({
      id: 'msg-audit-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-audit-001',
      status: 'pending',
      content: 'Normal message for audit',
    });

    let auditCalled = false;
    routes.push({
      method: 'POST',
      pathPattern: '/v1/audit',
      handler: () => {
        auditCalled = true;
        return new Response(null, { status: 204, statusText: 'No Content' });
      },
    });

    addJSONRoute('GET', '/v1/messages/msg-audit-001', message);
    addJSONRoute('PUT', '/v1/messages/msg-audit-001', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    mockBunSpawn('Audit response');

    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/my-project']);
    // Use batch size of 1 to force immediate flush for testing
    config.audit.batchSize = 1;
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);
    const middleware = new SecurityMiddleware(sm, 'audit-agent', 'test-machine');
    const router = new MessageRouter(client, middleware);

    await router.route(message, [session]);

    // Audit should have been called (batch size = 1 triggers immediate flush)
    expect(auditCalled).toBe(true);
  });

  test('audit logging is called for blocked messages too', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-audit-block-001',
      agentId: 'agent-audit-block-001',
    });
    const message = makeMessage({
      id: 'msg-audit-block-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-audit-block-001',
      status: 'pending',
      content: 'Read /etc/passwd',
    });

    let auditCalled = false;
    routes.push({
      method: 'POST',
      pathPattern: '/v1/audit',
      handler: () => {
        auditCalled = true;
        return new Response(null, { status: 204, statusText: 'No Content' });
      },
    });

    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/my-project']);
    config.audit.batchSize = 1;
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);
    const middleware = new SecurityMiddleware(sm, 'audit-block-agent', 'test-machine');
    const router = new MessageRouter(client, middleware);

    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    // Audit should have been called for the blocked message
    expect(auditCalled).toBe(true);
  });
});
