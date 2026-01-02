/**
 * Documentation Tracker Module
 *
 * Fetches, caches, and tracks changes to Claude Code documentation.
 * Provides delta detection to identify when docs are updated.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  BatchResult,
  CacheStatus,
  DeltaHistory,
  DeltaRecord,
  DeltaResult,
  DiffSummary,
  DocCategory,
  DocIndexEntry,
  DocMetadata,
  DocSource,
  DocsIndex,
  DocsTrackerConfig,
  FetchResult,
} from './types.ts';
import { CLAUDE_CODE_DOCS } from './types.ts';

const DEFAULT_CONFIG: DocsTrackerConfig = {
  cacheDir: '.claude-code-sdk/docs-cache',
  baseUrl: 'https://code.claude.com/docs/en',
  checkInterval: 24,
  autoFetch: false,
  fetchTimeout: 30000,
};

/**
 * DocsTracker - Tracks and caches Claude Code documentation
 */
export class DocsTracker {
  private config: DocsTrackerConfig;
  private metadata: Map<string, DocMetadata> = new Map();
  private deltaHistory: DeltaHistory = { schemaVersion: '1.0.0', deltas: [] };
  private initialized = false;

  constructor(config: Partial<DocsTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the tracker - load existing cache and metadata
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.ensureDir(this.config.cacheDir);
    await this.ensureDir(join(this.config.cacheDir, 'content'));
    await this.loadMetadata();
    await this.loadDeltaHistory();
    this.initialized = true;
  }

  /**
   * Get all registered doc sources
   */
  getSources(): DocSource[] {
    return [...CLAUDE_CODE_DOCS];
  }

  /**
   * Add a custom doc source
   */
  addSource(source: DocSource): void {
    const existing = CLAUDE_CODE_DOCS.find((s) => s.id === source.id);
    if (existing) {
      Object.assign(existing, source);
    } else {
      CLAUDE_CODE_DOCS.push(source);
    }
  }

  /**
   * Fetch a single document and cache it
   */
  async fetchDoc(url: string, category?: DocCategory): Promise<FetchResult> {
    await this.init();
    const startTime = Date.now();

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.fetchTimeout),
        headers: {
          Accept: 'text/markdown, text/plain, */*',
          'User-Agent': 'claude-code-sdk/0.1.0',
        },
      });

      if (!response.ok) {
        return {
          url,
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          fetchedAt: new Date(),
          responseTime: Date.now() - startTime,
        };
      }

      const content = await response.text();
      const contentHash = this.hashContent(content);
      const existingMeta = this.metadata.get(url);

      // Determine if this is a change
      const hasChanged = existingMeta ? existingMeta.contentHash !== contentHash : true;
      const now = new Date();

      // Extract title and description from content
      const { title, description } = this.extractMetadata(content);

      // Create/update metadata
      const previousVersion = existingMeta?.version ?? 0;
      const newVersion = hasChanged ? previousVersion + 1 : previousVersion || 1;
      const meta: DocMetadata = {
        url,
        localPath: this.getLocalPath(url),
        title,
        description,
        category: category ?? existingMeta?.category ?? 'core',
        tags: existingMeta?.tags ?? [],
        contentHash,
        firstCached: existingMeta?.firstCached ?? now,
        lastFetched: now,
        lastChanged: hasChanged ? now : (existingMeta?.lastChanged ?? null),
        version: newVersion,
      };

      // Record delta if this is a real change (not first fetch)
      if (hasChanged && existingMeta) {
        const cachedContent = await this.getCachedContent(url);
        const diffSummary = cachedContent
          ? this.computeDiff(cachedContent, content)
          : {
              linesAdded: 0,
              linesRemoved: 0,
              linesModified: 0,
              changedSections: [],
              summary: 'New document',
            };

        await this.recordDelta({
          id: `delta-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          url,
          title,
          detectedAt: now,
          previousVersion,
          newVersion,
          previousHash: existingMeta.contentHash,
          newHash: contentHash,
          diffSummary,
          reviewed: false,
        });
      }

      // Save content and metadata
      await this.saveContent(url, content);
      this.metadata.set(url, meta);
      await this.saveMetadata();

      return {
        url,
        success: true,
        content,
        fetchedAt: now,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        url,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: new Date(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch all registered documents
   */
  async fetchAll(): Promise<BatchResult> {
    await this.init();
    const startTime = Date.now();
    const sources = this.getSources();
    const results: FetchResult[] = [];
    let changesDetected = 0;

    for (const source of sources) {
      const existingHash = this.metadata.get(source.url)?.contentHash;
      const result = await this.fetchDoc(source.url, source.category);
      results.push(result);

      if (result.success) {
        const newMeta = this.metadata.get(source.url);
        if (newMeta && existingHash && newMeta.contentHash !== existingHash) {
          changesDetected++;
        }
      }

      // Small delay to avoid rate limiting
      await this.delay(100);
    }

    return {
      totalDocs: sources.length,
      successCount: results.filter((r) => r.success).length,
      failureCount: results.filter((r) => !r.success).length,
      changesDetected,
      results,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Check a single document for changes without downloading
   */
  async checkForChanges(url: string): Promise<DeltaResult> {
    await this.init();
    const existingMeta = this.metadata.get(url);
    const previousHash = existingMeta?.contentHash ?? '';

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.fetchTimeout),
        headers: {
          Accept: 'text/markdown, text/plain, */*',
          'User-Agent': 'claude-code-sdk/0.1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const content = await response.text();
      const newHash = this.hashContent(content);
      const hasChanges = previousHash !== newHash;

      let diffSummary: DiffSummary | undefined;
      if (hasChanges && existingMeta) {
        const cachedContent = await this.getCachedContent(url);
        if (cachedContent) {
          diffSummary = this.computeDiff(cachedContent, content);
        }
      }

      return {
        url,
        hasChanges,
        previousHash,
        newHash,
        checkedAt: new Date(),
        diffSummary,
      };
    } catch (error) {
      throw new Error(
        `Failed to check ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check all documents for changes
   */
  async checkAllForChanges(): Promise<DeltaResult[]> {
    await this.init();
    const results: DeltaResult[] = [];
    const sources = this.getSources();

    for (const source of sources) {
      try {
        const result = await this.checkForChanges(source.url);
        results.push(result);
      } catch (error) {
        console.error(`Error checking ${source.url}:`, error);
      }
      await this.delay(100);
    }

    return results;
  }

  /**
   * Get cached content for a URL
   */
  async getCachedContent(url: string): Promise<string | null> {
    await this.init();
    const localPath = this.getLocalPath(url);

    try {
      return await readFile(localPath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Get metadata for a cached document
   */
  getMetadata(url: string): DocMetadata | undefined {
    return this.metadata.get(url);
  }

  /**
   * Get all cached document metadata
   */
  getAllMetadata(): DocMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get documents by category
   */
  getByCategory(category: DocCategory): DocMetadata[] {
    return this.getAllMetadata().filter((m) => m.category === category);
  }

  /**
   * Get documents by tag
   */
  getByTag(tag: string): DocMetadata[] {
    return this.getAllMetadata().filter((m) => m.tags.includes(tag));
  }

  /**
   * Get documents that have changed since last review
   */
  getChangedDocs(): DocMetadata[] {
    return this.getAllMetadata().filter((m) => m.lastChanged && m.lastChanged > m.firstCached);
  }

  /**
   * Generate a documentation index
   */
  async generateIndex(): Promise<DocsIndex> {
    await this.init();
    const documents: DocIndexEntry[] = [];
    const categories: Record<DocCategory, number> = {
      core: 0,
      development: 0,
      configuration: 0,
      integration: 0,
      reference: 0,
      enterprise: 0,
      ide: 0,
      cicd: 0,
      troubleshooting: 0,
    };

    for (const meta of this.metadata.values()) {
      documents.push({
        url: meta.url,
        title: meta.title,
        description: meta.description,
        category: meta.category,
        tags: meta.tags,
        lastFetched: meta.lastFetched,
        hasUnreviewedChanges: meta.lastChanged !== null && meta.version > 1,
      });
      categories[meta.category]++;
    }

    return {
      schemaVersion: '1.0.0',
      lastUpdated: new Date(),
      baseUrl: this.config.baseUrl,
      documents,
      categories,
    };
  }

  /**
   * Get cache status
   */
  async getCacheStatus(): Promise<CacheStatus> {
    await this.init();
    const allMeta = this.getAllMetadata();
    let cacheSizeBytes = 0;
    let oldestDoc: Date | null = null;
    let newestDoc: Date | null = null;

    for (const meta of allMeta) {
      try {
        const stats = await stat(meta.localPath);
        cacheSizeBytes += stats.size;

        if (!oldestDoc || meta.firstCached < oldestDoc) {
          oldestDoc = meta.firstCached;
        }
        if (!newestDoc || meta.lastFetched > newestDoc) {
          newestDoc = meta.lastFetched;
        }
      } catch {
        // File might not exist
      }
    }

    return {
      totalDocs: allMeta.length,
      docsWithChanges: this.getChangedDocs().length,
      lastFullUpdate: newestDoc,
      cacheSizeBytes,
      oldestDoc,
      newestDoc,
    };
  }

  /**
   * Clear the cache
   */
  async clearCache(): Promise<void> {
    await this.init();
    const contentDir = join(this.config.cacheDir, 'content');

    try {
      await rm(contentDir, { recursive: true, force: true });
      await this.ensureDir(contentDir);
      this.metadata.clear();
      await this.saveMetadata();
    } catch (error) {
      throw new Error(
        `Failed to clear cache: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Search cached docs by content
   */
  async searchContent(query: string): Promise<Array<{ url: string; matches: string[] }>> {
    await this.init();
    const results: Array<{ url: string; matches: string[] }> = [];
    const queryLower = query.toLowerCase();

    for (const meta of this.metadata.values()) {
      const content = await this.getCachedContent(meta.url);
      if (!content) continue;

      const lines = content.split('\n');
      const matches: string[] = [];

      for (const line of lines) {
        if (line.toLowerCase().includes(queryLower)) {
          matches.push(line.trim());
        }
      }

      if (matches.length > 0) {
        results.push({ url: meta.url, matches: matches.slice(0, 10) });
      }
    }

    return results;
  }

  // Private helper methods

  private async ensureDir(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private getLocalPath(url: string): string {
    const filename = `${url.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    return join(this.config.cacheDir, 'content', filename);
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private extractMetadata(content: string): { title: string; description: string } {
    const lines = content.split('\n');
    let title = 'Untitled';
    let description = '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ') && title === 'Untitled') {
        title = trimmed.slice(2).trim();
      } else if (trimmed.startsWith('> ') && !description) {
        description = trimmed.slice(2).trim();
      }
      if (title !== 'Untitled' && description) break;
    }

    return { title, description };
  }

  private async saveContent(url: string, content: string): Promise<void> {
    const localPath = this.getLocalPath(url);
    await this.ensureDir(dirname(localPath));
    await writeFile(localPath, content, 'utf-8');
  }

  private async loadMetadata(): Promise<void> {
    const metaPath = join(this.config.cacheDir, 'metadata.json');

    try {
      const data = await readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(data) as Array<[string, DocMetadata]>;

      for (const [key, value] of parsed) {
        // Convert date strings back to Date objects
        value.firstCached = new Date(value.firstCached);
        value.lastFetched = new Date(value.lastFetched);
        if (value.lastChanged) {
          value.lastChanged = new Date(value.lastChanged);
        }
        this.metadata.set(key, value);
      }
    } catch {
      // No existing metadata
    }
  }

  private async saveMetadata(): Promise<void> {
    const metaPath = join(this.config.cacheDir, 'metadata.json');
    const data = Array.from(this.metadata.entries());
    await writeFile(metaPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private computeDiff(oldContent: string, newContent: string): DiffSummary {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let linesAdded = 0;
    let linesRemoved = 0;

    for (const line of newLines) {
      if (!oldSet.has(line)) linesAdded++;
    }

    for (const line of oldLines) {
      if (!newSet.has(line)) linesRemoved++;
    }

    // Find changed sections (headings)
    const oldHeadings = oldLines.filter((l) => l.startsWith('#')).map((l) => l.trim());
    const newHeadings = newLines.filter((l) => l.startsWith('#')).map((l) => l.trim());
    const changedSections: string[] = [];

    for (const heading of newHeadings) {
      if (!oldHeadings.includes(heading)) {
        changedSections.push(heading);
      }
    }

    return {
      linesAdded,
      linesRemoved,
      linesModified: Math.min(linesAdded, linesRemoved),
      changedSections,
      summary: `+${linesAdded}/-${linesRemoved} lines${changedSections.length > 0 ? `, ${changedSections.length} new sections` : ''}`,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Delta History Methods

  private async loadDeltaHistory(): Promise<void> {
    const historyPath = join(this.config.cacheDir, 'delta-history.json');

    try {
      const data = await readFile(historyPath, 'utf-8');
      const parsed = JSON.parse(data) as DeltaHistory;

      // Convert date strings back to Date objects
      for (const delta of parsed.deltas) {
        delta.detectedAt = new Date(delta.detectedAt);
      }

      this.deltaHistory = parsed;
    } catch {
      // No existing history
      this.deltaHistory = { schemaVersion: '1.0.0', deltas: [] };
    }
  }

  private async saveDeltaHistory(): Promise<void> {
    const historyPath = join(this.config.cacheDir, 'delta-history.json');
    await writeFile(historyPath, JSON.stringify(this.deltaHistory, null, 2), 'utf-8');
  }

  private async recordDelta(delta: DeltaRecord): Promise<void> {
    this.deltaHistory.deltas.push(delta);
    await this.saveDeltaHistory();
  }

  /**
   * Get all recorded deltas
   */
  getDeltaHistory(): DeltaRecord[] {
    return [...this.deltaHistory.deltas];
  }

  /**
   * Get unreviewed deltas
   */
  getUnreviewedDeltas(): DeltaRecord[] {
    return this.deltaHistory.deltas.filter((d) => !d.reviewed);
  }

  /**
   * Get deltas for a specific document
   */
  getDeltasForDoc(url: string): DeltaRecord[] {
    return this.deltaHistory.deltas.filter((d) => d.url === url);
  }

  /**
   * Mark a delta as reviewed
   */
  async markDeltaReviewed(deltaId: string): Promise<boolean> {
    const delta = this.deltaHistory.deltas.find((d) => d.id === deltaId);
    if (delta) {
      delta.reviewed = true;
      await this.saveDeltaHistory();
      return true;
    }
    return false;
  }

  /**
   * Mark all deltas as reviewed
   */
  async markAllDeltasReviewed(): Promise<number> {
    let count = 0;
    for (const delta of this.deltaHistory.deltas) {
      if (!delta.reviewed) {
        delta.reviewed = true;
        count++;
      }
    }
    if (count > 0) {
      await this.saveDeltaHistory();
    }
    return count;
  }

  /**
   * Get delta statistics
   */
  getDeltaStats(): {
    total: number;
    unreviewed: number;
    byDocument: Map<string, number>;
    recentDeltas: DeltaRecord[];
  } {
    const byDocument = new Map<string, number>();
    for (const delta of this.deltaHistory.deltas) {
      const count = byDocument.get(delta.url) ?? 0;
      byDocument.set(delta.url, count + 1);
    }

    return {
      total: this.deltaHistory.deltas.length,
      unreviewed: this.deltaHistory.deltas.filter((d) => !d.reviewed).length,
      byDocument,
      recentDeltas: this.deltaHistory.deltas.slice(-10).reverse(),
    };
  }
}
