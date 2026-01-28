/**
 * Integration Tests for Paste System (COMMS-005)
 *
 * Covers full lifecycle flows:
 * - Create → Share → Read → Delete
 * - Access modes: read_once, ttl
 * - Recipient filtering, expiration checks
 * - Multiple agents interacting
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PasteClient } from '../../src/comms/pastes/paste-client';
import { PasteManager, pasteToView } from '../../src/comms/pastes/paste-manager';
import { PasteSharing } from '../../src/comms/pastes/paste-sharing';
import { SignalDBClient } from '../../src/comms/client/signaldb';
import type { Paste } from '../../src/comms/protocol/types';
import type { PasteConfig } from '../../src/comms/pastes/types';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-pastes-int.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_pastes_int';
const AGENT_A = 'agent-aaa-001';
const AGENT_B = 'agent-bbb-002';

function makeConfig(agentId: string): PasteConfig {
  return { apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY, agentId };
}

let pasteIdCounter = 0;

function makePaste(overrides: Partial<Paste> = {}): Paste {
  pasteIdCounter++;
  return {
    id: `paste-int-${pasteIdCounter}`,
    creatorId: AGENT_A,
    content: `Integration test paste #${pasteIdCounter}`,
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

/** In-memory paste store for integration simulation */
let pasteStore: Map<string, Paste>;

function setupMockFetch(): void {
  fetchCalls = [];
  pasteStore = new Map();

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

function setupIntegrationRoutes(): void {
  // CREATE paste
  routes.push({
    method: 'POST',
    pathPattern: '/v1/pastes',
    handler: async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const id = `paste-int-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      const expiresAt = body.ttlSeconds
        ? new Date(Date.now() + body.ttlSeconds * 1000).toISOString()
        : null;

      const paste: Paste = {
        id,
        creatorId: body.creatorId,
        content: body.content,
        contentType: body.contentType ?? 'text/plain',
        accessType: body.accessType ?? 'ttl',
        ttlSeconds: body.ttlSeconds ?? 3600,
        recipientId: body.recipientId ?? null,
        readBy: [],
        readAt: null,
        createdAt: now,
        expiresAt,
        deletedAt: null,
      };

      pasteStore.set(id, paste);

      return new Response(JSON.stringify(paste), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  // READ paste by ID
  routes.push({
    method: 'GET',
    pathPattern: /\/v1\/pastes\/[^?]+/,
    handler: (url: string) => {
      const pathParts = url.split('/v1/pastes/')[1]!.split('?');
      const id = pathParts[0]!;
      const params = new URLSearchParams(pathParts[1] ?? '');
      const readerId = params.get('reader_id');

      const paste = pasteStore.get(id);
      if (!paste) {
        return new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Mark as read
      if (readerId && !paste.readBy.includes(readerId)) {
        paste.readBy.push(readerId);
        paste.readAt = new Date().toISOString();
      }

      return new Response(JSON.stringify(paste), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  // DELETE paste
  routes.push({
    method: 'DELETE',
    pathPattern: /\/v1\/pastes\//,
    handler: (url: string) => {
      const id = url.split('/v1/pastes/')[1]!;
      pasteStore.delete(id);
      return new Response(null, { status: 204, statusText: 'No Content' });
    },
  });

  // LIST pastes for agent
  routes.push({
    method: 'GET',
    pathPattern: '/v1/pastes',
    handler: (url: string) => {
      // Don't match specific paste IDs (those are handled above)
      if (/\/v1\/pastes\/[^?]/.test(url)) {
        return new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const params = new URLSearchParams(url.split('?')[1] ?? '');
      const agentId = params.get('agent_id');

      const allPastes = Array.from(pasteStore.values());
      const filtered = agentId
        ? allPastes.filter((p) => p.creatorId === agentId || p.recipientId === agentId)
        : allPastes;

      return new Response(JSON.stringify(filtered), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Paste Integration', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    routes = [];
    pasteIdCounter = 0;
    setupMockFetch();
    setupIntegrationRoutes();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
  });

  describe('Full Lifecycle: create → read → delete', () => {
    test('agent creates, reads, and deletes a paste', async () => {
      const clientA = new PasteClient(makeConfig(AGENT_A));

      // Create
      const created = await clientA.create({
        content: 'Full lifecycle test',
        contentType: 'text/plain',
        ttlSeconds: 600,
      });

      expect(created.id).toBeTruthy();
      expect(created.content).toBe('Full lifecycle test');
      expect(created.accessMode).toBe('ttl');

      // Read
      const read = await clientA.read(created.id);

      expect(read.id).toBe(created.id);
      expect(read.content).toBe('Full lifecycle test');
      expect(read.isRead).toBe(true);
      expect(read.readBy).toContain(AGENT_A);

      // Delete
      await clientA.delete(created.id);

      // Verify deleted
      await expect(clientA.read(created.id)).rejects.toThrow();
    });
  });

  describe('Full Lifecycle: create → share → read by recipient', () => {
    test('agent A creates and shares with agent B', async () => {
      const clientA = new PasteClient(makeConfig(AGENT_A));
      const clientB = new PasteClient(makeConfig(AGENT_B));

      // Agent A creates
      const created = await clientA.create({
        content: 'Shared content',
      });

      // Agent A shares with B
      const shared = await clientA.shareWith(created.id, AGENT_B);

      expect(shared.recipientId).toBe(AGENT_B);

      // Agent B reads the shared paste
      const readByB = await clientB.read(shared.id);

      expect(readByB.content).toBe('Shared content');
      expect(readByB.readBy).toContain(AGENT_B);
    });
  });

  describe('Access Modes', () => {
    test('TTL paste has expiration timestamp', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const paste = await client.create({
        content: 'TTL paste',
        accessMode: 'ttl',
        ttlSeconds: 300,
      });

      expect(paste.accessMode).toBe('ttl');
      expect(paste.expiresAt).toBeTruthy();
      expect(paste.isExpired).toBe(false);
    });

    test('read_once paste can be read', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const paste = await client.create({
        content: 'Read once secret',
        accessMode: 'read_once',
      });

      expect(paste.accessMode).toBe('read_once');

      // First read succeeds
      const read = await client.read(paste.id);
      expect(read.content).toBe('Read once secret');
    });
  });

  describe('Recipient Filtering', () => {
    test('getSharedWithMe filters correctly', async () => {
      const clientA = new PasteClient(makeConfig(AGENT_A));
      const clientB = new PasteClient(makeConfig(AGENT_B));

      // A creates two pastes, one for B
      await clientA.create({ content: 'Public paste' });
      const forB = await clientA.create({
        content: 'For agent B only',
        recipientId: AGENT_B,
      });

      // B checks shared
      const shared = await clientB.getSharedWithMe();

      // Should find at least the one addressed to B
      const found = shared.find((p) => p.id === forB.id);
      expect(found).toBeTruthy();
      expect(found!.recipientId).toBe(AGENT_B);
    });

    test('getMyPastes returns only own pastes', async () => {
      const clientA = new PasteClient(makeConfig(AGENT_A));

      await clientA.create({ content: 'Paste 1' });
      await clientA.create({ content: 'Paste 2' });

      const mine = await clientA.getMyPastes();

      expect(mine.length).toBeGreaterThanOrEqual(2);
      for (const p of mine) {
        expect(p.creatorId).toBe(AGENT_A);
      }
    });
  });

  describe('Expiration Checks', () => {
    test('isExpired returns correct result', () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const future = pasteToView(makePaste({
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }));
      const past = pasteToView(makePaste({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }));
      const noExpiry = pasteToView(makePaste({ expiresAt: null }));

      expect(client.isExpired(future)).toBe(false);
      expect(client.isExpired(past)).toBe(true);
      expect(client.isExpired(noExpiry)).toBe(false);
    });
  });

  describe('Content Types', () => {
    test('creates paste with JSON content type', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const paste = await client.create({
        content: '{"key": "value"}',
        contentType: 'application/json',
      });

      expect(paste.contentType).toBe('application/json');
    });

    test('creates paste with markdown content type', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const paste = await client.create({
        content: '# Hello\n\nWorld',
        contentType: 'text/markdown',
      });

      expect(paste.contentType).toBe('text/markdown');
    });

    test('defaults to text/plain', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      const paste = await client.create({ content: 'Plain text' });

      expect(paste.contentType).toBe('text/plain');
    });
  });

  describe('Multiple pastes', () => {
    test('list returns all agent pastes', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      await client.create({ content: 'Paste 1' });
      await client.create({ content: 'Paste 2' });
      await client.create({ content: 'Paste 3' });

      const all = await client.list();

      expect(all.length).toBeGreaterThanOrEqual(3);
    });

    test('list with filter narrows results', async () => {
      const client = new PasteClient(makeConfig(AGENT_A));

      await client.create({ content: 'Text paste', contentType: 'text/plain' });
      await client.create({ content: '{"a":1}', contentType: 'application/json' });

      const jsonOnly = await client.list({ contentType: 'application/json' });

      expect(jsonOnly.length).toBeGreaterThanOrEqual(1);
      for (const p of jsonOnly) {
        expect(p.contentType).toBe('application/json');
      }
    });
  });
});
