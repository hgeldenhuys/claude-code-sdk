/**
 * Change Tracker Module
 *
 * Tracks and monitors changes to Claude Code releases and provides
 * utilities to compare versions and identify breaking changes.
 */

import type { ChangeCategory, ChangeFilter, ClaudeCodeChange } from '../types/index.ts';

export interface TrackerConfig {
  cacheDir?: string;
  updateInterval?: number; // hours
  sourceUrls?: string[];
}

export class ChangeTracker {
  private config: TrackerConfig;
  private changes: ClaudeCodeChange[] = [];
  private lastUpdated: Date | null = null;

  constructor(config: TrackerConfig = {}) {
    this.config = {
      cacheDir: config.cacheDir ?? '.claude-code-sdk/cache',
      updateInterval: config.updateInterval ?? 24,
      sourceUrls: config.sourceUrls ?? [],
    };
  }

  /**
   * Fetch the latest changes from configured sources
   */
  async fetchChanges(): Promise<ClaudeCodeChange[]> {
    // TODO: Implement fetching from GitHub releases, changelog, etc.
    this.lastUpdated = new Date();
    return this.changes;
  }

  /**
   * Get all tracked changes, optionally filtered
   */
  getChanges(filter?: ChangeFilter): ClaudeCodeChange[] {
    let filtered = [...this.changes];

    if (filter?.category?.length) {
      filtered = filtered.filter((c) => filter.category!.includes(c.category));
    }

    if (filter?.breakingOnly) {
      filtered = filtered.filter((c) => c.breakingChange);
    }

    if (filter?.component) {
      filtered = filtered.filter((c) => c.affectedComponents.includes(filter.component!));
    }

    if (filter?.fromVersion) {
      filtered = filtered.filter((c) => this.compareVersions(c.version, filter.fromVersion!) >= 0);
    }

    if (filter?.toVersion) {
      filtered = filtered.filter((c) => this.compareVersions(c.version, filter.toVersion!) <= 0);
    }

    return filtered;
  }

  /**
   * Get breaking changes between two versions
   */
  getBreakingChanges(fromVersion: string, toVersion: string): ClaudeCodeChange[] {
    return this.getChanges({
      fromVersion,
      toVersion,
      breakingOnly: true,
    });
  }

  /**
   * Check if there are any breaking changes since a specific version
   */
  hasBreakingChangesSince(version: string): boolean {
    return this.getChanges({ fromVersion: version, breakingOnly: true }).length > 0;
  }

  /**
   * Get migration guide for upgrading between versions
   */
  getMigrationGuide(fromVersion: string, toVersion: string): string[] {
    const breakingChanges = this.getBreakingChanges(fromVersion, toVersion);
    return breakingChanges.filter((c) => c.migrationGuide).map((c) => c.migrationGuide!);
  }

  /**
   * Compare two semver versions
   * Returns: -1 if a < b, 0 if a == b, 1 if a > b
   */
  private compareVersions(a: string, b: string): number {
    const partsA = a.replace(/^v/, '').split('.').map(Number);
    const partsB = b.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numA < numB) return -1;
      if (numA > numB) return 1;
    }
    return 0;
  }

  /**
   * Get the last time changes were fetched
   */
  getLastUpdated(): Date | null {
    return this.lastUpdated;
  }

  /**
   * Check if cache needs refresh
   */
  needsRefresh(): boolean {
    if (!this.lastUpdated) return true;
    const hoursElapsed = (Date.now() - this.lastUpdated.getTime()) / (1000 * 60 * 60);
    return hoursElapsed >= (this.config.updateInterval ?? 24);
  }
}

export * from '../types/index.ts';
