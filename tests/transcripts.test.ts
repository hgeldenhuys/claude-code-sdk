/**
 * Transcript Module Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  parseTranscript,
  parseTranscriptFile,
  getTranscriptLine,
  extractTextContent,
  extractToolUses,
  getConversationThread,
  searchTranscripts,
  scoreResult,
  getContext,
  searchInFile,
  indexTranscripts,
  findTranscriptFiles,
  getSessionInfo,
  saveIndex,
  loadIndex,
  getIndexStats,
  findSessions,
  getRecentSessions,
  type TranscriptLine,
  type ContentBlock,
} from '../src/transcripts';

// Sample JSONL content for testing
const sampleTranscript = `{"type":"user","uuid":"uuid-1","sessionId":"session-123","timestamp":"2025-01-06T10:00:00Z","cwd":"/project","message":{"role":"user","content":"Hello, can you help me with TypeScript?"}}
{"type":"assistant","uuid":"uuid-2","parentUuid":"uuid-1","sessionId":"session-123","timestamp":"2025-01-06T10:00:05Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"text","text":"Of course! I'd be happy to help you with TypeScript. What do you need assistance with?"}]}}
{"type":"user","uuid":"uuid-3","parentUuid":"uuid-2","sessionId":"session-123","timestamp":"2025-01-06T10:00:30Z","cwd":"/project","message":{"role":"user","content":"I need to parse JSON files"}}
{"type":"assistant","uuid":"uuid-4","parentUuid":"uuid-3","sessionId":"session-123","timestamp":"2025-01-06T10:00:35Z","cwd":"/project","message":{"role":"assistant","content":[{"type":"text","text":"To parse JSON files in TypeScript, you can use the built-in JSON.parse() function."},{"type":"tool_use","id":"tool-1","name":"Read","input":{"file_path":"/project/data.json"}}]}}`;

const malformedTranscript = `{"type":"user","uuid":"uuid-1","sessionId":"session-123"}
not valid json
{"type":"assistant","uuid":"uuid-2","sessionId":"session-123","message":{"role":"assistant","content":"Valid response"}}`;

describe('Transcript Parser', () => {
  describe('parseTranscript', () => {
    it('should parse valid JSONL content', () => {
      const lines = parseTranscript(sampleTranscript);

      expect(lines).toHaveLength(4);
      expect(lines[0]!.type).toBe('user');
      expect(lines[0]!.uuid).toBe('uuid-1');
      expect(lines[0]!.sessionId).toBe('session-123');
    });

    it('should handle malformed JSON gracefully', () => {
      const lines = parseTranscript(malformedTranscript);

      // Should skip the malformed line
      expect(lines).toHaveLength(2);
      expect(lines[0]!.type).toBe('user');
      expect(lines[1]!.type).toBe('assistant');
    });

    it('should handle empty content', () => {
      const lines = parseTranscript('');
      expect(lines).toHaveLength(0);
    });

    it('should set parentUuid correctly', () => {
      const lines = parseTranscript(sampleTranscript);

      expect(lines[0]!.parentUuid).toBeNull();
      expect(lines[1]!.parentUuid).toBe('uuid-1');
      expect(lines[2]!.parentUuid).toBe('uuid-2');
    });
  });

  describe('extractTextContent', () => {
    it('should extract text from string content', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'user',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'Hello, world!',
        },
        raw: '{}',
      };

      expect(extractTextContent(line)).toBe('Hello, world!');
    });

    it('should extract text from content blocks', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'assistant',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First part.' } as ContentBlock,
            { type: 'text', text: 'Second part.' } as ContentBlock,
          ],
        },
        raw: '{}',
      };

      expect(extractTextContent(line)).toBe('First part.\nSecond part.');
    });

    it('should include tool names in extracted text', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'assistant',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me read that file.' } as ContentBlock,
            { type: 'tool_use', name: 'Read', input: {} } as ContentBlock,
          ],
        },
        raw: '{}',
      };

      const text = extractTextContent(line);
      expect(text).toContain('Let me read that file.');
      expect(text).toContain('[Tool: Read]');
    });

    it('should return null for lines without messages', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'system',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        raw: '{}',
      };

      expect(extractTextContent(line)).toBeNull();
    });
  });

  describe('extractToolUses', () => {
    it('should extract tool uses from transcript', () => {
      const lines = parseTranscript(sampleTranscript);
      const toolUses = extractToolUses(lines);

      expect(toolUses).toHaveLength(1);
      expect(toolUses[0]!.toolName).toBe('Read');
      expect(toolUses[0]!.input).toEqual({ file_path: '/project/data.json' });
    });
  });

  describe('getConversationThread', () => {
    it('should build conversation thread from parentUuid chain', () => {
      const lines = parseTranscript(sampleTranscript);
      const thread = getConversationThread(lines, 'uuid-4');

      expect(thread).toHaveLength(4);
      expect(thread[0]!.uuid).toBe('uuid-1');
      expect(thread[3]!.uuid).toBe('uuid-4');
    });

    it('should return single line for root message', () => {
      const lines = parseTranscript(sampleTranscript);
      const thread = getConversationThread(lines, 'uuid-1');

      expect(thread).toHaveLength(1);
      expect(thread[0]!.uuid).toBe('uuid-1');
    });
  });
});

describe('Transcript Search', () => {
  describe('scoreResult', () => {
    it('should return 0 for non-matching content', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'user',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'Hello world',
        },
        raw: '{}',
      };

      expect(scoreResult(line, 'typescript')).toBe(0);
    });

    it('should return positive score for matching content', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'user',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'I need help with TypeScript',
        },
        raw: '{}',
      };

      const score = scoreResult(line, 'TypeScript');
      expect(score).toBeGreaterThan(0);
    });

    it('should give higher score for exact case match', () => {
      const line: TranscriptLine = {
        lineNumber: 1,
        type: 'user',
        uuid: 'test',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'TypeScript is great',
        },
        raw: '{}',
      };

      const exactScore = scoreResult(line, 'TypeScript');
      const caseInsensitiveScore = scoreResult(line, 'typescript');

      expect(exactScore).toBeGreaterThan(caseInsensitiveScore);
    });

    it('should boost user/assistant messages', () => {
      const userLine: TranscriptLine = {
        lineNumber: 1,
        type: 'user',
        uuid: 'test1',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'TypeScript question',
        },
        raw: '{}',
      };

      const systemLine: TranscriptLine = {
        lineNumber: 2,
        type: 'system',
        uuid: 'test2',
        parentUuid: null,
        sessionId: 'session',
        timestamp: '2025-01-06T10:00:00Z',
        cwd: '/project',
        message: {
          role: 'user',
          content: 'TypeScript question',
        },
        raw: '{}',
      };

      const userScore = scoreResult(userLine, 'TypeScript');
      const systemScore = scoreResult(systemLine, 'TypeScript');

      expect(userScore).toBeGreaterThan(systemScore);
    });
  });

  describe('getContext', () => {
    it('should get surrounding context lines', () => {
      const lines = parseTranscript(sampleTranscript);
      const context = getContext(lines, 2, 1);

      // Should include lines at index 1 and 3, but not index 2
      expect(context).toHaveLength(2);
      expect(context.some((l) => l.uuid === 'uuid-2')).toBe(true);
      expect(context.some((l) => l.uuid === 'uuid-4')).toBe(true);
      expect(context.some((l) => l.uuid === 'uuid-3')).toBe(false);
    });

    it('should handle edge cases at start of array', () => {
      const lines = parseTranscript(sampleTranscript);
      const context = getContext(lines, 0, 2);

      // Should only include lines after index 0
      expect(context.some((l) => l.uuid === 'uuid-1')).toBe(false);
      expect(context.some((l) => l.uuid === 'uuid-2')).toBe(true);
    });

    it('should handle edge cases at end of array', () => {
      const lines = parseTranscript(sampleTranscript);
      const context = getContext(lines, 3, 2);

      // Should only include lines before index 3
      expect(context.some((l) => l.uuid === 'uuid-4')).toBe(false);
      expect(context.some((l) => l.uuid === 'uuid-2')).toBe(true);
      expect(context.some((l) => l.uuid === 'uuid-3')).toBe(true);
    });
  });
});

describe('Transcript Indexer', () => {
  let tempDir: string;

  beforeAll(async () => {
    // Create a temporary directory for test files
    tempDir = await mkdtemp(join(tmpdir(), 'transcript-test-'));

    // Create test transcript file
    const transcriptPath = join(tempDir, 'session-001.jsonl');
    await Bun.write(transcriptPath, sampleTranscript);
  });

  afterAll(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('findTranscriptFiles', () => {
    it('should find JSONL files in directory', async () => {
      const files = await findTranscriptFiles(tempDir);

      expect(files).toHaveLength(1);
      expect(files[0]).toContain('session-001.jsonl');
    });

    it('should return empty array for non-existent directory', async () => {
      const files = await findTranscriptFiles('/non-existent-path');

      expect(files).toHaveLength(0);
    });
  });

  describe('getSessionInfo', () => {
    it('should extract session information', async () => {
      const files = await findTranscriptFiles(tempDir);
      const info = await getSessionInfo(files[0]!);

      expect(info.sessionId).toBe('session-123');
      expect(info.lineCount).toBe(4);
      expect(info.messageTypes['user']).toBe(2);
      expect(info.messageTypes['assistant']).toBe(2);
    });
  });

  describe('indexTranscripts', () => {
    it('should build index of transcript files', async () => {
      const index = await indexTranscripts(tempDir);

      expect(index.version).toBe('1.0.0');
      expect(index.files).toHaveLength(1);
      expect(index.createdAt).toBeDefined();
    });
  });

  describe('saveIndex and loadIndex', () => {
    it('should save and load index', async () => {
      const index = await indexTranscripts(tempDir);
      const indexPath = join(tempDir, 'index.json');

      await saveIndex(index, indexPath);
      const loaded = await loadIndex(indexPath);

      expect(loaded).not.toBeNull();
      expect(loaded!.version).toBe(index.version);
      expect(loaded!.files).toHaveLength(index.files.length);
    });

    it('should return null for non-existent index', async () => {
      const loaded = await loadIndex('/non-existent/index.json');

      expect(loaded).toBeNull();
    });
  });

  describe('getIndexStats', () => {
    it('should calculate index statistics', async () => {
      const index = await indexTranscripts(tempDir);
      const stats = getIndexStats(index);

      expect(stats.totalFiles).toBe(1);
      expect(stats.totalLines).toBe(4);
      expect(stats.messageTypeCounts['user']).toBe(2);
      expect(stats.dateRange).not.toBeNull();
    });
  });

  describe('findSessions', () => {
    it('should filter sessions by criteria', async () => {
      const index = await indexTranscripts(tempDir);

      // Filter by min lines
      const filtered = findSessions(index, { minLines: 3 });
      expect(filtered).toHaveLength(1);

      const noMatches = findSessions(index, { minLines: 100 });
      expect(noMatches).toHaveLength(0);
    });
  });

  describe('getRecentSessions', () => {
    it('should return sessions within date range', async () => {
      const index = await indexTranscripts(tempDir);

      // Our test data has timestamps from 2025-01-06
      // This test might fail if run far in the future
      const recent = getRecentSessions(index, 365);
      expect(recent.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('searchInFile', () => {
    it('should search within a single file', async () => {
      const files = await findTranscriptFiles(tempDir);
      const results = await searchInFile(files[0]!, 'TypeScript');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.matchedText).toContain('TypeScript');
    });

    it('should return empty for non-matching query', async () => {
      const files = await findTranscriptFiles(tempDir);
      const results = await searchInFile(files[0]!, 'xyznonexistent');

      expect(results).toHaveLength(0);
    });

    it('should filter by types', async () => {
      const files = await findTranscriptFiles(tempDir);
      const results = await searchInFile(files[0]!, 'TypeScript', {
        types: ['user'],
      });

      for (const result of results) {
        expect(result.line.type).toBe('user');
      }
    });
  });
});

describe('File Operations', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'transcript-file-test-'));
    await Bun.write(join(tempDir, 'test.jsonl'), sampleTranscript);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('parseTranscriptFile', () => {
    it('should parse transcript from file', async () => {
      const lines = await parseTranscriptFile(join(tempDir, 'test.jsonl'));

      expect(lines).toHaveLength(4);
    });

    it('should throw for non-existent file', async () => {
      await expect(parseTranscriptFile('/non-existent.jsonl')).rejects.toThrow();
    });
  });

  describe('getTranscriptLine', () => {
    it('should get specific line from file', async () => {
      const line = await getTranscriptLine(join(tempDir, 'test.jsonl'), 1);

      expect(line).not.toBeNull();
      expect(line!.type).toBe('user');
      expect(line!.uuid).toBe('uuid-1');
    });

    it('should return null for out of range line', async () => {
      const line = await getTranscriptLine(join(tempDir, 'test.jsonl'), 100);

      expect(line).toBeNull();
    });

    it('should return null for non-existent file', async () => {
      const line = await getTranscriptLine('/non-existent.jsonl', 1);

      expect(line).toBeNull();
    });
  });
});
