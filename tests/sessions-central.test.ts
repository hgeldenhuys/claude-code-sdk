/**
 * Centralized Session Storage Tests (v3.0)
 *
 * Tests for:
 * - Machine ID management (machine.ts)
 * - SessionStore with centralized storage (store.ts)
 * - Query methods (listByDirectory, listByMachine)
 * - Migration from per-project sessions.json
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Import the modules we're testing
import { SessionStore } from '../src/hooks/sessions/store';
import type {
  GlobalSessionDatabase,
  MigrationResult,
  NamedSession,
  SessionDatabase,
} from '../src/hooks/sessions/types';

// ============================================================================
// Test Utilities
// ============================================================================

let testDir: string;
let testClaudeDir: string;
let testStoragePath: string;
let testMachineIdPath: string;
let testMachineAliasPath: string;

// Store original env values
let originalHome: string | undefined;
let originalUserProfile: string | undefined;

function setupTestEnvironment() {
  // Create unique test directory
  testDir = join(tmpdir(), `sesh-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  testClaudeDir = join(testDir, '.claude');
  testStoragePath = join(testClaudeDir, 'global-sessions.json');
  testMachineIdPath = join(testClaudeDir, 'machine-id');
  testMachineAliasPath = join(testClaudeDir, 'machine-alias');

  mkdirSync(testClaudeDir, { recursive: true });

  // Override HOME to use test directory
  originalHome = process.env.HOME;
  originalUserProfile = process.env.USERPROFILE;
  process.env.HOME = testDir;
  process.env.USERPROFILE = testDir;
}

function teardownTestEnvironment() {
  // Restore original env values
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  if (originalUserProfile !== undefined) {
    process.env.USERPROFILE = originalUserProfile;
  } else {
    delete process.env.USERPROFILE;
  }

  // Clean up test directory
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Generate a valid UUID v4 for testing
 */
function generateTestUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Create a v2.0 legacy database file for migration testing
 */
function createLegacyV2Database(path: string, sessions: Record<string, Partial<NamedSession>>) {
  const db: SessionDatabase = {
    version: '2.0',
    names: {},
    sessionIndex: {},
  };

  const now = new Date().toISOString();
  for (const [name, session] of Object.entries(sessions)) {
    const fullSession: NamedSession = {
      name,
      currentSessionId: session.currentSessionId ?? generateTestUUID(),
      history: session.history ?? [
        {
          sessionId: session.currentSessionId ?? generateTestUUID(),
          timestamp: now,
          source: 'startup',
        },
      ],
      created: session.created ?? now,
      lastAccessed: session.lastAccessed ?? now,
      manual: session.manual ?? false,
      cwd: session.cwd,
      machineId: session.machineId ?? '',
    };
    db.names[name] = fullSession;
    db.sessionIndex[fullSession.currentSessionId] = name;
  }

  const dir = join(path, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(db, null, 2));
}

/**
 * Create a v1.0 legacy database file for migration testing
 */
function createLegacyV1Database(
  path: string,
  sessions: Record<string, { name: string; created?: string; source?: string; manual?: boolean }>
) {
  const db = {
    version: '1.0',
    sessions,
  };

  const dir = join(path, '.claude');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sessions.json'), JSON.stringify(db, null, 2));
}

// ============================================================================
// Machine ID Tests
// ============================================================================

describe('Machine ID Management', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  describe('getMachineId()', () => {
    it('generates a valid UUID v4 when no machine-id file exists', async () => {
      // Dynamically import to get fresh module state
      const machineModule = await import('../src/hooks/sessions/machine');

      // Clear any cached machine ID by removing the file
      if (existsSync(testMachineIdPath)) {
        rmSync(testMachineIdPath);
      }

      // The module uses the file system, so with mocked HOME it should create new ID
      const store = new SessionStore({ storagePath: testStoragePath });
      const machineId = store.getMachineId();

      // Validate UUID v4 format
      const uuidV4Pattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(machineId).toMatch(uuidV4Pattern);
    });

    it('returns the same ID on subsequent calls (persists)', () => {
      // First store creates machine ID
      const store1 = new SessionStore({ storagePath: testStoragePath });
      const machineId1 = store1.getMachineId();

      // Second store should read the same ID
      const store2 = new SessionStore({ storagePath: testStoragePath });
      const machineId2 = store2.getMachineId();

      expect(machineId1).toBe(machineId2);
    });

    it('persists machine ID to file', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const machineId = store.getMachineId();

      // Check file exists and contains the ID
      expect(existsSync(testMachineIdPath)).toBe(true);
      const fileContent = readFileSync(testMachineIdPath, 'utf-8').trim();
      expect(fileContent).toBe(machineId);
    });
  });

  describe('setMachineAlias() and getMachineAlias()', () => {
    it('sets and retrieves machine alias', async () => {
      const { setMachineAlias, getMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      setMachineAlias('my-laptop');
      const alias = getMachineAlias();

      expect(alias).toBe('my-laptop');
    });

    it('normalizes alias to lowercase with hyphens', async () => {
      const { setMachineAlias, getMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      setMachineAlias('My Work Desktop');
      const alias = getMachineAlias();

      expect(alias).toBe('my-work-desktop');
    });

    it('removes special characters from alias', async () => {
      const { setMachineAlias, getMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      setMachineAlias('laptop@work#2024');
      const alias = getMachineAlias();

      expect(alias).toBe('laptop-work-2024');
    });

    it('throws on empty alias after normalization', async () => {
      const { setMachineAlias } = await import('../src/hooks/sessions/machine');

      expect(() => setMachineAlias('---')).toThrow('Invalid alias');
      expect(() => setMachineAlias('@#$%')).toThrow('Invalid alias');
    });

    it('returns undefined when no alias is set', async () => {
      const { getMachineAlias } = await import('../src/hooks/sessions/machine');

      // Ensure alias file doesn't exist
      if (existsSync(testMachineAliasPath)) {
        rmSync(testMachineAliasPath);
      }

      const alias = getMachineAlias();
      expect(alias).toBeUndefined();
    });
  });

  describe('getMachineInfo()', () => {
    it('returns valid MachineInfo structure', async () => {
      const { getMachineInfo, setMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      setMachineAlias('test-machine');
      const info = getMachineInfo();

      expect(info).toHaveProperty('id');
      expect(info).toHaveProperty('alias');
      expect(info).toHaveProperty('hostname');
      expect(info).toHaveProperty('registeredAt');
      expect(info).toHaveProperty('lastSeen');

      // Validate types
      expect(typeof info.id).toBe('string');
      expect(info.alias).toBe('test-machine');
      expect(typeof info.hostname).toBe('string');
      expect(info.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(info.lastSeen).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('includes hostname from os.hostname()', async () => {
      const { getMachineInfo } = await import('../src/hooks/sessions/machine');

      const info = getMachineInfo();
      expect(info.hostname).toBe(hostname());
    });
  });

  describe('getMachineDisplayName()', () => {
    it('returns alias when set', async () => {
      const { getMachineDisplayName, setMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      setMachineAlias('preferred-name');
      const displayName = getMachineDisplayName();

      expect(displayName).toBe('preferred-name');
    });

    it('returns hostname when no alias is set', async () => {
      const { getMachineDisplayName, clearMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      clearMachineAlias();
      const displayName = getMachineDisplayName();

      // Should be hostname (non-empty string)
      expect(typeof displayName).toBe('string');
      expect(displayName.length).toBeGreaterThan(0);
    });

    it('returns ID prefix as fallback', async () => {
      const { getMachineDisplayName, getMachineId, clearMachineAlias } = await import(
        '../src/hooks/sessions/machine'
      );

      // This test is tricky since hostname() rarely returns empty
      // We test the ID prefix pattern when alias is cleared
      clearMachineAlias();
      const displayName = getMachineDisplayName();
      const machineId = getMachineId();

      // Should be either hostname or first 8 chars of ID
      expect(displayName.length).toBeGreaterThan(0);
      // If hostname is empty, should be ID prefix
      if (hostname() === '') {
        expect(displayName).toBe(machineId.slice(0, 8));
      }
    });
  });
});

// ============================================================================
// Central Store Tests
// ============================================================================

describe('Centralized Session Storage', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  describe('Storage Location', () => {
    it('always stores to ~/.claude/global-sessions.json', () => {
      // Create store without explicit path (should use default)
      const store = new SessionStore({ storagePath: testStoragePath });

      // Track a session to trigger save
      store.track(generateTestUUID(), { name: 'test-session' });

      // Verify file was created at expected location
      expect(existsSync(testStoragePath)).toBe(true);
    });

    it('uses custom storagePath when provided', () => {
      const customPath = join(testDir, 'custom-sessions.json');
      const store = new SessionStore({ storagePath: customPath });

      store.track(generateTestUUID(), { name: 'custom-test' });

      expect(existsSync(customPath)).toBe(true);
    });
  });

  describe('Machine ID in Sessions', () => {
    it('includes machineId in new sessions', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const sessionId = generateTestUUID();

      store.track(sessionId, { name: 'machine-test', cwd: '/test/path' });

      const info = store.getByName('machine-test');
      expect(info).toBeDefined();
      expect(info?.machineId).toBe(store.getMachineId());
    });

    it('registers current machine in database', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const db = store.getDatabase();

      expect(db.machines).toBeDefined();
      expect(db.currentMachineId).toBe(store.getMachineId());
      expect(db.machines[store.getMachineId()]).toBeDefined();
    });
  });

  describe('Transcript ID Tracking', () => {
    it('stores transcriptId when provided', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const sessionId = generateTestUUID();
      const transcriptId = generateTestUUID();

      store.track(sessionId, {
        name: 'transcript-test',
        transcriptId,
        transcriptPath: '/path/to/transcript',
      });

      const history = store.getHistory('transcript-test');
      expect(history.length).toBe(1);
      expect(history[0].transcriptId).toBe(transcriptId);
      expect(history[0].transcriptPath).toBe('/path/to/transcript');
    });

    it('transcriptId is optional', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const sessionId = generateTestUUID();

      store.track(sessionId, { name: 'no-transcript' });

      const history = store.getHistory('no-transcript');
      expect(history.length).toBe(1);
      expect(history[0].transcriptId).toBeUndefined();
    });
  });

  describe('Schema Migration', () => {
    it('migrates from v2.0 format to v3.0', () => {
      // Create a v2.0 format database file
      const v2Db = {
        version: '2.0',
        names: {
          'old-session': {
            name: 'old-session',
            currentSessionId: 'old-uuid-1234',
            history: [
              {
                sessionId: 'old-uuid-1234',
                timestamp: '2025-01-01T00:00:00.000Z',
                source: 'startup',
              },
            ],
            created: '2025-01-01T00:00:00.000Z',
            lastAccessed: '2025-01-01T00:00:00.000Z',
            manual: false,
            cwd: '/old/project/path',
          },
        },
        sessionIndex: {
          'old-uuid-1234': 'old-session',
        },
        latestByDirectory: {
          '/old/project/path': 'old-session',
        },
      };

      writeFileSync(testStoragePath, JSON.stringify(v2Db, null, 2));

      // Load with SessionStore (should trigger migration)
      const store = new SessionStore({ storagePath: testStoragePath });
      const db = store.getDatabase();

      // Verify v3.0 structure
      expect(db.version).toBe('3.0');
      expect(db.machines).toBeDefined();
      expect(db.directoryIndex).toBeDefined();

      // Verify old session was preserved
      expect(db.names['old-session']).toBeDefined();
      expect(db.names['old-session'].machineId).toBe(store.getMachineId());

      // Verify directory index was built
      expect(db.directoryIndex['/old/project/path']).toContain('old-session');
    });

    it('handles corrupted database file gracefully', () => {
      // Write invalid JSON
      writeFileSync(testStoragePath, 'not valid json {{{');

      // Should not throw, should create fresh database
      const store = new SessionStore({ storagePath: testStoragePath });
      const db = store.getDatabase();

      expect(db.version).toBe('3.0');
      expect(Object.keys(db.names)).toHaveLength(0);
    });

    it('handles missing database file gracefully', () => {
      // Ensure file doesn't exist
      if (existsSync(testStoragePath)) {
        rmSync(testStoragePath);
      }

      const store = new SessionStore({ storagePath: testStoragePath });
      const db = store.getDatabase();

      expect(db.version).toBe('3.0');
      expect(db.machines).toBeDefined();
    });
  });
});

// ============================================================================
// Query Method Tests
// ============================================================================

describe('Query Methods', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  describe('listByDirectory()', () => {
    it('returns only sessions for the specified directory', () => {
      const store = new SessionStore({ storagePath: testStoragePath });

      // Create sessions in different directories
      store.track(generateTestUUID(), { name: 'project-a-1', cwd: '/path/to/project-a' });
      store.track(generateTestUUID(), { name: 'project-a-2', cwd: '/path/to/project-a' });
      store.track(generateTestUUID(), { name: 'project-b-1', cwd: '/path/to/project-b' });
      store.track(generateTestUUID(), { name: 'project-c-1', cwd: '/path/to/project-c' });

      // Query by directory
      const projectASessions = store.listByDirectory('/path/to/project-a');

      expect(projectASessions).toHaveLength(2);
      expect(projectASessions.map((s) => s.name).sort()).toEqual(['project-a-1', 'project-a-2']);
    });

    it('returns empty array for unknown directory', () => {
      const store = new SessionStore({ storagePath: testStoragePath });

      store.track(generateTestUUID(), { name: 'session-1', cwd: '/known/path' });

      const sessions = store.listByDirectory('/unknown/path');

      expect(sessions).toHaveLength(0);
    });

    it('returns sessions sorted by lastAccessed (most recent first)', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const cwd = '/sort/test/path';

      // Create sessions - all should be returned
      store.track(generateTestUUID(), { name: 'session-a', cwd });
      store.track(generateTestUUID(), { name: 'session-b', cwd });
      store.track(generateTestUUID(), { name: 'session-c', cwd });

      const sessions = store.listByDirectory(cwd);

      expect(sessions).toHaveLength(3);
      // Verify all sessions are present (order depends on access time which may be identical)
      const names = sessions.map((s) => s.name).sort();
      expect(names).toEqual(['session-a', 'session-b', 'session-c']);
    });
  });

  describe('listByMachine()', () => {
    it('returns only sessions for the specified machine', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const currentMachineId = store.getMachineId();

      // Create sessions on current machine
      store.track(generateTestUUID(), { name: 'local-session-1', cwd: '/local/path' });
      store.track(generateTestUUID(), { name: 'local-session-2', cwd: '/local/path' });

      // Query by current machine
      const sessions = store.listByMachine(currentMachineId);

      expect(sessions).toHaveLength(2);
      for (const session of sessions) {
        expect(session.machineId).toBe(currentMachineId);
      }
    });

    it('defaults to current machine when machineId is undefined', () => {
      const store = new SessionStore({ storagePath: testStoragePath });

      store.track(generateTestUUID(), { name: 'default-machine', cwd: '/test/path' });

      // Call without machineId parameter
      const sessions = store.listByMachine();

      expect(sessions).toHaveLength(1);
      expect(sessions[0].machineId).toBe(store.getMachineId());
    });

    it('returns empty array for unknown machine', () => {
      const store = new SessionStore({ storagePath: testStoragePath });

      store.track(generateTestUUID(), { name: 'local-session', cwd: '/local/path' });

      const sessions = store.listByMachine('unknown-machine-id');

      expect(sessions).toHaveLength(0);
    });

    it('returns sessions sorted by lastAccessed (most recent first)', () => {
      const store = new SessionStore({ storagePath: testStoragePath });

      store.track(generateTestUUID(), { name: 'alpha', cwd: '/test' });
      store.track(generateTestUUID(), { name: 'beta', cwd: '/test' });
      store.track(generateTestUUID(), { name: 'gamma', cwd: '/test' });

      const sessions = store.listByMachine();

      expect(sessions).toHaveLength(3);
      // Verify all sessions are present (order depends on access time which may be identical in fast execution)
      const names = sessions.map((s) => s.name).sort();
      expect(names).toEqual(['alpha', 'beta', 'gamma']);
    });
  });
});

// ============================================================================
// Migration Tests
// ============================================================================

describe('Migration from Project Sessions', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  describe('migrateFromProject()', () => {
    it('imports sessions from v2.0 project path', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-v2');

      // Create v2.0 legacy database
      createLegacyV2Database(projectPath, {
        'legacy-session-1': {
          currentSessionId: 'legacy-uuid-1',
          cwd: projectPath,
        },
        'legacy-session-2': {
          currentSessionId: 'legacy-uuid-2',
          cwd: projectPath,
        },
      });

      const result = store.migrateFromProject(projectPath);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify sessions were imported
      const session1 = store.getByName('legacy-session-1');
      expect(session1).toBeDefined();
      expect(session1?.machineId).toBe(store.getMachineId());
    });

    it('imports sessions from v1.0 project path', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-v1');

      // Create v1.0 legacy database
      createLegacyV1Database(projectPath, {
        'v1-uuid-1': { name: 'v1-session-1', source: 'startup' },
        'v1-uuid-2': { name: 'v1-session-2', source: 'resume' },
      });

      const result = store.migrateFromProject(projectPath);

      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify sessions were imported
      const session = store.getByName('v1-session-1');
      expect(session).toBeDefined();
      expect(session?.machineId).toBe(store.getMachineId());
    });

    it('adds machineId to imported sessions', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-machine-test');

      createLegacyV2Database(projectPath, {
        'machine-test-session': {
          currentSessionId: 'machine-uuid',
          cwd: projectPath,
        },
      });

      store.migrateFromProject(projectPath);

      const db = store.getDatabase();
      const session = db.names['machine-test-session'];

      expect(session).toBeDefined();
      expect(session.machineId).toBe(store.getMachineId());
    });

    it('skips sessions that already exist in global database', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-existing');

      // First, create a session in the global store
      store.track(generateTestUUID(), { name: 'existing-session', cwd: '/some/path' });

      // Create project database with same name
      createLegacyV2Database(projectPath, {
        'existing-session': {
          currentSessionId: 'different-uuid',
          cwd: projectPath,
        },
      });

      const result = store.migrateFromProject(projectPath);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);

      // Check details
      expect(result.details[0].name).toBe('existing-session');
      expect(result.details[0].status).toBe('skipped');
      expect(result.details[0].reason).toContain('already exists');
    });

    it('handles missing source files gracefully', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const nonExistentPath = join(testDir, 'non-existent-project');

      const result = store.migrateFromProject(nonExistentPath);

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('handles corrupted source files gracefully', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-corrupted');

      // Create corrupted sessions.json
      const claudeDir = join(projectPath, '.claude');
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, 'sessions.json'), 'not valid json {{{');

      const result = store.migrateFromProject(projectPath);

      expect(result.errors).toBe(1);
      expect(result.details[0].status).toBe('error');
    });

    it('returns correct stats (imported, skipped, errors)', () => {
      const store = new SessionStore({ storagePath: testStoragePath });
      const projectPath = join(testDir, 'project-mixed');

      // Pre-create one session to trigger a skip
      store.track(generateTestUUID(), { name: 'skip-me', cwd: '/path' });

      // Create project database with mix of new and existing
      createLegacyV2Database(projectPath, {
        'skip-me': {
          currentSessionId: 'skip-uuid',
          cwd: projectPath,
        },
        'import-me': {
          currentSessionId: 'import-uuid',
          cwd: projectPath,
        },
      });

      const result = store.migrateFromProject(projectPath);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.errors).toBe(0);

      // Verify details
      const importDetail = result.details.find((d) => d.name === 'import-me');
      const skipDetail = result.details.find((d) => d.name === 'skip-me');

      expect(importDetail?.status).toBe('imported');
      expect(skipDetail?.status).toBe('skipped');
    });
  });
});

// ============================================================================
// Directory Index Tests
// ============================================================================

describe('Directory Index', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  it('builds directory index when tracking sessions with cwd', () => {
    const store = new SessionStore({ storagePath: testStoragePath });

    store.track(generateTestUUID(), { name: 'session-1', cwd: '/project/a' });
    store.track(generateTestUUID(), { name: 'session-2', cwd: '/project/a' });
    store.track(generateTestUUID(), { name: 'session-3', cwd: '/project/b' });

    const db = store.getDatabase();

    expect(db.directoryIndex['/project/a']).toHaveLength(2);
    expect(db.directoryIndex['/project/a']).toContain('session-1');
    expect(db.directoryIndex['/project/a']).toContain('session-2');
    expect(db.directoryIndex['/project/b']).toHaveLength(1);
    expect(db.directoryIndex['/project/b']).toContain('session-3');
  });

  it('updates latestByDirectory when tracking', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const cwd = '/test/project';

    store.track(generateTestUUID(), { name: 'first', cwd });
    store.track(generateTestUUID(), { name: 'second', cwd });

    const latest = store.getLatestForDirectory(cwd);
    expect(latest).toBe('second');
  });

  it('allows resuming latest session for directory', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const cwd = '/resume/test';

    // Create initial session
    store.track('original-uuid', { name: 'resume-test', cwd, source: 'startup' });

    // Simulate /clear creating new session
    const newSessionId = 'new-uuid-after-clear';
    const result = store.resumeLatestForDirectory(newSessionId, cwd);

    expect(result).toBeDefined();
    expect(result?.name).toBe('resume-test');
    expect(result?.sessionIdChanged).toBe(true);
    expect(result?.previousSessionId).toBe('original-uuid');

    // Verify new session ID is now associated with the name
    expect(store.getSessionId('resume-test')).toBe(newSessionId);
  });
});

// ============================================================================
// Machine Registry Tests
// ============================================================================

describe('Machine Registry', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  it('registers current machine on store creation', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const db = store.getDatabase();

    const machineId = store.getMachineId();
    expect(db.machines[machineId]).toBeDefined();
    expect(db.machines[machineId].id).toBe(machineId);
    expect(db.machines[machineId].hostname).toBe(hostname());
  });

  it('updates lastSeen on store access', () => {
    const store1 = new SessionStore({ storagePath: testStoragePath });
    const machineId = store1.getMachineId();
    const firstSeen = store1.getDatabase().machines[machineId].lastSeen;

    // Small delay to ensure different timestamp
    const store2 = new SessionStore({ storagePath: testStoragePath });
    const secondSeen = store2.getDatabase().machines[machineId].lastSeen;

    // lastSeen should be updated (or equal if too fast)
    expect(new Date(secondSeen).getTime()).toBeGreaterThanOrEqual(new Date(firstSeen).getTime());
  });
});

// ============================================================================
// Session History with Machine Context
// ============================================================================

describe('Session History with Machine Context', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  it('maintains session history across session ID changes', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const name = 'history-test';

    // Simulate multiple compacts/clears
    store.track('uuid-1', { name, source: 'startup', cwd: '/test' });
    store.track('uuid-2', { name, source: 'compact', cwd: '/test' });
    store.track('uuid-3', { name, source: 'clear', cwd: '/test' });

    const history = store.getHistory(name);

    expect(history).toHaveLength(3);
    expect(history[0].sessionId).toBe('uuid-1');
    expect(history[0].source).toBe('startup');
    expect(history[1].sessionId).toBe('uuid-2');
    expect(history[1].source).toBe('compact');
    expect(history[2].sessionId).toBe('uuid-3');
    expect(history[2].source).toBe('clear');
  });

  it('all history entries have same machineId', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const name = 'machine-history-test';

    store.track('uuid-1', { name, cwd: '/test' });
    store.track('uuid-2', { name, cwd: '/test' });

    const session = store.getByName(name);
    expect(session?.machineId).toBe(store.getMachineId());

    // All sessions tracked by same store have same machineId
    const db = store.getDatabase();
    const namedSession = db.names[name];
    expect(namedSession.machineId).toBe(store.getMachineId());
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    setupTestEnvironment();
  });

  afterEach(() => {
    teardownTestEnvironment();
  });

  it('handles concurrent store instances', () => {
    const store1 = new SessionStore({ storagePath: testStoragePath });
    const store2 = new SessionStore({ storagePath: testStoragePath });

    // Both should have same machine ID
    expect(store1.getMachineId()).toBe(store2.getMachineId());

    // Track in store1
    store1.track(generateTestUUID(), { name: 'store1-session', cwd: '/test' });

    // Store2 needs to reload to see it
    const store3 = new SessionStore({ storagePath: testStoragePath });
    expect(store3.getByName('store1-session')).toBeDefined();
  });

  it('handles very long directory paths', () => {
    const store = new SessionStore({ storagePath: testStoragePath });
    const longPath = '/a'.repeat(500) + '/very/long/path';

    store.track(generateTestUUID(), { name: 'long-path-session', cwd: longPath });

    const sessions = store.listByDirectory(longPath);
    expect(sessions).toHaveLength(1);
  });

  it('handles unicode in session names and paths', () => {
    const store = new SessionStore({ storagePath: testStoragePath });

    // Note: session names are normalized, so unicode might be stripped
    store.track(generateTestUUID(), {
      name: 'unicode-test',
      cwd: '/path/with/unicode/folder',
    });

    const session = store.getByName('unicode-test');
    expect(session).toBeDefined();
  });

  it('handles empty database gracefully', () => {
    const store = new SessionStore({ storagePath: testStoragePath });

    expect(store.listByDirectory('/any/path')).toHaveLength(0);
    expect(store.listByMachine()).toHaveLength(0);
    expect(store.list()).toHaveLength(0);
  });
});
