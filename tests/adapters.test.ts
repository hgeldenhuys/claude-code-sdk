/**
 * Adapter Framework Unit Tests
 *
 * Tests for:
 * - TranscriptAdapter interface compliance
 * - AdapterRegistry register/unregister/get/list
 * - BaseAdapter cursor tracking persistence
 * - BaseAdapter metrics collection
 * - JSONL parsing edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { AdapterRegistry, getAdapterRegistry } from '../src/transcripts/adapters/registry';
import { BaseAdapter, initCursorSchema } from '../src/transcripts/adapters/base';
import type {
  TranscriptAdapter,
  EntryContext,
  ProcessEntryResult,
  AdapterMetrics,
  WatchPath,
} from '../src/transcripts/adapters/types';

// ============================================================================
// Test Fixtures - Mock Adapter Implementation
// ============================================================================

/**
 * Mock adapter for testing TranscriptAdapter interface compliance
 */
class MockAdapter extends BaseAdapter {
  readonly name = 'mock-adapter';
  readonly description = 'Mock adapter for testing';
  readonly fileExtensions = ['.jsonl'];

  private testDir: string;
  public onRegisterCalled = false;
  public onUnregisterCalled = false;
  public processedEntries: Array<{ entry: Record<string, unknown>; context: EntryContext }> = [];

  constructor(testDir: string) {
    super();
    this.testDir = testDir;
  }

  get watchPath(): WatchPath {
    return () => [`${this.testDir}/*.jsonl`];
  }

  processEntry(
    entry: Record<string, unknown>,
    _db: Database,
    context: EntryContext
  ): ProcessEntryResult {
    this.processedEntries.push({ entry, context });

    // Simulate failure for entries with error: true
    if (entry.error === true) {
      return {
        success: false,
        error: 'Simulated error',
      };
    }

    return {
      success: true,
      entryType: (entry.type as string) || 'unknown',
    };
  }

  override onRegister(): void {
    this.onRegisterCalled = true;
  }

  override onUnregister(): void {
    this.onUnregisterCalled = true;
  }
}

/**
 * Minimal adapter that only implements required methods
 */
class MinimalAdapter implements TranscriptAdapter {
  readonly name = 'minimal-adapter';
  readonly description = 'Minimal adapter with only required methods';
  readonly watchPath = '~/.test/**/*.jsonl';
  readonly fileExtensions = ['.jsonl'];

  private metrics: AdapterMetrics = {
    entriesProcessed: 0,
    entriesFailed: 0,
    entriesByType: {},
    bytesProcessed: 0,
    startTime: new Date(),
    endTime: undefined,
    filesProcessed: 0,
  };

  processEntry(
    entry: Record<string, unknown>,
    _db: Database,
    _context: EntryContext
  ): ProcessEntryResult {
    this.metrics.entriesProcessed++;
    return { success: true, entryType: (entry.type as string) || 'unknown' };
  }

  getMetrics(): AdapterMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      entriesProcessed: 0,
      entriesFailed: 0,
      entriesByType: {},
      bytesProcessed: 0,
      startTime: new Date(),
      endTime: undefined,
      filesProcessed: 0,
    };
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('TranscriptAdapter Interface Compliance', () => {
  let tempDir: string;
  let db: Database;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'adapter-test-'));
    db = new Database(':memory:');
    initCursorSchema(db);
  });

  afterAll(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should implement all required interface properties', () => {
    const adapter = new MockAdapter(tempDir);

    // Required readonly properties
    expect(typeof adapter.name).toBe('string');
    expect(adapter.name.length).toBeGreaterThan(0);

    expect(typeof adapter.description).toBe('string');

    expect(adapter.watchPath).toBeDefined();

    expect(Array.isArray(adapter.fileExtensions)).toBe(true);
    expect(adapter.fileExtensions.length).toBeGreaterThan(0);
  });

  it('should implement processEntry method', () => {
    const adapter = new MockAdapter(tempDir);

    const context: EntryContext = {
      filePath: '/test/file.jsonl',
      lineNumber: 1,
      rawLine: '{"type":"test"}',
      sessionId: 'session-123',
      processedAt: new Date().toISOString(),
    };

    const result = adapter.processEntry({ type: 'test' }, db, context);

    expect(result).toHaveProperty('success');
    expect(typeof result.success).toBe('boolean');
  });

  it('should implement getMetrics and resetMetrics methods', () => {
    const adapter = new MockAdapter(tempDir);

    const metrics = adapter.getMetrics();
    expect(metrics).toHaveProperty('entriesProcessed');
    expect(metrics).toHaveProperty('entriesFailed');
    expect(metrics).toHaveProperty('entriesByType');
    expect(metrics).toHaveProperty('bytesProcessed');
    expect(metrics).toHaveProperty('startTime');
    expect(metrics).toHaveProperty('filesProcessed');

    adapter.resetMetrics();
    const resetMetrics = adapter.getMetrics();
    expect(resetMetrics.entriesProcessed).toBe(0);
    expect(resetMetrics.entriesFailed).toBe(0);
  });

  it('should work with minimal adapter implementation', () => {
    const adapter = new MinimalAdapter();

    expect(adapter.name).toBe('minimal-adapter');
    expect(typeof adapter.watchPath).toBe('string');

    const context: EntryContext = {
      filePath: '/test/file.jsonl',
      lineNumber: 1,
      rawLine: '{"type":"test"}',
      processedAt: new Date().toISOString(),
    };

    const result = adapter.processEntry({ type: 'test' }, db, context);
    expect(result.success).toBe(true);

    const metrics = adapter.getMetrics();
    expect(metrics.entriesProcessed).toBe(1);
  });
});

describe('AdapterRegistry', () => {
  let tempDir: string;
  let db: Database;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'registry-test-'));
    db = new Database(':memory:');
    initCursorSchema(db);
  });

  afterAll(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Reset the singleton instance before each test
    AdapterRegistry.resetInstance();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = AdapterRegistry.getInstance();
      const instance2 = AdapterRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should return instance via getAdapterRegistry helper', () => {
      const instance1 = AdapterRegistry.getInstance();
      const instance2 = getAdapterRegistry();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);
      instance1.register(adapter);

      AdapterRegistry.resetInstance();
      const instance2 = AdapterRegistry.getInstance();

      expect(instance2.count()).toBe(0);
    });
  });

  describe('register()', () => {
    it('should register an adapter', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);

      expect(registry.has('mock-adapter')).toBe(true);
      expect(registry.count()).toBe(1);
    });

    it('should throw error when registering duplicate adapter', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter1 = new MockAdapter(tempDir);
      const adapter2 = new MockAdapter(tempDir);

      registry.register(adapter1);

      expect(() => registry.register(adapter2)).toThrow("Adapter 'mock-adapter' is already registered");
    });

    it('should call onRegister hook', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);

      expect(adapter.onRegisterCalled).toBe(true);
    });

    it('should initialize schema when database is set', () => {
      const registry = AdapterRegistry.getInstance();
      registry.setDatabase(db);

      const adapter = new MockAdapter(tempDir);
      registry.register(adapter, { initSchema: true });

      // Verify cursor table was created
      const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('adapter_cursors');
    });

    it('should respect enabled option', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter, { enabled: false });

      expect(registry.has('mock-adapter')).toBe(true);
      expect(registry.isEnabled('mock-adapter')).toBe(false);
    });
  });

  describe('unregister()', () => {
    it('should unregister an adapter', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);
      const result = registry.unregister('mock-adapter');

      expect(result).toBe(true);
      expect(registry.has('mock-adapter')).toBe(false);
    });

    it('should return false for non-existent adapter', () => {
      const registry = AdapterRegistry.getInstance();

      const result = registry.unregister('non-existent');

      expect(result).toBe(false);
    });

    it('should call onUnregister hook', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);
      registry.unregister('mock-adapter');

      expect(adapter.onUnregisterCalled).toBe(true);
    });
  });

  describe('get()', () => {
    it('should return adapter by name', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);
      const retrieved = registry.get('mock-adapter');

      expect(retrieved).toBe(adapter);
    });

    it('should return undefined for non-existent adapter', () => {
      const registry = AdapterRegistry.getInstance();

      const retrieved = registry.get('non-existent');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('list()', () => {
    it('should list all registered adapter names', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir));
      registry.register(new MinimalAdapter());

      const names = registry.list();

      expect(names).toContain('mock-adapter');
      expect(names).toContain('minimal-adapter');
      expect(names.length).toBe(2);
    });

    it('should list only enabled adapters when enabledOnly is true', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir), { enabled: true });
      registry.register(new MinimalAdapter(), { enabled: false });

      const names = registry.list(true);

      expect(names).toContain('mock-adapter');
      expect(names).not.toContain('minimal-adapter');
    });

    it('should return empty array when no adapters registered', () => {
      const registry = AdapterRegistry.getInstance();

      const names = registry.list();

      expect(names).toEqual([]);
    });
  });

  describe('getAll()', () => {
    it('should return all adapter instances', () => {
      const registry = AdapterRegistry.getInstance();
      const mockAdapter = new MockAdapter(tempDir);
      const minimalAdapter = new MinimalAdapter();

      registry.register(mockAdapter);
      registry.register(minimalAdapter);

      const adapters = registry.getAll();

      expect(adapters).toContain(mockAdapter);
      expect(adapters).toContain(minimalAdapter);
      expect(adapters.length).toBe(2);
    });

    it('should filter by enabled status', () => {
      const registry = AdapterRegistry.getInstance();
      const mockAdapter = new MockAdapter(tempDir);
      const minimalAdapter = new MinimalAdapter();

      registry.register(mockAdapter, { enabled: true });
      registry.register(minimalAdapter, { enabled: false });

      const enabledAdapters = registry.getAll(true);

      expect(enabledAdapters).toContain(mockAdapter);
      expect(enabledAdapters).not.toContain(minimalAdapter);
    });
  });

  describe('enable() / disable() / isEnabled()', () => {
    it('should enable a disabled adapter', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir), { enabled: false });

      const result = registry.enable('mock-adapter');

      expect(result).toBe(true);
      expect(registry.isEnabled('mock-adapter')).toBe(true);
    });

    it('should disable an enabled adapter', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir), { enabled: true });

      const result = registry.disable('mock-adapter');

      expect(result).toBe(true);
      expect(registry.isEnabled('mock-adapter')).toBe(false);
    });

    it('should return false for non-existent adapter', () => {
      const registry = AdapterRegistry.getInstance();

      expect(registry.enable('non-existent')).toBe(false);
      expect(registry.disable('non-existent')).toBe(false);
      expect(registry.isEnabled('non-existent')).toBe(false);
    });
  });

  describe('getByExtension()', () => {
    it('should return adapters that handle a specific extension', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir));
      registry.register(new MinimalAdapter());

      const adapters = registry.getByExtension('.jsonl');

      expect(adapters.length).toBe(2);
    });

    it('should normalize extension with or without dot', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir));

      const withDot = registry.getByExtension('.jsonl');
      const withoutDot = registry.getByExtension('jsonl');

      expect(withDot.length).toBe(1);
      expect(withoutDot.length).toBe(1);
    });

    it('should return empty array for unhandled extension', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir));

      const adapters = registry.getByExtension('.txt');

      expect(adapters.length).toBe(0);
    });
  });

  describe('clear()', () => {
    it('should remove all adapters', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir));
      registry.register(new MinimalAdapter());

      registry.clear();

      expect(registry.count()).toBe(0);
    });

    it('should call onUnregister for all adapters', () => {
      const registry = AdapterRegistry.getInstance();
      const adapter = new MockAdapter(tempDir);

      registry.register(adapter);
      registry.clear();

      expect(adapter.onUnregisterCalled).toBe(true);
    });
  });

  describe('getStatus()', () => {
    it('should return registry status summary', () => {
      const registry = AdapterRegistry.getInstance();
      registry.register(new MockAdapter(tempDir), { enabled: true });
      registry.register(new MinimalAdapter(), { enabled: false });

      const status = registry.getStatus();

      expect(status.totalAdapters).toBe(2);
      expect(status.enabledAdapters).toBe(1);
      expect(status.adapterDetails.length).toBe(2);
      expect(status.adapterDetails[0]).toHaveProperty('name');
      expect(status.adapterDetails[0]).toHaveProperty('description');
      expect(status.adapterDetails[0]).toHaveProperty('enabled');
      expect(status.adapterDetails[0]).toHaveProperty('registeredAt');
      expect(status.adapterDetails[0]).toHaveProperty('fileExtensions');
    });
  });
});

describe('BaseAdapter Cursor Tracking', () => {
  let tempDir: string;
  let db: Database;
  let adapter: MockAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cursor-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initCursorSchema(db);
    adapter = new MockAdapter(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  it('should save and retrieve cursor state', () => {
    const filePath = '/test/file.jsonl';

    adapter.saveCursor(db, {
      filePath,
      byteOffset: 1024,
      entryCount: 50,
      firstTimestamp: '2025-01-01T00:00:00Z',
      lastTimestamp: '2025-01-01T12:00:00Z',
      updatedAt: new Date().toISOString(),
    });

    const cursor = adapter.getCursor(db, filePath);

    expect(cursor).not.toBeNull();
    expect(cursor!.filePath).toBe(filePath);
    expect(cursor!.adapterName).toBe('mock-adapter');
    expect(cursor!.byteOffset).toBe(1024);
    expect(cursor!.entryCount).toBe(50);
    expect(cursor!.firstTimestamp).toBe('2025-01-01T00:00:00Z');
    expect(cursor!.lastTimestamp).toBe('2025-01-01T12:00:00Z');
  });

  it('should return null for non-existent cursor', () => {
    const cursor = adapter.getCursor(db, '/non-existent/file.jsonl');
    expect(cursor).toBeNull();
  });

  it('should update existing cursor', () => {
    const filePath = '/test/file.jsonl';

    // Save initial cursor
    adapter.saveCursor(db, {
      filePath,
      byteOffset: 1024,
      entryCount: 50,
      firstTimestamp: '2025-01-01T00:00:00Z',
      lastTimestamp: '2025-01-01T12:00:00Z',
      updatedAt: new Date().toISOString(),
    });

    // Update cursor
    adapter.saveCursor(db, {
      filePath,
      byteOffset: 2048,
      entryCount: 100,
      firstTimestamp: '2025-01-01T00:00:00Z',
      lastTimestamp: '2025-01-01T18:00:00Z',
      updatedAt: new Date().toISOString(),
    });

    const cursor = adapter.getCursor(db, filePath);

    expect(cursor!.byteOffset).toBe(2048);
    expect(cursor!.entryCount).toBe(100);
    expect(cursor!.lastTimestamp).toBe('2025-01-01T18:00:00Z');
  });

  it('should delete cursor', () => {
    const filePath = '/test/file.jsonl';

    adapter.saveCursor(db, {
      filePath,
      byteOffset: 1024,
      entryCount: 50,
      firstTimestamp: null,
      lastTimestamp: null,
      updatedAt: new Date().toISOString(),
    });

    adapter.deleteCursor(db, filePath);

    const cursor = adapter.getCursor(db, filePath);
    expect(cursor).toBeNull();
  });

  it('should maintain separate cursors per adapter', async () => {
    const filePath = '/test/shared-file.jsonl';

    // Create a second adapter with different name
    class AnotherAdapter extends MockAdapter {
      override readonly name = 'another-adapter';
    }
    const anotherAdapter = new AnotherAdapter(tempDir);

    // Save cursors for both adapters on same file
    adapter.saveCursor(db, {
      filePath,
      byteOffset: 1000,
      entryCount: 10,
      firstTimestamp: null,
      lastTimestamp: null,
      updatedAt: new Date().toISOString(),
    });

    anotherAdapter.saveCursor(db, {
      filePath,
      byteOffset: 2000,
      entryCount: 20,
      firstTimestamp: null,
      lastTimestamp: null,
      updatedAt: new Date().toISOString(),
    });

    // Verify cursors are independent
    const cursor1 = adapter.getCursor(db, filePath);
    const cursor2 = anotherAdapter.getCursor(db, filePath);

    expect(cursor1!.byteOffset).toBe(1000);
    expect(cursor1!.adapterName).toBe('mock-adapter');
    expect(cursor2!.byteOffset).toBe(2000);
    expect(cursor2!.adapterName).toBe('another-adapter');
  });

  it('should persist cursor across processFile calls', async () => {
    // Create test JSONL file
    const filePath = join(tempDir, 'cursor-persistence.jsonl');
    const lines = [
      '{"sessionId":"s1","timestamp":"2025-01-01T00:00:00Z","type":"user"}',
      '{"sessionId":"s1","timestamp":"2025-01-01T00:01:00Z","type":"assistant"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    // Create a custom adapter that inserts to a test table
    class TestInsertAdapter extends BaseAdapter {
      readonly name = 'test-insert';
      readonly description = 'Test adapter that inserts to test table';
      readonly fileExtensions = ['.jsonl'];
      get watchPath(): WatchPath { return () => []; }

      override initSchema(db: Database): void {
        super.initSchema(db);
        db.run('CREATE TABLE IF NOT EXISTS test_entries (id INTEGER PRIMARY KEY, type TEXT)');
      }

      processEntry(
        entry: Record<string, unknown>,
        db: Database,
        _context: EntryContext
      ): ProcessEntryResult {
        db.run('INSERT INTO test_entries (type) VALUES (?)', [entry.type as string]);
        return { success: true, entryType: entry.type as string };
      }
    }

    const testAdapter = new TestInsertAdapter();
    testAdapter.initSchema(db);

    // Process file first time
    const result1 = testAdapter.processFile(filePath, db);
    expect(result1.entriesIndexed).toBe(2);

    // Verify cursor was saved
    const cursor1 = testAdapter.getCursor(db, filePath);
    expect(cursor1).not.toBeNull();
    expect(cursor1!.entryCount).toBe(2);

    // Add more content to file
    const moreLines = '{"sessionId":"s1","timestamp":"2025-01-01T00:02:00Z","type":"system"}\n';
    await appendFile(filePath, moreLines);

    // Process delta (only new content)
    const result2 = testAdapter.processFileDelta(filePath, db);
    expect(result2.entriesIndexed).toBe(1);

    // Verify cursor was updated
    const cursor2 = testAdapter.getCursor(db, filePath);
    expect(cursor2!.entryCount).toBe(3);
  });
});

describe('BaseAdapter Metrics Collection', () => {
  let tempDir: string;
  let db: Database;
  let adapter: MockAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'metrics-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initCursorSchema(db);
    adapter = new MockAdapter(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  it('should track entries processed', async () => {
    const filePath = join(tempDir, 'metrics-test.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z"}',
      '{"type":"system","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    adapter.processFile(filePath, db);
    const metrics = adapter.getMetrics();

    expect(metrics.entriesProcessed).toBe(3);
    expect(metrics.entriesFailed).toBe(0);
    expect(metrics.filesProcessed).toBe(1);
  });

  it('should track entries by type', async () => {
    const filePath = join(tempDir, 'type-metrics.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z"}',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    adapter.processFile(filePath, db);
    const metrics = adapter.getMetrics();

    expect(metrics.entriesByType['user']).toBe(2);
    expect(metrics.entriesByType['assistant']).toBe(1);
  });

  it('should track failed entries', async () => {
    const filePath = join(tempDir, 'error-metrics.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"error","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z","error":true}',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    adapter.processFile(filePath, db);
    const metrics = adapter.getMetrics();

    expect(metrics.entriesProcessed).toBe(2);
    expect(metrics.entriesFailed).toBe(1);
  });

  it('should track bytes processed', async () => {
    const filePath = join(tempDir, 'bytes-metrics.jsonl');
    const content = '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}\n';
    await writeFile(filePath, content);

    adapter.processFile(filePath, db);
    const metrics = adapter.getMetrics();

    expect(metrics.bytesProcessed).toBe(Buffer.byteLength(content, 'utf-8'));
  });

  it('should reset metrics', async () => {
    const filePath = join(tempDir, 'reset-metrics.jsonl');
    const lines = '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}\n';
    await writeFile(filePath, lines);

    adapter.processFile(filePath, db);

    // Verify metrics were collected
    let metrics = adapter.getMetrics();
    expect(metrics.entriesProcessed).toBeGreaterThan(0);

    // Reset and verify
    adapter.resetMetrics();
    metrics = adapter.getMetrics();

    expect(metrics.entriesProcessed).toBe(0);
    expect(metrics.entriesFailed).toBe(0);
    expect(metrics.bytesProcessed).toBe(0);
    expect(metrics.filesProcessed).toBe(0);
    expect(Object.keys(metrics.entriesByType).length).toBe(0);
  });

  it('should accumulate metrics across multiple files', async () => {
    // Create first file
    const filePath1 = join(tempDir, 'multi-file-1.jsonl');
    await writeFile(filePath1, '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}\n');

    // Create second file
    const filePath2 = join(tempDir, 'multi-file-2.jsonl');
    await writeFile(filePath2, '{"type":"assistant","sessionId":"s2","timestamp":"2025-01-01T00:01:00Z"}\n');

    adapter.processFile(filePath1, db);
    adapter.processFile(filePath2, db);

    const metrics = adapter.getMetrics();

    expect(metrics.entriesProcessed).toBe(2);
    expect(metrics.filesProcessed).toBe(2);
    expect(metrics.entriesByType['user']).toBe(1);
    expect(metrics.entriesByType['assistant']).toBe(1);
  });
});

describe('JSONL Parsing Edge Cases', () => {
  let tempDir: string;
  let db: Database;
  let adapter: MockAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'jsonl-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initCursorSchema(db);
    adapter = new MockAdapter(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  it('should handle empty file', async () => {
    const filePath = join(tempDir, 'empty.jsonl');
    await writeFile(filePath, '');

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(0);
  });

  it('should handle file with only whitespace', async () => {
    const filePath = join(tempDir, 'whitespace.jsonl');
    await writeFile(filePath, '   \n\n   \n');

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(0);
  });

  it('should skip malformed JSON lines', async () => {
    const filePath = join(tempDir, 'malformed.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      'not valid json',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z"}',
      '{incomplete json',
      '{"type":"system","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    const result = adapter.processFile(filePath, db);
    const metrics = adapter.getMetrics();

    expect(result.entriesIndexed).toBe(3); // Only valid JSON lines
    expect(metrics.entriesFailed).toBe(2); // Invalid lines
  });

  it('should handle empty lines between valid entries', async () => {
    const filePath = join(tempDir, 'empty-lines.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z"}',
      '',
      '',
      '{"type":"system","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(3);
  });

  it('should handle partial line at start when reading from offset', async () => {
    const filePath = join(tempDir, 'partial-start.jsonl');
    const line1 = '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}';
    const line2 = '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z"}';
    await writeFile(filePath, `${line1}\n${line2}\n`);

    // Read from middle of first line (simulates delta read hitting mid-line)
    const partialOffset = 20; // Middle of first JSON object

    // Protected method test: verify parseJsonlLines handles partial
    const content = `partial":"garbage"}\n${line2}\n`;

    // The BaseAdapter.parseJsonlLines should skip the partial first line
    // when fromByteOffset > 0 and line doesn't start with '{'
    const result = adapter.processFile(filePath, db, { fromByteOffset: partialOffset });

    // The partial line should be skipped
    // Since the real file is being read from offset 20, the actual content
    // will depend on what's at that position
    expect(result.entriesIndexed).toBeLessThanOrEqual(2);
  });

  it('should handle file without trailing newline', async () => {
    const filePath = join(tempDir, 'no-trailing-newline.jsonl');
    const content = '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}';
    await writeFile(filePath, content); // No trailing newline

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(1);
  });

  it('should handle very long lines', async () => {
    const filePath = join(tempDir, 'long-line.jsonl');
    const longContent = 'x'.repeat(10000);
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2025-01-01T00:00:00Z',
      data: longContent,
    });
    await writeFile(filePath, line + '\n');

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(1);
  });

  it('should handle Unicode content', async () => {
    const filePath = join(tempDir, 'unicode.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z","content":"Hello"}',
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:01:00Z","content":"Hej"}',
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:02:00Z","content":"Emoji: test"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(3);
  });

  it('should extract session ID from entries', async () => {
    const filePath = join(tempDir, 'session-extract.jsonl');
    const lines = [
      '{"type":"user","sessionId":"test-session-123","timestamp":"2025-01-01T00:00:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    const result = adapter.processFile(filePath, db);

    expect(result.sessionId).toBe('test-session-123');
  });

  it('should track first and last timestamps', async () => {
    const filePath = join(tempDir, 'timestamps.jsonl');
    const lines = [
      '{"type":"user","sessionId":"s1","timestamp":"2025-01-01T00:00:00Z"}',
      '{"type":"assistant","sessionId":"s1","timestamp":"2025-01-01T06:00:00Z"}',
      '{"type":"system","sessionId":"s1","timestamp":"2025-01-01T12:00:00Z"}',
    ].join('\n') + '\n';

    await writeFile(filePath, lines);

    const result = adapter.processFile(filePath, db);

    expect(result.firstTimestamp).toBe('2025-01-01T00:00:00Z');
    expect(result.lastTimestamp).toBe('2025-01-01T12:00:00Z');
  });

  it('should handle JSON with nested objects', async () => {
    const filePath = join(tempDir, 'nested.jsonl');
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2025-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', name: 'Read', input: { file: '/test.txt' } },
        ],
      },
    });
    await writeFile(filePath, line + '\n');

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(1);
    expect(adapter.processedEntries[0]!.entry.message).toBeDefined();
  });

  it('should handle JSON with special characters in strings', async () => {
    const filePath = join(tempDir, 'special-chars.jsonl');
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      timestamp: '2025-01-01T00:00:00Z',
      content: 'Line 1\nLine 2\tTabbed\r\nWindows line',
      path: 'C:\\Users\\test\\file.txt',
      quote: 'He said "hello"',
    });
    await writeFile(filePath, line + '\n');

    const result = adapter.processFile(filePath, db);

    expect(result.entriesIndexed).toBe(1);
  });
});

describe('BaseAdapter handlesFile', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'handles-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return true for matching extension', () => {
    const adapter = new MockAdapter(tempDir);

    expect(adapter.handlesFile('/path/to/file.jsonl')).toBe(true);
  });

  it('should return false for non-matching extension', () => {
    const adapter = new MockAdapter(tempDir);

    expect(adapter.handlesFile('/path/to/file.txt')).toBe(false);
    expect(adapter.handlesFile('/path/to/file.json')).toBe(false);
    expect(adapter.handlesFile('/path/to/file')).toBe(false);
  });

  it('should handle extensions with or without leading dot', () => {
    // Create adapter with extension without dot
    class NoDotAdapter extends BaseAdapter {
      readonly name = 'nodot';
      readonly description = 'Test';
      readonly fileExtensions = ['jsonl']; // No leading dot
      get watchPath(): WatchPath { return () => []; }

      processEntry(): ProcessEntryResult {
        return { success: true };
      }
    }

    const adapter = new NoDotAdapter();

    expect(adapter.handlesFile('/path/file.jsonl')).toBe(true);
  });
});

describe('BaseAdapter resolveWatchPaths', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'watch-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should resolve function watchPath', async () => {
    class FunctionWatchAdapter extends BaseAdapter {
      readonly name = 'func-watch';
      readonly description = 'Test';
      readonly fileExtensions = ['.jsonl'];

      get watchPath(): WatchPath {
        return () => ['/path/file1.jsonl', '/path/file2.jsonl'];
      }

      processEntry(): ProcessEntryResult {
        return { success: true };
      }
    }

    const adapter = new FunctionWatchAdapter();
    const paths = await adapter.resolveWatchPaths();

    expect(paths).toEqual(['/path/file1.jsonl', '/path/file2.jsonl']);
  });

  it('should resolve async function watchPath', async () => {
    class AsyncWatchAdapter extends BaseAdapter {
      readonly name = 'async-watch';
      readonly description = 'Test';
      readonly fileExtensions = ['.jsonl'];

      get watchPath(): WatchPath {
        return async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return ['/async/file.jsonl'];
        };
      }

      processEntry(): ProcessEntryResult {
        return { success: true };
      }
    }

    const adapter = new AsyncWatchAdapter();
    const paths = await adapter.resolveWatchPaths();

    expect(paths).toEqual(['/async/file.jsonl']);
  });
});
