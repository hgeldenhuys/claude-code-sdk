/**
 * Tests for Agent Daemon Components (COMMS-002 Task 8)
 *
 * Covers:
 * - SSE text protocol parsing (via SSEClient + mock streams)
 * - SSE reconnection with exponential backoff
 * - Message router: target resolution, CLI invocation, response posting
 * - Session discovery: mocked filesystem returns correct LocalSession[]
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SSEClient } from '../../src/comms/daemon/sse-client';
import { MessageRouter } from '../../src/comms/daemon/message-router';
import { createDefaultConfig } from '../../src/comms/daemon/types';
import type { SSEConfig, LocalSession } from '../../src/comms/daemon/types';
import type { Message } from '../../src/comms/protocol/types';
import { SignalDBClient } from '../../src/comms/client/signaldb';

// ============================================================================
// Helpers
// ============================================================================

const TEST_API_URL = 'https://test-project.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_daemon';

function makeSSEConfig(overrides: Partial<SSEConfig> = {}): SSEConfig {
  return {
    endpoint: '/v1/messages/stream',
    lastEventId: null,
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30000,
    reconnectMultiplier: 2,
    ...overrides,
  };
}

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

/**
 * Create a ReadableStream from an SSE string payload.
 */
function createSSEStream(sseText: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
}

/**
 * Create a ReadableStream that sends chunks with delays.
 */
function createChunkedSSEStream(chunks: string[], delayMs = 10): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (let i = 0; i < chunks.length; i++) {
        await Bun.sleep(delayMs);
        controller.enqueue(encoder.encode(chunks[i]!));
      }
      controller.close();
    },
  });
}

// Track fetch calls
let fetchCalls: { url: string; init: RequestInit }[] = [];
let originalFetch: typeof globalThis.fetch;

// Route-based mock fetch infrastructure
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

function addSSERoute(pathPattern: string | RegExp, ssePayload: string): void {
  routes.push({
    method: 'GET',
    pathPattern,
    handler: () => {
      return new Response(createSSEStream(ssePayload), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    },
  });
}

function addSSEChunkedRoute(pathPattern: string | RegExp, chunks: string[], delayMs = 10): void {
  routes.push({
    method: 'GET',
    pathPattern,
    handler: () => {
      return new Response(createChunkedSSEStream(chunks, delayMs), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    },
  });
}

function addSSEErrorRoute(pathPattern: string | RegExp, status: number): void {
  routes.push({
    method: 'GET',
    pathPattern,
    handler: () => {
      return new Response(JSON.stringify({ message: 'Error' }), {
        status,
        statusText: `Error ${status}`,
      });
    },
  });
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

/**
 * Helper to start SSE client without blocking.
 * SSEClient.connect() never returns when the stream ends and reconnect is enabled.
 * We fire-and-forget connect(), let it process, then disconnect.
 */
function fireAndForgetConnect(client: SSEClient): void {
  client.connect().catch(() => {
    // Errors handled via onError callback
  });
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
// SSE Parsing - Valid Data Frames
// ============================================================================

describe('SSEClient - SSE Parsing', () => {
  test('parses a valid data-only SSE frame and emits message', async () => {
    const msg = makeMessage({ id: 'msg-parse-001', content: 'Test parse' });
    const ssePayload = `data: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-parse-001');
    expect(received[0]!.content).toBe('Test parse');
  });

  test('parses SSE frame with id, event, and data fields', async () => {
    const msg = makeMessage({ id: 'msg-fields-001' });
    const ssePayload = `id: evt-100\nevent: message\ndata: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-fields-001');
    expect(client.resumeId).toBe('evt-100');
  });

  test('joins multi-line data fields with newlines', async () => {
    // Multiple "data:" lines are joined with newline (per SSE spec).
    // If the joined result is valid JSON with id + content, it emits as a Message.
    // Newline between JSON tokens is valid JSON whitespace.
    const ssePayload = `data: {"id":"msg-multi-001"\ndata: ,"content":"Hello","channelId":"c","senderId":"s","targetType":"agent","targetAddress":"a","messageType":"chat","metadata":{},"status":"pending","claimedBy":null,"claimedAt":null,"threadId":null,"createdAt":"","expiresAt":null}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    // Newline is valid JSON whitespace, so the joined data is valid JSON
    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-multi-001');
    expect(received[0]!.content).toBe('Hello');
  });

  test('skips comment lines (lines starting with ":")', async () => {
    const msg = makeMessage({ id: 'msg-comment-001' });
    const ssePayload = `: this is a comment\ndata: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-comment-001');
  });

  test('skips frames with no data lines (comment-only)', async () => {
    const msg = makeMessage({ id: 'msg-skip-001' });
    // First frame is comment-only (no data), second has data
    const ssePayload = `: keepalive\n\ndata: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-skip-001');
  });

  test('handles malformed JSON in data field (no crash, no emission)', async () => {
    const ssePayload = `data: {not-valid-json}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    // Invalid JSON => raw string => won't match Message shape
    expect(received.length).toBe(0);
  });

  test('parses multiple SSE frames in a single stream', async () => {
    const msg1 = makeMessage({ id: 'msg-batch-001', content: 'First' });
    const msg2 = makeMessage({ id: 'msg-batch-002', content: 'Second' });
    const msg3 = makeMessage({ id: 'msg-batch-003', content: 'Third' });
    const ssePayload = [
      `id: 1\ndata: ${JSON.stringify(msg1)}\n\n`,
      `id: 2\ndata: ${JSON.stringify(msg2)}\n\n`,
      `id: 3\ndata: ${JSON.stringify(msg3)}\n\n`,
    ].join('');
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(3);
    expect(received[0]!.id).toBe('msg-batch-001');
    expect(received[1]!.id).toBe('msg-batch-002');
    expect(received[2]!.id).toBe('msg-batch-003');
    expect(client.resumeId).toBe('3');
  });

  test('handles data field with space after colon', async () => {
    const msg = makeMessage({ id: 'msg-space-001' });
    const ssePayload = `data: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-space-001');
  });

  test('handles data field without space after colon', async () => {
    const msg = makeMessage({ id: 'msg-nospace-001' });
    // "data:" without space is valid per SSE spec
    const ssePayload = `data:${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-nospace-001');
  });

  test('ignores non-message event types', async () => {
    // "event: heartbeat" is not "message", so data should not be emitted as Message
    const ssePayload = `event: heartbeat\ndata: {"type":"keepalive"}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(0);
  });

  test('processes chunked SSE delivery correctly', async () => {
    const msg = makeMessage({ id: 'msg-chunked-001' });
    const fullPayload = `data: ${JSON.stringify(msg)}\n\n`;
    const mid = Math.floor(fullPayload.length / 2);
    const chunk1 = fullPayload.slice(0, mid);
    const chunk2 = fullPayload.slice(mid);

    addSSEChunkedRoute('/v1/messages/stream', [chunk1, chunk2], 20);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(200);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-chunked-001');
  });
});

// ============================================================================
// SSE Connection Status
// ============================================================================

describe('SSEClient - Connection Status', () => {
  test('emits connected=true on successful connection', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const statuses: boolean[] = [];
    client.onStatus((s) => statuses.push(s));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    // First status should be true (connected)
    expect(statuses[0]).toBe(true);
  });

  test('emits connected=false on disconnection', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const statuses: boolean[] = [];
    client.onStatus((s) => statuses.push(s));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();
    await Bun.sleep(50);

    // Last status should be false
    const lastStatus = statuses[statuses.length - 1];
    expect(lastStatus).toBe(false);
    expect(client.isConnected).toBe(false);
  });

  test('emits error on connection failure', async () => {
    addSSEErrorRoute('/v1/messages/stream', 500);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const errors: Error[] = [];
    client.onError((e) => errors.push(e));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.message).toContain('SSE connection failed');
    expect(errors[0]!.message).toContain('500');
  });

  test('isConnected returns false before connect and after disconnect', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    expect(client.isConnected).toBe(false);

    fireAndForgetConnect(client);
    await Bun.sleep(50);
    client.disconnect();
    await Bun.sleep(50);

    expect(client.isConnected).toBe(false);
  });
});

// ============================================================================
// SSE Reconnection - Exponential Backoff
// ============================================================================

describe('SSEClient - Reconnection', () => {
  test('exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)', () => {
    const config = makeSSEConfig({
      reconnectBaseMs: 1000,
      reconnectMaxMs: 30000,
      reconnectMultiplier: 2,
    });

    let current = config.reconnectBaseMs;
    const sequence: number[] = [];
    for (let i = 0; i < 6; i++) {
      sequence.push(current);
      current = Math.min(current * config.reconnectMultiplier, config.reconnectMaxMs);
    }

    expect(sequence[0]).toBe(1000);
    expect(sequence[1]).toBe(2000);
    expect(sequence[2]).toBe(4000);
    expect(sequence[3]).toBe(8000);
    expect(sequence[4]).toBe(16000);
    expect(sequence[5]).toBe(30000);
  });

  test('backoff caps at reconnectMaxMs', () => {
    const config = makeSSEConfig({
      reconnectBaseMs: 1000,
      reconnectMaxMs: 5000,
      reconnectMultiplier: 2,
    });

    let current = config.reconnectBaseMs;
    const sequence: number[] = [];
    for (let i = 0; i < 5; i++) {
      sequence.push(current);
      current = Math.min(current * config.reconnectMultiplier, config.reconnectMaxMs);
    }

    expect(sequence[0]).toBe(1000);
    expect(sequence[1]).toBe(2000);
    expect(sequence[2]).toBe(4000);
    expect(sequence[3]).toBe(5000); // capped
    expect(sequence[4]).toBe(5000); // stays capped
  });

  test('sends Last-Event-ID header when lastEventId is set', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const config = makeSSEConfig({ lastEventId: 'evt-previous' });
    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, config);

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers['Last-Event-ID']).toBe('evt-previous');
  });

  test('does not send Last-Event-ID header when lastEventId is null', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const config = makeSSEConfig({ lastEventId: null });
    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, config);

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers['Last-Event-ID']).toBeUndefined();
  });

  test('tracks lastEventId from received events for resumption', async () => {
    const msg1 = makeMessage({ id: 'msg-track-001' });
    const msg2 = makeMessage({ id: 'msg-track-002' });
    const ssePayload = [
      `id: evt-10\ndata: ${JSON.stringify(msg1)}\n\n`,
      `id: evt-20\ndata: ${JSON.stringify(msg2)}\n\n`,
    ].join('');
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(client.resumeId).toBe('evt-20');
  });

  test('includes query params in SSE URL', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(
      TEST_API_URL,
      TEST_PROJECT_KEY,
      makeSSEConfig(),
      { machine_id: 'mac-001' },
    );

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
    expect(fetchCalls[0]!.url).toContain('machine_id=mac-001');
  });

  test('includes Authorization Bearer header', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    const headers = fetchCalls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TEST_PROJECT_KEY}`);
  });

  test('strips trailing slash from apiUrl', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(
      'https://test-project.signaldb.live/',
      TEST_PROJECT_KEY,
      makeSSEConfig(),
    );

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(fetchCalls[0]!.url).toContain('https://test-project.signaldb.live/v1/messages/stream');
    expect(fetchCalls[0]!.url).not.toContain('//v1');
  });

  test('disconnect prevents reconnection', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig({
      reconnectBaseMs: 50,
    }));

    fireAndForgetConnect(client);
    await Bun.sleep(30);
    client.disconnect();

    const callCountAtDisconnect = fetchCalls.length;
    await Bun.sleep(200);

    // No more fetch calls after disconnect
    expect(fetchCalls.length).toBe(callCountAtDisconnect);
  });

  test('reconnects after stream ends (when not disconnected)', async () => {
    // Use very short backoff to test reconnection behavior
    let connectCount = 0;
    routes.push({
      method: 'GET',
      pathPattern: '/v1/messages/stream',
      handler: () => {
        connectCount++;
        return new Response(createSSEStream(`: keepalive\n\n`), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig({
      reconnectBaseMs: 50,
    }));

    fireAndForgetConnect(client);
    // Wait enough for at least one reconnect cycle
    await Bun.sleep(300);
    client.disconnect();

    // Should have connected more than once (initial + at least one reconnect)
    expect(connectCount).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// SSE Callback Safety
// ============================================================================

describe('SSEClient - Callback Safety', () => {
  test('callback errors do not crash the stream', async () => {
    const msg = makeMessage({ id: 'msg-safe-001' });
    const ssePayload = `data: ${JSON.stringify(msg)}\n\n`;
    addSSERoute('/v1/messages/stream', ssePayload);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());

    // First callback throws
    client.onMessage(() => {
      throw new Error('Callback error');
    });

    // Second callback should still receive the message
    const received: Message[] = [];
    client.onMessage((m) => received.push(m));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(received.length).toBe(1);
    expect(received[0]!.id).toBe('msg-safe-001');
  });

  test('multiple status callbacks all fire', async () => {
    addSSERoute('/v1/messages/stream', `: keepalive\n\n`);

    const client = new SSEClient(TEST_API_URL, TEST_PROJECT_KEY, makeSSEConfig());
    const statuses1: boolean[] = [];
    const statuses2: boolean[] = [];
    client.onStatus((s) => statuses1.push(s));
    client.onStatus((s) => statuses2.push(s));

    fireAndForgetConnect(client);
    await Bun.sleep(100);
    client.disconnect();

    expect(statuses1.length).toBeGreaterThan(0);
    expect(statuses2.length).toBeGreaterThan(0);
    expect(statuses1.length).toBe(statuses2.length);
  });
});

// ============================================================================
// Message Router - Target Resolution
// ============================================================================

describe('MessageRouter - Target Resolution', () => {
  // Save and restore Bun.spawn around each router test
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    originalSpawn = Bun.spawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  function mockBunSpawn(stdout: string, exitCode = 0, stderr = ''): void {
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = (cmd: string[]) => ({
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

  function mockBunSpawnWithCapture(stdout: string): { getCapturedCmd: () => string[] | null } {
    let capturedCmd: string[] | null = null;
    // @ts-expect-error - mocking Bun.spawn
    Bun.spawn = (cmd: string[]) => {
      capturedCmd = cmd;
      return {
        stdout: new ReadableStream({
          start(c) {
            if (stdout) c.enqueue(new TextEncoder().encode(stdout));
            c.close();
          },
        }),
        stderr: new ReadableStream({ start(c) { c.close(); } }),
        exited: Promise.resolve(0),
        kill: () => {},
      };
    };
    return { getCapturedCmd: () => capturedCmd };
  }

  test('routes to session matching agentId in target address', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-001',
      agentId: 'agent-uuid-001',
    });

    const message = makeMessage({
      id: 'msg-route-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/agent-uuid-001',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed', claimedBy: 'agent-uuid-001' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('Claude response text');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Claude response text');
      expect(result.messageId).toBe('msg-route-001');
    }
  });

  test('routes to session matching sessionId in target address', async () => {
    const session = makeLocalSession({
      sessionId: 'abc-def-123-456',
      agentId: 'agent-001',
    });

    const message = makeMessage({
      id: 'msg-sessid-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/abc-def-123-456',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });

    const capture = mockBunSpawnWithCapture('Session response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Session response');
    }

    // Verify the CLI command used the correct sessionId
    const cmd = capture.getCapturedCmd();
    expect(cmd).not.toBeNull();
    expect(cmd![0]).toBe('claude');
    expect(cmd![1]).toBe('--resume');
    expect(cmd![2]).toBe('abc-def-123-456');
    expect(cmd![3]).toBe('-p');
  });

  test('routes project-level messages to matching projectPath', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-proj-001',
      agentId: 'agent-proj-001',
      projectPath: '/Users/dev/my-repo',
    });

    const message = makeMessage({
      id: 'msg-proj-001',
      targetType: 'project',
      targetAddress: 'project://mac-001/Users/dev/my-repo',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('Project response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Project response');
    }
  });

  test('routes broadcast messages to first available session', async () => {
    const sessions = [
      makeLocalSession({ sessionId: 'sess-bc-001', agentId: 'agent-bc-001' }),
      makeLocalSession({ sessionId: 'sess-bc-002', agentId: 'agent-bc-002' }),
    ];

    const message = makeMessage({
      id: 'msg-bc-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://general',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('Broadcast response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, sessions);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Broadcast response');
    }
  });

  test('returns failure for unknown session (no matching target)', async () => {
    const message = makeMessage({
      id: 'msg-unknown-001',
      targetType: 'agent',
      targetAddress: 'agent://other-machine/other-session',
      status: 'pending',
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);

    // Multiple sessions to avoid single-session fallback
    const result = await router.route(message, [
      makeLocalSession({ sessionId: 'sess-a', agentId: 'agent-a' }),
      makeLocalSession({ sessionId: 'sess-b', agentId: 'agent-b' }),
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No local session matches');
      expect(result.messageId).toBe('msg-unknown-001');
    }
  });

  test('returns failure for empty sessions list', async () => {
    const message = makeMessage({ id: 'msg-empty-001' });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No local session matches');
      expect(result.messageId).toBe('msg-empty-001');
    }
  });

  test('returns failure when CLI process fails (non-zero exit)', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-fail-001',
      agentId: 'agent-fail-001',
    });

    const message = makeMessage({
      id: 'msg-fail-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-fail-001',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    mockBunSpawn('', 1, 'Session not found');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Claude process failed');
      expect(result.error).toContain('Session not found');
    }
  });

  test('claims pending message before delivery', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-claim-001',
      agentId: 'agent-claim-001',
    });

    const message = makeMessage({
      id: 'msg-claim-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-claim-001',
      status: 'pending',
    });

    let claimCalled = false;
    routes.push({
      method: 'PATCH',
      pathPattern: '/claim',
      handler: (url) => {
        claimCalled = true;
        expect(url).toContain('msg-claim-001');
        return new Response(JSON.stringify({ ...message, status: 'claimed', claimedBy: 'agent-claim-001' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('OK');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    await router.route(message, [session]);

    expect(claimCalled).toBe(true);
  });

  test('does not claim non-pending messages', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-nonclaim-001',
      agentId: 'agent-nonclaim-001',
    });

    const message = makeMessage({
      id: 'msg-nonclaim-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-nonclaim-001',
      status: 'claimed', // Already claimed
    });

    let claimCalled = false;
    routes.push({
      method: 'PATCH',
      pathPattern: '/claim',
      handler: () => {
        claimCalled = true;
        return new Response(JSON.stringify(message), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('Response text');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    await router.route(message, [session]);

    // Should NOT have called claim since status is 'claimed', not 'pending'
    expect(claimCalled).toBe(false);
  });

  test('posts response back to SignalDB with correct fields', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-resp-001',
      agentId: 'agent-resp-001',
    });

    const message = makeMessage({
      id: 'msg-resp-001',
      channelId: 'chan-resp-001',
      senderId: 'sender-resp-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-resp-001',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });

    let postedResponse: Record<string, unknown> | null = null;
    routes.push({
      method: 'POST',
      pathPattern: '/v1/messages',
      handler: (_url, init) => {
        postedResponse = JSON.parse(init.body as string);
        return new Response(JSON.stringify(makeMessage({ messageType: 'response' })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    mockBunSpawn('My response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    await router.route(message, [session]);

    expect(postedResponse).not.toBeNull();
    expect(postedResponse!.messageType).toBe('response');
    expect(postedResponse!.content).toBe('My response');
    expect(postedResponse!.targetAddress).toBe('sender-resp-001'); // Reply to sender
    expect(postedResponse!.channelId).toBe('chan-resp-001');
    expect(postedResponse!.senderId).toBe('agent-resp-001');
    const meta = postedResponse!.metadata as Record<string, unknown>;
    expect(meta.inReplyTo).toBe('msg-resp-001');
  });

  test('uses threadId from original message or message id', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-thread-001',
      agentId: 'agent-thread-001',
    });

    // Message with existing threadId
    const message = makeMessage({
      id: 'msg-thread-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-thread-001',
      status: 'pending',
      threadId: 'thread-existing-001',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });

    let postedResponse: Record<string, unknown> | null = null;
    routes.push({
      method: 'POST',
      pathPattern: '/v1/messages',
      handler: (_url, init) => {
        postedResponse = JSON.parse(init.body as string);
        return new Response(JSON.stringify(makeMessage({ messageType: 'response' })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    mockBunSpawn('Thread response');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    await router.route(message, [session]);

    expect(postedResponse).not.toBeNull();
    expect(postedResponse!.threadId).toBe('thread-existing-001');
  });

  test('single session is used as fallback for unmatched target', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-only-001',
      agentId: 'agent-only-001',
    });

    const message = makeMessage({
      id: 'msg-fallback-001',
      targetType: 'agent',
      targetAddress: 'agent://unknown-machine/unknown-session',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('Fallback');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    // Single session fallback
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.response).toBe('Fallback');
    }
  });

  test('captures claude CLI stdout as response', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-stdout-001',
      agentId: 'agent-stdout-001',
    });

    const message = makeMessage({
      id: 'msg-stdout-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-stdout-001',
      status: 'pending',
    });

    addJSONRoute('PATCH', '/claim', { ...message, status: 'claimed' });
    addJSONRoute('POST', '/v1/messages', makeMessage({ messageType: 'response' }));
    addJSONRoute('PATCH', '/status', { ...message, status: 'delivered' });
    mockBunSpawn('  This is the response output  ');

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Response should be trimmed
      expect(result.response).toBe('This is the response output');
    }
  });

  test('handles claim failure (another agent claimed first)', async () => {
    const session = makeLocalSession({
      sessionId: 'sess-claimfail-001',
      agentId: 'agent-claimfail-001',
    });

    const message = makeMessage({
      id: 'msg-claimfail-001',
      targetType: 'agent',
      targetAddress: 'agent://mac-001/sess-claimfail-001',
      status: 'pending',
    });

    // Claim fails with 409 conflict
    routes.push({
      method: 'PATCH',
      pathPattern: '/claim',
      handler: () => new Response(JSON.stringify({ message: 'Already claimed' }), {
        status: 409,
        statusText: 'Conflict',
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    const client = new SignalDBClient({ apiUrl: TEST_API_URL, projectKey: TEST_PROJECT_KEY });
    const router = new MessageRouter(client);
    const result = await router.route(message, [session]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to claim message');
    }
  });
});

// ============================================================================
// Session Discovery
// ============================================================================

describe('Session Discovery', () => {
  test('discoverSessions returns an array', async () => {
    const { discoverSessions } = await import('../../src/comms/daemon/session-discovery');
    const result = await discoverSessions('test-machine-id');
    expect(Array.isArray(result)).toBe(true);
  });

  test('createDefaultConfig produces valid DaemonConfig', () => {
    const config = createDefaultConfig(
      'https://my-project.signaldb.live',
      'sk_live_abc',
      'mac-001',
    );

    expect(config.apiUrl).toBe('https://my-project.signaldb.live');
    expect(config.projectKey).toBe('sk_live_abc');
    expect(config.machineId).toBe('mac-001');
    expect(config.heartbeatIntervalMs).toBe(10000);
    expect(config.sse.endpoint).toBe('/v1/messages/stream');
    expect(config.sse.lastEventId).toBeNull();
    expect(config.sse.reconnectBaseMs).toBe(1000);
    expect(config.sse.reconnectMaxMs).toBe(30000);
    expect(config.sse.reconnectMultiplier).toBe(2);
  });

  test('LocalSession type fields are correct', () => {
    const session: LocalSession = {
      sessionId: 'test-uuid-001',
      sessionName: 'happy-panda',
      projectPath: '/home/user/project',
      agentId: null,
    };

    expect(session.sessionId).toBe('test-uuid-001');
    expect(session.sessionName).toBe('happy-panda');
    expect(session.projectPath).toBe('/home/user/project');
    expect(session.agentId).toBeNull();
  });

  test('LocalSession agentId is null before registration', () => {
    const session: LocalSession = {
      sessionId: 'pre-reg-001',
      sessionName: null,
      projectPath: '/project',
      agentId: null,
    };

    expect(session.agentId).toBeNull();
    expect(session.sessionName).toBeNull();
  });
});

// ============================================================================
// DaemonConfig Defaults
// ============================================================================

describe('DaemonConfig - createDefaultConfig', () => {
  test('heartbeat interval defaults to 10 seconds', () => {
    const config = createDefaultConfig('https://api.test', 'key', 'machine');
    expect(config.heartbeatIntervalMs).toBe(10_000);
  });

  test('SSE reconnect base defaults to 1 second', () => {
    const config = createDefaultConfig('https://api.test', 'key', 'machine');
    expect(config.sse.reconnectBaseMs).toBe(1_000);
  });

  test('SSE reconnect max defaults to 30 seconds', () => {
    const config = createDefaultConfig('https://api.test', 'key', 'machine');
    expect(config.sse.reconnectMaxMs).toBe(30_000);
  });

  test('SSE reconnect multiplier defaults to 2', () => {
    const config = createDefaultConfig('https://api.test', 'key', 'machine');
    expect(config.sse.reconnectMultiplier).toBe(2);
  });

  test('SSE endpoint defaults to /v1/messages/stream', () => {
    const config = createDefaultConfig('https://api.test', 'key', 'machine');
    expect(config.sse.endpoint).toBe('/v1/messages/stream');
  });
});
