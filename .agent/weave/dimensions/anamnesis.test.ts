/**
 * Tests for Anamnesis Dimension Implementation
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createInMemoryStore } from '../sqlite-store';
import {
  AnamnesisManagerImpl,
  createAnamnesisManager,
  identifyImportantMoments,
  calculateMessageRange,
  summarizeSegment,
  type IndexEntry,
  type PruneOptions
} from './anamnesis';
import type { SQLiteStore } from '../sqlite-store';

describe('AnamnesisManager', () => {
  let store: SQLiteStore;
  let manager: AnamnesisManagerImpl;

  beforeAll(() => {
    store = createInMemoryStore();
    manager = new AnamnesisManagerImpl(store);
  });

  afterAll(() => {
    store.close();
  });

  describe('indexMoment', () => {
    test('should create a memory entry and return ID', async () => {
      const entry: IndexEntry = {
        summary: 'Discussed authentication architecture using JWT tokens',
        keywords: ['authentication', 'jwt', 'tokens', 'security'],
        sessionId: 'session-001',
        transcriptFile: '/tmp/transcripts/session-001.md',
        messageRange: [10, 25],
        importance: 'high',
        topics: ['architecture', 'security']
      };

      const memoryId = await manager.indexMoment(entry);

      expect(memoryId).toMatch(/^mem-\d+-[a-z0-9]+$/);

      // Verify the memory was stored
      const memory = await manager.getMemory(memoryId);
      expect(memory).not.toBeNull();
      expect(memory!.summary).toBe(entry.summary);
      expect(memory!.keywords).toEqual(entry.keywords);
      expect(memory!.importance).toBe('high');
      expect(memory!.accessCount).toBe(0);
    });

    test('should create topics when specified', async () => {
      const entry: IndexEntry = {
        summary: 'Database schema migration strategy',
        keywords: ['database', 'migration', 'schema'],
        sessionId: 'session-002',
        transcriptFile: '/tmp/transcripts/session-002.md',
        messageRange: [5, 15],
        importance: 'medium',
        topics: ['database']
      };

      await manager.indexMoment(entry);

      const topics = await manager.getTopics();
      const dbTopic = topics.find(t => t.topic === 'database');
      expect(dbTopic).toBeDefined();
      expect(dbTopic!.memoryIds.length).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    test('should find memories by query', async () => {
      // Index some test data
      await manager.indexMoment({
        summary: 'Implemented caching layer with Redis',
        keywords: ['caching', 'redis', 'performance'],
        sessionId: 'session-003',
        transcriptFile: '/tmp/transcripts/session-003.md',
        messageRange: [1, 10],
        importance: 'high'
      });

      const results = await manager.search('redis caching');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].matchedKeywords).toContain('redis');
    });

    test('should boost high importance memories', async () => {
      // Index low and high importance memories with same keywords
      await manager.indexMoment({
        summary: 'Minor logging change',
        keywords: ['testing-boost', 'minor'],
        sessionId: 'session-004',
        transcriptFile: '/tmp/test.md',
        messageRange: [1, 5],
        importance: 'low'
      });

      await manager.indexMoment({
        summary: 'Critical security fix',
        keywords: ['testing-boost', 'critical'],
        sessionId: 'session-005',
        transcriptFile: '/tmp/test.md',
        messageRange: [1, 5],
        importance: 'critical'
      });

      const results = await manager.searchByKeywords(['testing-boost']);

      // Critical should be ranked higher
      expect(results.length).toBe(2);
      expect(results[0].memory.importance).toBe('critical');
    });
  });

  describe('searchByTopic', () => {
    test('should find memories by topic', async () => {
      await manager.indexMoment({
        summary: 'API rate limiting implementation',
        keywords: ['api', 'rate-limiting'],
        sessionId: 'session-006',
        transcriptFile: '/tmp/test.md',
        messageRange: [1, 10],
        importance: 'high',
        topics: ['api-design']
      });

      const results = await manager.searchByTopic('api-design');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].memory.summary).toContain('rate limiting');
    });
  });

  describe('updateAccessStats', () => {
    test('should increment access count', async () => {
      const memoryId = await manager.indexMoment({
        summary: 'Test access stats',
        keywords: ['access', 'test'],
        sessionId: 'session-007',
        transcriptFile: '/tmp/test.md',
        messageRange: [1, 5],
        importance: 'low'
      });

      await manager.updateAccessStats(memoryId);
      await manager.updateAccessStats(memoryId);

      const memory = await manager.getMemory(memoryId);
      expect(memory!.accessCount).toBe(2);
      expect(memory!.lastAccessed).toBeDefined();
    });
  });

  describe('prune', () => {
    test('should prune low importance memories', async () => {
      await manager.indexMoment({
        summary: 'Prunable memory',
        keywords: ['prune-test'],
        sessionId: 'session-008',
        transcriptFile: '/tmp/test.md',
        messageRange: [1, 5],
        importance: 'low'
      });

      const options: PruneOptions = {
        maxImportance: 'low',
        dryRun: true
      };

      const count = await manager.prune(options);
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('getRecentMemories', () => {
    test('should return recent memories', async () => {
      const memories = await manager.getRecentMemories(5);

      expect(Array.isArray(memories)).toBe(true);
      expect(memories.length).toBeLessThanOrEqual(5);
    });
  });
});

describe('identifyImportantMoments', () => {
  test('should identify decision moments', () => {
    const messages = [
      'User: What database should we use?',
      'Assistant: I recommend PostgreSQL for its reliability.',
      'User: Ok, I decided to go with PostgreSQL.',
      'Assistant: Great choice!'
    ];

    const moments = identifyImportantMoments(messages);

    expect(moments.length).toBeGreaterThan(0);
    const decisionMoment = moments.find(m => m.reason === 'Decision made');
    expect(decisionMoment).toBeDefined();
    expect(decisionMoment!.importance).toBe('high');
    expect(decisionMoment!.keywords).toContain('decision');
  });

  test('should identify architecture discussions', () => {
    const messages = [
      'User: How should we structure the application?',
      'Assistant: I suggest a layered architecture with services.',
      'User: What pattern would you recommend?',
      'Assistant: The repository pattern would work well here.'
    ];

    const moments = identifyImportantMoments(messages);

    const archMoment = moments.find(m => m.reason === 'Architecture discussion');
    expect(archMoment).toBeDefined();
    expect(archMoment!.keywords).toContain('architecture');
  });

  test('should identify problem/solution pairs', () => {
    const messages = [
      'User: I have a problem with the API.',
      'Assistant: What error are you seeing?',
      'User: Getting 500 errors.',
      'Assistant: The issue was in the middleware.',
      'User: I fixed it by updating the config.',
      'Assistant: That solved the problem!'
    ];

    const moments = identifyImportantMoments(messages);

    const problemMoment = moments.find(m => m.reason === 'Problem identified');
    const solutionMoment = moments.find(m => m.reason === 'Solution found');

    expect(problemMoment).toBeDefined();
    expect(solutionMoment).toBeDefined();
    expect(solutionMoment!.importance).toBe('high');
  });

  test('should identify critical issues', () => {
    const messages = [
      'User: Is there a security concern?',
      'Assistant: Yes, this is a critical security vulnerability.',
      'User: We must not deploy without fixing it.'
    ];

    const moments = identifyImportantMoments(messages);

    const criticalMoment = moments.find(m => m.reason === 'Critical issue or constraint');
    expect(criticalMoment).toBeDefined();
    expect(criticalMoment!.importance).toBe('critical');
  });
});

describe('calculateMessageRange', () => {
  test('should calculate correct range', () => {
    const range = calculateMessageRange(10, 100, 5);
    expect(range).toEqual([5, 15]);
  });

  test('should clamp to bounds', () => {
    const rangeStart = calculateMessageRange(2, 100, 5);
    expect(rangeStart).toEqual([0, 7]);

    const rangeEnd = calculateMessageRange(98, 100, 5);
    expect(rangeEnd).toEqual([93, 99]);
  });
});

describe('summarizeSegment', () => {
  test('should extract summary from segment', () => {
    const messages = [
      '',
      'User: How do we handle authentication?',
      'Assistant: Use JWT tokens with refresh mechanism.',
      'User: Sounds good.'
    ];

    const summary = summarizeSegment(messages, 0, 3);
    expect(summary).toBe('User: How do we handle authentication?');
  });

  test('should truncate long summaries', () => {
    const longMessage = 'A'.repeat(300);
    const messages = [longMessage];

    const summary = summarizeSegment(messages, 0, 0);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith('...')).toBe(true);
  });
});
