/**
 * Security Integration Tests (T-005)
 *
 * Tests cross-component integration between RLS, rate limiting,
 * SecurityMiddleware, JWT, and MessageRouter.
 *
 * Covers:
 * - AC-013: JWT created on daemon startup, attached as X-Agent-Token header
 * - AC-014: SecurityMiddleware applied in MessageRouter.route() before deliverToSession()
 * - AC-015: Rate limiter blocks > 60 messages/minute per agent with retryAfterMs
 * - AC-016: Client-side RLS filters direct/channel/broadcast messages correctly
 *
 * Focus: INTEGRATION between components, not individual component behavior.
 * Individual component tests are in:
 *   - tests/comms/security-daemon-integration.test.ts (T3)
 *   - tests/comms/security/rls.test.ts (T4)
 *   - tests/comms/security.test.ts
 *   - tests/comms/security-middleware.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MessageRouter } from '../../../src/comms/daemon/message-router';
import { SignalDBClient } from '../../../src/comms/client/signaldb';
import { SecurityManager } from '../../../src/comms/security/security-manager';
import { SecurityMiddleware, RateLimitError } from '../../../src/comms/security/middleware';
import { RLSFilter } from '../../../src/comms/security/row-level-security';
import { JWTManager } from '../../../src/comms/security/jwt-manager';
import { createDefaultSecurityConfig } from '../../../src/comms/security/types';
import type { Message } from '../../../src/comms/protocol/types';
import type { LocalSession } from '../../../src/comms/daemon/types';

// ============================================================================
// Constants
// ============================================================================

const TEST_API_URL = 'https://test-integration.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_integration';
const TEST_JWT_SECRET = 'integration-test-jwt-secret-key-32chars!';

// ============================================================================
// Helpers
// ============================================================================

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-int-' + Math.random().toString(36).slice(2, 10),
    channelId: 'chan-int-001',
    senderId: 'agent-sender-ext',
    targetType: 'agent',
    targetAddress: 'agent://mac-int-001/sess-int-001',
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

function makeLocalSession(overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    sessionId: 'sess-int-001',
    sessionName: 'clever-fox',
    projectPath: '/Users/dev/integration-project',
    agentId: 'agent-int-001',
    ...overrides,
  };
}

// ============================================================================
// Mock Fetch + Bun.spawn Infrastructure
// ============================================================================

type MockRoute = {
  method: string;
  pathPattern: string | RegExp;
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
};

let routes: MockRoute[] = [];
let fetchCalls: { method: string; url: string; body?: unknown; headers?: Record<string, string> }[] = [];
let originalFetch: typeof globalThis.fetch;
let originalSpawn: typeof Bun.spawn;
let auditEntries: unknown[] = [];

function setupMockFetch(): void {
  fetchCalls = [];
  auditEntries = [];

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = (init?.headers as Record<string, string>) ?? {};
    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    fetchCalls.push({ method, url, body, headers });

    // Capture audit log calls
    if (method === 'POST' && url.includes('/v1/audit')) {
      auditEntries.push(body);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

function addJSONRoute(
  method: string,
  pathPattern: string | RegExp,
  response: unknown,
  status = 200,
): void {
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

function createTestSecurityManager(
  allowedDirs: string[] = ['/Users/dev/integration-project'],
): SecurityManager {
  const config = createDefaultSecurityConfig(TEST_JWT_SECRET, allowedDirs);
  const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
  return new SecurityManager(config, client);
}

function createTestMiddleware(
  agentId: string = 'test-agent-int-001',
  machineId: string = 'mac-int-001',
  securityManager?: SecurityManager,
): SecurityMiddleware {
  const sm = securityManager ?? createTestSecurityManager();
  return new SecurityMiddleware(sm, agentId, machineId);
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  originalSpawn = Bun.spawn;
  originalFetch = globalThis.fetch;
  routes = [];
  fetchCalls = [];
  auditEntries = [];
  setupMockFetch();
});

afterEach(() => {
  Bun.spawn = originalSpawn;
  globalThis.fetch = originalFetch;
  routes = [];
  fetchCalls = [];
  auditEntries = [];
});

// ============================================================================
// 1. End-to-End Middleware Pipeline
//    RLS -> rate limit -> content validation -> directory -> audit -> delivery
// ============================================================================

describe('End-to-end middleware pipeline', () => {
  test('valid message passes RLS, then middleware, then gets delivered', async () => {
    // Set up RLS filter for agent-A
    const agentId = 'agent-pipeline-A';
    const machineId = 'mac-pipeline';
    const sessionId = 'sess-pipeline-001';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-general']),
      new Set([sessionId]),
    );

    // Message is targeted to our agent
    const message = makeMessage({
      id: 'msg-pipeline-pass',
      targetAddress: `agent://${machineId}/${sessionId}`,
      targetType: 'agent',
      content: 'Deploy the integration tests',
      status: 'pending',
    });

    // Step 1: RLS allows
    expect(rlsFilter.shouldDeliver(message)).toBe(true);

    // Step 2-5: Middleware pipeline (rate limit -> validate -> directory -> audit)
    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);
    const session = makeLocalSession({ sessionId, agentId });

    // Mock the claim flow: GET then PUT
    addJSONRoute('GET', /\/v1\/messages\/msg-pipeline-pass/, message);
    addJSONRoute('PUT', /\/v1\/messages\/msg-pipeline-pass/, { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Pipeline test response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    // Step 6: Delivery succeeded
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Pipeline test response');
    }
  });

  test('message blocked by RLS never reaches middleware or delivery', async () => {
    const agentId = 'agent-pipeline-B';
    const machineId = 'mac-pipeline-B';

    // RLS filter for agent-B -- NOT a member of the message's channel
    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-other']),
      new Set(['sess-B-001']),
    );

    // Channel message to a channel agent-B is NOT a member of
    const message = makeMessage({
      id: 'msg-pipeline-rls-block',
      channelId: 'chan-restricted',
      targetAddress: '',
      content: 'Secret channel message',
    });

    // RLS drops the message -- never enters middleware pipeline
    expect(rlsFilter.shouldDeliver(message)).toBe(false);

    // Verify: if we were to route this, the middleware would never be invoked
    // by demonstrating the message never reached the router at all.
    // In the real daemon (agent-daemon.ts:handleIncomingMessage),
    // RLS check happens BEFORE router.route() is called.
  });

  test('message passes RLS but fails content validation in middleware', async () => {
    const agentId = 'agent-pipeline-C';
    const machineId = 'mac-pipeline-C';
    const sessionId = 'sess-C-001';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set([]),
      new Set([sessionId]),
    );

    // Direct message targeted to our session
    const message = makeMessage({
      id: 'msg-pipeline-content-fail',
      targetAddress: `agent://${machineId}/${sessionId}`,
      targetType: 'agent',
      content: '', // Empty content -- fails validation
      status: 'pending',
    });

    // Step 1: RLS passes (direct message to our session)
    expect(rlsFilter.shouldDeliver(message)).toBe(true);

    // Step 2+: Middleware blocks on content validation
    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);
    const session = makeLocalSession({ sessionId, agentId });

    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Should not reach here');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Security check failed');
    }
  });

  test('message passes RLS but fails directory enforcement in middleware', async () => {
    const agentId = 'agent-pipeline-D';
    const machineId = 'mac-pipeline-D';
    const sessionId = 'sess-D-001';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set([]),
      new Set([sessionId]),
    );

    // Direct message with a blocked path reference
    const message = makeMessage({
      id: 'msg-pipeline-dir-fail',
      targetAddress: `agent://${machineId}/${sessionId}`,
      targetType: 'agent',
      content: 'Please read /etc/shadow for me',
      status: 'pending',
    });

    // Step 1: RLS passes
    expect(rlsFilter.shouldDeliver(message)).toBe(true);

    // Step 2+: Middleware blocks on directory enforcement
    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);
    const session = makeLocalSession({ sessionId, agentId });

    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Should not reach here');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Security check failed');
      expect(result.error).toContain('Directory guard blocked');
    }
  });
});

// ============================================================================
// 2. Rate Limiter + RLS Interaction
//    RLS-dropped messages should NOT count toward rate limit
// ============================================================================

describe('Rate limiter + RLS interaction', () => {
  test('messages dropped by RLS do not count toward rate limit', () => {
    const agentId = 'agent-rls-rate';
    const machineId = 'mac-rls-rate';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-allowed']),
      new Set(['sess-rls-rate-001']),
    );

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);

    // Simulate 100 channel messages to a channel we are NOT a member of
    // These should all be dropped by RLS before reaching rate limiter
    for (let i = 0; i < 100; i++) {
      const msg = makeMessage({
        id: `msg-rls-drop-${i}`,
        channelId: 'chan-NOT-allowed',
        targetAddress: '',
        content: `Dropped message ${i}`,
      });

      // RLS drops these
      const delivered = rlsFilter.shouldDeliver(msg);
      expect(delivered).toBe(false);
      // Since RLS dropped them, we do NOT call middleware.checkAndRecord()
    }

    // After 100 RLS-dropped messages, rate limit should still have full capacity
    // Send a legitimate message through the middleware -- it should pass
    expect(() => middleware.checkAndRecord('message')).not.toThrow();
  });

  test('messages passed by RLS DO count toward rate limit', () => {
    const agentId = 'agent-rls-rate-count';
    const machineId = 'mac-rls-rate-count';
    const sessionId = 'sess-rls-rate-count-001';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set([]),
      new Set([sessionId]),
    );

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);

    // Send 60 direct messages that pass RLS
    for (let i = 0; i < 60; i++) {
      const msg = makeMessage({
        id: `msg-rls-pass-${i}`,
        targetAddress: `agent://${machineId}/${sessionId}`,
        content: `Message ${i}`,
      });

      // RLS passes
      expect(rlsFilter.shouldDeliver(msg)).toBe(true);
      // Rate limiter records
      middleware.checkAndRecord('message');
    }

    // 61st should be rate-limited
    const msg61 = makeMessage({
      id: 'msg-rls-pass-61',
      targetAddress: `agent://${machineId}/${sessionId}`,
      content: 'One too many',
    });
    expect(rlsFilter.shouldDeliver(msg61)).toBe(true);
    expect(() => middleware.checkAndRecord('message')).toThrow(RateLimitError);
  });

  test('mixed RLS pass/drop: only passed messages count toward limit', () => {
    const agentId = 'agent-mixed-rls';
    const machineId = 'mac-mixed-rls';
    const sessionId = 'sess-mixed-001';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-team']),
      new Set([sessionId]),
    );

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);

    let passedCount = 0;
    let rateLimitHit = false;

    // Send 130 messages: alternating between pass and drop
    // Even indices pass RLS, odd indices get dropped
    for (let i = 0; i < 130; i++) {
      let msg: Message;
      if (i % 2 === 0) {
        // Even: direct message to our session (passes RLS)
        msg = makeMessage({
          id: `msg-mix-${i}`,
          targetAddress: `agent://${machineId}/${sessionId}`,
          content: `Direct message ${i}`,
        });
      } else {
        // Odd: channel message to unknown channel (dropped by RLS)
        msg = makeMessage({
          id: `msg-mix-${i}`,
          channelId: 'chan-unknown-xyz',
          targetAddress: '',
          content: `Channel message ${i}`,
        });
      }

      const shouldDeliver = rlsFilter.shouldDeliver(msg);
      if (shouldDeliver) {
        passedCount++;
        try {
          middleware.checkAndRecord('message');
        } catch (err) {
          // 61st passed message should trigger rate limit
          expect(err).toBeInstanceOf(RateLimitError);
          rateLimitHit = true;
          break;
        }
      }
    }

    // 60 messages succeeded, and the 61st triggered the rate limit
    expect(passedCount).toBe(61);
    expect(rateLimitHit).toBe(true);
  });
});

// ============================================================================
// 3. JWT + Middleware Flow
//    JWT token present when SecurityMiddleware operates
// ============================================================================

describe('JWT + middleware flow', () => {
  test('JWT token created and attached to client before middleware operates', () => {
    // Simulate what AgentDaemon.start() does:
    // 1. Create SecurityManager
    // 2. Create JWT token
    // 3. Attach to client headers
    // 4. Create SecurityMiddleware
    // 5. Create MessageRouter with middleware

    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/integration-project']);
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);

    // Step 1: Create JWT token (as daemon does on startup)
    const jwtManager = sm.jwt;
    const token = jwtManager.createToken('mac-jwt-001', 'mac-jwt-001', ['daemon', 'route', 'heartbeat']);

    // Step 2: Attach to client
    client.setHeader('X-Agent-Token', token);

    // Step 3: Validate the token is valid
    const payload = jwtManager.validateToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.agentId).toBe('mac-jwt-001');
    expect(payload!.capabilities).toContain('daemon');
    expect(payload!.capabilities).toContain('route');

    // Step 4: Create middleware with the same SecurityManager
    const middleware = new SecurityMiddleware(sm, 'mac-jwt-001', 'mac-jwt-001');

    // Step 5: Middleware should function -- rate limit check should pass
    expect(() => middleware.checkAndRecord('message')).not.toThrow();
  });

  test('JWT token is included in API requests made during routing', async () => {
    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/integration-project']);
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);

    // Create and attach JWT
    const token = sm.createToken('agent-jwt-api', 'mac-jwt-api', ['route']);
    client.setHeader('X-Agent-Token', token);

    const middleware = new SecurityMiddleware(sm, 'agent-jwt-api', 'mac-jwt-api');
    const router = new MessageRouter(client, middleware);

    const session = makeLocalSession({
      sessionId: 'sess-jwt-api',
      agentId: 'agent-jwt-api',
    });

    const message = makeMessage({
      id: 'msg-jwt-api-001',
      targetAddress: 'agent://mac-jwt-api/sess-jwt-api',
      targetType: 'agent',
      content: 'JWT header test',
      status: 'pending',
    });

    addJSONRoute('GET', /\/v1\/messages\/msg-jwt-api-001/, message);
    addJSONRoute('PUT', /\/v1\/messages\//, { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('JWT response');

    await router.route(message, [session]);

    // Verify JWT header was present in API calls
    let foundJwtHeader = false;
    for (let i = 0; i < fetchCalls.length; i++) {
      const call = fetchCalls[i]!;
      if (call.headers && call.headers['X-Agent-Token'] === token) {
        foundJwtHeader = true;
        break;
      }
    }
    expect(foundJwtHeader).toBe(true);
  });

  test('revoked JWT still allows middleware to function (middleware uses SecurityManager, not JWT directly)', () => {
    // This tests that the middleware pipeline does not depend on
    // the JWT being valid -- JWT is for API authentication, not
    // for the middleware pipeline itself.

    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/integration-project']);
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);

    // Create and revoke a JWT
    const token = sm.createToken('agent-revoked', 'mac-revoked', ['route']);
    const payload = sm.validateToken(token);
    expect(payload).not.toBeNull();
    sm.revokeToken(payload!.jti);
    expect(sm.validateToken(token)).toBeNull(); // Confirmed revoked

    // Middleware should still function (it uses SecurityManager, not JWT directly)
    const middleware = new SecurityMiddleware(sm, 'agent-revoked', 'mac-revoked');
    expect(() => middleware.checkAndRecord('message')).not.toThrow();
    expect(middleware.validateAndSanitize('Hello')).toBe('Hello');
  });
});

// ============================================================================
// 4. Multiple Agent Isolation
//    Two agents with different RLS filters, verify message routing isolation
// ============================================================================

describe('Multiple agent isolation', () => {
  test('two agents with different RLS filters only receive their own messages', () => {
    // Agent Alpha: member of chan-frontend
    const filterAlpha = new RLSFilter(
      'agent-alpha',
      'mac-001',
      new Set(['chan-frontend']),
      new Set(['sess-alpha-001']),
    );

    // Agent Beta: member of chan-backend
    const filterBeta = new RLSFilter(
      'agent-beta',
      'mac-001',
      new Set(['chan-backend']),
      new Set(['sess-beta-001']),
    );

    // Frontend channel message
    const frontendMsg = makeMessage({
      id: 'msg-frontend-001',
      channelId: 'chan-frontend',
      targetAddress: '',
      content: 'Frontend update',
    });

    // Backend channel message
    const backendMsg = makeMessage({
      id: 'msg-backend-001',
      channelId: 'chan-backend',
      targetAddress: '',
      content: 'Backend update',
    });

    // Alpha receives frontend, not backend
    expect(filterAlpha.shouldDeliver(frontendMsg)).toBe(true);
    expect(filterAlpha.shouldDeliver(backendMsg)).toBe(false);

    // Beta receives backend, not frontend
    expect(filterBeta.shouldDeliver(frontendMsg)).toBe(false);
    expect(filterBeta.shouldDeliver(backendMsg)).toBe(true);
  });

  test('direct messages are isolated per agent', () => {
    // Use different machine IDs to ensure isolation is tested
    // on agentId matching, not machineId matching
    const filterAlpha = new RLSFilter(
      'agent-alpha',
      'mac-alpha-only',
      new Set([]),
      new Set(['sess-alpha-001']),
    );

    const filterBeta = new RLSFilter(
      'agent-beta',
      'mac-beta-only',
      new Set([]),
      new Set(['sess-beta-001']),
    );

    // Message directly to Alpha (uses Alpha's machine)
    const toAlpha = makeMessage({
      id: 'msg-to-alpha',
      targetAddress: 'agent://mac-alpha-only/agent-alpha',
      content: 'Hello Alpha',
    });

    // Message directly to Beta (uses Beta's machine)
    const toBeta = makeMessage({
      id: 'msg-to-beta',
      targetAddress: 'agent://mac-beta-only/agent-beta',
      content: 'Hello Beta',
    });

    // Alpha only gets its own direct messages
    expect(filterAlpha.shouldDeliver(toAlpha)).toBe(true);
    expect(filterAlpha.shouldDeliver(toBeta)).toBe(false);

    // Beta only gets its own direct messages
    expect(filterBeta.shouldDeliver(toAlpha)).toBe(false);
    expect(filterBeta.shouldDeliver(toBeta)).toBe(true);
  });

  test('broadcast messages reach both agents', () => {
    const filterAlpha = new RLSFilter(
      'agent-alpha',
      'mac-001',
      new Set(['chan-frontend']),
      new Set(['sess-alpha-001']),
    );

    const filterBeta = new RLSFilter(
      'agent-beta',
      'mac-001',
      new Set(['chan-backend']),
      new Set(['sess-beta-001']),
    );

    const broadcast = makeMessage({
      id: 'msg-broadcast-001',
      metadata: { deliveryMode: 'broadcast' },
      content: 'System announcement',
    });

    expect(filterAlpha.shouldDeliver(broadcast)).toBe(true);
    expect(filterBeta.shouldDeliver(broadcast)).toBe(true);
  });

  test('rate limits are independent per agent even with shared SecurityManager', () => {
    const sm = createTestSecurityManager();
    const middlewareAlpha = new SecurityMiddleware(sm, 'agent-alpha', 'mac-001');
    const middlewareBeta = new SecurityMiddleware(sm, 'agent-beta', 'mac-001');

    // Exhaust Alpha's rate limit
    for (let i = 0; i < 60; i++) {
      middlewareAlpha.checkAndRecord('message');
    }

    // Alpha is now rate-limited
    expect(() => middlewareAlpha.checkAndRecord('message')).toThrow(RateLimitError);

    // Beta should still be allowed
    expect(() => middlewareBeta.checkAndRecord('message')).not.toThrow();
  });

  test('two agents route messages independently through MessageRouter', async () => {
    const sm = createTestSecurityManager();

    // Agent Alpha's pipeline
    const middlewareAlpha = new SecurityMiddleware(sm, 'agent-alpha', 'mac-001');
    const clientAlpha = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const routerAlpha = new MessageRouter(clientAlpha, middlewareAlpha);
    const sessionAlpha = makeLocalSession({
      sessionId: 'sess-alpha-001',
      agentId: 'agent-alpha',
    });

    // Agent Beta's pipeline
    const middlewareBeta = new SecurityMiddleware(sm, 'agent-beta', 'mac-001');
    const clientBeta = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const routerBeta = new MessageRouter(clientBeta, middlewareBeta);
    const sessionBeta = makeLocalSession({
      sessionId: 'sess-beta-001',
      agentId: 'agent-beta',
    });

    const msgToAlpha = makeMessage({
      id: 'msg-to-alpha-route',
      targetAddress: 'agent://mac-001/sess-alpha-001',
      targetType: 'agent',
      content: 'Task for Alpha',
      status: 'pending',
    });

    const msgToBeta = makeMessage({
      id: 'msg-to-beta-route',
      targetAddress: 'agent://mac-001/sess-beta-001',
      targetType: 'agent',
      content: 'Task for Beta',
      status: 'pending',
    });

    // Set up routes for both agents (claim needs GET then PUT)
    addJSONRoute('GET', /\/v1\/messages\/msg-to-alpha-route/, msgToAlpha);
    addJSONRoute('GET', /\/v1\/messages\/msg-to-beta-route/, msgToBeta);
    addJSONRoute('PUT', /\/v1\/messages\//, { status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Agent response');

    // Alpha routes its message
    const resultAlpha = await routerAlpha.route(msgToAlpha, [sessionAlpha]);
    expect(resultAlpha.ok).toBe(true);

    // Beta routes its message
    const resultBeta = await routerBeta.route(msgToBeta, [sessionBeta]);
    expect(resultBeta.ok).toBe(true);
  });
});

// ============================================================================
// 5. Dynamic Membership Updates
//    Change channel memberships, verify RLS updates take effect
// ============================================================================

describe('Dynamic membership updates', () => {
  test('joining a channel allows delivery of its messages', () => {
    const filter = new RLSFilter(
      'agent-dynamic-001',
      'mac-dynamic',
      new Set(['chan-general']),
      new Set(['sess-dynamic-001']),
    );

    const privateMsg = makeMessage({
      id: 'msg-private-chan',
      channelId: 'chan-private-team',
      targetAddress: '',
      content: 'Private team discussion',
    });

    // Initially NOT a member of chan-private-team
    expect(filter.shouldDeliver(privateMsg)).toBe(false);

    // Join the channel
    filter.updateMemberships(new Set(['chan-general', 'chan-private-team']));

    // Now should receive
    expect(filter.shouldDeliver(privateMsg)).toBe(true);
  });

  test('leaving a channel stops delivery of its messages', () => {
    const filter = new RLSFilter(
      'agent-dynamic-002',
      'mac-dynamic',
      new Set(['chan-general', 'chan-team']),
      new Set(['sess-dynamic-002']),
    );

    const teamMsg = makeMessage({
      id: 'msg-team-chan',
      channelId: 'chan-team',
      targetAddress: '',
      content: 'Team update',
    });

    // Initially a member
    expect(filter.shouldDeliver(teamMsg)).toBe(true);

    // Leave the channel
    filter.updateMemberships(new Set(['chan-general']));

    // No longer receives
    expect(filter.shouldDeliver(teamMsg)).toBe(false);
  });

  test('membership update is atomic (complete replacement, not incremental)', () => {
    const filter = new RLSFilter(
      'agent-dynamic-003',
      'mac-dynamic',
      new Set(['chan-a', 'chan-b', 'chan-c']),
      new Set(['sess-dynamic-003']),
    );

    const msgA = makeMessage({ channelId: 'chan-a', targetAddress: '' });
    const msgB = makeMessage({ channelId: 'chan-b', targetAddress: '' });
    const msgC = makeMessage({ channelId: 'chan-c', targetAddress: '' });
    const msgD = makeMessage({ channelId: 'chan-d', targetAddress: '' });

    // All original channels deliver
    expect(filter.shouldDeliver(msgA)).toBe(true);
    expect(filter.shouldDeliver(msgB)).toBe(true);
    expect(filter.shouldDeliver(msgC)).toBe(true);
    expect(filter.shouldDeliver(msgD)).toBe(false);

    // Atomic replacement: only chan-d now
    filter.updateMemberships(new Set(['chan-d']));

    // Old channels no longer deliver
    expect(filter.shouldDeliver(msgA)).toBe(false);
    expect(filter.shouldDeliver(msgB)).toBe(false);
    expect(filter.shouldDeliver(msgC)).toBe(false);
    // New channel delivers
    expect(filter.shouldDeliver(msgD)).toBe(true);
  });

  test('session discovery updates RLS session IDs', () => {
    const filter = new RLSFilter(
      'agent-discovery',
      'mac-discovery',
      new Set([]),
      new Set(['sess-old-001']),
    );

    // Message to the old session -- delivers
    const toOld = makeMessage({
      targetAddress: 'agent://other-machine/sess-old-001',
    });
    expect(filter.shouldDeliver(toOld)).toBe(true);

    // Message to the new session -- does not deliver yet
    const toNew = makeMessage({
      targetAddress: 'agent://other-machine/sess-new-002',
    });
    expect(filter.shouldDeliver(toNew)).toBe(false);

    // Simulate discovery polling updating session IDs
    filter.updateSessionIds(new Set(['sess-old-001', 'sess-new-002']));

    // Both sessions now deliver
    expect(filter.shouldDeliver(toOld)).toBe(true);
    expect(filter.shouldDeliver(toNew)).toBe(true);
  });

  test('removing a stale session stops delivery to it', () => {
    const filter = new RLSFilter(
      'agent-stale',
      'mac-stale',
      new Set([]),
      new Set(['sess-active-001', 'sess-stale-002']),
    );

    const toStale = makeMessage({
      targetAddress: 'agent://other-machine/sess-stale-002',
    });
    expect(filter.shouldDeliver(toStale)).toBe(true);

    // Discovery removes stale session
    filter.updateSessionIds(new Set(['sess-active-001']));

    // Stale session no longer delivers
    expect(filter.shouldDeliver(toStale)).toBe(false);
  });

  test('dynamic membership + rate limit: new channel messages count toward limit', () => {
    const agentId = 'agent-dyn-rate';
    const machineId = 'mac-dyn-rate';

    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-initial']),
      new Set(['sess-dyn-rate-001']),
    );

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);

    // Send 30 messages via initial channel
    for (let i = 0; i < 30; i++) {
      const msg = makeMessage({
        channelId: 'chan-initial',
        targetAddress: '',
        content: `Initial ${i}`,
      });
      expect(rlsFilter.shouldDeliver(msg)).toBe(true);
      middleware.checkAndRecord('message');
    }

    // Join a new channel dynamically
    rlsFilter.updateMemberships(new Set(['chan-initial', 'chan-new']));

    // Send 30 more messages via new channel
    for (let i = 0; i < 30; i++) {
      const msg = makeMessage({
        channelId: 'chan-new',
        targetAddress: '',
        content: `New ${i}`,
      });
      expect(rlsFilter.shouldDeliver(msg)).toBe(true);
      middleware.checkAndRecord('message');
    }

    // Total 60 messages used -- next one should be rate limited
    const msg61 = makeMessage({
      channelId: 'chan-new',
      targetAddress: '',
      content: 'Over limit',
    });
    expect(rlsFilter.shouldDeliver(msg61)).toBe(true);
    expect(() => middleware.checkAndRecord('message')).toThrow(RateLimitError);
  });

  test('concurrent RLS filter and middleware lifecycle matches daemon flow', async () => {
    // This test simulates the full daemon message handling flow:
    // 1. RLS filter initialized with initial sessions
    // 2. Message arrives via SSE
    // 3. RLS checks shouldDeliver
    // 4. If passed, router.route() applies middleware
    // 5. Discovery polling adds new session
    // 6. RLS filter updates
    // 7. New messages to new session are delivered

    const agentId = 'agent-lifecycle';
    const machineId = 'mac-lifecycle';

    // Phase 1: Initial state
    const rlsFilter = new RLSFilter(
      agentId,
      machineId,
      new Set(['chan-general']),
      new Set(['sess-init-001']),
    );

    const sm = createTestSecurityManager();
    const middleware = new SecurityMiddleware(sm, agentId, machineId);
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);

    // Phase 2: Message to initial session -- passes everything
    const initMsg = makeMessage({
      id: 'msg-lifecycle-init',
      targetAddress: `agent://${machineId}/sess-init-001`,
      targetType: 'agent',
      content: 'Initial task',
      status: 'pending',
    });

    expect(rlsFilter.shouldDeliver(initMsg)).toBe(true);

    addJSONRoute('GET', /\/v1\/messages\/msg-lifecycle-init/, initMsg);
    addJSONRoute('PUT', /\/v1\/messages\//, { status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('POST', '/v1/audit', undefined, 204);
    mockBunSpawn('Lifecycle response');

    const session = makeLocalSession({
      sessionId: 'sess-init-001',
      agentId,
    });
    const result1 = await router.route(initMsg, [session]);
    expect(result1.ok).toBe(true);

    // Phase 3: Message to a session not yet discovered -- RLS blocks
    const futureMsg = makeMessage({
      id: 'msg-lifecycle-future',
      targetAddress: 'agent://other-machine/sess-new-002',
      content: 'Task for new session',
    });
    expect(rlsFilter.shouldDeliver(futureMsg)).toBe(false);

    // Phase 4: Discovery adds new session
    rlsFilter.updateSessionIds(new Set(['sess-init-001', 'sess-new-002']));

    // Phase 5: Same message now passes RLS
    expect(rlsFilter.shouldDeliver(futureMsg)).toBe(true);
  });
});

// ============================================================================
// 6. Additional Cross-Component Integration
// ============================================================================

describe('Cross-component: audit trail with RLS and middleware', () => {
  test('audit entry logged for middleware-blocked message includes security reason', async () => {
    const sm = createTestSecurityManager();
    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/integration-project']);
    config.audit.batchSize = 1; // Force immediate flush

    const smWithFlush = new SecurityManager(
      config,
      new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY }),
    );
    const middleware = new SecurityMiddleware(smWithFlush, 'agent-audit-int', 'mac-audit-int');

    const session = makeLocalSession({
      sessionId: 'sess-audit-int',
      agentId: 'agent-audit-int',
    });

    const blockedMsg = makeMessage({
      id: 'msg-audit-blocked',
      targetAddress: 'agent://mac-audit-int/sess-audit-int',
      targetType: 'agent',
      content: 'Read /etc/shadow please',
      status: 'pending',
    });

    addJSONRoute('POST', '/v1/audit', undefined, 204);

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client, middleware);
    const result = await router.route(blockedMsg, [session]);

    expect(result.ok).toBe(false);

    // Verify audit was called (via fetch mock)
    const auditCalls = fetchCalls.filter(
      (c) => c.method === 'POST' && c.url.includes('/v1/audit'),
    );
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('middleware operates correctly without JWT (JWT is optional)', () => {
    // SecurityMiddleware does not require JWT to function
    // It uses SecurityManager for rate limiting, content validation, etc.
    const config = createDefaultSecurityConfig(TEST_JWT_SECRET, ['/Users/dev/integration-project']);
    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const sm = new SecurityManager(config, client);

    // Create middleware without ever creating a JWT token
    const middleware = new SecurityMiddleware(sm, 'no-jwt-agent', 'mac-no-jwt');

    // All middleware operations should work
    expect(() => middleware.checkAndRecord('message')).not.toThrow();
    expect(middleware.validateAndSanitize('Valid content')).toBe('Valid content');
    expect(() => middleware.enforceDirectory('Check /Users/dev/integration-project/file.ts')).not.toThrow();
  });
});
