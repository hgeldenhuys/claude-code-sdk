/**
 * Anamnesis Dimension Implementation
 *
 * Anamnesis (An) represents the recall/memory dimension, indexing past conversations,
 * enabling semantic search, and maintaining topic clusters for retrieval.
 *
 * Layer: Interface (adaptive, conversation memory and retrieval)
 * Symbol: An
 * Purpose: Remember and retrieve relevant past discussions
 *
 * Key features:
 * - Index important conversation moments with keywords and transcript references
 * - Search memories by query, keywords, or topic
 * - Recall full context by loading transcript segments
 * - Topic clustering for semantic organization
 * - Memory pruning with configurable retention policies
 *
 * @module weave/dimensions/anamnesis
 */

import type {
  Anamnesis,
  MemoryEntry,
  TranscriptReference,
  TopicCluster,
  MemoryImportance,
  AnamnesisMetadata
} from '../types';
import type { SQLiteStore, TranscriptIndexRow } from '../sqlite-store';
import { readFileSync, existsSync } from 'fs';

// ============================================================================
// Types
// ============================================================================

export interface AnamnesisManager {
  // Index a conversation moment
  indexMoment(entry: IndexEntry): Promise<string>;  // Returns memory ID

  // Search memories
  search(query: string): Promise<SearchResult[]>;
  searchByKeywords(keywords: string[]): Promise<SearchResult[]>;
  searchByTopic(topic: string): Promise<SearchResult[]>;

  // Recall full context
  recall(memoryId: string): Promise<RecalledContext | null>;

  // Topic management
  createTopic(name: string, memoryIds: string[]): Promise<void>;
  addToTopic(topic: string, memoryId: string): Promise<void>;
  getTopics(): Promise<TopicCluster[]>;

  // Maintenance
  updateAccessStats(memoryId: string): Promise<void>;
  prune(options: PruneOptions): Promise<number>;  // Returns count pruned

  // Utility
  getMemory(memoryId: string): Promise<MemoryEntry | null>;
  getRecentMemories(limit?: number): Promise<MemoryEntry[]>;
  getMemoriesByImportance(importance: MemoryImportance): Promise<MemoryEntry[]>;
}

export interface IndexEntry {
  summary: string;
  keywords: string[];
  sessionId: string;
  transcriptFile: string;
  messageRange: [number, number];
  importance: MemoryImportance;
  topics?: string[];
  relatedEntities?: string[];
}

export interface SearchResult {
  memory: MemoryEntry;
  score: number;  // Relevance score
  matchedKeywords: string[];
}

export interface RecalledContext {
  memory: MemoryEntry;
  transcript: string[];  // The actual conversation lines
  fullContext?: string;  // Surrounding context if available
}

export interface PruneOptions {
  maxAge?: number;        // Days
  minAccessCount?: number;
  maxImportance?: MemoryImportance;
  dryRun?: boolean;
}

// ============================================================================
// Implementation
// ============================================================================

export class AnamnesisManagerImpl implements AnamnesisManager {
  private store: SQLiteStore;
  private keywordIndex: Map<string, Set<string>> = new Map();  // In-memory keyword index
  private initialized: boolean = false;

  constructor(store: SQLiteStore) {
    this.store = store;
  }

  /**
   * Initialize the in-memory keyword index from stored memories
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const memories = await this.store.read('An', { status: 'active' });
      for (const memory of memories) {
        if (memory.keywords && Array.isArray(memory.keywords)) {
          for (const keyword of memory.keywords) {
            const normalized = keyword.toLowerCase();
            if (!this.keywordIndex.has(normalized)) {
              this.keywordIndex.set(normalized, new Set());
            }
            this.keywordIndex.get(normalized)!.add(memory.id);
          }
        }
      }
      this.initialized = true;
    } catch (error) {
      // Store may not have any memories yet, that's ok
      this.initialized = true;
    }
  }

  /**
   * Index a conversation moment for later retrieval
   */
  async indexMoment(entry: IndexEntry): Promise<string> {
    await this.ensureInitialized();

    const id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const memory: MemoryEntry = {
      id,
      summary: entry.summary,
      keywords: entry.keywords,
      transcriptRef: {
        sessionId: entry.sessionId,
        file: entry.transcriptFile,
        messageRange: entry.messageRange,
        timestamp: now
      },
      importance: entry.importance,
      createdAt: now,
      accessCount: 0,
      relatedEntities: entry.relatedEntities
    };

    // Save to SQLite knowledge table
    await this.store.write('An', 'add', memory);

    // Also index in transcript_index table for fast searches
    await this.store.indexTranscript({
      id,
      sessionId: entry.sessionId,
      filePath: entry.transcriptFile,
      messageRange: entry.messageRange,
      keywords: entry.keywords,
      summary: entry.summary,
      importance: entry.importance
    });

    // Update in-memory keyword index
    for (const keyword of entry.keywords) {
      const normalized = keyword.toLowerCase();
      if (!this.keywordIndex.has(normalized)) {
        this.keywordIndex.set(normalized, new Set());
      }
      this.keywordIndex.get(normalized)!.add(id);
    }

    // Add to topics if specified
    if (entry.topics) {
      for (const topic of entry.topics) {
        await this.addToTopic(topic, id);
      }
    }

    return id;
  }

  /**
   * Search memories by natural language query
   */
  async search(query: string): Promise<SearchResult[]> {
    await this.ensureInitialized();

    // Extract keywords from query
    const queryKeywords = this.extractKeywords(query);
    return this.searchByKeywords(queryKeywords);
  }

  /**
   * Search memories by specific keywords
   */
  async searchByKeywords(keywords: string[]): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const normalizedKeywords = keywords.map(k => k.toLowerCase());
    const memoryScores = new Map<string, { score: number; matched: string[] }>();

    // Score memories by keyword matches using in-memory index
    for (const keyword of normalizedKeywords) {
      const memoryIds = this.keywordIndex.get(keyword);
      if (memoryIds) {
        for (const memoryId of memoryIds) {
          const current = memoryScores.get(memoryId) || { score: 0, matched: [] };
          current.score += 1;
          current.matched.push(keyword);
          memoryScores.set(memoryId, current);
        }
      }
    }

    // Also search transcript_index for matches not in memory index
    const transcriptResults = await this.store.searchTranscripts(normalizedKeywords, { limit: 50 });
    for (const row of transcriptResults) {
      if (!memoryScores.has(row.id)) {
        const rowKeywords = row.keywords?.split(',') || [];
        const matched = normalizedKeywords.filter(kw =>
          rowKeywords.some(rk => rk.toLowerCase().includes(kw))
        );
        if (matched.length > 0) {
          memoryScores.set(row.id, { score: matched.length, matched });
        }
      }
    }

    // Fetch full memories and sort by score
    const results: SearchResult[] = [];
    for (const [memoryId, { score, matched }] of memoryScores) {
      const memory = await this.getMemory(memoryId);
      if (memory) {
        // Boost score by importance
        const importanceBoost = this.getImportanceBoost(memory.importance);
        // Boost by recency (decay factor)
        const recencyBoost = this.getRecencyBoost(memory.createdAt);
        // Boost by access frequency
        const accessBoost = Math.min(1 + (memory.accessCount * 0.1), 2);

        results.push({
          memory,
          score: score * importanceBoost * recencyBoost * accessBoost,
          matchedKeywords: matched
        });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, 20);  // Top 20 results
  }

  /**
   * Search memories by topic cluster
   */
  async searchByTopic(topic: string): Promise<SearchResult[]> {
    await this.ensureInitialized();

    const topics = await this.getTopics();
    const cluster = topics.find(t => t.topic.toLowerCase() === topic.toLowerCase());

    if (!cluster) {
      return [];
    }

    const results: SearchResult[] = [];
    for (const memoryId of cluster.memoryIds) {
      const memory = await this.getMemory(memoryId);
      if (memory) {
        results.push({
          memory,
          score: 1,
          matchedKeywords: [topic]
        });
      }
    }

    // Sort by importance and recency
    results.sort((a, b) => {
      const impDiff = this.getImportanceBoost(b.memory.importance) -
                      this.getImportanceBoost(a.memory.importance);
      if (impDiff !== 0) return impDiff;
      return new Date(b.memory.createdAt).getTime() - new Date(a.memory.createdAt).getTime();
    });

    return results;
  }

  /**
   * Recall full context for a memory, loading the actual transcript
   */
  async recall(memoryId: string): Promise<RecalledContext | null> {
    await this.ensureInitialized();

    const memory = await this.getMemory(memoryId);

    if (!memory) {
      return null;
    }

    // Update access stats
    await this.updateAccessStats(memoryId);

    // Try to load transcript
    const transcript = await this.loadTranscript(memory.transcriptRef);

    return {
      memory,
      transcript,
      fullContext: transcript.join('\n')
    };
  }

  /**
   * Load transcript lines from file
   */
  private async loadTranscript(ref: TranscriptReference): Promise<string[]> {
    if (!existsSync(ref.file)) {
      return [`[Transcript file not found: ${ref.file}]`];
    }

    try {
      const content = readFileSync(ref.file, 'utf-8');
      const lines = content.split('\n');

      const [start, end] = ref.messageRange;

      // Clamp to valid range
      const safeStart = Math.max(0, start);
      const safeEnd = Math.min(lines.length - 1, end);

      return lines.slice(safeStart, safeEnd + 1);

    } catch (error) {
      return [`[Error loading transcript: ${error}]`];
    }
  }

  /**
   * Create a new topic cluster
   */
  async createTopic(name: string, memoryIds: string[]): Promise<void> {
    await this.ensureInitialized();

    const cluster: TopicCluster = {
      topic: name,
      memoryIds,
      relatedTopics: [],
      lastUpdated: new Date().toISOString(),
      coherence: 1.0
    };

    await this.store.write('An', 'add', {
      id: `topic:${name.toLowerCase()}`,
      type: 'topic',
      ...cluster
    });
  }

  /**
   * Add a memory to a topic cluster (creates cluster if doesn't exist)
   */
  async addToTopic(topic: string, memoryId: string): Promise<void> {
    await this.ensureInitialized();

    const topicId = `topic:${topic.toLowerCase()}`;

    try {
      const existing = await this.store.readById('An', topicId);

      if (existing) {
        if (!existing.memoryIds.includes(memoryId)) {
          existing.memoryIds.push(memoryId);
          existing.lastUpdated = new Date().toISOString();
          await this.store.write('An', 'update', existing);
        }
      } else {
        await this.createTopic(topic, [memoryId]);
      }
    } catch {
      // Topic doesn't exist, create it
      await this.createTopic(topic, [memoryId]);
    }
  }

  /**
   * Get all topic clusters
   */
  async getTopics(): Promise<TopicCluster[]> {
    await this.ensureInitialized();

    const allEntries = await this.store.read('An', { status: 'active' });
    return allEntries.filter((m: any) => m.type === 'topic').map((m: any) => ({
      topic: m.topic,
      memoryIds: m.memoryIds,
      relatedTopics: m.relatedTopics || [],
      lastUpdated: m.lastUpdated,
      coherence: m.coherence || 1.0
    }));
  }

  /**
   * Update access statistics for a memory
   */
  async updateAccessStats(memoryId: string): Promise<void> {
    await this.ensureInitialized();

    const memory = await this.getMemory(memoryId);

    if (memory) {
      memory.accessCount = (memory.accessCount || 0) + 1;
      memory.lastAccessed = new Date().toISOString();
      await this.store.write('An', 'update', memory);
    }
  }

  /**
   * Prune old or low-importance memories
   */
  async prune(options: PruneOptions): Promise<number> {
    await this.ensureInitialized();

    const allEntries = await this.store.read('An', { status: 'active' });
    let pruned = 0;
    const now = new Date();

    for (const entry of allEntries) {
      // Skip topics and non-memory entries
      if (entry.type === 'topic') continue;

      let shouldPrune = false;

      // Check age
      if (options.maxAge && entry.createdAt) {
        const created = new Date(entry.createdAt);
        const ageDays = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        if (ageDays > options.maxAge) shouldPrune = true;
      }

      // Check access count
      if (options.minAccessCount !== undefined) {
        const accessCount = entry.accessCount || 0;
        if (accessCount < options.minAccessCount) shouldPrune = true;
      }

      // Check importance
      if (options.maxImportance && entry.importance) {
        const importanceOrder = ['low', 'medium', 'high', 'critical'];
        const memoryLevel = importanceOrder.indexOf(entry.importance);
        const maxLevel = importanceOrder.indexOf(options.maxImportance);
        if (memoryLevel <= maxLevel) shouldPrune = true;
      }

      if (shouldPrune) {
        if (!options.dryRun) {
          await this.store.delete('An', entry.id);

          // Remove from keyword index
          if (entry.keywords) {
            for (const keyword of entry.keywords) {
              const normalized = keyword.toLowerCase();
              const memorySet = this.keywordIndex.get(normalized);
              if (memorySet) {
                memorySet.delete(entry.id);
                if (memorySet.size === 0) {
                  this.keywordIndex.delete(normalized);
                }
              }
            }
          }
        }
        pruned++;
      }
    }

    return pruned;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get a single memory by ID
   */
  async getMemory(memoryId: string): Promise<MemoryEntry | null> {
    try {
      const memory = await this.store.readById('An', memoryId);
      if (memory && memory.type !== 'topic') {
        return memory as MemoryEntry;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get recent memories
   */
  async getRecentMemories(limit: number = 10): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    const allEntries = await this.store.read('An', {
      status: 'active',
      limit,
      orderBy: 'updated_at',
      orderDir: 'desc'
    });

    return allEntries.filter((m: any) => m.type !== 'topic');
  }

  /**
   * Get memories by importance level
   */
  async getMemoriesByImportance(importance: MemoryImportance): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    const allEntries = await this.store.read('An', { status: 'active' });
    return allEntries.filter((m: any) =>
      m.type !== 'topic' && m.importance === importance
    );
  }

  /**
   * Extract keywords from text
   */
  private extractKeywords(text: string): string[] {
    // Simple keyword extraction - tokenize and filter
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Remove common stop words
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
      'can', 'has', 'her', 'was', 'one', 'our', 'out', 'this',
      'that', 'have', 'from', 'they', 'been', 'said', 'each',
      'which', 'their', 'will', 'way', 'could', 'people',
      'than', 'been', 'who', 'its', 'now', 'did', 'made',
      'find', 'did', 'get', 'come', 'made', 'may', 'part'
    ]);

    return words.filter(w => !stopWords.has(w));
  }

  /**
   * Get importance boost factor
   */
  private getImportanceBoost(importance: MemoryImportance): number {
    const boosts: Record<MemoryImportance, number> = {
      'low': 1,
      'medium': 1.5,
      'high': 2,
      'critical': 3
    };
    return boosts[importance] || 1;
  }

  /**
   * Get recency boost factor (exponential decay)
   */
  private getRecencyBoost(createdAt: string): number {
    const now = new Date();
    const created = new Date(createdAt);
    const daysSince = (now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);

    // Half-life of 30 days
    const halfLife = 30;
    return Math.pow(0.5, daysSince / halfLife) + 0.5; // Range: 0.5 to 1.5
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new AnamnesisManager instance
 */
export function createAnamnesisManager(store: SQLiteStore): AnamnesisManager {
  return new AnamnesisManagerImpl(store);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Identify important moments in a conversation transcript
 *
 * Analyzes conversation messages to find moments worth indexing:
 * - Decisions made
 * - Architecture discussions
 * - Problem/solution pairs
 * - Key insights or realizations
 * - Errors and their resolutions
 */
export function identifyImportantMoments(messages: string[]): {
  index: number;
  importance: MemoryImportance;
  keywords: string[];
  reason: string;
}[] {
  const moments: ReturnType<typeof identifyImportantMoments> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i].toLowerCase();

    // Decision indicators - high importance
    if (msg.includes('decided') || msg.includes('chose') || msg.includes('went with') ||
        msg.includes('decision') || msg.includes('final choice')) {
      moments.push({
        index: i,
        importance: 'high',
        keywords: extractContextKeywords(messages, i, ['decision', 'choice']),
        reason: 'Decision made'
      });
    }

    // Architecture discussions - high importance
    if (msg.includes('architecture') || msg.includes('pattern') || msg.includes('design') ||
        msg.includes('structure') || msg.includes('approach')) {
      moments.push({
        index: i,
        importance: 'high',
        keywords: extractContextKeywords(messages, i, ['architecture', 'design', 'pattern']),
        reason: 'Architecture discussion'
      });
    }

    // Problem identification - medium importance
    if (msg.includes('problem') || msg.includes('issue') || msg.includes('bug') ||
        msg.includes('error') || msg.includes('failing')) {
      moments.push({
        index: i,
        importance: 'medium',
        keywords: extractContextKeywords(messages, i, ['problem', 'issue', 'debugging']),
        reason: 'Problem identified'
      });
    }

    // Solution found - high importance
    if (msg.includes('solution') || msg.includes('fixed') || msg.includes('resolved') ||
        msg.includes('working now') || msg.includes('that fixed')) {
      moments.push({
        index: i,
        importance: 'high',
        keywords: extractContextKeywords(messages, i, ['solution', 'fix', 'resolution']),
        reason: 'Solution found'
      });
    }

    // Important realization - medium importance
    if (msg.includes('realized') || msg.includes('understood') || msg.includes('insight') ||
        msg.includes('turns out') || msg.includes('i see')) {
      moments.push({
        index: i,
        importance: 'medium',
        keywords: extractContextKeywords(messages, i, ['insight', 'realization', 'understanding']),
        reason: 'Key insight'
      });
    }

    // Critical warnings or blockers - critical importance
    if (msg.includes('critical') || msg.includes('blocker') || msg.includes('must not') ||
        msg.includes('security') || msg.includes('breaking change')) {
      moments.push({
        index: i,
        importance: 'critical',
        keywords: extractContextKeywords(messages, i, ['critical', 'security', 'blocker']),
        reason: 'Critical issue or constraint'
      });
    }

    // TODO/followup items - medium importance
    if (msg.includes('todo') || msg.includes('follow up') || msg.includes('later') ||
        msg.includes('need to') || msg.includes('should remember')) {
      moments.push({
        index: i,
        importance: 'medium',
        keywords: extractContextKeywords(messages, i, ['todo', 'followup', 'deferred']),
        reason: 'Follow-up item'
      });
    }
  }

  // Deduplicate moments that are very close together
  return deduplicateMoments(moments);
}

/**
 * Extract context-aware keywords from surrounding messages
 */
function extractContextKeywords(messages: string[], index: number, baseKeywords: string[]): string[] {
  const keywords = new Set(baseKeywords);

  // Look at surrounding context (2 messages before and after)
  const start = Math.max(0, index - 2);
  const end = Math.min(messages.length - 1, index + 2);

  const stopWords = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all',
    'can', 'has', 'was', 'one', 'this', 'that', 'have', 'from'
  ]);

  for (let i = start; i <= end; i++) {
    const words = messages[i].toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    // Add technical-looking words (camelCase, snake_case, contains numbers)
    for (const word of words) {
      if (/[A-Z]/.test(word) || word.includes('_') || /\d/.test(word) ||
          word.endsWith('ing') || word.endsWith('tion') || word.endsWith('ment')) {
        keywords.add(word.toLowerCase());
      }
    }
  }

  return Array.from(keywords).slice(0, 10);  // Limit to 10 keywords
}

/**
 * Deduplicate moments that are very close together
 */
function deduplicateMoments(moments: ReturnType<typeof identifyImportantMoments>): ReturnType<typeof identifyImportantMoments> {
  if (moments.length === 0) return moments;

  // Sort by index
  moments.sort((a, b) => a.index - b.index);

  const deduplicated: typeof moments = [moments[0]];

  for (let i = 1; i < moments.length; i++) {
    const current = moments[i];
    const last = deduplicated[deduplicated.length - 1];

    // If within 3 lines and same importance level, merge
    if (current.index - last.index <= 3 && current.importance === last.importance) {
      // Merge keywords
      const mergedKeywords = new Set([...last.keywords, ...current.keywords]);
      last.keywords = Array.from(mergedKeywords).slice(0, 10);
      // Keep the higher importance if different
    } else {
      deduplicated.push(current);
    }
  }

  return deduplicated;
}

/**
 * Calculate message range to capture context around an important moment
 */
export function calculateMessageRange(
  momentIndex: number,
  totalMessages: number,
  contextLines: number = 5
): [number, number] {
  const start = Math.max(0, momentIndex - contextLines);
  const end = Math.min(totalMessages - 1, momentIndex + contextLines);
  return [start, end];
}

/**
 * Create a summary for a conversation segment
 */
export function summarizeSegment(messages: string[], startIndex: number, endIndex: number): string {
  const segment = messages.slice(startIndex, endIndex + 1);

  // Extract first non-empty line as base
  let summary = segment.find(m => m.trim().length > 0) || '';

  // Truncate if too long
  if (summary.length > 200) {
    summary = summary.substring(0, 197) + '...';
  }

  return summary;
}

// ============================================================================
// Default Export
// ============================================================================

export default AnamnesisManagerImpl;
