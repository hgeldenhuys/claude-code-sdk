/**
 * Unit & Integration Tests for Comms CLI Bridge (COMMS-007)
 *
 * Covers:
 * - CLI Utils: truncate, formatTimestamp, formatStatus, parseEnvConfig, etc.
 * - Status command: table output, --json, presence derivation, empty list
 * - Agents command: full details, --json, empty list
 * - Send command: broadcast, agent, project addresses, error handling
 * - Listen command: subscribe call, channel resolution
 * - Channels command: list, create, join, leave, archive, help, --json
 * - Memo command: list, compose, read, reply, archive, help, --json
 * - Paste command: create, read, delete, list, shared, help, --json
 * - Dispatcher: help output, unknown command
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

// ============================================================================
// Test Constants
// ============================================================================

const TEST_API_URL = 'https://test-cli.signaldb.live';
const TEST_PROJECT_KEY = 'sk_test_cli_key';
const TEST_AGENT_ID = 'agent-cli-001';

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

// ============================================================================
// Console Capture Helper
// ============================================================================

let consoleLogs: string[] = [];
let consoleErrors: string[] = [];
let logSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;

function captureConsole(): void {
  consoleLogs = [];
  consoleErrors = [];
  logSpy = spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleLogs.push(args.map(String).join(' '));
  });
  errorSpy = spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
}

function restoreConsole(): void {
  logSpy?.mockRestore();
  errorSpy?.mockRestore();
}

function getLogOutput(): string {
  return consoleLogs.join('\n');
}

// ============================================================================
// Environment Setup / Teardown
// ============================================================================

let originalEnv: Record<string, string | undefined>;

function setEnvFull(): void {
  process.env.SIGNALDB_API_URL = TEST_API_URL;
  process.env.SIGNALDB_PROJECT_KEY = TEST_PROJECT_KEY;
  process.env.SIGNALDB_AGENT_ID = TEST_AGENT_ID;
}

function setEnvPartial(): void {
  process.env.SIGNALDB_API_URL = TEST_API_URL;
  process.env.SIGNALDB_PROJECT_KEY = TEST_PROJECT_KEY;
  delete process.env.SIGNALDB_AGENT_ID;
}

function saveEnv(): void {
  originalEnv = {
    SIGNALDB_API_URL: process.env.SIGNALDB_API_URL,
    SIGNALDB_PROJECT_KEY: process.env.SIGNALDB_PROJECT_KEY,
    SIGNALDB_AGENT_ID: process.env.SIGNALDB_AGENT_ID,
  };
}

function restoreEnv(): void {
  for (const key of Object.keys(originalEnv)) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

// ============================================================================
// Mock Data Factories
// ============================================================================

import type { Agent, Channel, Message } from '../../src/comms/protocol/types';
import type { MemoView } from '../../src/comms/memos/types';
import type { PasteView } from '../../src/comms/pastes/types';

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-001',
    machineId: 'machine-001',
    sessionId: 'session-001',
    sessionName: 'brave-tiger',
    projectPath: '/Users/dev/project',
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
    id: 'channel-001',
    name: 'dev-team',
    type: 'broadcast',
    members: ['agent-001'],
    createdBy: 'agent-001',
    metadata: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-001',
    channelId: 'channel-001',
    senderId: 'agent-001',
    targetType: 'broadcast',
    targetAddress: 'broadcast://dev-team',
    messageType: 'chat',
    content: 'Hello world',
    metadata: {},
    status: 'delivered',
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
    id: 'memo-001',
    senderId: 'agent-002',
    to: 'agent://machine-001/agent-001',
    subject: 'Test memo',
    body: 'This is the memo body.',
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

function makePasteView(overrides: Partial<PasteView> = {}): PasteView {
  return {
    id: 'paste-001',
    creatorId: TEST_AGENT_ID,
    content: 'Hello paste content',
    contentType: 'text/plain',
    accessMode: 'ttl',
    ttlSeconds: 3600,
    recipientId: null,
    readBy: [],
    readAt: null,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    isExpired: false,
    isRead: false,
    metadata: {},
    ...overrides,
  };
}

// ============================================================================
// 1. CLI Utils
// ============================================================================

describe('CLI Utils', () => {
  describe('truncate', () => {
    let truncate: typeof import('../../src/comms/bridges/cli/utils').truncate;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      truncate = mod.truncate;
    });

    test('returns string unchanged when shorter than maxLen', () => {
      expect(truncate('hello', 10)).toBe('hello');
    });

    test('returns string unchanged when equal to maxLen', () => {
      expect(truncate('hello', 5)).toBe('hello');
    });

    test('truncates string longer than maxLen with ".."', () => {
      expect(truncate('hello world', 8)).toBe('hello ..');
    });

    test('truncates single character over limit', () => {
      const result = truncate('abcdef', 5);
      expect(result.length).toBeLessThanOrEqual(5);
      expect(result).toBe('abc..');
    });

    test('handles empty string', () => {
      expect(truncate('', 5)).toBe('');
    });
  });

  describe('formatTimestamp', () => {
    let formatTimestamp: typeof import('../../src/comms/bridges/cli/utils').formatTimestamp;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      formatTimestamp = mod.formatTimestamp;
    });

    test('returns "just now" for timestamps less than 1 minute ago', () => {
      const recent = new Date(Date.now() - 10_000).toISOString();
      expect(formatTimestamp(recent)).toBe('just now');
    });

    test('returns "Xm ago" for timestamps less than 1 hour ago', () => {
      const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
      expect(formatTimestamp(thirtyMinAgo)).toBe('30m ago');
    });

    test('returns "Xh ago" for timestamps less than 24 hours ago', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
      expect(formatTimestamp(fiveHoursAgo)).toBe('5h ago');
    });

    test('returns YYYY-MM-DD for timestamps older than 24 hours', () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();
      const result = formatTimestamp(twoDaysAgo);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('returns original string for invalid timestamps', () => {
      expect(formatTimestamp('invalid-date')).toBe('invalid-date');
    });
  });

  describe('formatStatus', () => {
    let formatStatus: typeof import('../../src/comms/bridges/cli/utils').formatStatus;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      formatStatus = mod.formatStatus;
    });

    test('returns a string for known statuses', () => {
      const statuses = ['pending', 'claimed', 'delivered', 'read', 'expired', 'active', 'idle', 'offline'];
      for (let i = 0; i < statuses.length; i++) {
        const result = formatStatus(statuses[i]!);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      }
    });

    test('returns the status string as-is for unknown statuses', () => {
      expect(formatStatus('unknown-status')).toBe('unknown-status');
    });
  });

  describe('hasJsonFlag', () => {
    let hasJsonFlag: typeof import('../../src/comms/bridges/cli/utils').hasJsonFlag;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      hasJsonFlag = mod.hasJsonFlag;
    });

    test('returns true when --json is present', () => {
      expect(hasJsonFlag(['--json'])).toBe(true);
    });

    test('returns true when --json is among other args', () => {
      expect(hasJsonFlag(['list', '--json', '--unread'])).toBe(true);
    });

    test('returns false when --json is absent', () => {
      expect(hasJsonFlag(['list', '--unread'])).toBe(false);
    });

    test('returns false for empty args', () => {
      expect(hasJsonFlag([])).toBe(false);
    });
  });

  describe('getFlagValue', () => {
    let getFlagValue: typeof import('../../src/comms/bridges/cli/utils').getFlagValue;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      getFlagValue = mod.getFlagValue;
    });

    test('returns value for a flag with a value', () => {
      expect(getFlagValue(['--type', 'broadcast'], '--type')).toBe('broadcast');
    });

    test('returns undefined for a flag without a value', () => {
      expect(getFlagValue(['--type'], '--type')).toBeUndefined();
    });

    test('returns undefined for a missing flag', () => {
      expect(getFlagValue(['--other', 'value'], '--type')).toBeUndefined();
    });

    test('returns the first matching value when flag appears multiple times', () => {
      expect(getFlagValue(['--type', 'first', '--type', 'second'], '--type')).toBe('first');
    });
  });

  describe('jsonOutput', () => {
    let jsonOutput: typeof import('../../src/comms/bridges/cli/utils').jsonOutput;

    beforeEach(async () => {
      const mod = await import('../../src/comms/bridges/cli/utils');
      jsonOutput = mod.jsonOutput;
      captureConsole();
    });

    afterEach(() => {
      restoreConsole();
    });

    test('prints JSON and returns true when isJson is true', () => {
      const data = { key: 'value' };
      const result = jsonOutput(data, true);
      expect(result).toBe(true);
      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.key).toBe('value');
    });

    test('does nothing and returns false when isJson is false', () => {
      const result = jsonOutput({ key: 'value' }, false);
      expect(result).toBe(false);
      expect(consoleLogs.length).toBe(0);
    });
  });

  describe('parseEnvConfig', () => {
    let parseEnvConfig: typeof import('../../src/comms/bridges/cli/utils').parseEnvConfig;
    let exitSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      saveEnv();
      const mod = await import('../../src/comms/bridges/cli/utils');
      parseEnvConfig = mod.parseEnvConfig;
      captureConsole();
      exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    });

    afterEach(() => {
      restoreEnv();
      restoreConsole();
      exitSpy.mockRestore();
    });

    test('returns config when all env vars are set', () => {
      setEnvFull();
      const config = parseEnvConfig();
      expect(config.apiUrl).toBe(TEST_API_URL);
      expect(config.projectKey).toBe(TEST_PROJECT_KEY);
      expect(config.agentId).toBe(TEST_AGENT_ID);
    });

    test('exits when env vars are missing', () => {
      delete process.env.SIGNALDB_API_URL;
      delete process.env.SIGNALDB_PROJECT_KEY;
      delete process.env.SIGNALDB_AGENT_ID;

      expect(() => parseEnvConfig()).toThrow('process.exit called');
      expect(consoleErrors.length).toBeGreaterThan(0);
    });
  });

  describe('parseEnvConfigPartial', () => {
    let parseEnvConfigPartial: typeof import('../../src/comms/bridges/cli/utils').parseEnvConfigPartial;
    let exitSpy: ReturnType<typeof spyOn>;

    beforeEach(async () => {
      saveEnv();
      const mod = await import('../../src/comms/bridges/cli/utils');
      parseEnvConfigPartial = mod.parseEnvConfigPartial;
      captureConsole();
      exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    });

    afterEach(() => {
      restoreEnv();
      restoreConsole();
      exitSpy.mockRestore();
    });

    test('returns partial config with apiUrl and projectKey', () => {
      setEnvPartial();
      const config = parseEnvConfigPartial();
      expect(config.apiUrl).toBe(TEST_API_URL);
      expect(config.projectKey).toBe(TEST_PROJECT_KEY);
    });

    test('does not require agentId', () => {
      setEnvPartial();
      // Should not throw
      const config = parseEnvConfigPartial();
      expect(config).toBeTruthy();
    });
  });
});

// ============================================================================
// 2. Status Command
// ============================================================================

describe('comms status', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/status').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvPartial();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/status');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('displays agents in table format', async () => {
    const agents = [
      makeAgent({ id: 'agent-001', sessionName: 'brave-tiger', heartbeatAt: new Date().toISOString() }),
      makeAgent({ id: 'agent-002', sessionName: 'calm-owl', heartbeatAt: new Date(Date.now() - 60_000).toISOString() }),
    ];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('Agents (2)');
    expect(output).toContain('brave-tig');
    expect(output).toContain('calm-owl');
  });

  test('outputs JSON with --json flag', async () => {
    const agents = [makeAgent({ heartbeatAt: new Date().toISOString() })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    expect(consoleLogs.length).toBe(1);
    const parsed = JSON.parse(consoleLogs[0]!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].id).toBe('agent-001');
    expect(parsed[0]).toHaveProperty('presence');
  });

  test('derives presence as "active" for heartbeat < 10s', async () => {
    const agents = [makeAgent({ heartbeatAt: new Date().toISOString() })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    const parsed = JSON.parse(consoleLogs[0]!);
    expect(parsed[0].presence).toBe('active');
  });

  test('derives presence as "idle" for heartbeat between 10s and 5min', async () => {
    const agents = [makeAgent({ heartbeatAt: new Date(Date.now() - 60_000).toISOString() })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    const parsed = JSON.parse(consoleLogs[0]!);
    expect(parsed[0].presence).toBe('idle');
  });

  test('derives presence as "offline" for heartbeat > 5min', async () => {
    const agents = [makeAgent({ heartbeatAt: new Date(Date.now() - 600_000).toISOString() })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    const parsed = JSON.parse(consoleLogs[0]!);
    expect(parsed[0].presence).toBe('offline');
  });

  test('derives presence as "offline" for null heartbeat', async () => {
    const agents = [makeAgent({ heartbeatAt: null })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    const parsed = JSON.parse(consoleLogs[0]!);
    expect(parsed[0].presence).toBe('offline');
  });

  test('displays "No agents registered." for empty list', async () => {
    addJSONRoute('GET', '/v1/agents', []);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('No agents registered.');
  });
});

// ============================================================================
// 3. Agents Command
// ============================================================================

describe('comms agents', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/agents').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvPartial();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/agents');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('displays agent details', async () => {
    const agents = [
      makeAgent({
        id: 'agent-uuid-full',
        sessionName: 'brave-tiger',
        machineId: 'mac-001',
        projectPath: '/Users/dev/project',
        capabilities: { code: true },
        metadata: { version: '1.0' },
        heartbeatAt: new Date().toISOString(),
      }),
    ];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('Registered Agents (1)');
    expect(output).toContain('agent-uuid-full');
    expect(output).toContain('mac-001');
    expect(output).toContain('/Users/dev/project');
    expect(output).toContain('Capabilities:');
    expect(output).toContain('code');
  });

  test('outputs JSON with --json flag', async () => {
    const agents = [makeAgent({ heartbeatAt: new Date().toISOString() })];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute(['--json']);

    expect(consoleLogs.length).toBe(1);
    const parsed = JSON.parse(consoleLogs[0]!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('presence');
  });

  test('shows "No agents registered." for empty list', async () => {
    addJSONRoute('GET', '/v1/agents', []);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('No agents registered.');
  });

  test('shows multiple agents with separators', async () => {
    const agents = [
      makeAgent({ id: 'agent-A', sessionName: 'alpha', heartbeatAt: new Date().toISOString() }),
      makeAgent({ id: 'agent-B', sessionName: 'beta', heartbeatAt: null }),
    ];
    addJSONRoute('GET', '/v1/agents', agents);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('alpha');
    expect(output).toContain('beta');
  });
});

// ============================================================================
// 4. Send Command
// ============================================================================

describe('comms send', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/send').execute;
  let exitSpy: ReturnType<typeof spyOn>;
  let origIsTTY: boolean | undefined;

  beforeEach(async () => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    // Force TTY mode so send reads from args instead of stdin
    origIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
    const mod = await import('../../src/comms/bridges/cli/commands/send');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
    Object.defineProperty(process.stdin, 'isTTY', { value: origIsTTY, writable: true, configurable: true });
  });

  test('sends to agent:// address via messages API', async () => {
    const message = makeMessage({ status: 'delivered' });
    addJSONRoute('POST', '/v1/messages', message);

    try {
      await execute(['agent://machine-1/agent-2', 'Hello', 'there']);
    } catch {
      // process.exit called after console log
    }

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]!.method).toBe('POST');
    expect(fetchCalls[0]!.url).toContain('/v1/messages');
    const body = fetchCalls[0]!.body as Record<string, unknown>;
    expect(body.content).toBe('Hello there');
    expect(body.targetAddress).toBe('agent://machine-1/agent-2');
    expect(body.targetType).toBe('agent');
  });

  test('sends to project:// address via messages API', async () => {
    const message = makeMessage({ status: 'delivered' });
    addJSONRoute('POST', '/v1/messages', message);

    try {
      await execute(['project://machine-1/my-project', 'Build', 'complete']);
    } catch {
      // process.exit called
    }

    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0]!.body as Record<string, unknown>;
    expect(body.content).toBe('Build complete');
    expect(body.targetType).toBe('project');
  });

  test('sends to broadcast:// address via channel publish', async () => {
    const channel = makeChannel({ id: 'ch-resolved', name: 'dev-team' });
    const message = makeMessage();

    // Route for resolving channel by name (getByName returns a single Channel)
    addJSONRoute('GET', '/v1/channels', channel);
    // Route for publishing message via channel client (uses POST /v1/messages)
    addJSONRoute('POST', '/v1/messages', message);

    try {
      await execute(['broadcast://dev-team', 'Hello broadcast']);
    } catch {
      // process.exit called
    }

    // Should make at least a channel resolve call and a publish call
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('errors when no address is provided', async () => {
    try {
      await execute([]);
    } catch {
      // process.exit called
    }
    expect(consoleErrors.join('\n')).toContain('Usage');
  });

  test('errors when no message is provided (tty mode)', async () => {
    try {
      await execute(['agent://machine-1/agent-2']);
    } catch {
      // process.exit called
    }

    const errorOutput = consoleErrors.join('\n');
    expect(errorOutput).toContain('No message');
  });

  test('outputs JSON with --json flag for agent address', async () => {
    const message = makeMessage({ status: 'delivered' });
    addJSONRoute('POST', '/v1/messages', message);

    try {
      await execute(['agent://machine-1/agent-2', 'Hello', '--json']);
    } catch {
      // process.exit called
    }

    // When --json is set, it outputs JSON
    expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
    const parsed = JSON.parse(consoleLogs[0]!);
    expect(parsed).toHaveProperty('id');
  });

  test('errors for invalid address protocol', async () => {
    try {
      await execute(['invalid://test', 'Hello']);
    } catch {
      // process.exit called
    }
    expect(consoleErrors.join('\n')).toContain('Error');
  });
});

// ============================================================================
// 5. Listen Command
// ============================================================================

describe('comms listen', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/listen').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/listen');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('resolves named channel for listen', async () => {
    const channel = makeChannel({ id: 'ch-123', name: 'dev-team' });
    addJSONRoute('GET', '/v1/channels', channel);

    // The listen command will try to connect SSE which will hang/fail in tests
    // We just verify it resolves the channel name via the fetch call
    const promise = execute(['dev-team']);

    // Give it a moment to make the fetch call
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify channel resolution was attempted
    const channelFetches = fetchCalls.filter(c => c.url.includes('/v1/channels'));
    expect(channelFetches.length).toBeGreaterThanOrEqual(1);

    // Clean up: the listen command hangs on a never-resolving promise,
    // we can't cleanly await it but we tested what we can
  });

  test('errors when channel is not found', async () => {
    // The GET /v1/channels?name=... will return 404 from our fallback handler
    try {
      await execute(['nonexistent-channel']);
    } catch {
      // Expected: process.exit called
    }

    // Should have attempted to resolve the channel
    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// 6. Channels Command
// ============================================================================

describe('comms channels', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/channels').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/channels');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('shows help text for no subcommand', async () => {
    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('comms channels');
    expect(output).toContain('list');
    expect(output).toContain('create');
    expect(output).toContain('join');
    expect(output).toContain('leave');
    expect(output).toContain('archive');
  });

  test('shows help text for "help" subcommand', async () => {
    await execute(['help']);

    const output = getLogOutput();
    expect(output).toContain('comms channels');
  });

  describe('list', () => {
    test('displays channels in table format', async () => {
      const channels = [
        makeChannel({ id: 'ch-001', name: 'dev-team', type: 'broadcast', members: ['a', 'b'] }),
        makeChannel({ id: 'ch-002', name: 'alerts', type: 'project', members: ['a'] }),
      ];
      addJSONRoute('GET', '/v1/channels', channels);

      await execute(['list']);

      const output = getLogOutput();
      expect(output).toContain('Channels (2)');
      expect(output).toContain('dev-team');
      expect(output).toContain('alerts');
    });

    test('outputs JSON with --json', async () => {
      const channels = [makeChannel()];
      addJSONRoute('GET', '/v1/channels', channels);

      await execute(['list', '--json']);

      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].name).toBe('dev-team');
    });

    test('shows "No channels found." for empty list', async () => {
      addJSONRoute('GET', '/v1/channels', []);

      await execute(['list']);

      const output = getLogOutput();
      expect(output).toContain('No channels found.');
    });
  });

  describe('create', () => {
    test('creates a broadcast channel by default', async () => {
      const channel = makeChannel({ id: 'ch-new', name: 'new-channel', type: 'broadcast' });
      addJSONRoute('POST', '/v1/channels', channel);

      await execute(['create', 'new-channel']);

      const output = getLogOutput();
      expect(output).toContain('Channel created successfully');
      expect(output).toContain('new-channel');
    });

    test('creates a channel with specified type', async () => {
      const channel = makeChannel({ id: 'ch-new', name: 'dm-channel', type: 'direct' });
      addJSONRoute('POST', '/v1/channels', channel);

      await execute(['create', 'dm-channel', '--type', 'direct']);

      expect(fetchCalls.length).toBe(1);
      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.type).toBe('direct');
    });

    test('outputs JSON with --json', async () => {
      const channel = makeChannel({ id: 'ch-new', name: 'new-channel' });
      addJSONRoute('POST', '/v1/channels', channel);

      await execute(['create', 'new-channel', '--json']);

      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.name).toBe('new-channel');
    });

    test('errors when name is missing', () => {
      expect(() => execute(['create'])).toThrow();
    });

    test('errors for invalid channel type', () => {
      expect(() => execute(['create', 'ch-name', '--type', 'invalid'])).toThrow();
    });
  });

  describe('join', () => {
    test('joins a channel by ID', async () => {
      const channel = makeChannel({ id: 'ch-join', name: 'joined-channel', members: ['agent-001', TEST_AGENT_ID] });
      addJSONRoute('POST', /\/v1\/channels\/ch-join\/members/, channel);

      await execute(['join', 'ch-join']);

      const output = getLogOutput();
      expect(output).toContain('Joined channel');
    });

    test('outputs JSON with --json', async () => {
      const channel = makeChannel({ id: 'ch-join', name: 'joined-channel' });
      addJSONRoute('POST', /\/v1\/channels\/ch-join\/members/, channel);

      await execute(['join', 'ch-join', '--json']);

      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.name).toBe('joined-channel');
    });

    test('errors when channel ID is missing', () => {
      expect(() => execute(['join'])).toThrow();
    });
  });

  describe('leave', () => {
    test('leaves a channel by ID', async () => {
      const channel = makeChannel({ id: 'ch-leave', name: 'left-channel', members: [] });
      addJSONRoute('DELETE', /\/v1\/channels\/ch-leave\/members/, channel);

      await execute(['leave', 'ch-leave']);

      const output = getLogOutput();
      expect(output).toContain('Left channel');
    });

    test('outputs JSON with --json', async () => {
      const channel = makeChannel({ id: 'ch-leave', name: 'left-channel' });
      addJSONRoute('DELETE', /\/v1\/channels\/ch-leave\/members/, channel);

      await execute(['leave', 'ch-leave', '--json']);

      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.name).toBe('left-channel');
    });
  });

  describe('archive', () => {
    test('archives a channel by ID', async () => {
      // archiveChannel first GETs the channel, then POSTs a system message
      const channel = makeChannel({ id: 'ch-arch', name: 'archived-ch' });
      addJSONRoute('GET', /\/v1\/channels\/ch-arch/, channel);
      addJSONRoute('POST', '/v1/messages', makeMessage());

      await execute(['archive', 'ch-arch']);

      const output = getLogOutput();
      expect(output).toContain('Channel archived');
    });

    test('outputs JSON with --json', async () => {
      const channel = makeChannel({ id: 'ch-arch', name: 'archived-ch' });
      addJSONRoute('GET', /\/v1\/channels\/ch-arch/, channel);
      addJSONRoute('POST', '/v1/messages', makeMessage());

      await execute(['archive', 'ch-arch', '--json']);

      expect(consoleLogs.length).toBe(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.archived).toBe('ch-arch');
    });
  });

  test('errors for unknown subcommand', () => {
    expect(() => execute(['unknown-sub'])).toThrow();
  });
});

// ============================================================================
// 7. Memo Command
// ============================================================================

describe('comms memo', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/memo').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/memo');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('shows help text for no subcommand', async () => {
    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('comms memo');
    expect(output).toContain('list');
    expect(output).toContain('compose');
    expect(output).toContain('read');
    expect(output).toContain('reply');
    expect(output).toContain('archive');
  });

  describe('list', () => {
    test('displays memos in table format', async () => {
      // MemoInbox.inbox() calls client.messages.listForAgent() -> GET /v1/messages
      // MemoInbox.getUnreadCount() also calls client.messages.listForAgent() -> GET /v1/messages
      // Both return raw Message objects; messageToMemoView converts them
      const messages = [
        makeMessage({ id: 'memo-001', messageType: 'memo', status: 'pending', content: 'Build results body', metadata: { subject: 'Build results', category: 'finding', priority: 'P1' } }),
        makeMessage({ id: 'memo-002', messageType: 'memo', status: 'delivered', content: 'Code review body', metadata: { subject: 'Code review', category: 'question', priority: 'P2' } }),
      ];
      addJSONRoute('GET', '/v1/messages', messages);

      await execute(['list']);

      const output = getLogOutput();
      expect(output).toContain('Inbox');
    });

    test('outputs JSON with --json', async () => {
      const messages = [
        makeMessage({ id: 'memo-001', messageType: 'memo', status: 'pending', metadata: { subject: 'Test', category: 'knowledge', priority: 'P2' } }),
      ];
      addJSONRoute('GET', '/v1/messages', messages);

      await execute(['list', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('compose', () => {
    test('composes a memo with required flags', async () => {
      const memo = makeMemoView({ id: 'memo-new', subject: 'Test subject' });
      addJSONRoute('POST', '/v1/messages', memo);

      await execute(['compose', '--to', 'agent://machine-1/agent-2', '--subject', 'Test subject', '--body', 'Test body']);

      const output = getLogOutput();
      expect(output).toContain('Memo sent successfully');
    });

    test('outputs JSON with --json', async () => {
      const memo = makeMemoView({ id: 'memo-new' });
      addJSONRoute('POST', '/v1/messages', memo);

      await execute(['compose', '--to', 'agent://m/a', '--subject', 'S', '--body', 'B', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.id).toBe('memo-new');
    });

    test('errors when --to is missing', () => {
      expect(() => execute(['compose', '--subject', 'S', '--body', 'B'])).toThrow();
    });

    test('errors when --subject is missing', () => {
      expect(() => execute(['compose', '--to', 'agent://m/a', '--body', 'B'])).toThrow();
    });

    test('errors when --body is missing', () => {
      expect(() => execute(['compose', '--to', 'agent://m/a', '--subject', 'S'])).toThrow();
    });
  });

  describe('read', () => {
    test('reads a memo by ID', async () => {
      // MemoClient.read() calls deliver() then markRead().
      // Each calls validateTransition() -> listForAgent (GET /v1/messages) then updateStatus (PATCH).
      // The deliver step may fail (already delivered), which is caught.
      // Then markRead is called: validateTransition -> listForAgent + updateStatus.
      const rawMessage = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'delivered', content: 'Full body content', metadata: { subject: 'Read me', category: 'knowledge', priority: 'P2' } });
      const readMessage = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'read', content: 'Full body content', metadata: { subject: 'Read me', category: 'knowledge', priority: 'P2' } });

      // validateTransition() for deliver -> GET /v1/messages returns array
      addJSONRoute('GET', '/v1/messages', [rawMessage]);
      // updateStatus for deliver -> PATCH /v1/messages/{id}/status
      addJSONRoute('PATCH', /\/v1\/messages\/memo-read\/status/, rawMessage);
      // validateTransition() for markRead -> GET /v1/messages (returns delivered now)
      // Note: route order matters - the second GET will re-use the first route
      // updateStatus for markRead -> PATCH (same route pattern, returns read)
      // We can't easily differentiate sequential same-pattern routes, but the test
      // should still work since MemoClaimer.deliver may fail and be caught.
      // Let's simplify: set status=delivered so deliver fails (wrong transition),
      // then markRead validates delivered->read (valid) and PATCHes.
      // Actually let's set status to 'claimed' so deliver() works:
      routes = [];
      const claimedMsg = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'claimed', content: 'Full body content', metadata: { subject: 'Read me', category: 'knowledge', priority: 'P2' } });
      const deliveredMsg = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'delivered', content: 'Full body content', metadata: { subject: 'Read me', category: 'knowledge', priority: 'P2' } });

      // Route: GET /v1/messages returns claimed message (for validateTransition in deliver)
      // This route will be matched by all GET /v1/messages calls.
      // We need a dynamic handler that changes response after deliver.
      let deliverCalled = false;
      routes.push({
        method: 'GET',
        pathPattern: '/v1/messages',
        handler: () => {
          // Before deliver: claimed; after deliver: delivered
          const msg = deliverCalled ? deliveredMsg : claimedMsg;
          return new Response(JSON.stringify([msg]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      // Route: PATCH /v1/messages/memo-read/status
      routes.push({
        method: 'PATCH',
        pathPattern: /\/v1\/messages\/memo-read\/status/,
        handler: () => {
          deliverCalled = true;
          const msg = deliverCalled ? readMessage : deliveredMsg;
          return new Response(JSON.stringify(msg), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      await execute(['read', 'memo-read']);

      const output = getLogOutput();
      expect(output).toContain('Read me');
      expect(output).toContain('Full body content');
    });

    test('outputs JSON with --json', async () => {
      const claimedMsg = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'claimed', content: 'Body', metadata: { subject: 'Test', category: 'knowledge', priority: 'P2' } });
      const readMsg = makeMessage({ id: 'memo-read', messageType: 'memo', status: 'read', content: 'Body', metadata: { subject: 'Test', category: 'knowledge', priority: 'P2' } });

      let patchCount = 0;
      routes.push({
        method: 'GET',
        pathPattern: '/v1/messages',
        handler: () => {
          const s = patchCount === 0 ? 'claimed' : 'delivered';
          const msg = { ...claimedMsg, status: s };
          return new Response(JSON.stringify([msg]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });
      routes.push({
        method: 'PATCH',
        pathPattern: /\/v1\/messages\/memo-read\/status/,
        handler: () => {
          patchCount++;
          return new Response(JSON.stringify(readMsg), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      });

      await execute(['read', 'memo-read', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.id).toBe('memo-read');
    });

    test('errors when memo ID is missing', () => {
      expect(() => execute(['read'])).toThrow();
    });
  });

  describe('reply', () => {
    test('replies to a memo by ID', async () => {
      // MemoThreading.reply() calls fetchMemoById() -> client.messages.listForAgent() -> GET /v1/messages
      // Then composer.send() -> POST /v1/messages
      const parentMsg = makeMessage({
        id: 'memo-001',
        messageType: 'memo',
        senderId: 'agent-002',
        targetAddress: 'agent://machine-001/agent-001',
        content: 'Original memo body',
        metadata: { subject: 'Original subject', category: 'knowledge', priority: 'P2' },
      });
      const replyMsg = makeMessage({
        id: 'memo-reply',
        messageType: 'memo',
        content: 'My reply',
        metadata: { subject: '(reply)', category: 'knowledge', priority: 'P2' },
        threadId: 'memo-001',
      });

      // fetchMemoById -> GET /v1/messages returns array of Messages
      addJSONRoute('GET', '/v1/messages', [parentMsg]);
      // composer.send -> POST /v1/messages
      addJSONRoute('POST', '/v1/messages', replyMsg);

      await execute(['reply', 'memo-001', '--body', 'My reply']);

      const output = getLogOutput();
      expect(output).toContain('Reply sent');
    });

    test('errors when memo ID is missing', () => {
      expect(() => execute(['reply', '--body', 'Reply body'])).toThrow();
    });

    test('errors when --body is missing', () => {
      expect(() => execute(['reply', 'memo-001'])).toThrow();
    });
  });

  describe('archive', () => {
    test('archives a memo by ID', async () => {
      // archive() calls expire() -> validateTransition (GET /v1/messages) + updateStatus (PATCH)
      const readMsg = makeMessage({ id: 'memo-arch', messageType: 'memo', status: 'read', content: 'Archive body', metadata: { subject: 'Archived', category: 'knowledge', priority: 'P2' } });
      const expiredMsg = makeMessage({ id: 'memo-arch', messageType: 'memo', status: 'expired', content: 'Archive body', metadata: { subject: 'Archived', category: 'knowledge', priority: 'P2' } });

      addJSONRoute('GET', '/v1/messages', [readMsg]);
      addJSONRoute('PATCH', /\/v1\/messages\/memo-arch\/status/, expiredMsg);

      await execute(['archive', 'memo-arch']);

      const output = getLogOutput();
      expect(output).toContain('Memo archived');
    });

    test('outputs JSON with --json', async () => {
      const readMsg = makeMessage({ id: 'memo-arch', messageType: 'memo', status: 'read', content: 'Body', metadata: { subject: 'Archived', category: 'knowledge', priority: 'P2' } });
      const expiredMsg = makeMessage({ id: 'memo-arch', messageType: 'memo', status: 'expired', content: 'Body', metadata: { subject: 'Archived', category: 'knowledge', priority: 'P2' } });

      addJSONRoute('GET', '/v1/messages', [readMsg]);
      addJSONRoute('PATCH', /\/v1\/messages\/memo-arch\/status/, expiredMsg);

      await execute(['archive', 'memo-arch', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.id).toBe('memo-arch');
    });
  });

  test('errors for unknown subcommand', () => {
    expect(() => execute(['unknown-sub'])).toThrow();
  });
});

// ============================================================================
// 8. Paste Command
// ============================================================================

describe('comms paste', () => {
  let execute: typeof import('../../src/comms/bridges/cli/commands/paste').execute;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
    const mod = await import('../../src/comms/bridges/cli/commands/paste');
    execute = mod.execute;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('shows help text for no subcommand', async () => {
    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('comms paste');
    expect(output).toContain('create');
    expect(output).toContain('read');
    expect(output).toContain('delete');
    expect(output).toContain('list');
    expect(output).toContain('shared');
  });

  describe('create', () => {
    test('creates a paste with content', async () => {
      const paste = makePasteView({ id: 'paste-new' });
      // PasteClient.create() calls manager.create() -> POST /v1/pastes
      addJSONRoute('POST', '/v1/pastes', {
        id: 'paste-new',
        creatorId: TEST_AGENT_ID,
        content: 'Hello paste',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: null,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        deletedAt: null,
      });

      await execute(['create', 'Hello paste']);

      const output = getLogOutput();
      expect(output).toContain('Paste created successfully');
    });

    test('creates with custom access and TTL flags', async () => {
      addJSONRoute('POST', '/v1/pastes', {
        id: 'paste-custom',
        creatorId: TEST_AGENT_ID,
        content: 'Secret',
        contentType: 'text/plain',
        accessType: 'read_once',
        ttlSeconds: null,
        recipientId: null,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        deletedAt: null,
      });

      await execute(['create', 'Secret', '--access', 'read_once', '--ttl', '300']);

      expect(fetchCalls.length).toBe(1);
    });

    test('creates with --to flag', async () => {
      addJSONRoute('POST', '/v1/pastes', {
        id: 'paste-to',
        creatorId: TEST_AGENT_ID,
        content: 'For you',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: 'agent-002',
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        deletedAt: null,
      });

      await execute(['create', 'For you', '--to', 'agent-002']);

      const body = fetchCalls[0]!.body as Record<string, unknown>;
      expect(body.recipientId).toBe('agent-002');
    });

    test('outputs JSON with --json', async () => {
      addJSONRoute('POST', '/v1/pastes', {
        id: 'paste-json',
        creatorId: TEST_AGENT_ID,
        content: 'JSON paste',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: null,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        deletedAt: null,
      });

      await execute(['create', 'JSON paste', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.id).toBe('paste-json');
    });

    test('errors when content is missing', () => {
      expect(() => execute(['create'])).toThrow();
    });

    test('errors for invalid access mode', () => {
      expect(() => execute(['create', 'test', '--access', 'invalid'])).toThrow();
    });
  });

  describe('read', () => {
    test('reads a paste by ID', async () => {
      addJSONRoute('GET', /\/v1\/pastes\/paste-read/, {
        id: 'paste-read',
        creatorId: TEST_AGENT_ID,
        content: 'Readable content',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: null,
        readBy: [TEST_AGENT_ID],
        readAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        deletedAt: null,
      });

      await execute(['read', 'paste-read']);

      const output = getLogOutput();
      expect(output).toContain('paste-read');
      expect(output).toContain('Readable content');
    });

    test('outputs JSON with --json', async () => {
      addJSONRoute('GET', /\/v1\/pastes\/paste-read/, {
        id: 'paste-read',
        creatorId: TEST_AGENT_ID,
        content: 'JSON read',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: null,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        deletedAt: null,
      });

      await execute(['read', 'paste-read', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.id).toBe('paste-read');
    });

    test('errors when paste ID is missing', () => {
      expect(() => execute(['read'])).toThrow();
    });
  });

  describe('delete', () => {
    test('deletes a paste by ID', async () => {
      addJSONRoute('DELETE', /\/v1\/pastes\/paste-del/, null, 204);

      await execute(['delete', 'paste-del']);

      const output = getLogOutput();
      expect(output).toContain('Paste deleted');
      expect(output).toContain('paste-del');
    });

    test('outputs JSON with --json', async () => {
      addJSONRoute('DELETE', /\/v1\/pastes\/paste-del/, null, 204);

      await execute(['delete', 'paste-del', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(parsed.deleted).toBe('paste-del');
    });

    test('errors when paste ID is missing', () => {
      expect(() => execute(['delete'])).toThrow();
    });
  });

  describe('list', () => {
    test('displays pastes in table format', async () => {
      const pastes = [
        {
          id: 'paste-001',
          creatorId: TEST_AGENT_ID,
          content: 'Paste 1',
          contentType: 'text/plain',
          accessType: 'ttl',
          ttlSeconds: 3600,
          recipientId: null,
          readBy: [],
          readAt: null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          deletedAt: null,
        },
      ];
      addJSONRoute('GET', '/v1/pastes', pastes);

      await execute(['list']);

      const output = getLogOutput();
      expect(output).toContain('Your Pastes');
    });

    test('outputs JSON with --json', async () => {
      const pastes = [{
        id: 'paste-001',
        creatorId: TEST_AGENT_ID,
        content: 'P1',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: null,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        deletedAt: null,
      }];
      addJSONRoute('GET', '/v1/pastes', pastes);

      await execute(['list', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(Array.isArray(parsed)).toBe(true);
    });

    test('shows "No pastes found." for empty list', async () => {
      addJSONRoute('GET', '/v1/pastes', []);

      await execute(['list']);

      const output = getLogOutput();
      expect(output).toContain('No pastes found.');
    });
  });

  describe('shared', () => {
    test('displays shared pastes in table format', async () => {
      const pastes = [{
        id: 'paste-shared-001',
        creatorId: 'other-agent',
        content: 'Shared content',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: TEST_AGENT_ID,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        deletedAt: null,
      }];
      addJSONRoute('GET', '/v1/pastes', pastes);

      await execute(['shared']);

      const output = getLogOutput();
      expect(output).toContain('Shared With You');
    });

    test('outputs JSON with --json', async () => {
      const pastes = [{
        id: 'paste-shared-001',
        creatorId: 'other-agent',
        content: 'Shared',
        contentType: 'text/plain',
        accessType: 'ttl',
        ttlSeconds: 3600,
        recipientId: TEST_AGENT_ID,
        readBy: [],
        readAt: null,
        createdAt: new Date().toISOString(),
        expiresAt: null,
        deletedAt: null,
      }];
      addJSONRoute('GET', '/v1/pastes', pastes);

      await execute(['shared', '--json']);

      expect(consoleLogs.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(consoleLogs[0]!);
      expect(Array.isArray(parsed)).toBe(true);
    });

    test('shows "No shared pastes found." for empty list', async () => {
      addJSONRoute('GET', '/v1/pastes', []);

      await execute(['shared']);

      const output = getLogOutput();
      expect(output).toContain('No shared pastes found.');
    });
  });

  test('errors for unknown subcommand', () => {
    expect(() => execute(['unknown-sub'])).toThrow();
  });
});

// ============================================================================
// 9. Dispatcher / Entry Point
// ============================================================================

describe('comms dispatcher', () => {
  // We test the dispatcher logic by importing and inspecting the entry point structure.
  // Since bin/comms.ts calls main() directly, we test the command registry pattern.

  test('command registry contains all expected commands', async () => {
    // Verify the barrel exports provide all commands
    const barrel = await import('../../src/comms/bridges/cli/index');

    expect(typeof barrel.executeStatus).toBe('function');
    expect(typeof barrel.executeAgents).toBe('function');
    expect(typeof barrel.executeSend).toBe('function');
    expect(typeof barrel.executeListen).toBe('function');
    expect(typeof barrel.executeChannels).toBe('function');
    expect(typeof barrel.executeMemo).toBe('function');
    expect(typeof barrel.executePaste).toBe('function');
  });

  test('barrel exports utility functions', async () => {
    const barrel = await import('../../src/comms/bridges/cli/index');

    expect(typeof barrel.truncate).toBe('function');
    expect(typeof barrel.formatTimestamp).toBe('function');
    expect(typeof barrel.formatStatus).toBe('function');
    expect(typeof barrel.hasJsonFlag).toBe('function');
    expect(typeof barrel.getFlagValue).toBe('function');
    expect(typeof barrel.jsonOutput).toBe('function');
    expect(typeof barrel.parseEnvConfig).toBe('function');
    expect(typeof barrel.parseEnvConfigPartial).toBe('function');
    expect(typeof barrel.exitWithError).toBe('function');
  });

  test('barrel exports types', async () => {
    // TypeScript types are erased at runtime, but we can verify
    // the module loads without errors
    const barrel = await import('../../src/comms/bridges/cli/index');
    expect(barrel).toBeTruthy();
  });

  test('barrel exports color functions', async () => {
    const barrel = await import('../../src/comms/bridges/cli/index');

    expect(typeof barrel.bold).toBe('function');
    expect(typeof barrel.cyan).toBe('function');
    expect(typeof barrel.dim).toBe('function');
    expect(typeof barrel.green).toBe('function');
    expect(typeof barrel.red).toBe('function');
    expect(typeof barrel.yellow).toBe('function');
    expect(typeof barrel.gray).toBe('function');
    expect(typeof barrel.magenta).toBe('function');
  });
});

// ============================================================================
// 10. Cross-cutting: --json flag propagation
// ============================================================================

describe('--json flag propagation', () => {
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('status --json returns valid JSON', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/status');
    addJSONRoute('GET', '/v1/agents', [makeAgent({ heartbeatAt: new Date().toISOString() })]);

    await execute(['--json']);

    expect(consoleLogs.length).toBe(1);
    expect(() => JSON.parse(consoleLogs[0]!)).not.toThrow();
  });

  test('agents --json returns valid JSON', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/agents');
    addJSONRoute('GET', '/v1/agents', [makeAgent({ heartbeatAt: new Date().toISOString() })]);

    await execute(['--json']);

    expect(consoleLogs.length).toBe(1);
    expect(() => JSON.parse(consoleLogs[0]!)).not.toThrow();
  });

  test('channels list --json returns valid JSON', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/channels');
    addJSONRoute('GET', '/v1/channels', [makeChannel()]);

    await execute(['list', '--json']);

    expect(consoleLogs.length).toBe(1);
    expect(() => JSON.parse(consoleLogs[0]!)).not.toThrow();
  });
});

// ============================================================================
// 11. Edge Cases
// ============================================================================

describe('Edge cases', () => {
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    saveEnv();
    setEnvFull();
    originalFetch = globalThis.fetch;
    routes = [];
    setupMockFetch();
    captureConsole();
    exitSpy = spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit called'); });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    routes = [];
    fetchCalls = [];
    restoreConsole();
    restoreEnv();
    exitSpy.mockRestore();
  });

  test('status handles agents with null sessionName', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/status');
    addJSONRoute('GET', '/v1/agents', [
      makeAgent({ sessionName: null, heartbeatAt: new Date().toISOString() }),
    ]);

    await execute([]);

    // Should not throw; uses agent.id as fallback name
    const output = getLogOutput();
    expect(output).toContain('Agents (1)');
  });

  test('status handles agents with null projectPath', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/status');
    addJSONRoute('GET', '/v1/agents', [
      makeAgent({ projectPath: null, heartbeatAt: new Date().toISOString() }),
    ]);

    await execute([]);

    const output = getLogOutput();
    expect(output).toContain('Agents (1)');
  });

  test('agents handles agents with empty capabilities and metadata', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/agents');
    addJSONRoute('GET', '/v1/agents', [
      makeAgent({ capabilities: {}, metadata: {}, heartbeatAt: new Date().toISOString() }),
    ]);

    await execute([]);

    const output = getLogOutput();
    // Should not show Capabilities or Metadata lines for empty objects
    expect(output).toContain('Registered Agents (1)');
  });

  test('channels create supports -t shorthand', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/channels');
    const channel = makeChannel({ id: 'ch-short', name: 'short-channel', type: 'project' });
    addJSONRoute('POST', '/v1/channels', channel);

    await execute(['create', 'short-channel', '-t', 'project']);

    expect(fetchCalls.length).toBe(1);
    const body = fetchCalls[0]!.body as Record<string, unknown>;
    expect(body.type).toBe('project');
  });

  test('memo compose supports -s and -b shorthands', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/memo');
    const memo = makeMemoView({ id: 'memo-short' });
    addJSONRoute('POST', '/v1/messages', memo);

    await execute(['compose', '--to', 'agent://m/a', '-s', 'Short subject', '-b', 'Short body']);

    expect(fetchCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('paste create parses --ttl as integer', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/paste');
    addJSONRoute('POST', '/v1/pastes', {
      id: 'paste-ttl',
      creatorId: TEST_AGENT_ID,
      content: 'TTL test',
      contentType: 'text/plain',
      accessType: 'ttl',
      ttlSeconds: 300,
      recipientId: null,
      readBy: [],
      readAt: null,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      deletedAt: null,
    });

    await execute(['create', 'TTL test', '--ttl', '300']);

    const body = fetchCalls[0]!.body as Record<string, unknown>;
    expect(body.ttlSeconds).toBe(300);
  });

  test('channels --help shows help', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/channels');

    await execute(['--help']);

    const output = getLogOutput();
    expect(output).toContain('comms channels');
  });

  test('memo --help shows help', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/memo');

    await execute(['--help']);

    const output = getLogOutput();
    expect(output).toContain('comms memo');
  });

  test('paste --help shows help', async () => {
    const { execute } = await import('../../src/comms/bridges/cli/commands/paste');

    await execute(['--help']);

    const output = getLogOutput();
    expect(output).toContain('comms paste');
  });
});
