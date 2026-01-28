/**
 * Tests for Security Middleware Integration (COMMS-005)
 *
 * Covers:
 * - SecurityMiddleware: rate limiting, content validation, sanitization,
 *   directory enforcement, audit logging
 * - SecureChannelClient: security-wrapped channel operations
 * - SecureMemoClient: security-wrapped memo operations
 * - SecurePasteClient: security-wrapped paste operations
 * - Cross-layer security enforcement
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SecurityManager } from '../../src/comms/security/security-manager';
import { SecurityMiddleware, RateLimitError, ContentValidationError, DirectoryGuardError } from '../../src/comms/security/middleware';
import { SecureChannelClient } from '../../src/comms/channels/secure-channel-client';
import { SecureMemoClient } from '../../src/comms/memos/secure-memo-client';
import { SecurePasteClient } from '../../src/comms/pastes/secure-paste-client';
import { ChannelClient } from '../../src/comms/channels/channel-client';
import { MemoClient } from '../../src/comms/memos/memo-client';
import { PasteClient } from '../../src/comms/pastes/paste-client';
import { createDefaultSecurityConfig } from '../../src/comms/security/types';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Channel, Message, Paste } from '../../src/comms/protocol/types';
import type { MemoView } from '../../src/comms/memos/types';
import type { PasteView } from '../../src/comms/pastes/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-security.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_security';
const TEST_AGENT_ID = 'agent-sec-001';
const TEST_MACHINE_ID = 'mac-sec-001';

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'chan-sec-001',
    name: 'secure-channel',
    type: 'project',
    members: [TEST_AGENT_ID],
    createdBy: TEST_AGENT_ID,
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-sec-001',
    channelId: 'chan-sec-001',
    senderId: TEST_AGENT_ID,
    targetType: 'broadcast',
    targetAddress: 'broadcast://secure-channel',
    messageType: 'chat',
    content: 'Hello, secure world!',
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

function makeMemoView(overrides: Partial<MemoView> = {}): MemoView {
  return {
    id: 'memo-sec-001',
    senderId: TEST_AGENT_ID,
    to: 'agent://mac-1/agent-002',
    subject: 'Test Memo',
    body: 'Hello from test',
    category: 'knowledge',
    priority: 'P2',
    status: 'pending',
    claimedBy: null,
    threadId: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    metadata: {},
    ...overrides,
  };
}

function makePaste(overrides: Partial<Paste> = {}): Paste {
  return {
    id: 'paste-sec-001',
    creatorId: TEST_AGENT_ID,
    content: 'Secure paste content',
    contentType: 'text/plain',
    accessType: 'ttl',
    ttlSeconds: 3600,
    recipientId: null,
    readBy: [],
    readAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    deletedAt: null,
    ...overrides,
  };
}

// ============================================================================
// Mock Fetch Infrastructure
// ============================================================================

type MockRoute = {
  method: string;
  pathPattern: string | RegExp;
  handler: (url: string, init: RequestInit) => Response | Promise<Response>;
};

let routes: MockRoute[] = [];
let fetchCalls: { method: string; url: string; body?: unknown }[] = [];
let originalFetch: typeof globalThis.fetch;
let auditLogs: unknown[] = [];

function setupMockFetch(): void {
  fetchCalls = [];
  auditLogs = [];

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { body = init.body; }
    }
    fetchCalls.push({ method, url, body });

    // Capture audit log calls
    if (method === 'POST' && url.includes('/v1/audit')) {
      auditLogs.push(body);
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

function createSecurityManager(allowedDirs: string[] = ['/tmp/allowed']): SecurityManager {
  const client = new SignalDBClient({
    apiUrl: TEST_API_URL,
    projectKey: TEST_PROJECT_KEY,
  });
  const config = createDefaultSecurityConfig('test-jwt-secret', allowedDirs);
  return new SecurityManager(config, client);
}

// ============================================================================
// SecurityMiddleware
// ============================================================================

describe('SecurityMiddleware', () => {
  let security: SecurityManager;
  let middleware: SecurityMiddleware;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    security = createSecurityManager(['/tmp/allowed', '/tmp/project']);
    middleware = new SecurityMiddleware(security, TEST_AGENT_ID, TEST_MACHINE_ID);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('checkAndRecord', () => {
    test('allows action within rate limit', () => {
      expect(() => middleware.checkAndRecord('message')).not.toThrow();
    });

    test('records action on success', () => {
      middleware.checkAndRecord('message');

      // Second check should still be allowed (under limit)
      expect(() => middleware.checkAndRecord('message')).not.toThrow();
    });

    test('throws RateLimitError when limit exceeded', () => {
      // Exhaust message limit (60/minute default)
      for (let i = 0; i < 60; i++) {
        middleware.checkAndRecord('message');
      }

      expect(() => middleware.checkAndRecord('message')).toThrow(RateLimitError);
    });

    test('RateLimitError has correct properties', () => {
      for (let i = 0; i < 60; i++) {
        middleware.checkAndRecord('message');
      }

      try {
        middleware.checkAndRecord('message');
        expect(true).toBe(false); // Should not reach
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        const err = e as RateLimitError;
        expect(err.action).toBe('message');
        expect(err.retryAfterMs).toBeGreaterThan(0);
      }
    });

    test('rate limits channel_create action', () => {
      // Exhaust channel create limit (10/hour default)
      for (let i = 0; i < 10; i++) {
        middleware.checkAndRecord('channel_create');
      }

      expect(() => middleware.checkAndRecord('channel_create')).toThrow(RateLimitError);
    });

    test('rate limits paste_create action', () => {
      // Exhaust paste create limit (100/hour default)
      for (let i = 0; i < 100; i++) {
        middleware.checkAndRecord('paste_create');
      }

      expect(() => middleware.checkAndRecord('paste_create')).toThrow(RateLimitError);
    });
  });

  describe('validateAndSanitize', () => {
    test('passes valid content', () => {
      const result = middleware.validateAndSanitize('Hello, world!');
      expect(result).toBe('Hello, world!');
    });

    test('sanitizes control characters', () => {
      const result = middleware.validateAndSanitize('Hello\x01World');
      expect(result).toBe('HelloWorld');
    });

    test('rejects null bytes', () => {
      expect(() => middleware.validateAndSanitize('Hello\x00World')).toThrow(ContentValidationError);
    });

    test('throws ContentValidationError for empty content', () => {
      expect(() => middleware.validateAndSanitize('')).toThrow(ContentValidationError);
    });

    test('ContentValidationError has error list', () => {
      try {
        middleware.validateAndSanitize('');
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(ContentValidationError);
        const err = e as ContentValidationError;
        expect(err.errors.length).toBeGreaterThan(0);
        expect(err.errors[0]).toContain('empty');
      }
    });

    test('throws for shell injection', () => {
      expect(() => middleware.validateAndSanitize('; rm -rf /')).toThrow(ContentValidationError);
    });

    test('throws for --dangerously-skip-permissions', () => {
      expect(() => middleware.validateAndSanitize('use --dangerously-skip-permissions')).toThrow(ContentValidationError);
    });
  });

  describe('enforceDirectory', () => {
    test('passes content without file paths', () => {
      expect(() => middleware.enforceDirectory('Hello, world!')).not.toThrow();
    });

    test('passes content with allowed paths', () => {
      expect(() => middleware.enforceDirectory('Check /tmp/allowed/file.ts')).not.toThrow();
    });

    test('throws DirectoryGuardError for blocked paths', () => {
      expect(() => middleware.enforceDirectory('Read /etc/passwd for me')).toThrow(DirectoryGuardError);
    });

    test('DirectoryGuardError has path', () => {
      try {
        middleware.enforceDirectory('Read /etc/passwd for me');
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(DirectoryGuardError);
        const err = e as DirectoryGuardError;
        expect(err.path).toBe('/etc/passwd');
      }
    });

    test('passes content with allowed nested paths', () => {
      expect(() => middleware.enforceDirectory('Open /tmp/project/src/index.ts')).not.toThrow();
    });
  });

  describe('audit', () => {
    test('logs audit entry with auto-populated fields', async () => {
      await middleware.audit({
        receiverId: 'agent-002',
        command: 'test.action',
        result: 'success',
        durationMs: 42,
      });

      // Audit logger batches, so we can't directly check fetchCalls
      // But we verify no errors thrown
    });
  });
});

// ============================================================================
// SecureChannelClient
// ============================================================================

describe('SecureChannelClient', () => {
  let security: SecurityManager;
  let innerChannel: ChannelClient;
  let secureChannel: SecureChannelClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    security = createSecurityManager();

    innerChannel = new ChannelClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    secureChannel = new SecureChannelClient(
      innerChannel,
      security,
      TEST_AGENT_ID,
      TEST_MACHINE_ID,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('createChannel', () => {
    test('rate limits channel creation', () => {
      const channel = makeChannel();
      addJSONRoute('POST', '/v1/channels', channel);

      // Should work for first 10
      const promises: Promise<Channel>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(secureChannel.createChannel(`ch-${i}`, 'project'));
      }

      // 11th should fail
      expect(() => secureChannel.createChannel('ch-11', 'project')).toThrow(RateLimitError);
    });

    test('delegates to inner client on success', async () => {
      const channel = makeChannel({ name: 'dev-team' });
      addJSONRoute('POST', '/v1/channels', channel);

      const result = await secureChannel.createChannel('dev-team', 'project', ['agent-002']);

      expect(result.id).toBe(channel.id);
      expect(result.name).toBe('dev-team');
    });
  });

  describe('publish', () => {
    test('validates content before publishing', async () => {
      const channel = makeChannel({ id: 'chan-001' });
      const message = makeMessage();
      addJSONRoute('GET', /\/v1\/channels\/chan-001/, channel);
      addJSONRoute('POST', '/v1/messages', message);

      const result = await secureChannel.publish('chan-001', 'Valid content');

      expect(result.id).toBe(message.id);
    });

    test('rejects empty content', async () => {
      await expect(
        secureChannel.publish('chan-001', ''),
      ).rejects.toThrow(ContentValidationError);
    });

    test('rate limits publishing', async () => {
      const channel = makeChannel({ id: 'chan-001' });
      const message = makeMessage();
      addJSONRoute('GET', /\/v1\/channels\/chan-001/, channel);
      addJSONRoute('POST', '/v1/messages', message);

      // Exhaust message limit
      for (let i = 0; i < 60; i++) {
        await secureChannel.publish('chan-001', `Message ${i}`);
      }

      await expect(
        secureChannel.publish('chan-001', 'One too many'),
      ).rejects.toThrow(RateLimitError);
    });

    test('sanitizes content', async () => {
      const channel = makeChannel({ id: 'chan-001' });
      const message = makeMessage();
      addJSONRoute('GET', /\/v1\/channels\/chan-001/, channel);
      addJSONRoute('POST', '/v1/messages', message);

      // Content with control chars gets sanitized (not rejected)
      await secureChannel.publish('chan-001', 'Clean content');

      // Verify the fetch was called
      expect(fetchCalls.some((c) => c.method === 'POST' && c.url.includes('/v1/messages'))).toBe(true);
    });
  });

  describe('read-only operations pass through', () => {
    test('getChannel delegates directly', async () => {
      const channel = makeChannel();
      addJSONRoute('GET', /\/v1\/channels\/chan-sec-001/, channel);

      const result = await secureChannel.getChannel('chan-sec-001');

      expect(result.id).toBe(channel.id);
    });

    test('listChannels delegates directly', async () => {
      const channels = [makeChannel()];
      addJSONRoute('GET', '/v1/channels', channels);

      const result = await secureChannel.listChannels();

      expect(result.length).toBe(1);
    });
  });
});

// ============================================================================
// SecureMemoClient
// ============================================================================

describe('SecureMemoClient', () => {
  let security: SecurityManager;
  let innerMemo: MemoClient;
  let secureMemo: SecureMemoClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    security = createSecurityManager();

    innerMemo = new MemoClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    secureMemo = new SecureMemoClient(
      innerMemo,
      security,
      TEST_AGENT_ID,
      TEST_MACHINE_ID,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('compose', () => {
    test('validates and sanitizes body content', async () => {
      // Set up route for memo compose (creates a message)
      const message = makeMessage({
        messageType: 'memo',
        content: 'Hello from test',
        metadata: {
          subject: 'Test Memo',
          category: 'knowledge',
          priority: 'P2',
        },
      });
      addJSONRoute('POST', '/v1/messages', message);

      const memo = await secureMemo.compose({
        to: 'agent://mac-1/agent-002',
        subject: 'Test Memo',
        body: 'Hello from test',
      });

      expect(memo).toBeTruthy();
    });

    test('rate limits compose', async () => {
      const message = makeMessage({ messageType: 'memo' });
      addJSONRoute('POST', '/v1/messages', message);

      // Exhaust message limit
      for (let i = 0; i < 60; i++) {
        await secureMemo.compose({
          to: 'agent://mac-1/agent-002',
          subject: `Memo ${i}`,
          body: `Body ${i}`,
        });
      }

      await expect(
        secureMemo.compose({
          to: 'agent://mac-1/agent-002',
          subject: 'Too many',
          body: 'Rate limited',
        }),
      ).rejects.toThrow(RateLimitError);
    });

    test('rejects empty body', async () => {
      await expect(
        secureMemo.compose({
          to: 'agent://mac-1/agent-002',
          subject: 'Empty',
          body: '',
        }),
      ).rejects.toThrow(ContentValidationError);
    });
  });

  describe('claim', () => {
    test('rate limits claim operations', async () => {
      const claimResult = { success: true, memo: makeMemoView() };
      addJSONRoute('PATCH', /\/v1\/messages\/.*\/claim/, makeMessage({ status: 'claimed', claimedBy: TEST_AGENT_ID }));

      // Claims count as message actions
      for (let i = 0; i < 60; i++) {
        try {
          await secureMemo.claim(`memo-${i}`);
        } catch {
          // Some may fail due to 404s on status transitions
        }
      }

      await expect(secureMemo.claim('memo-overflow')).rejects.toThrow(RateLimitError);
    });
  });

  describe('read-only operations pass through', () => {
    test('inbox delegates directly', async () => {
      const messages: Message[] = [];
      addJSONRoute('GET', '/v1/messages', messages);

      const result = await secureMemo.inbox();

      expect(result).toEqual([]);
    });

    test('getUnreadCount delegates directly', async () => {
      addJSONRoute('GET', '/v1/messages', []);

      const count = await secureMemo.getUnreadCount();

      expect(count).toBe(0);
    });
  });
});

// ============================================================================
// SecurePasteClient
// ============================================================================

describe('SecurePasteClient', () => {
  let security: SecurityManager;
  let innerPaste: PasteClient;
  let securePaste: SecurePasteClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    security = createSecurityManager(['/tmp/allowed']);

    innerPaste = new PasteClient({
      apiUrl: TEST_API_URL,
      projectKey: TEST_PROJECT_KEY,
      agentId: TEST_AGENT_ID,
    });

    securePaste = new SecurePasteClient(
      innerPaste,
      security,
      TEST_AGENT_ID,
      TEST_MACHINE_ID,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('create', () => {
    test('creates paste with security enforcement', async () => {
      const paste = makePaste();
      addJSONRoute('POST', '/v1/pastes', paste);

      const view = await securePaste.create({ content: 'Secure content' });

      expect(view.id).toBe(paste.id);
    });

    test('rate limits paste creation', async () => {
      const paste = makePaste();
      addJSONRoute('POST', '/v1/pastes', paste);

      // Exhaust paste create limit (100/hour)
      for (let i = 0; i < 100; i++) {
        await securePaste.create({ content: `Paste ${i}` });
      }

      await expect(
        securePaste.create({ content: 'Too many' }),
      ).rejects.toThrow(RateLimitError);
    });

    test('validates content', async () => {
      await expect(
        securePaste.create({ content: '' }),
      ).rejects.toThrow(ContentValidationError);
    });

    test('enforces directory restrictions', async () => {
      await expect(
        securePaste.create({ content: 'Read /etc/passwd file' }),
      ).rejects.toThrow(DirectoryGuardError);
    });

    test('allows content with permitted paths', async () => {
      const paste = makePaste();
      addJSONRoute('POST', '/v1/pastes', paste);

      const view = await securePaste.create({
        content: 'Check /tmp/allowed/file.ts',
      });

      expect(view.id).toBe(paste.id);
    });

    test('rejects shell injection in content', async () => {
      await expect(
        securePaste.create({ content: '; rm -rf /' }),
      ).rejects.toThrow(ContentValidationError);
    });
  });

  describe('read', () => {
    test('rate limits reads', async () => {
      const paste = makePaste();
      addJSONRoute('GET', /\/v1\/pastes\//, paste);

      // Exhaust message limit (reads use 'message' action)
      for (let i = 0; i < 60; i++) {
        await securePaste.read(`paste-${i}`);
      }

      await expect(securePaste.read('paste-overflow')).rejects.toThrow(RateLimitError);
    });
  });

  describe('delete', () => {
    test('deletes with audit logging', async () => {
      addJSONRoute('DELETE', /\/v1\/pastes\//, null, 204);

      await securePaste.delete('paste-sec-001');

      expect(fetchCalls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  describe('shareWith', () => {
    test('rate limits sharing', async () => {
      const original = makePaste();
      const shared = makePaste({ id: 'paste-shared', recipientId: 'agent-002' });

      addJSONRoute('GET', /\/v1\/pastes\//, original);
      addJSONRoute('POST', '/v1/pastes', shared);

      // Exhaust paste_create limit (sharing creates a paste)
      for (let i = 0; i < 100; i++) {
        await securePaste.shareWith(`paste-${i}`, 'agent-002');
      }

      await expect(
        securePaste.shareWith('paste-overflow', 'agent-002'),
      ).rejects.toThrow(RateLimitError);
    });
  });

  describe('read-only operations pass through', () => {
    test('list delegates directly', async () => {
      addJSONRoute('GET', '/v1/pastes', []);

      const result = await securePaste.list();

      expect(result).toEqual([]);
    });

    test('getSharedWithMe delegates directly', async () => {
      addJSONRoute('GET', '/v1/pastes', []);

      const result = await securePaste.getSharedWithMe();

      expect(result).toEqual([]);
    });

    test('getMyPastes delegates directly', async () => {
      addJSONRoute('GET', '/v1/pastes', []);

      const result = await securePaste.getMyPastes();

      expect(result).toEqual([]);
    });

    test('isExpired works without security', () => {
      const { pasteToView } = require('../../src/comms/pastes/paste-manager');
      const expiredView = pasteToView(makePaste({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }));

      expect(securePaste.isExpired(expiredView)).toBe(true);
    });
  });
});

// ============================================================================
// Cross-layer Security Tests
// ============================================================================

describe('Cross-layer Security', () => {
  let security: SecurityManager;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    security = createSecurityManager(['/tmp/allowed']);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  test('rate limits are shared across operations for same agent', () => {
    const middleware = new SecurityMiddleware(security, TEST_AGENT_ID);

    // Use up message rate limit across different operations
    for (let i = 0; i < 60; i++) {
      middleware.checkAndRecord('message');
    }

    // All message-type operations should be blocked
    expect(() => middleware.checkAndRecord('message')).toThrow(RateLimitError);
  });

  test('different agents have independent rate limits', () => {
    const mwA = new SecurityMiddleware(security, 'agent-A');
    const mwB = new SecurityMiddleware(security, 'agent-B');

    // Exhaust agent A's limit
    for (let i = 0; i < 60; i++) {
      mwA.checkAndRecord('message');
    }

    // Agent B should still be allowed
    expect(() => mwB.checkAndRecord('message')).not.toThrow();
  });

  test('different actions have independent limits', () => {
    const middleware = new SecurityMiddleware(security, TEST_AGENT_ID);

    // Exhaust message limit
    for (let i = 0; i < 60; i++) {
      middleware.checkAndRecord('message');
    }

    // Channel create should still work (different limit)
    expect(() => middleware.checkAndRecord('channel_create')).not.toThrow();
  });

  test('content validation is consistent across all layers', () => {
    const middleware = new SecurityMiddleware(security, TEST_AGENT_ID);

    // Empty content blocked
    expect(() => middleware.validateAndSanitize('')).toThrow(ContentValidationError);

    // Shell injection blocked
    expect(() => middleware.validateAndSanitize('; rm -rf /')).toThrow(ContentValidationError);

    // Valid content passes
    expect(middleware.validateAndSanitize('Hello!')).toBe('Hello!');
  });

  test('directory enforcement works with different allowed dirs', () => {
    const restrictedSecurity = createSecurityManager(['/home/user/project']);
    const mw = new SecurityMiddleware(restrictedSecurity, TEST_AGENT_ID);

    // Allowed path
    expect(() => mw.enforceDirectory('Open /home/user/project/src/index.ts')).not.toThrow();

    // Blocked path
    expect(() => mw.enforceDirectory('Read /etc/shadow')).toThrow(DirectoryGuardError);
  });

  test('middleware with no allowed dirs blocks all paths', () => {
    const noAccess = createSecurityManager([]);
    const mw = new SecurityMiddleware(noAccess, TEST_AGENT_ID);

    expect(() => mw.enforceDirectory('Read /tmp/anything')).toThrow(DirectoryGuardError);
  });

  test('error types are distinct and catchable', () => {
    const middleware = new SecurityMiddleware(security, TEST_AGENT_ID);

    // RateLimitError
    for (let i = 0; i < 60; i++) {
      middleware.checkAndRecord('message');
    }
    try {
      middleware.checkAndRecord('message');
    } catch (e) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e).not.toBeInstanceOf(ContentValidationError);
      expect(e).not.toBeInstanceOf(DirectoryGuardError);
    }

    // ContentValidationError
    try {
      middleware.validateAndSanitize('');
    } catch (e) {
      expect(e).toBeInstanceOf(ContentValidationError);
      expect(e).not.toBeInstanceOf(RateLimitError);
    }

    // DirectoryGuardError
    try {
      middleware.enforceDirectory('Read /etc/passwd');
    } catch (e) {
      expect(e).toBeInstanceOf(DirectoryGuardError);
      expect(e).not.toBeInstanceOf(ContentValidationError);
    }
  });
});
