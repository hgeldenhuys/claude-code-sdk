/**
 * Claude Code SDK
 *
 * An SDK for tracking Claude Code changes, extending components,
 * and managing a plugin marketplace for Claude Code development.
 */

export { ChangeTracker, type TrackerConfig } from './tracker/index.ts';
export { Marketplace, type MarketplaceConfig } from './marketplace/index.ts';
export { PluginManager, type PluginManagerConfig } from './plugins/index.ts';
export { DocsTracker } from './docs/index.ts';
export * from './docs/types.ts';
export * from './types/index.ts';
export * from './utils/index.ts';
export * from './transcripts/index.ts';

import { DocsTracker } from './docs/index.ts';
import type { DocsTrackerConfig } from './docs/types.ts';
import { Marketplace, type MarketplaceConfig } from './marketplace/index.ts';
import { PluginManager, type PluginManagerConfig } from './plugins/index.ts';
import { ChangeTracker, type TrackerConfig } from './tracker/index.ts';
import type { SDKConfig } from './types/index.ts';

/**
 * Main SDK class that provides unified access to all functionality
 */
export class ClaudeCodeSDK {
  readonly tracker: ChangeTracker;
  readonly marketplace: Marketplace;
  readonly plugins: PluginManager;
  readonly docs: DocsTracker;

  private config: SDKConfig;

  constructor(config: SDKConfig = {}) {
    this.config = {
      marketplaceUrl: config.marketplaceUrl ?? 'https://marketplace.claude-code.dev',
      pluginsDir: config.pluginsDir ?? '.claude/plugins',
      cacheDir: config.cacheDir ?? '.claude/sdk-cache',
      autoUpdate: config.autoUpdate ?? true,
      telemetry: config.telemetry ?? false,
    };

    const trackerConfig: TrackerConfig = {
      cacheDir: this.config.cacheDir,
    };

    const marketplaceConfig: MarketplaceConfig = {
      apiUrl: `${this.config.marketplaceUrl}/api`,
      cacheDir: this.config.cacheDir,
    };

    const pluginsConfig: PluginManagerConfig = {
      pluginsDir: this.config.pluginsDir,
      autoLoad: true,
    };

    const docsConfig: DocsTrackerConfig = {
      cacheDir: `${this.config.cacheDir}/docs`,
      baseUrl: 'https://code.claude.com/docs/en',
      checkInterval: 24,
      autoFetch: false,
      fetchTimeout: 30000,
    };

    this.tracker = new ChangeTracker(trackerConfig);
    this.marketplace = new Marketplace(marketplaceConfig);
    this.plugins = new PluginManager(pluginsConfig);
    this.docs = new DocsTracker(docsConfig);
  }

  /**
   * Initialize the SDK - loads plugins, docs tracker, and checks for updates
   */
  async init(): Promise<void> {
    await this.plugins.loadAll();
    await this.docs.init();

    if (this.config.autoUpdate) {
      await this.checkForUpdates();
    }
  }

  /**
   * Check for updates to Claude Code and installed plugins
   */
  async checkForUpdates(): Promise<{
    claudeCodeChanges: number;
    pluginUpdates: Map<string, string>;
  }> {
    const changes = await this.tracker.fetchChanges();
    const pluginUpdates = await this.marketplace.checkUpdates(this.plugins.getAll());

    return {
      claudeCodeChanges: changes.length,
      pluginUpdates,
    };
  }

  /**
   * Get SDK version
   */
  getVersion(): string {
    return '0.1.0';
  }

  /**
   * Get current configuration
   */
  getConfig(): SDKConfig {
    return { ...this.config };
  }
}

// Default export for convenience
export default ClaudeCodeSDK;
