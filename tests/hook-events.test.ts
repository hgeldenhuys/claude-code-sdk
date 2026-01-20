/**
 * Hook Events CLI/TUI Tests
 *
 * Tests for hook-events CLI (bin/hook-events.ts) and TUI (bin/hook-events-tui.ts)
 * Covers database queries, filtering, and bookmark persistence
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import {
  getHookEvents,
  getHookSessions,
  getMaxHookEventId,
  getHookEventsAfterId,
  getHookEventCount,
  type HookEventResult,
  type GetHookEventsOptions,
} from '../src/transcripts/db';

// ============================================================================
// Test Data
// ============================================================================

// Sample hook events for testing
const sampleHookEvents: Array<{
  sessionId: string;
  timestamp: string;
  eventType: string;
  toolUseId: string | null;
  toolName: string | null;
  decision: string | null;
  handlerResults: string | null;
  inputJson: string;
  contextJson: string;
  filePath: string;
  lineNumber: number;
}> = [
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:00Z',
    eventType: 'SessionStart',
    toolUseId: null,
    toolName: null,
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({ session_id: 'session-abc-123', cwd: '/project' }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 1,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:05Z',
    eventType: 'UserPromptSubmit',
    toolUseId: null,
    toolName: null,
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({ prompt: 'Hello, help me with this' }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 2,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:10Z',
    eventType: 'PreToolUse',
    toolUseId: 'tool-xyz-1',
    toolName: 'Bash',
    decision: 'allow',
    handlerResults: JSON.stringify([{ handler: 'tool-guard', result: 'allow' }]),
    inputJson: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 3,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:15Z',
    eventType: 'PostToolUse',
    toolUseId: 'tool-xyz-1',
    toolName: 'Bash',
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({
      tool_name: 'Bash',
      tool_result: 'file1.txt\nfile2.txt',
      usage: { input_tokens: 1500, output_tokens: 500 },
    }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 4,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:20Z',
    eventType: 'PreToolUse',
    toolUseId: 'tool-xyz-2',
    toolName: 'Read',
    decision: 'allow',
    handlerResults: null,
    inputJson: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/project/file1.txt' } }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 5,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:25Z',
    eventType: 'PostToolUse',
    toolUseId: 'tool-xyz-2',
    toolName: 'Read',
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({
      tool_name: 'Read',
      tool_result: 'File contents here',
      usage: { input_tokens: 50000, output_tokens: 10000 },
    }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 6,
  },
  {
    sessionId: 'session-abc-123',
    timestamp: '2024-01-18T10:00:30Z',
    eventType: 'Stop',
    toolUseId: null,
    toolName: null,
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({ reason: 'end_turn' }),
    contextJson: JSON.stringify({ cwd: '/project' }),
    filePath: '/home/user/.claude/hooks/project/hooks.jsonl',
    lineNumber: 7,
  },
  // Second session
  {
    sessionId: 'session-def-456',
    timestamp: '2024-01-18T11:00:00Z',
    eventType: 'SessionStart',
    toolUseId: null,
    toolName: null,
    decision: null,
    handlerResults: null,
    inputJson: JSON.stringify({ session_id: 'session-def-456', cwd: '/other-project' }),
    contextJson: JSON.stringify({ cwd: '/other-project' }),
    filePath: '/home/user/.claude/hooks/other-project/hooks.jsonl',
    lineNumber: 1,
  },
  {
    sessionId: 'session-def-456',
    timestamp: '2024-01-18T11:00:10Z',
    eventType: 'PreToolUse',
    toolUseId: 'tool-abc-1',
    toolName: 'Write',
    decision: 'allow',
    handlerResults: null,
    inputJson: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/other-project/new.txt' } }),
    contextJson: JSON.stringify({ cwd: '/other-project' }),
    filePath: '/home/user/.claude/hooks/other-project/hooks.jsonl',
    lineNumber: 2,
  },
];

// ============================================================================
// Test Fixtures
// ============================================================================

let tempDir: string;
let db: Database;
let dbPath: string;

beforeAll(async () => {
  // Create temp directory for test database
  tempDir = await mkdtemp(join(tmpdir(), 'hook-events-test-'));
  dbPath = join(tempDir, 'test-transcripts.db');

  // Create and initialize database
  db = new Database(dbPath);

  // Create hook_events table (matching the schema in db.ts - v8 schema)
  db.run(`
    CREATE TABLE IF NOT EXISTS hook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      tool_use_id TEXT,
      tool_name TEXT,
      decision TEXT,
      handler_results TEXT,
      input_json TEXT,
      context_json TEXT,
      file_path TEXT NOT NULL,
      line_number INTEGER NOT NULL,
      turn_id TEXT,
      turn_sequence INTEGER,
      session_name TEXT,
      git_hash TEXT,
      git_branch TEXT,
      git_dirty INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_session ON hook_events(session_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_type ON hook_events(event_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_tool ON hook_events(tool_name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_timestamp ON hook_events(timestamp)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_turn_id ON hook_events(turn_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_hook_events_session_name ON hook_events(session_name)');

  // Create hook_files table (used by getHookSessions)
  db.run(`
    CREATE TABLE IF NOT EXISTS hook_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT UNIQUE NOT NULL,
      session_id TEXT NOT NULL,
      event_count INTEGER DEFAULT 0,
      last_line_number INTEGER DEFAULT 0,
      first_timestamp TEXT,
      last_timestamp TEXT,
      indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert test data
  const insertStmt = db.prepare(`
    INSERT INTO hook_events (
      session_id, timestamp, event_type, tool_use_id, tool_name,
      decision, handler_results, input_json, context_json, file_path, line_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const event of sampleHookEvents) {
    insertStmt.run(
      event.sessionId,
      event.timestamp,
      event.eventType,
      event.toolUseId,
      event.toolName,
      event.decision,
      event.handlerResults,
      event.inputJson,
      event.contextJson,
      event.filePath,
      event.lineNumber
    );
  }

  // Insert hook_files data for sessions
  const insertFileStmt = db.prepare(`
    INSERT INTO hook_files (file_path, session_id, event_count, last_line_number, first_timestamp, last_timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertFileStmt.run(
    '/home/user/.claude/hooks/project/hooks.jsonl',
    'session-abc-123',
    7,
    7,
    '2024-01-18T10:00:00Z',
    '2024-01-18T10:00:30Z'
  );

  insertFileStmt.run(
    '/home/user/.claude/hooks/other-project/hooks.jsonl',
    'session-def-456',
    2,
    2,
    '2024-01-18T11:00:00Z',
    '2024-01-18T11:00:10Z'
  );
});

afterAll(async () => {
  // Close database and cleanup
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

// ============================================================================
// Database Query Tests
// ============================================================================

describe('Hook Events Database Queries', () => {
  describe('getHookEvents', () => {
    test('returns all events without filters', () => {
      const events = getHookEvents(db);
      expect(events.length).toBe(sampleHookEvents.length);
    });

    test('filters by sessionId', () => {
      const events = getHookEvents(db, { sessionId: 'session-abc-123' });
      expect(events.length).toBe(7);
      for (const event of events) {
        expect(event.sessionId).toBe('session-abc-123');
      }
    });

    test('filters by single eventType', () => {
      const events = getHookEvents(db, { eventTypes: ['PreToolUse'] });
      expect(events.length).toBe(3);
      for (const event of events) {
        expect(event.eventType).toBe('PreToolUse');
      }
    });

    test('filters by multiple eventTypes', () => {
      const events = getHookEvents(db, { eventTypes: ['PreToolUse', 'PostToolUse'] });
      expect(events.length).toBe(5);
      for (const event of events) {
        expect(['PreToolUse', 'PostToolUse']).toContain(event.eventType);
      }
    });

    test('filters by toolName', () => {
      const events = getHookEvents(db, { toolNames: ['Bash'] });
      expect(events.length).toBe(2);
      for (const event of events) {
        expect(event.toolName).toBe('Bash');
      }
    });

    test('filters by multiple toolNames', () => {
      const events = getHookEvents(db, { toolNames: ['Bash', 'Read'] });
      expect(events.length).toBe(4);
      for (const event of events) {
        expect(['Bash', 'Read']).toContain(event.toolName);
      }
    });

    test('applies limit', () => {
      const events = getHookEvents(db, { limit: 3 });
      expect(events.length).toBe(3);
    });

    test('applies offset', () => {
      const allEvents = getHookEvents(db);
      const offsetEvents = getHookEvents(db, { offset: 2, limit: 3 });
      expect(offsetEvents.length).toBe(3);
      expect(offsetEvents[0]!.id).toBe(allEvents[2]!.id);
    });

    test('filters by fromTime', () => {
      const events = getHookEvents(db, { fromTime: '2024-01-18T10:00:15Z' });
      for (const event of events) {
        expect(new Date(event.timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date('2024-01-18T10:00:15Z').getTime()
        );
      }
    });

    test('filters by toTime', () => {
      const events = getHookEvents(db, { toTime: '2024-01-18T10:00:15Z' });
      for (const event of events) {
        expect(new Date(event.timestamp).getTime()).toBeLessThanOrEqual(
          new Date('2024-01-18T10:00:15Z').getTime()
        );
      }
    });

    test('combines multiple filters', () => {
      const events = getHookEvents(db, {
        sessionId: 'session-abc-123',
        eventTypes: ['PreToolUse'],
        toolNames: ['Bash'],
      });
      expect(events.length).toBe(1);
      expect(events[0]!.toolName).toBe('Bash');
      expect(events[0]!.eventType).toBe('PreToolUse');
    });

    test('orders by timestamp ascending', () => {
      const events = getHookEvents(db, { order: 'asc' });
      for (let i = 1; i < events.length; i++) {
        expect(new Date(events[i]!.timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(events[i - 1]!.timestamp).getTime()
        );
      }
    });

    test('orders by timestamp descending', () => {
      const events = getHookEvents(db, { order: 'desc' });
      for (let i = 1; i < events.length; i++) {
        expect(new Date(events[i]!.timestamp).getTime()).toBeLessThanOrEqual(
          new Date(events[i - 1]!.timestamp).getTime()
        );
      }
    });
  });

  describe('getHookSessions', () => {
    test('returns all sessions', () => {
      const sessions = getHookSessions(db);
      expect(sessions.length).toBe(2);
    });

    test('returns session with correct event count', () => {
      const sessions = getHookSessions(db);
      const session1 = sessions.find(s => s.sessionId === 'session-abc-123');
      const session2 = sessions.find(s => s.sessionId === 'session-def-456');

      expect(session1).toBeDefined();
      expect(session1!.eventCount).toBe(7);

      expect(session2).toBeDefined();
      expect(session2!.eventCount).toBe(2);
    });

    test('returns correct timestamps', () => {
      const sessions = getHookSessions(db);
      const session1 = sessions.find(s => s.sessionId === 'session-abc-123');

      expect(session1).toBeDefined();
      expect(session1!.firstTimestamp).toBe('2024-01-18T10:00:00Z');
      expect(session1!.lastTimestamp).toBe('2024-01-18T10:00:30Z');
    });
  });

  describe('getMaxHookEventId', () => {
    test('returns max id for all events', () => {
      const maxId = getMaxHookEventId(db);
      expect(maxId).toBe(sampleHookEvents.length);
    });

    test('returns max id for specific session', () => {
      const maxId = getMaxHookEventId(db, 'session-abc-123');
      expect(maxId).toBe(7); // Last event in first session
    });

    test('returns 0 for non-existent session', () => {
      const maxId = getMaxHookEventId(db, 'non-existent-session');
      expect(maxId).toBe(0);
    });
  });

  describe('getHookEventsAfterId', () => {
    test('returns events after given id', () => {
      const events = getHookEventsAfterId(db, 5);
      expect(events.length).toBe(4); // Events 6, 7, 8, 9
      for (const event of events) {
        expect(event.id).toBeGreaterThan(5);
      }
    });

    test('filters by sessionId', () => {
      const events = getHookEventsAfterId(db, 0, 'session-def-456');
      expect(events.length).toBe(2);
      for (const event of events) {
        expect(event.sessionId).toBe('session-def-456');
      }
    });

    test('filters by eventTypes', () => {
      const events = getHookEventsAfterId(db, 0, undefined, ['SessionStart']);
      expect(events.length).toBe(2);
      for (const event of events) {
        expect(event.eventType).toBe('SessionStart');
      }
    });

    test('filters by toolNames', () => {
      const events = getHookEventsAfterId(db, 0, undefined, undefined, ['Write']);
      expect(events.length).toBe(1);
      expect(events[0]!.toolName).toBe('Write');
    });
  });

  describe('getHookEventCount', () => {
    test('returns total count', () => {
      const count = getHookEventCount(db);
      expect(count).toBe(sampleHookEvents.length);
    });

    test('returns count for specific session', () => {
      const count = getHookEventCount(db, 'session-abc-123');
      expect(count).toBe(7);
    });

    test('returns 0 for non-existent session', () => {
      const count = getHookEventCount(db, 'non-existent');
      expect(count).toBe(0);
    });
  });
});

// ============================================================================
// Bookmark Persistence Tests
// ============================================================================

describe('Bookmark Persistence', () => {
  let bookmarkDir: string;
  let bookmarkFile: string;

  interface BookmarkStore {
    [sessionId: string]: number[];
  }

  function loadBookmarks(): BookmarkStore {
    try {
      if (existsSync(bookmarkFile)) {
        const content = Bun.file(bookmarkFile).text();
        return JSON.parse(content as unknown as string);
      }
    } catch {
      // Ignore errors
    }
    return {};
  }

  async function saveBookmarks(bookmarks: BookmarkStore): Promise<void> {
    await mkdir(bookmarkDir, { recursive: true });
    await writeFile(bookmarkFile, JSON.stringify(bookmarks, null, 2));
  }

  beforeEach(async () => {
    bookmarkDir = await mkdtemp(join(tmpdir(), 'hook-events-bookmarks-'));
    bookmarkFile = join(bookmarkDir, 'hook-event-bookmarks.json');
  });

  afterEach(async () => {
    await rm(bookmarkDir, { recursive: true, force: true });
  });

  test('loadBookmarks returns empty object when file does not exist', () => {
    const bookmarks = loadBookmarks();
    expect(bookmarks).toEqual({});
  });

  test('saveBookmarks creates file with correct content', async () => {
    const bookmarks: BookmarkStore = {
      'session-123': [1, 5, 10],
      'session-456': [2, 8],
    };

    await saveBookmarks(bookmarks);

    expect(existsSync(bookmarkFile)).toBe(true);
    const content = await readFile(bookmarkFile, 'utf-8');
    const loaded = JSON.parse(content);
    expect(loaded).toEqual(bookmarks);
  });

  test('bookmarks can be loaded after saving', async () => {
    const bookmarks: BookmarkStore = {
      'session-abc': [3, 7, 15],
    };

    await saveBookmarks(bookmarks);

    // Simulate loading (need to re-read since our test loadBookmarks uses sync)
    const content = await readFile(bookmarkFile, 'utf-8');
    const loaded = JSON.parse(content);
    expect(loaded).toEqual(bookmarks);
  });

  test('bookmarks are stored per session', async () => {
    const bookmarks: BookmarkStore = {};

    // Add bookmarks for session 1
    bookmarks['session-1'] = [1, 2, 3];
    await saveBookmarks(bookmarks);

    // Add bookmarks for session 2
    bookmarks['session-2'] = [10, 20];
    await saveBookmarks(bookmarks);

    const content = await readFile(bookmarkFile, 'utf-8');
    const loaded = JSON.parse(content);

    expect(loaded['session-1']).toEqual([1, 2, 3]);
    expect(loaded['session-2']).toEqual([10, 20]);
  });

  test('can toggle bookmark by adding/removing from array', async () => {
    const bookmarks: BookmarkStore = {
      'session-1': [1, 5, 10],
    };

    // Toggle off event 5
    const index = bookmarks['session-1']!.indexOf(5);
    if (index > -1) {
      bookmarks['session-1']!.splice(index, 1);
    }

    await saveBookmarks(bookmarks);

    const content = await readFile(bookmarkFile, 'utf-8');
    const loaded = JSON.parse(content);
    expect(loaded['session-1']).toEqual([1, 10]);

    // Toggle on event 7
    bookmarks['session-1']!.push(7);
    await saveBookmarks(bookmarks);

    const content2 = await readFile(bookmarkFile, 'utf-8');
    const loaded2 = JSON.parse(content2);
    expect(loaded2['session-1']).toEqual([1, 10, 7]);
  });
});

// ============================================================================
// Filter-Aware Bookmark Navigation Tests
// ============================================================================

describe('Filter-Aware Bookmark Navigation', () => {
  test('finds visible bookmarks in filtered list', () => {
    // Simulated events after filtering
    const filteredEvents = [
      { id: 2, eventType: 'PreToolUse' },
      { id: 4, eventType: 'PreToolUse' },
      { id: 7, eventType: 'PreToolUse' },
      { id: 9, eventType: 'PreToolUse' },
    ];

    // Bookmarks include some that are not in the filtered list
    const bookmarkedIds = new Set([1, 4, 6, 9]);

    // Find visible bookmarks (bookmarks that exist in filtered events)
    const visibleBookmarkIndices: number[] = [];
    for (let i = 0; i < filteredEvents.length; i++) {
      if (bookmarkedIds.has(filteredEvents[i]!.id)) {
        visibleBookmarkIndices.push(i);
      }
    }

    expect(visibleBookmarkIndices).toEqual([1, 3]); // indices of id 4 and 9
  });

  test('jumps to next visible bookmark', () => {
    const visibleBookmarkIndices = [1, 5, 8];
    const currentIndex = 3;

    // Find next bookmark after current position
    let nextIndex = -1;
    for (const idx of visibleBookmarkIndices) {
      if (idx > currentIndex) {
        nextIndex = idx;
        break;
      }
    }

    expect(nextIndex).toBe(5);
  });

  test('jumps to previous visible bookmark', () => {
    const visibleBookmarkIndices = [1, 5, 8];
    const currentIndex = 6;

    // Find previous bookmark before current position
    let prevIndex = -1;
    for (let i = visibleBookmarkIndices.length - 1; i >= 0; i--) {
      if (visibleBookmarkIndices[i]! < currentIndex) {
        prevIndex = visibleBookmarkIndices[i]!;
        break;
      }
    }

    expect(prevIndex).toBe(5);
  });

  test('wraps to first bookmark when no next exists', () => {
    const visibleBookmarkIndices = [1, 5, 8];
    const currentIndex = 9; // After last bookmark

    // Find next bookmark, wrap to beginning if none after
    let nextIndex = -1;
    for (const idx of visibleBookmarkIndices) {
      if (idx > currentIndex) {
        nextIndex = idx;
        break;
      }
    }

    // Wrap to first if no next found
    if (nextIndex === -1 && visibleBookmarkIndices.length > 0) {
      nextIndex = visibleBookmarkIndices[0]!;
    }

    expect(nextIndex).toBe(1);
  });

  test('wraps to last bookmark when no previous exists', () => {
    const visibleBookmarkIndices = [3, 5, 8];
    const currentIndex = 1; // Before first bookmark

    // Find previous bookmark, wrap to end if none before
    let prevIndex = -1;
    for (let i = visibleBookmarkIndices.length - 1; i >= 0; i--) {
      if (visibleBookmarkIndices[i]! < currentIndex) {
        prevIndex = visibleBookmarkIndices[i]!;
        break;
      }
    }

    // Wrap to last if no prev found
    if (prevIndex === -1 && visibleBookmarkIndices.length > 0) {
      prevIndex = visibleBookmarkIndices[visibleBookmarkIndices.length - 1]!;
    }

    expect(prevIndex).toBe(8);
  });

  test('returns -1 when no bookmarks exist', () => {
    const visibleBookmarkIndices: number[] = [];
    const currentIndex = 5;

    let nextIndex = -1;
    for (const idx of visibleBookmarkIndices) {
      if (idx > currentIndex) {
        nextIndex = idx;
        break;
      }
    }

    expect(nextIndex).toBe(-1);
  });
});

// ============================================================================
// JSON Syntax Highlighting Tests
// ============================================================================

describe('JSON Syntax Highlighting', () => {
  /**
   * Simplified highlightJson for testing (mirrors the TUI implementation)
   */
  function highlightJson(json: string): string {
    const lines = json.split('\n');
    const highlighted: string[] = [];

    for (const line of lines) {
      let result = '';
      let i = 0;

      while (i < line.length) {
        const char = line[i];

        if (char === ' ' || char === '\t') {
          result += char;
          i++;
          continue;
        }

        if (char === '"') {
          let str = '"';
          i++;
          while (i < line.length && line[i] !== '"') {
            if (line[i] === '\\' && i + 1 < line.length) {
              str += line[i] + line[i + 1];
              i += 2;
            } else {
              str += line[i];
              i++;
            }
          }
          if (i < line.length) {
            str += '"';
            i++;
          }

          const escapedStr = str.replace(/\{/g, '{open}').replace(/\}/g, '{close}');
          const remaining = line.slice(i).trim();
          if (remaining.startsWith(':')) {
            result += `{cyan-fg}${escapedStr}{/cyan-fg}`;
          } else {
            result += `{green-fg}${escapedStr}{/green-fg}`;
          }
          continue;
        }

        if (char === '-' || (char >= '0' && char <= '9')) {
          let num = '';
          while (i < line.length && /[\d.eE+\-]/.test(line[i]!)) {
            num += line[i];
            i++;
          }
          result += `{yellow-fg}${num}{/yellow-fg}`;
          continue;
        }

        if (line.slice(i, i + 4) === 'true') {
          result += '{magenta-fg}true{/magenta-fg}';
          i += 4;
          continue;
        }
        if (line.slice(i, i + 5) === 'false') {
          result += '{magenta-fg}false{/magenta-fg}';
          i += 5;
          continue;
        }
        if (line.slice(i, i + 4) === 'null') {
          result += '{magenta-fg}null{/magenta-fg}';
          i += 4;
          continue;
        }

        if (char === '{') {
          result += '{open}';
          i++;
          continue;
        }
        if (char === '}') {
          result += '{close}';
          i++;
          continue;
        }
        if (char === '[' || char === ']' || char === ':' || char === ',') {
          result += char;
          i++;
          continue;
        }

        result += char;
        i++;
      }

      highlighted.push(result);
    }

    return highlighted.join('\n');
  }

  test('highlights keys in cyan', () => {
    const json = '{"name": "test"}';
    const result = highlightJson(json);
    expect(result).toContain('{cyan-fg}"name"{/cyan-fg}');
  });

  test('highlights string values in green', () => {
    const json = '{"name": "test"}';
    const result = highlightJson(json);
    expect(result).toContain('{green-fg}"test"{/green-fg}');
  });

  test('highlights numbers in yellow', () => {
    const json = '{"count": 42}';
    const result = highlightJson(json);
    expect(result).toContain('{yellow-fg}42{/yellow-fg}');
  });

  test('highlights negative numbers', () => {
    const json = '{"temp": -10}';
    const result = highlightJson(json);
    expect(result).toContain('{yellow-fg}-10{/yellow-fg}');
  });

  test('highlights floating point numbers', () => {
    const json = '{"pi": 3.14159}';
    const result = highlightJson(json);
    expect(result).toContain('{yellow-fg}3.14159{/yellow-fg}');
  });

  test('highlights true in magenta', () => {
    const json = '{"active": true}';
    const result = highlightJson(json);
    expect(result).toContain('{magenta-fg}true{/magenta-fg}');
  });

  test('highlights false in magenta', () => {
    const json = '{"active": false}';
    const result = highlightJson(json);
    expect(result).toContain('{magenta-fg}false{/magenta-fg}');
  });

  test('highlights null in magenta', () => {
    const json = '{"value": null}';
    const result = highlightJson(json);
    expect(result).toContain('{magenta-fg}null{/magenta-fg}');
  });

  test('escapes curly braces in strings', () => {
    const json = '{"template": "{name}"}';
    const result = highlightJson(json);
    // The { becomes {open} and } becomes {close}, but since we're inside a string
    // the result will have the escaping applied
    expect(result).toContain('{open');
    expect(result).toContain('{close}');
    expect(result).not.toContain('{{'); // Should not have double braces
  });

  test('escapes curly braces as structural characters', () => {
    const json = '{"a": 1}';
    const result = highlightJson(json);
    expect(result).toContain('{open}');
    expect(result).toContain('{close}');
  });

  test('handles multiline JSON', () => {
    const json = JSON.stringify({ name: 'test', count: 5 }, null, 2);
    const result = highlightJson(json);
    expect(result).toContain('{cyan-fg}"name"{/cyan-fg}');
    expect(result).toContain('{green-fg}"test"{/green-fg}');
    expect(result).toContain('{yellow-fg}5{/yellow-fg}');
  });

  test('handles arrays', () => {
    const json = '{"items": [1, 2, 3]}';
    const result = highlightJson(json);
    expect(result).toContain('[');
    expect(result).toContain(']');
    expect(result).toContain('{yellow-fg}1{/yellow-fg}');
  });

  test('handles escaped quotes in strings', () => {
    const json = '{"msg": "say \\"hello\\""}';
    const result = highlightJson(json);
    expect(result).toContain('{green-fg}"say \\"hello\\""{/green-fg}');
  });
});

// ============================================================================
// CLI Output Tests
// ============================================================================

describe('CLI Integration', () => {
  test('help command shows usage', async () => {
    const proc = Bun.spawn(['bun', 'run', 'bin/hook-events.ts', '--help'], {
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain('hook-events');
    expect(output).toContain('Usage:');
    expect(output).toContain('--event');
    expect(output).toContain('--tool');
  });

  test('list command runs without error or reports missing index', async () => {
    const proc = Bun.spawn(['bun', 'run', 'bin/hook-events.ts', 'list'], {
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    // Either succeeds (index exists) or fails with expected message (no index in CI)
    if (proc.exitCode === 1) {
      expect(stderr).toContain('Index not built');
    } else {
      expect(proc.exitCode).toBe(0);
    }
  });

  test('TUI help command shows usage', async () => {
    const proc = Bun.spawn(['bun', 'run', 'bin/hook-events-tui.ts', '--help'], {
      cwd: join(import.meta.dir, '..'),
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    expect(output).toContain('hook-events-tui');
    expect(output).toContain('Navigation:');
    expect(output).toContain('Bookmarks');
    expect(output).toContain('Decision Indicator');
  });
});
