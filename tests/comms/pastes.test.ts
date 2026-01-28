/**
 * Unit Tests for Paste System (COMMS-005)
 *
 * Covers:
 * - PasteManager: create, read, delete, list, validation, contentType defaults
 * - PasteSharing: shareWith, getSharedWithMe, getMyPastes, isExpired
 * - PasteClient facade: create, read, share, list, delete
 * - pasteToView: conversion and derived fields
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PasteManager, pasteToView } from '../../src/comms/pastes/paste-manager';
import { PasteSharing } from '../../src/comms/pastes/paste-sharing';
import { PasteClient } from '../../src/comms/pastes/paste-client';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Paste, AccessType } from '../../src/comms/protocol/types';
import type { PasteConfig, PasteView } from '../../src/comms/pastes/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-pastes.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_pastes';
const TEST_AGENT_ID = 'agent-uuid-001';
const OTHER_AGENT_ID = 'agent-uuid-002';

const DEFAULT_CONFIG: PasteConfig = {
  apiUrl: TEST_API_URL,
  projectKey: TEST_PROJECT_KEY,
  agentId: TEST_AGENT_ID,
};

function makePaste(overrides: Partial<Paste> = {}): Paste {
  return {
    id: 'paste-uuid-001',
    creatorId: TEST_AGENT_ID,
    content: 'Hello, paste world!',
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

function makeExpiredPaste(overrides: Partial<Paste> = {}): Paste {
  return makePaste({
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
}

function makeReadOncePaste(overrides: Partial<Paste> = {}): Paste {
  return makePaste({
    accessType: 'read_once',
    ttlSeconds: null,
    expiresAt: null,
    ...overrides,
  });
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

function createTestClient(): SignalDBClient {
  return new SignalDBClient({
    apiUrl: TEST_API_URL,
    projectKey: TEST_PROJECT_KEY,
  });
}

// ============================================================================
// pasteToView
// ============================================================================

describe('pasteToView', () => {
  test('converts Paste to PasteView with derived fields', () => {
    const paste = makePaste();
    const view = pasteToView(paste);

    expect(view.id).toBe(paste.id);
    expect(view.creatorId).toBe(paste.creatorId);
    expect(view.content).toBe(paste.content);
    expect(view.contentType).toBe(paste.contentType);
    expect(view.accessMode).toBe(paste.accessType);
    expect(view.ttlSeconds).toBe(paste.ttlSeconds);
    expect(view.recipientId).toBe(paste.recipientId);
    expect(view.readBy).toEqual([]);
    expect(view.readAt).toBeNull();
    expect(view.isExpired).toBe(false);
    expect(view.isRead).toBe(false);
  });

  test('detects expired paste', () => {
    const paste = makeExpiredPaste();
    const view = pasteToView(paste);

    expect(view.isExpired).toBe(true);
  });

  test('detects read paste', () => {
    const paste = makePaste({ readAt: new Date().toISOString() });
    const view = pasteToView(paste);

    expect(view.isRead).toBe(true);
  });

  test('handles null expiresAt', () => {
    const paste = makePaste({ expiresAt: null });
    const view = pasteToView(paste);

    expect(view.isExpired).toBe(false);
  });

  test('handles read_once access type', () => {
    const paste = makeReadOncePaste();
    const view = pasteToView(paste);

    expect(view.accessMode).toBe('read_once');
    expect(view.ttlSeconds).toBeNull();
  });

  test('includes readBy array', () => {
    const paste = makePaste({ readBy: ['agent-1', 'agent-2'] });
    const view = pasteToView(paste);

    expect(view.readBy).toEqual(['agent-1', 'agent-2']);
  });

  test('handles null readBy', () => {
    const paste = makePaste({ readBy: null as unknown as string[] });
    const view = pasteToView(paste);

    expect(view.readBy).toEqual([]);
  });

  test('sets metadata to empty object', () => {
    const paste = makePaste();
    const view = pasteToView(paste);

    expect(view.metadata).toEqual({});
  });
});

// ============================================================================
// PasteManager
// ============================================================================

describe('PasteManager', () => {
  let client: SignalDBClient;
  let manager: PasteManager;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    client = createTestClient();
    manager = new PasteManager(client, DEFAULT_CONFIG);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('create', () => {
    test('creates a paste with defaults', async () => {
      const paste = makePaste();
      addJSONRoute('POST', '/v1/pastes', paste);

      const view = await manager.create({ content: 'Hello!' });

      expect(view.id).toBe(paste.id);
      expect(view.content).toBe(paste.content);
      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0]!.method).toBe('POST');

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.creatorId).toBe(TEST_AGENT_ID);
      expect(body.contentType).toBe('text/plain');
      expect(body.accessType).toBe('ttl');
      expect(body.ttlSeconds).toBe(3600);
    });

    test('creates with custom content type', async () => {
      const paste = makePaste({ contentType: 'application/json' });
      addJSONRoute('POST', '/v1/pastes', paste);

      await manager.create({
        content: '{"key": "value"}',
        contentType: 'application/json',
      });

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.contentType).toBe('application/json');
    });

    test('creates with read_once access mode', async () => {
      const paste = makeReadOncePaste();
      addJSONRoute('POST', '/v1/pastes', paste);

      await manager.create({
        content: 'Secret!',
        accessMode: 'read_once',
      });

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.accessType).toBe('read_once');
    });

    test('creates with custom TTL', async () => {
      const paste = makePaste({ ttlSeconds: 300 });
      addJSONRoute('POST', '/v1/pastes', paste);

      await manager.create({ content: 'Short TTL', ttlSeconds: 300 });

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.ttlSeconds).toBe(300);
    });

    test('creates with recipient', async () => {
      const paste = makePaste({ recipientId: OTHER_AGENT_ID });
      addJSONRoute('POST', '/v1/pastes', paste);

      await manager.create({
        content: 'For you',
        recipientId: OTHER_AGENT_ID,
      });

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.recipientId).toBe(OTHER_AGENT_ID);
    });

    test('rejects empty content', async () => {
      await expect(manager.create({ content: '' })).rejects.toThrow(
        'Paste content must not be empty',
      );
    });

    test('rejects whitespace-only content', async () => {
      await expect(manager.create({ content: '   ' })).rejects.toThrow(
        'Paste content must not be empty',
      );
    });
  });

  describe('read', () => {
    test('reads a paste by ID', async () => {
      const paste = makePaste();
      addJSONRoute('GET', /\/v1\/pastes\/paste-uuid-001/, paste);

      const view = await manager.read('paste-uuid-001');

      expect(view.id).toBe('paste-uuid-001');
      expect(view.content).toBe('Hello, paste world!');
      expect(fetchCalls[0]!.url).toContain('reader_id=agent-uuid-001');
    });

    test('returns PasteView with derived fields', async () => {
      const paste = makePaste({
        readAt: new Date().toISOString(),
        readBy: [TEST_AGENT_ID],
      });
      addJSONRoute('GET', /\/v1\/pastes\//, paste);

      const view = await manager.read('paste-uuid-001');

      expect(view.isRead).toBe(true);
      expect(view.readBy).toEqual([TEST_AGENT_ID]);
    });
  });

  describe('delete', () => {
    test('deletes a paste by ID', async () => {
      addJSONRoute('DELETE', /\/v1\/pastes\/paste-uuid-001/, null, 204);

      await manager.delete('paste-uuid-001');

      expect(fetchCalls.length).toBe(1);
      expect(fetchCalls[0]!.method).toBe('DELETE');
    });
  });

  describe('list', () => {
    test('lists all pastes for agent', async () => {
      const pastes = [makePaste(), makePaste({ id: 'paste-uuid-002' })];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list();

      expect(views.length).toBe(2);
    });

    test('filters by creatorId', async () => {
      const pastes = [
        makePaste({ creatorId: TEST_AGENT_ID }),
        makePaste({ id: 'paste-uuid-002', creatorId: OTHER_AGENT_ID }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list({ creatorId: TEST_AGENT_ID });

      expect(views.length).toBe(1);
      expect(views[0]!.creatorId).toBe(TEST_AGENT_ID);
    });

    test('filters by recipientId', async () => {
      const pastes = [
        makePaste({ recipientId: TEST_AGENT_ID }),
        makePaste({ id: 'paste-uuid-002', recipientId: null }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list({ recipientId: TEST_AGENT_ID });

      expect(views.length).toBe(1);
      expect(views[0]!.recipientId).toBe(TEST_AGENT_ID);
    });

    test('filters by contentType', async () => {
      const pastes = [
        makePaste({ contentType: 'text/plain' }),
        makePaste({ id: 'paste-uuid-002', contentType: 'application/json' }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list({ contentType: 'application/json' });

      expect(views.length).toBe(1);
      expect(views[0]!.contentType).toBe('application/json');
    });

    test('excludes expired by default', async () => {
      const pastes = [
        makePaste(),
        makeExpiredPaste({ id: 'paste-uuid-expired' }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list();

      expect(views.length).toBe(1);
      expect(views[0]!.id).toBe('paste-uuid-001');
    });

    test('includes expired when requested', async () => {
      const pastes = [
        makePaste(),
        makeExpiredPaste({ id: 'paste-uuid-expired' }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const views = await manager.list({ includeExpired: true });

      expect(views.length).toBe(2);
    });
  });
});

// ============================================================================
// PasteSharing
// ============================================================================

describe('PasteSharing', () => {
  let client: SignalDBClient;
  let sharing: PasteSharing;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    client = createTestClient();
    sharing = new PasteSharing(client, DEFAULT_CONFIG);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('shareWith', () => {
    test('creates a copy for the recipient', async () => {
      const original = makePaste();
      const shared = makePaste({
        id: 'paste-uuid-shared',
        recipientId: OTHER_AGENT_ID,
      });

      addJSONRoute('GET', /\/v1\/pastes\/paste-uuid-001/, original);
      addJSONRoute('POST', '/v1/pastes', shared);

      const view = await sharing.shareWith('paste-uuid-001', OTHER_AGENT_ID);

      expect(view.id).toBe('paste-uuid-shared');
      expect(view.recipientId).toBe(OTHER_AGENT_ID);
      expect(fetchCalls.length).toBe(2);
      expect(fetchCalls[0]!.method).toBe('GET');
      expect(fetchCalls[1]!.method).toBe('POST');
    });

    test('preserves content type and access mode', async () => {
      const original = makePaste({
        contentType: 'application/json',
        accessType: 'read_once',
      });
      const shared = makePaste({
        id: 'paste-uuid-shared',
        recipientId: OTHER_AGENT_ID,
      });

      addJSONRoute('GET', /\/v1\/pastes\//, original);
      addJSONRoute('POST', '/v1/pastes', shared);

      await sharing.shareWith('paste-uuid-001', OTHER_AGENT_ID);

      const body = fetchCalls[1]!.body as Record<string, unknown>;
      expect(body.contentType).toBe('application/json');
      expect(body.accessType).toBe('read_once');
    });
  });

  describe('getSharedWithMe', () => {
    test('returns pastes where recipientId matches agent', async () => {
      const pastes = [
        makePaste({ recipientId: TEST_AGENT_ID }),
        makePaste({ id: 'paste-uuid-002', recipientId: OTHER_AGENT_ID }),
        makePaste({ id: 'paste-uuid-003', recipientId: null }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const shared = await sharing.getSharedWithMe();

      expect(shared.length).toBe(1);
      expect(shared[0]!.recipientId).toBe(TEST_AGENT_ID);
    });

    test('excludes expired pastes', async () => {
      const pastes = [
        makePaste({ recipientId: TEST_AGENT_ID }),
        makeExpiredPaste({ id: 'paste-uuid-expired', recipientId: TEST_AGENT_ID }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const shared = await sharing.getSharedWithMe();

      expect(shared.length).toBe(1);
    });
  });

  describe('getMyPastes', () => {
    test('returns pastes where creatorId matches agent', async () => {
      const pastes = [
        makePaste({ creatorId: TEST_AGENT_ID }),
        makePaste({ id: 'paste-uuid-002', creatorId: OTHER_AGENT_ID }),
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      const mine = await sharing.getMyPastes();

      expect(mine.length).toBe(1);
      expect(mine[0]!.creatorId).toBe(TEST_AGENT_ID);
    });
  });

  describe('isExpired', () => {
    test('returns false for non-expired paste', () => {
      const view = pasteToView(makePaste());
      expect(sharing.isExpired(view)).toBe(false);
    });

    test('returns true for expired paste', () => {
      const view = pasteToView(makeExpiredPaste());
      expect(sharing.isExpired(view)).toBe(true);
    });

    test('returns false for paste with null expiresAt', () => {
      const view = pasteToView(makePaste({ expiresAt: null }));
      expect(sharing.isExpired(view)).toBe(false);
    });
  });
});

// ============================================================================
// PasteClient (Facade)
// ============================================================================

describe('PasteClient', () => {
  let pasteClient: PasteClient;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    pasteClient = new PasteClient(DEFAULT_CONFIG);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  test('create delegates to PasteManager', async () => {
    const paste = makePaste();
    addJSONRoute('POST', '/v1/pastes', paste);

    const view = await pasteClient.create({ content: 'Hello!' });

    expect(view.id).toBe(paste.id);
  });

  test('read delegates to PasteManager', async () => {
    const paste = makePaste();
    addJSONRoute('GET', /\/v1\/pastes\/paste-uuid-001/, paste);

    const view = await pasteClient.read('paste-uuid-001');

    expect(view.id).toBe(paste.id);
  });

  test('delete delegates to PasteManager', async () => {
    addJSONRoute('DELETE', /\/v1\/pastes\/paste-uuid-001/, null, 204);

    await pasteClient.delete('paste-uuid-001');

    expect(fetchCalls.length).toBe(1);
  });

  test('list delegates to PasteManager', async () => {
    const pastes = [makePaste()];
    addJSONRoute('GET', '/v1/pastes', pastes);

    const views = await pasteClient.list();

    expect(views.length).toBe(1);
  });

  test('shareWith delegates to PasteSharing', async () => {
    const original = makePaste();
    const shared = makePaste({ id: 'paste-shared', recipientId: OTHER_AGENT_ID });

    addJSONRoute('GET', /\/v1\/pastes\/paste-uuid-001/, original);
    addJSONRoute('POST', '/v1/pastes', shared);

    const view = await pasteClient.shareWith('paste-uuid-001', OTHER_AGENT_ID);

    expect(view.recipientId).toBe(OTHER_AGENT_ID);
  });

  test('getSharedWithMe delegates to PasteSharing', async () => {
    const pastes = [makePaste({ recipientId: TEST_AGENT_ID })];
    addJSONRoute('GET', '/v1/pastes', pastes);

    const shared = await pasteClient.getSharedWithMe();

    expect(shared.length).toBe(1);
  });

  test('getMyPastes delegates to PasteSharing', async () => {
    const pastes = [makePaste({ creatorId: TEST_AGENT_ID })];
    addJSONRoute('GET', '/v1/pastes', pastes);

    const mine = await pasteClient.getMyPastes();

    expect(mine.length).toBe(1);
  });

  test('isExpired delegates to PasteSharing', () => {
    const view = pasteToView(makeExpiredPaste());
    expect(pasteClient.isExpired(view)).toBe(true);
  });

  test('accepts external SignalDBClient', async () => {
    const client = createTestClient();
    const custom = new PasteClient(DEFAULT_CONFIG, client);

    const paste = makePaste();
    addJSONRoute('POST', '/v1/pastes', paste);

    const view = await custom.create({ content: 'Via custom client' });
    expect(view.id).toBe(paste.id);
  });
});
