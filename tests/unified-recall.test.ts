/**
 * Unified Recall Tests
 *
 * Tests for the unified search functionality across adapters:
 * - SearchableTable interface compliance
 * - getSearchableTables() on built-in adapters
 * - searchUnified() function in db.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { TranscriptLinesAdapter } from '../src/transcripts/adapters/transcript-lines';
import { HookEventsAdapter } from '../src/transcripts/adapters/hook-events';
import { AdapterRegistry } from '../src/transcripts/adapters/registry';
import { initCursorSchema } from '../src/transcripts/adapters/base';
import { initSchema, searchUnified, type UnifiedSearchOptions } from '../src/transcripts/db';
import type { SearchableTable } from '../src/transcripts/adapters/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestTranscriptLine = (
  sessionId: string,
  lineNumber: number,
  type: string,
  content: string,
  timestamp: string
) => JSON.stringify({
  sessionId,
  uuid: `line-${lineNumber}`,
  type,
  timestamp,
  message: { role: type === 'user' ? 'user' : 'assistant', content },
});

const createTestHookEvent = (
  sessionId: string,
  eventType: string,
  toolName: string,
  timestamp: string
) => JSON.stringify({
  sessionId,
  eventType,
  toolName,
  timestamp,
  toolUseId: `tool-${Date.now()}`,
  handlerResults: {},
});

// ============================================================================
// SearchableTable Interface Tests
// ============================================================================

describe('SearchableTable Interface', () => {
  it('should have all required properties', () => {
    const table: SearchableTable = {
      ftsTable: 'test_fts',
      sourceTable: 'test',
      contentColumn: 'content',
      joinColumn: 'id',
      selectColumns: ['id', 'name'],
      sourceName: 'Test Source',
      sourceIcon: '🧪',
    };

    expect(table.ftsTable).toBe('test_fts');
    expect(table.sourceTable).toBe('test');
    expect(table.contentColumn).toBe('content');
    expect(table.joinColumn).toBe('id');
    expect(Array.isArray(table.selectColumns)).toBe(true);
    expect(table.sourceName).toBe('Test Source');
    expect(table.sourceIcon).toBe('🧪');
  });
});

// ============================================================================
// TranscriptLinesAdapter.getSearchableTables() Tests
// ============================================================================

describe('TranscriptLinesAdapter.getSearchableTables()', () => {
  let adapter: TranscriptLinesAdapter;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'transcript-searchable-test-'));
    adapter = new TranscriptLinesAdapter(tempDir);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return an array of SearchableTable', () => {
    const tables = adapter.getSearchableTables();

    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
  });

  it('should return lines_fts table configuration', () => {
    const tables = adapter.getSearchableTables();
    const linesFts = tables.find((t) => t.ftsTable === 'lines_fts');

    expect(linesFts).toBeDefined();
    expect(linesFts!.sourceTable).toBe('lines');
    expect(linesFts!.contentColumn).toBe('content');
    expect(linesFts!.joinColumn).toBe('id');
  });

  it('should have correct display metadata', () => {
    const tables = adapter.getSearchableTables();
    const linesFts = tables.find((t) => t.ftsTable === 'lines_fts');

    expect(linesFts!.sourceName).toBe('Transcript');
    expect(linesFts!.sourceIcon).toBe('📝');
  });

  it('should include required select columns', () => {
    const tables = adapter.getSearchableTables();
    const linesFts = tables.find((t) => t.ftsTable === 'lines_fts');

    expect(linesFts!.selectColumns).toContain('session_id');
    expect(linesFts!.selectColumns).toContain('timestamp');
    expect(linesFts!.selectColumns).toContain('content');
    expect(linesFts!.selectColumns).toContain('turn_id');
  });
});

// ============================================================================
// HookEventsAdapter.getSearchableTables() Tests
// ============================================================================

describe('HookEventsAdapter.getSearchableTables()', () => {
  let adapter: HookEventsAdapter;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hook-events-searchable-test-'));
    adapter = new HookEventsAdapter(tempDir);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return an array of SearchableTable', () => {
    const tables = adapter.getSearchableTables();

    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
  });

  it('should return hook_events_fts table configuration', () => {
    const tables = adapter.getSearchableTables();
    const hookFts = tables.find((t) => t.ftsTable === 'hook_events_fts');

    expect(hookFts).toBeDefined();
    expect(hookFts!.sourceTable).toBe('hook_events');
    expect(hookFts!.contentColumn).toBe('content');
    expect(hookFts!.joinColumn).toBe('id');
  });

  it('should have correct display metadata', () => {
    const tables = adapter.getSearchableTables();
    const hookFts = tables.find((t) => t.ftsTable === 'hook_events_fts');

    expect(hookFts!.sourceName).toBe('Hook Event');
    expect(hookFts!.sourceIcon).toBe('🪝');
  });

  it('should include required select columns', () => {
    const tables = adapter.getSearchableTables();
    const hookFts = tables.find((t) => t.ftsTable === 'hook_events_fts');

    expect(hookFts!.selectColumns).toContain('session_id');
    expect(hookFts!.selectColumns).toContain('timestamp');
    expect(hookFts!.selectColumns).toContain('event_type');
    expect(hookFts!.selectColumns).toContain('tool_name');
  });
});

// ============================================================================
// searchUnified() Tests
// ============================================================================

describe('searchUnified()', () => {
  let db: Database;
  let tempDir: string;
  let transcriptAdapter: TranscriptLinesAdapter;
  let hookAdapter: HookEventsAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'unified-search-test-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    db = new Database(':memory:');
    initSchema(db);
    initCursorSchema(db);

    transcriptAdapter = new TranscriptLinesAdapter(tempDir);
    hookAdapter = new HookEventsAdapter(tempDir);
  });

  afterEach(() => {
    db.close();
  });

  it('should return empty array for empty query', () => {
    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    const results = searchUnified(db, tables, { query: '' });
    expect(results).toEqual([]);
  });

  it('should return empty array for whitespace-only query', () => {
    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    const results = searchUnified(db, tables, { query: '   ' });
    expect(results).toEqual([]);
  });

  it('should search transcript lines', async () => {
    // Create test transcript file
    const transcriptPath = join(tempDir, 'transcript.jsonl');
    const lines = [
      createTestTranscriptLine('session-1', 1, 'user', 'Hello world', '2025-01-01T00:00:00Z'),
      createTestTranscriptLine('session-1', 2, 'assistant', 'Hi there!', '2025-01-01T00:01:00Z'),
      createTestTranscriptLine('session-1', 3, 'user', 'Tell me about testing', '2025-01-01T00:02:00Z'),
    ].join('\n') + '\n';
    await writeFile(transcriptPath, lines);

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    // Get searchable tables with adapter name
    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    // Search
    const results = searchUnified(db, tables, { query: 'Hello' });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.adapterName).toBe('transcript-lines');
    expect(results[0]!.sourceName).toBe('Transcript');
    expect(results[0]!.sourceIcon).toBe('📝');
  });

  it('should handle multiple search tables', async () => {
    // Create test transcript file
    const transcriptPath = join(tempDir, 'transcript-multi.jsonl');
    const lines = [
      createTestTranscriptLine('session-1', 1, 'user', 'Unique search term foo', '2025-01-01T00:00:00Z'),
    ].join('\n') + '\n';
    await writeFile(transcriptPath, lines);

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    // Combine tables from both adapters
    const allTables = [
      ...transcriptAdapter.getSearchableTables().map((t) => ({ ...t, adapterName: 'transcript-lines' })),
      ...hookAdapter.getSearchableTables().map((t) => ({ ...t, adapterName: 'hook-events' })),
    ];

    // Search (should only find in transcript, not in empty hook events)
    const results = searchUnified(db, allTables, { query: 'foo' });

    expect(results.length).toBeGreaterThan(0);
    // All results should be from transcript adapter since hook events is empty
    expect(results.every((r) => r.adapterName === 'transcript-lines')).toBe(true);
  });

  it('should respect sources filter', async () => {
    // Create test transcript file
    const transcriptPath = join(tempDir, 'transcript-filter.jsonl');
    const lines = [
      createTestTranscriptLine('session-1', 1, 'user', 'Test filter content', '2025-01-01T00:00:00Z'),
    ].join('\n') + '\n';
    await writeFile(transcriptPath, lines);

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    // Combine tables from both adapters
    const allTables = [
      ...transcriptAdapter.getSearchableTables().map((t) => ({ ...t, adapterName: 'transcript-lines' })),
      ...hookAdapter.getSearchableTables().map((t) => ({ ...t, adapterName: 'hook-events' })),
    ];

    // Search with filter - only hook-events (which is empty)
    const results = searchUnified(db, allTables, {
      query: 'filter',
      sources: ['hook-events'],
    });

    // Should return empty since hook-events has no data
    expect(results.length).toBe(0);
  });

  it('should respect limitPerSource option', async () => {
    // Create test transcript file with many lines
    const transcriptPath = join(tempDir, 'transcript-limit.jsonl');
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(createTestTranscriptLine(
        'session-1',
        i + 1,
        'user',
        `Keyword match ${i}`,
        `2025-01-01T00:${i.toString().padStart(2, '0')}:00Z`
      ));
    }
    await writeFile(transcriptPath, lines.join('\n') + '\n');

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    // Search with limit
    const results = searchUnified(db, tables, {
      query: 'Keyword',
      limitPerSource: 5,
    });

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should filter by sessionIds', async () => {
    // Create test transcript file with multiple sessions
    const transcriptPath = join(tempDir, 'transcript-sessions.jsonl');
    const lines = [
      createTestTranscriptLine('session-A', 1, 'user', 'Session A content', '2025-01-01T00:00:00Z'),
      createTestTranscriptLine('session-B', 1, 'user', 'Session B content', '2025-01-01T00:01:00Z'),
      createTestTranscriptLine('session-C', 1, 'user', 'Session C content', '2025-01-01T00:02:00Z'),
    ].join('\n') + '\n';
    await writeFile(transcriptPath, lines);

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    // Search with session filter
    const results = searchUnified(db, tables, {
      query: 'Session',
      sessionIds: ['session-A', 'session-C'],
    });

    // Should only find sessions A and C
    const foundSessions = new Set(results.map((r) => r.sessionId));
    expect(foundSessions.has('session-A')).toBe(true);
    expect(foundSessions.has('session-B')).toBe(false);
    expect(foundSessions.has('session-C')).toBe(true);
  });

  it('should include required fields in results', async () => {
    // Create test transcript file
    const transcriptPath = join(tempDir, 'transcript-fields.jsonl');
    const lines = [
      createTestTranscriptLine('session-test', 42, 'user', 'Test fields content', '2025-01-01T12:34:56Z'),
    ].join('\n') + '\n';
    await writeFile(transcriptPath, lines);

    // Index the file
    transcriptAdapter.processFileWithSessions(transcriptPath, db);

    const tables = transcriptAdapter.getSearchableTables().map((t) => ({
      ...t,
      adapterName: 'transcript-lines',
    }));

    const results = searchUnified(db, tables, { query: 'fields' });

    expect(results.length).toBeGreaterThan(0);
    const result = results[0]!;

    // Check all required fields are present
    expect(result.adapterName).toBe('transcript-lines');
    expect(result.sourceName).toBeDefined();
    expect(result.sourceIcon).toBeDefined();
    expect(result.sessionId).toBe('session-test');
    expect(result.timestamp).toBe('2025-01-01T12:34:56Z');
    expect(result.entryType).toBeDefined();
    expect(typeof result.lineNumber).toBe('number');
    expect(result.matchedText).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it('should handle non-existent FTS tables gracefully', () => {
    // Create a fake searchable table config for a non-existent table
    const fakeTables = [{
      ftsTable: 'nonexistent_fts',
      sourceTable: 'nonexistent',
      contentColumn: 'content',
      joinColumn: 'id',
      selectColumns: ['id'],
      sourceName: 'Fake',
      sourceIcon: '❓',
      adapterName: 'fake-adapter',
    }];

    // Should not throw, just return empty results
    const results = searchUnified(db, fakeTables, { query: 'test' });
    expect(results).toEqual([]);
  });
});

// ============================================================================
// AdapterRegistry Integration Tests
// ============================================================================

describe('AdapterRegistry getSearchableTables integration', () => {
  let tempDir: string;
  let db: Database;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'registry-searchable-test-'));
    db = new Database(':memory:');
    initSchema(db);
  });

  afterAll(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    AdapterRegistry.resetInstance();
  });

  it('should collect searchable tables from all registered adapters', () => {
    const registry = AdapterRegistry.getInstance();
    registry.setDatabase(db);

    const transcriptAdapter = new TranscriptLinesAdapter(tempDir);
    const hookAdapter = new HookEventsAdapter(tempDir);

    registry.register(transcriptAdapter);
    registry.register(hookAdapter);

    // Collect searchable tables from all adapters
    const allTables: Array<SearchableTable & { adapterName: string }> = [];
    for (const adapter of registry.getAll()) {
      if (adapter.getSearchableTables) {
        const tables = adapter.getSearchableTables();
        for (const table of tables) {
          allTables.push({ ...table, adapterName: adapter.name });
        }
      }
    }

    expect(allTables.length).toBeGreaterThanOrEqual(2);
    expect(allTables.some((t) => t.adapterName === 'transcript-lines')).toBe(true);
    expect(allTables.some((t) => t.adapterName === 'hook-events')).toBe(true);
  });
});
