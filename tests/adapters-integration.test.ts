/**
 * Adapter Integration Tests
 *
 * Tests for built-in adapters (TranscriptLinesAdapter, HookEventsAdapter)
 * with real JSONL processing, turn_id/session_name extraction, and
 * incremental/delta processing.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { TranscriptLinesAdapter, createTranscriptLinesAdapter } from '../src/transcripts/adapters/transcript-lines';
import { HookEventsAdapter, createHookEventsAdapter } from '../src/transcripts/adapters/hook-events';
import { initSchema } from '../src/transcripts/db';
import { initCursorSchema } from '../src/transcripts/adapters/base';

// ============================================================================
// Test Fixtures - Sample JSONL Data
// ============================================================================

/**
 * Sample transcript JSONL content with various entry types
 */
const sampleTranscriptLines = [
  {
    type: 'user',
    uuid: 'uuid-1',
    sessionId: 'session-001',
    timestamp: '2025-01-06T10:00:00Z',
    cwd: '/project',
    slug: 'test-session',
    message: {
      role: 'user',
      content: 'Hello, help me with TypeScript',
    },
  },
  {
    type: 'assistant',
    uuid: 'uuid-2',
    parentUuid: 'uuid-1',
    sessionId: 'session-001',
    timestamp: '2025-01-06T10:00:05Z',
    cwd: '/project',
    slug: 'test-session',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Sure, I can help with TypeScript!' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/project/package.json' } },
      ],
    },
  },
  {
    type: 'user',
    uuid: 'uuid-3',
    parentUuid: 'uuid-2',
    sessionId: 'session-001',
    timestamp: '2025-01-06T10:00:30Z',
    cwd: '/project',
    slug: 'test-session',
    message: {
      role: 'user',
      content: 'Thanks! Now show me the tests',
    },
  },
  {
    type: 'summary',
    uuid: 'uuid-4',
    sessionId: 'session-001',
    timestamp: '2025-01-06T10:01:00Z',
    cwd: '/project',
    slug: 'test-session',
    summary: 'Discussed TypeScript project setup and reviewed package.json',
  },
];

/**
 * Sample hook events JSONL content with turn tracking
 */
const sampleHookEvents = [
  {
    timestamp: '2025-01-06T10:00:00Z',
    sessionId: 'session-001',
    eventType: 'SessionStart',
    handlerResults: {
      'session-naming-SessionStart': {
        data: { sessionName: 'jolly-squid' },
      },
      'turn-tracker-SessionStart': {
        data: { turnId: 'session-001:1', sequence: 1, turnSequence: 1 },
      },
    },
  },
  {
    timestamp: '2025-01-06T10:00:02Z',
    sessionId: 'session-001',
    eventType: 'PreToolUse',
    toolUseId: 'tool-1',
    toolName: 'Read',
    decision: 'allow',
    input: { file_path: '/project/package.json' },
    handlerResults: {
      'turn-tracker-PreToolUse': {
        data: { turnId: 'session-001:1', sequence: 1 },
      },
    },
  },
  {
    timestamp: '2025-01-06T10:00:03Z',
    sessionId: 'session-001',
    eventType: 'PostToolUse',
    toolUseId: 'tool-1',
    toolName: 'Read',
    handlerResults: {
      'turn-tracker-PostToolUse': {
        data: { turnId: 'session-001:1', sequence: 1 },
      },
    },
  },
  {
    timestamp: '2025-01-06T10:00:30Z',
    sessionId: 'session-001',
    eventType: 'Stop',
    handlerResults: {
      'turn-tracker-Stop': {
        data: { turnId: 'session-001:1', sequence: 1, turnSequence: 1 },
      },
    },
  },
  {
    timestamp: '2025-01-06T10:01:00Z',
    sessionId: 'session-001',
    eventType: 'PreToolUse',
    toolUseId: 'tool-2',
    toolName: 'Bash',
    decision: 'allow',
    input: { command: 'bun test' },
    handlerResults: {
      'turn-tracker-PreToolUse': {
        data: { turnId: 'session-001:2', sequence: 2 },
      },
    },
  },
];

function toJsonl(entries: object[]): string {
  return entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// ============================================================================
// TranscriptLinesAdapter Integration Tests
// ============================================================================

describe('TranscriptLinesAdapter Integration', () => {
  let tempDir: string;
  let projectsDir: string;
  let db: Database;
  let adapter: TranscriptLinesAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'transcript-adapter-test-'));
    projectsDir = join(tempDir, 'projects');
    await mkdir(projectsDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    initCursorSchema(db);
    adapter = createTranscriptLinesAdapter(projectsDir);
  });

  afterEach(() => {
    db.close();
  });

  describe('Basic Processing', () => {
    it('should process real transcript JSONL file', async () => {
      const filePath = join(projectsDir, 'session-001.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      const result = adapter.processFileWithSessions(filePath, db);

      expect(result.linesIndexed).toBe(4);
      expect(result.sessionId).toBe('session-001');

      // Verify lines were indexed
      const rows = db.query('SELECT * FROM lines WHERE session_id = ?').all('session-001') as {
        uuid: string;
        type: string;
        content: string;
        slug: string | null;
        role: string | null;
      }[];

      expect(rows.length).toBe(4);

      // Verify types were extracted
      const types = rows.map((r) => r.type);
      expect(types).toContain('user');
      expect(types).toContain('assistant');
      expect(types).toContain('summary');
    });

    it('should extract content from message structures', async () => {
      const filePath = join(projectsDir, 'content-test.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      adapter.processFileWithSessions(filePath, db);

      // Check user message content
      const userRow = db.query('SELECT content FROM lines WHERE uuid = ?').get('uuid-1') as { content: string };
      expect(userRow.content).toContain('Hello, help me with TypeScript');

      // Check assistant message with tool use
      const assistantRow = db.query('SELECT content FROM lines WHERE uuid = ?').get('uuid-2') as { content: string };
      expect(assistantRow.content).toContain('TypeScript');
      expect(assistantRow.content).toContain('[Tool: Read]');

      // Check summary content
      const summaryRow = db.query('SELECT content FROM lines WHERE uuid = ?').get('uuid-4') as { content: string };
      expect(summaryRow.content).toContain('TypeScript project setup');
    });

    it('should extract slug from entries', async () => {
      const filePath = join(projectsDir, 'slug-test.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      adapter.processFileWithSessions(filePath, db);

      const row = db.query('SELECT slug FROM lines WHERE uuid = ?').get('uuid-1') as { slug: string };
      expect(row.slug).toBe('test-session');
    });

    it('should extract role and model from message', async () => {
      const filePath = join(projectsDir, 'role-test.jsonl');
      const entries = [
        {
          type: 'assistant',
          uuid: 'model-uuid',
          sessionId: 'session-002',
          timestamp: '2025-01-06T10:00:00Z',
          cwd: '/project',
          message: {
            role: 'assistant',
            model: 'claude-3-opus',
            content: 'Response from model',
          },
        },
      ];
      await writeFile(filePath, toJsonl(entries));

      adapter.processFileWithSessions(filePath, db);

      const row = db.query('SELECT role, model FROM lines WHERE uuid = ?').get('model-uuid') as {
        role: string;
        model: string;
      };
      expect(row.role).toBe('assistant');
      expect(row.model).toBe('claude-3-opus');
    });

    it('should update sessions table', async () => {
      const filePath = join(projectsDir, 'sessions-test.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      adapter.processFileWithSessions(filePath, db);

      const session = db.query('SELECT * FROM sessions WHERE file_path = ?').get(filePath) as {
        session_id: string;
        slug: string | null;
        line_count: number;
        byte_offset: number;
        first_timestamp: string | null;
        last_timestamp: string | null;
      };

      expect(session).not.toBeNull();
      expect(session.session_id).toBe('session-001');
      expect(session.line_count).toBe(4);
      expect(session.byte_offset).toBeGreaterThan(0);
      expect(session.first_timestamp).toBe('2025-01-06T10:00:00Z');
      expect(session.last_timestamp).toBe('2025-01-06T10:01:00Z');
    });
  });

  describe('Incremental Processing (Delta)', () => {
    it('should process only new content on delta update', async () => {
      const filePath = join(projectsDir, 'delta-test.jsonl');

      // Initial content
      const initialLines = sampleTranscriptLines.slice(0, 2);
      await writeFile(filePath, toJsonl(initialLines));

      // First index
      const result1 = adapter.processFileWithSessions(filePath, db);
      expect(result1.linesIndexed).toBe(2);

      // Add more content
      const additionalLines = sampleTranscriptLines.slice(2);
      await appendFile(filePath, toJsonl(additionalLines));

      // Get cursor state
      const cursor = adapter.getCursor(db, filePath);
      expect(cursor).not.toBeNull();
      const initialByteOffset = cursor!.byteOffset;

      // Delta update
      const result2 = adapter.processFileWithSessions(filePath, db, initialByteOffset, cursor!.entryCount + 1);
      expect(result2.linesIndexed).toBe(2); // Only new lines

      // Verify total lines in DB
      const totalRows = db.query('SELECT COUNT(*) as count FROM lines WHERE session_id = ?').get('session-001') as { count: number };
      expect(totalRows.count).toBe(4);
    });

    it('should skip unchanged files on delta update', async () => {
      const filePath = join(projectsDir, 'unchanged-test.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      // First index
      adapter.processFileWithSessions(filePath, db);

      // Get initial state
      const cursor = adapter.getCursor(db, filePath);
      const initialOffset = cursor!.byteOffset;

      // Try delta with no changes
      const result = adapter.processFileDelta(filePath, db);

      // Should report 0 new entries
      expect(result.entriesIndexed).toBe(0);

      // Cursor should remain unchanged
      const newCursor = adapter.getCursor(db, filePath);
      expect(newCursor!.byteOffset).toBe(initialOffset);
    });
  });

  describe('Cursor Persistence', () => {
    it('should persist cursor across simulated restarts', async () => {
      const filePath = join(projectsDir, 'cursor-persist.jsonl');
      await writeFile(filePath, toJsonl(sampleTranscriptLines));

      // First adapter instance processes file
      adapter.processFileWithSessions(filePath, db);

      const cursor1 = adapter.getCursor(db, filePath);
      expect(cursor1).not.toBeNull();

      // Simulate restart: create new adapter instance
      const adapter2 = createTranscriptLinesAdapter(projectsDir);

      // Cursor should be retrievable by new instance
      const cursor2 = adapter2.getCursor(db, filePath);
      expect(cursor2).not.toBeNull();
      expect(cursor2!.byteOffset).toBe(cursor1!.byteOffset);
      expect(cursor2!.entryCount).toBe(cursor1!.entryCount);
    });

    it('should handle cursor for multiple files', async () => {
      const file1 = join(projectsDir, 'multi-1.jsonl');
      const file2 = join(projectsDir, 'multi-2.jsonl');

      const lines1 = [{ type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2025-01-06T10:00:00Z', cwd: '/p1' }];
      const lines2 = [
        { type: 'user', uuid: 'u2', sessionId: 's2', timestamp: '2025-01-06T11:00:00Z', cwd: '/p2' },
        { type: 'assistant', uuid: 'u3', sessionId: 's2', timestamp: '2025-01-06T11:00:05Z', cwd: '/p2' },
      ];

      await writeFile(file1, toJsonl(lines1));
      await writeFile(file2, toJsonl(lines2));

      adapter.processFileWithSessions(file1, db);
      adapter.processFileWithSessions(file2, db);

      const cursor1 = adapter.getCursor(db, file1);
      const cursor2 = adapter.getCursor(db, file2);

      expect(cursor1!.entryCount).toBe(1);
      expect(cursor2!.entryCount).toBe(2);
    });
  });

  describe('indexAll and updateIndex', () => {
    it('should index all transcript files in directory', async () => {
      // Create isolated directory for this test
      const isolatedDir = await mkdtemp(join(tmpdir(), 'indexall-transcript-'));
      const session1Dir = join(isolatedDir, 'proj1');
      const session2Dir = join(isolatedDir, 'proj2');
      await mkdir(session1Dir, { recursive: true });
      await mkdir(session2Dir, { recursive: true });

      await writeFile(join(session1Dir, 'transcript.jsonl'), toJsonl([
        { type: 'user', uuid: 'a1', sessionId: 'sa', timestamp: '2025-01-01T00:00:00Z', cwd: '/p1' },
      ]));
      await writeFile(join(session2Dir, 'transcript.jsonl'), toJsonl([
        { type: 'user', uuid: 'b1', sessionId: 'sb', timestamp: '2025-01-02T00:00:00Z', cwd: '/p2' },
      ]));

      const isolatedAdapter = createTranscriptLinesAdapter(isolatedDir);
      const result = await isolatedAdapter.indexAll(db);

      expect(result.filesIndexed).toBe(2);
      expect(result.linesIndexed).toBe(2);

      await rm(isolatedDir, { recursive: true, force: true });
    });

    it('should update index with only new content', async () => {
      // Create isolated directory for this test
      const isolatedDir = await mkdtemp(join(tmpdir(), 'updateindex-transcript-'));
      const sessionDir = join(isolatedDir, 'update-test');
      await mkdir(sessionDir, { recursive: true });

      const filePath = join(sessionDir, 'transcript.jsonl');
      await writeFile(filePath, toJsonl([
        { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2025-01-01T00:00:00Z', cwd: '/p' },
      ]));

      const isolatedAdapter = createTranscriptLinesAdapter(isolatedDir);

      // Initial index
      await isolatedAdapter.indexAll(db);

      // Add more content
      await appendFile(filePath, toJsonl([
        { type: 'assistant', uuid: 'u2', sessionId: 's1', timestamp: '2025-01-01T00:01:00Z', cwd: '/p' },
      ]));

      // Update
      const result = await isolatedAdapter.updateIndex(db);

      expect(result.filesUpdated).toBe(1);
      expect(result.newLines).toBe(1);

      // Verify total
      const count = db.query('SELECT COUNT(*) as c FROM lines').get() as { c: number };
      expect(count.c).toBe(2);

      await rm(isolatedDir, { recursive: true, force: true });
    });
  });

  describe('Factory Function', () => {
    it('should create adapter with default projects dir', () => {
      const defaultAdapter = createTranscriptLinesAdapter();
      expect(defaultAdapter.getProjectsDir()).toContain('.claude/projects');
    });

    it('should create adapter with custom projects dir', () => {
      const customAdapter = createTranscriptLinesAdapter('/custom/path');
      expect(customAdapter.getProjectsDir()).toBe('/custom/path');
    });

    it('should allow changing projects dir', () => {
      const testAdapter = createTranscriptLinesAdapter('/initial');
      testAdapter.setProjectsDir('/changed');
      expect(testAdapter.getProjectsDir()).toBe('/changed');
    });
  });
});

// ============================================================================
// HookEventsAdapter Integration Tests
// ============================================================================

describe('HookEventsAdapter Integration', () => {
  let tempDir: string;
  let hooksDir: string;
  let db: Database;
  let adapter: HookEventsAdapter;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'hook-adapter-test-'));
    hooksDir = join(tempDir, 'hooks');
    await mkdir(hooksDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    initCursorSchema(db);
    adapter = createHookEventsAdapter(hooksDir);
  });

  afterEach(() => {
    db.close();
  });

  describe('Basic Processing', () => {
    it('should process real hooks JSONL file', async () => {
      const filePath = join(hooksDir, 'session-001.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      const result = adapter.processFileWithHookFiles(filePath, db);

      expect(result.eventsIndexed).toBe(5);
      expect(result.sessionId).toBe('session-001');

      // Verify events were indexed
      const rows = db.query('SELECT * FROM hook_events WHERE session_id = ?').all('session-001') as {
        event_type: string;
        tool_name: string | null;
      }[];

      expect(rows.length).toBe(5);

      // Verify event types
      const eventTypes = rows.map((r) => r.event_type);
      expect(eventTypes).toContain('SessionStart');
      expect(eventTypes).toContain('PreToolUse');
      expect(eventTypes).toContain('PostToolUse');
      expect(eventTypes).toContain('Stop');
    });

    it('should extract tool information', async () => {
      const filePath = join(hooksDir, 'tool-info.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      adapter.processFileWithHookFiles(filePath, db);

      const toolEvent = db.query(`
        SELECT tool_name, tool_use_id, decision, input_json
        FROM hook_events
        WHERE tool_name = 'Read'
      `).get() as {
        tool_name: string;
        tool_use_id: string;
        decision: string;
        input_json: string;
      };

      expect(toolEvent.tool_name).toBe('Read');
      expect(toolEvent.tool_use_id).toBe('tool-1');
      expect(toolEvent.decision).toBe('allow');

      const input = JSON.parse(toolEvent.input_json);
      expect(input.file_path).toBe('/project/package.json');
    });

    it('should store handler results as JSON', async () => {
      const filePath = join(hooksDir, 'handler-results.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      adapter.processFileWithHookFiles(filePath, db);

      const event = db.query(`
        SELECT handler_results
        FROM hook_events
        WHERE event_type = 'SessionStart'
      `).get() as { handler_results: string };

      const results = JSON.parse(event.handler_results);
      expect(results['session-naming-SessionStart'].data.sessionName).toBe('jolly-squid');
      expect(results['turn-tracker-SessionStart'].data.turnId).toBe('session-001:1');
    });
  });

  describe('Turn ID and Session Name Extraction', () => {
    it('should extract turn_id from handler results', async () => {
      const filePath = join(hooksDir, 'turn-id.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      adapter.processFileWithHookFiles(filePath, db);

      // Check PreToolUse event has turn_id
      const preToolEvent = db.query(`
        SELECT turn_id, turn_sequence
        FROM hook_events
        WHERE event_type = 'PreToolUse' AND tool_name = 'Read'
      `).get() as { turn_id: string; turn_sequence: number };

      expect(preToolEvent.turn_id).toBe('session-001:1');
      expect(preToolEvent.turn_sequence).toBe(1);

      // Check second turn has different turn_id
      const turn2Event = db.query(`
        SELECT turn_id, turn_sequence
        FROM hook_events
        WHERE tool_name = 'Bash'
      `).get() as { turn_id: string; turn_sequence: number };

      expect(turn2Event.turn_id).toBe('session-001:2');
      expect(turn2Event.turn_sequence).toBe(2);
    });

    it('should extract session_name from handler results', async () => {
      const filePath = join(hooksDir, 'session-name.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      adapter.processFileWithHookFiles(filePath, db);

      const event = db.query(`
        SELECT session_name
        FROM hook_events
        WHERE event_type = 'SessionStart'
      `).get() as { session_name: string };

      expect(event.session_name).toBe('jolly-squid');
    });

    it('should handle events without turn tracking', async () => {
      const filePath = join(hooksDir, 'no-turn.hooks.jsonl');
      const events = [
        {
          timestamp: '2025-01-06T10:00:00Z',
          sessionId: 'session-002',
          eventType: 'PreToolUse',
          toolName: 'Read',
          // No handlerResults
        },
      ];
      await writeFile(filePath, toJsonl(events));

      adapter.processFileWithHookFiles(filePath, db);

      const event = db.query('SELECT turn_id, session_name FROM hook_events').get() as {
        turn_id: string | null;
        session_name: string | null;
      };

      expect(event.turn_id).toBeNull();
      expect(event.session_name).toBeNull();
    });

    it('should extract turn info from various handler key formats', async () => {
      const filePath = join(hooksDir, 'key-formats.hooks.jsonl');
      const events = [
        {
          timestamp: '2025-01-06T10:00:00Z',
          sessionId: 'session-003',
          eventType: 'Stop',
          handlerResults: {
            'turn-tracker-Stop': {
              data: { turnId: 'session-003:5', turnSequence: 5 },
            },
          },
        },
      ];
      await writeFile(filePath, toJsonl(events));

      adapter.processFileWithHookFiles(filePath, db);

      const event = db.query('SELECT turn_id, turn_sequence FROM hook_events').get() as {
        turn_id: string;
        turn_sequence: number;
      };

      expect(event.turn_id).toBe('session-003:5');
      expect(event.turn_sequence).toBe(5);
    });
  });

  describe('Incremental Processing (Delta)', () => {
    it('should process only new events on delta update', async () => {
      const filePath = join(hooksDir, 'delta.hooks.jsonl');

      // Initial events
      const initialEvents = sampleHookEvents.slice(0, 2);
      await writeFile(filePath, toJsonl(initialEvents));

      // First index
      const result1 = adapter.processFileWithHookFiles(filePath, db);
      expect(result1.eventsIndexed).toBe(2);

      // Add more events
      const additionalEvents = sampleHookEvents.slice(2);
      await appendFile(filePath, toJsonl(additionalEvents));

      // Get cursor
      const cursor = adapter.getCursor(db, filePath);
      expect(cursor).not.toBeNull();

      // Delta update
      const result2 = adapter.processFileWithHookFiles(
        filePath,
        db,
        cursor!.byteOffset,
        cursor!.entryCount + 1
      );
      expect(result2.eventsIndexed).toBe(3); // Only new events

      // Verify total
      const count = db.query('SELECT COUNT(*) as c FROM hook_events').get() as { c: number };
      expect(count.c).toBe(5);
    });

    it('should verify delta indexed correctly', async () => {
      const filePath = join(hooksDir, 'verify-delta.hooks.jsonl');

      // Initial events
      await writeFile(filePath, toJsonl(sampleHookEvents.slice(0, 3)));
      adapter.processFileWithHookFiles(filePath, db);

      // Add one more event
      const newEvent = {
        timestamp: '2025-01-06T12:00:00Z',
        sessionId: 'session-001',
        eventType: 'SessionEnd',
        handlerResults: {},
      };
      await appendFile(filePath, JSON.stringify(newEvent) + '\n');

      // Update
      const cursor = adapter.getCursor(db, filePath);
      const result = adapter.processFileWithHookFiles(filePath, db, cursor!.byteOffset, cursor!.entryCount + 1);

      expect(result.eventsIndexed).toBe(1);

      // Verify new event exists
      const endEvent = db.query(`
        SELECT event_type FROM hook_events WHERE event_type = 'SessionEnd'
      `).get() as { event_type: string } | null;

      expect(endEvent).not.toBeNull();
      expect(endEvent!.event_type).toBe('SessionEnd');
    });
  });

  describe('Cursor Persistence', () => {
    it('should persist cursor across simulated restarts', async () => {
      const filePath = join(hooksDir, 'cursor-persist.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      // First adapter processes
      adapter.processFileWithHookFiles(filePath, db);
      const cursor1 = adapter.getCursor(db, filePath);

      // New adapter instance (simulated restart)
      const adapter2 = createHookEventsAdapter(hooksDir);
      const cursor2 = adapter2.getCursor(db, filePath);

      expect(cursor2).not.toBeNull();
      expect(cursor2!.byteOffset).toBe(cursor1!.byteOffset);
      expect(cursor2!.entryCount).toBe(cursor1!.entryCount);
    });
  });

  describe('hook_files Table', () => {
    it('should update hook_files tracking table', async () => {
      const filePath = join(hooksDir, 'hook-files.hooks.jsonl');
      await writeFile(filePath, toJsonl(sampleHookEvents));

      adapter.processFileWithHookFiles(filePath, db);

      const hookFile = db.query('SELECT * FROM hook_files WHERE file_path = ?').get(filePath) as {
        session_id: string;
        event_count: number;
        byte_offset: number;
        first_timestamp: string | null;
        last_timestamp: string | null;
      };

      expect(hookFile).not.toBeNull();
      expect(hookFile.session_id).toBe('session-001');
      expect(hookFile.event_count).toBe(5);
      expect(hookFile.byte_offset).toBeGreaterThan(0);
      expect(hookFile.first_timestamp).toBe('2025-01-06T10:00:00Z');
      expect(hookFile.last_timestamp).toBe('2025-01-06T10:01:00Z');
    });
  });

  describe('indexAll and updateIndex', () => {
    it('should index all hook files in directory', async () => {
      // Create isolated directory for this test
      const isolatedDir = await mkdtemp(join(tmpdir(), 'indexall-hooks-'));
      const proj1Dir = join(isolatedDir, 'proj1');
      const proj2Dir = join(isolatedDir, 'proj2');
      await mkdir(proj1Dir, { recursive: true });
      await mkdir(proj2Dir, { recursive: true });

      await writeFile(join(proj1Dir, 'events.hooks.jsonl'), toJsonl([
        { timestamp: '2025-01-01T00:00:00Z', sessionId: 'sa', eventType: 'SessionStart' },
      ]));
      await writeFile(join(proj2Dir, 'events.hooks.jsonl'), toJsonl([
        { timestamp: '2025-01-02T00:00:00Z', sessionId: 'sb', eventType: 'SessionStart' },
      ]));

      const isolatedAdapter = createHookEventsAdapter(isolatedDir);
      const result = await isolatedAdapter.indexAll(db);

      expect(result.filesIndexed).toBe(2);
      expect(result.eventsIndexed).toBe(2);

      await rm(isolatedDir, { recursive: true, force: true });
    });

    it('should update index with only new events', async () => {
      // Create isolated directory for this test
      const isolatedDir = await mkdtemp(join(tmpdir(), 'updateindex-hooks-'));
      const projDir = join(isolatedDir, 'update-test');
      await mkdir(projDir, { recursive: true });

      const filePath = join(projDir, 'events.hooks.jsonl');
      await writeFile(filePath, toJsonl([
        { timestamp: '2025-01-01T00:00:00Z', sessionId: 's1', eventType: 'SessionStart' },
      ]));

      const isolatedAdapter = createHookEventsAdapter(isolatedDir);

      // Initial index
      await isolatedAdapter.indexAll(db);

      // Add more events
      await appendFile(filePath, toJsonl([
        { timestamp: '2025-01-01T00:01:00Z', sessionId: 's1', eventType: 'Stop' },
      ]));

      // Update
      const result = await isolatedAdapter.updateIndex(db);

      expect(result.filesUpdated).toBe(1);
      expect(result.newEvents).toBe(1);

      // Verify total
      const count = db.query('SELECT COUNT(*) as c FROM hook_events').get() as { c: number };
      expect(count.c).toBe(2);

      await rm(isolatedDir, { recursive: true, force: true });
    });
  });

  describe('Factory Function', () => {
    it('should create adapter with default hooks dir', () => {
      const defaultAdapter = createHookEventsAdapter();
      expect(defaultAdapter.getHooksDir()).toContain('.claude/hooks');
    });

    it('should create adapter with custom hooks dir', () => {
      const customAdapter = createHookEventsAdapter('/custom/hooks');
      expect(customAdapter.getHooksDir()).toBe('/custom/hooks');
    });

    it('should allow changing hooks dir', () => {
      const testAdapter = createHookEventsAdapter('/initial');
      testAdapter.setHooksDir('/changed');
      expect(testAdapter.getHooksDir()).toBe('/changed');
    });
  });
});

// ============================================================================
// Cross-Adapter Integration Tests
// ============================================================================

describe('Cross-Adapter Integration', () => {
  let tempDir: string;
  let projectsDir: string;
  let hooksDir: string;
  let db: Database;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'cross-adapter-test-'));
    projectsDir = join(tempDir, 'projects');
    hooksDir = join(tempDir, 'hooks');
    await mkdir(projectsDir, { recursive: true });
    await mkdir(hooksDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    initCursorSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should index both transcripts and hooks with same session ID', async () => {
    const sessionId = 'shared-session';

    // Create transcript
    const transcriptPath = join(projectsDir, 'shared.jsonl');
    const transcriptLines = [
      { type: 'user', uuid: 't1', sessionId, timestamp: '2025-01-06T10:00:00Z', cwd: '/p' },
      { type: 'assistant', uuid: 't2', sessionId, timestamp: '2025-01-06T10:00:05Z', cwd: '/p' },
    ];
    await writeFile(transcriptPath, toJsonl(transcriptLines));

    // Create hooks
    const hooksPath = join(hooksDir, 'shared.hooks.jsonl');
    const hookEvents = [
      { timestamp: '2025-01-06T10:00:01Z', sessionId, eventType: 'PreToolUse', toolName: 'Read' },
      { timestamp: '2025-01-06T10:00:02Z', sessionId, eventType: 'PostToolUse', toolName: 'Read' },
    ];
    await writeFile(hooksPath, toJsonl(hookEvents));

    // Index both
    const transcriptAdapter = createTranscriptLinesAdapter(projectsDir);
    const hooksAdapter = createHookEventsAdapter(hooksDir);

    transcriptAdapter.processFileWithSessions(transcriptPath, db);
    hooksAdapter.processFileWithHookFiles(hooksPath, db);

    // Verify both indexed with same session ID
    const lineCount = db.query('SELECT COUNT(*) as c FROM lines WHERE session_id = ?').get(sessionId) as { c: number };
    const eventCount = db.query('SELECT COUNT(*) as c FROM hook_events WHERE session_id = ?').get(sessionId) as { c: number };

    expect(lineCount.c).toBe(2);
    expect(eventCount.c).toBe(2);
  });

  it('should maintain independent cursors per adapter', async () => {
    const sessionId = 'cursor-test';

    // Create files
    const transcriptPath = join(projectsDir, 'cursor.jsonl');
    const hooksPath = join(hooksDir, 'cursor.hooks.jsonl');

    await writeFile(transcriptPath, toJsonl([
      { type: 'user', uuid: 'u1', sessionId, timestamp: '2025-01-06T10:00:00Z', cwd: '/p' },
    ]));
    await writeFile(hooksPath, toJsonl([
      { timestamp: '2025-01-06T10:00:00Z', sessionId, eventType: 'SessionStart' },
      { timestamp: '2025-01-06T10:00:01Z', sessionId, eventType: 'PreToolUse' },
    ]));

    const transcriptAdapter = createTranscriptLinesAdapter(projectsDir);
    const hooksAdapter = createHookEventsAdapter(hooksDir);

    transcriptAdapter.processFileWithSessions(transcriptPath, db);
    hooksAdapter.processFileWithHookFiles(hooksPath, db);

    // Verify cursors are independent (different adapter names)
    const transcriptCursor = transcriptAdapter.getCursor(db, transcriptPath);
    const hooksCursor = hooksAdapter.getCursor(db, hooksPath);

    expect(transcriptCursor!.adapterName).toBe('transcript-lines');
    expect(hooksCursor!.adapterName).toBe('hook-events');
    expect(transcriptCursor!.entryCount).toBe(1);
    expect(hooksCursor!.entryCount).toBe(2);
  });
});

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let tempDir: string;
  let projectsDir: string;
  let hooksDir: string;
  let db: Database;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'edge-case-test-'));
    projectsDir = join(tempDir, 'projects');
    hooksDir = join(tempDir, 'hooks');
    await mkdir(projectsDir, { recursive: true });
    await mkdir(hooksDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
    initCursorSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should handle transcript file without sessionId', async () => {
    const adapter = createTranscriptLinesAdapter(projectsDir);
    const filePath = join(projectsDir, 'no-session.jsonl');

    await writeFile(filePath, toJsonl([
      { type: 'user', uuid: 'u1', timestamp: '2025-01-06T10:00:00Z', cwd: '/p' },
    ]));

    const result = adapter.processFileWithSessions(filePath, db);

    // Should still index the line
    expect(result.linesIndexed).toBe(1);
    expect(result.sessionId).toBe(''); // Empty session ID
  });

  it('should handle hook events without all fields', async () => {
    const adapter = createHookEventsAdapter(hooksDir);
    const filePath = join(hooksDir, 'partial.hooks.jsonl');

    await writeFile(filePath, toJsonl([
      { timestamp: '2025-01-06T10:00:00Z', eventType: 'Unknown' },
      { timestamp: '2025-01-06T10:00:01Z', sessionId: 's1', eventType: 'PreToolUse' },
    ]));

    const result = adapter.processFileWithHookFiles(filePath, db);

    expect(result.eventsIndexed).toBe(2);
  });

  it('should handle very large JSONL files efficiently', async () => {
    const adapter = createTranscriptLinesAdapter(projectsDir);
    const filePath = join(projectsDir, 'large.jsonl');

    // Generate 1000 lines
    const lines: object[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push({
        type: i % 2 === 0 ? 'user' : 'assistant',
        uuid: `uuid-${i}`,
        sessionId: 'large-session',
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
        cwd: '/project',
      });
    }

    await writeFile(filePath, toJsonl(lines));

    const startTime = performance.now();
    const result = adapter.processFileWithSessions(filePath, db);
    const duration = performance.now() - startTime;

    expect(result.linesIndexed).toBe(1000);
    // Should complete in reasonable time (< 5 seconds)
    expect(duration).toBeLessThan(5000);
  });

  it('should handle concurrent file processing', async () => {
    const adapter = createTranscriptLinesAdapter(projectsDir);

    // Create multiple files
    const files = [];
    for (let i = 0; i < 5; i++) {
      const filePath = join(projectsDir, `concurrent-${i}.jsonl`);
      await writeFile(filePath, toJsonl([
        { type: 'user', uuid: `u-${i}`, sessionId: `s-${i}`, timestamp: '2025-01-06T10:00:00Z', cwd: '/p' },
      ]));
      files.push(filePath);
    }

    // Process all files
    const results = [];
    for (const file of files) {
      results.push(adapter.processFileWithSessions(file, db));
    }

    // Verify all processed
    const totalLines = results.reduce((sum, r) => sum + r.linesIndexed, 0);
    expect(totalLines).toBe(5);

    // Verify cursors
    for (const file of files) {
      const cursor = adapter.getCursor(db, file);
      expect(cursor).not.toBeNull();
    }
  });

  it('should handle non-existent file gracefully', async () => {
    const adapter = createTranscriptLinesAdapter(projectsDir);
    const filePath = join(projectsDir, 'does-not-exist.jsonl');

    const result = adapter.processFileWithSessions(filePath, db);

    expect(result.linesIndexed).toBe(0);
  });

  it('should distinguish between .jsonl and .hooks.jsonl files', async () => {
    // Create isolated directory for this test
    const isolatedDir = await mkdtemp(join(tmpdir(), 'distinguish-test-'));

    // Transcript adapter should NOT process .hooks.jsonl files
    const transcriptAdapter = createTranscriptLinesAdapter(isolatedDir);

    // Create both types in same directory
    await writeFile(join(isolatedDir, 'transcript.jsonl'), toJsonl([
      { type: 'user', uuid: 'u1', sessionId: 's1', timestamp: '2025-01-06T10:00:00Z', cwd: '/p' },
    ]));
    await writeFile(join(isolatedDir, 'events.hooks.jsonl'), toJsonl([
      { timestamp: '2025-01-06T10:00:00Z', sessionId: 's1', eventType: 'SessionStart' },
    ]));

    const result = await transcriptAdapter.indexAll(db);

    // Should only index the transcript file, not hooks
    expect(result.filesIndexed).toBe(1);
    expect(result.linesIndexed).toBe(1);

    await rm(isolatedDir, { recursive: true, force: true });
  });
});
