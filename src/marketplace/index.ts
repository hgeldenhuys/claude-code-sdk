/**
 * Marketplace Module
 *
 * Provides functionality to browse, search, install, and manage
 * plugins from the Claude Code plugin marketplace.
 */

import type {
  MarketplacePackage,
  MarketplaceSearchOptions,
  Plugin,
  PluginManifest,
  PluginSource,
  PluginType,
} from '../types/index.ts';

export interface MarketplaceConfig {
  apiUrl?: string;
  cacheDir?: string;
  timeout?: number;
}

export class Marketplace {
  private config: MarketplaceConfig;
  private cache: Map<string, MarketplacePackage> = new Map();

  constructor(config: MarketplaceConfig = {}) {
    this.config = {
      apiUrl: config.apiUrl ?? 'https://marketplace.claude-code.dev/api',
      cacheDir: config.cacheDir ?? '.claude-code-sdk/marketplace-cache',
      timeout: config.timeout ?? 30000,
    };
  }

  /**
   * Search for packages in the marketplace
   */
  async search(options: MarketplaceSearchOptions = {}): Promise<MarketplacePackage[]> {
    const params = new URLSearchParams();
    if (options.query) params.set('q', options.query);
    if (options.type) params.set('type', options.type);
    if (options.tags?.length) params.set('tags', options.tags.join(','));
    if (options.sortBy) params.set('sort', options.sortBy);
    if (options.page) params.set('page', String(options.page));
    if (options.limit) params.set('limit', String(options.limit));

    // TODO: Implement actual API call
    // const response = await fetch(`${this.config.apiUrl}/packages?${params}`);
    return [];
  }

  /**
   * Get a specific package by ID
   */
  async getPackage(id: string): Promise<MarketplacePackage | null> {
    if (this.cache.has(id)) {
      return this.cache.get(id)!;
    }

    // TODO: Implement actual API call
    // const response = await fetch(`${this.config.apiUrl}/packages/${id}`);
    return null;
  }

  /**
   * Get featured/popular packages
   */
  async getFeatured(): Promise<MarketplacePackage[]> {
    return this.search({ sortBy: 'downloads', limit: 10 });
  }

  /**
   * Get packages by type
   */
  async getByType(type: PluginType): Promise<MarketplacePackage[]> {
    return this.search({ type });
  }

  /**
   * Download and install a package from the marketplace
   */
  async install(packageId: string, targetDir: string): Promise<PluginManifest> {
    const pkg = await this.getPackage(packageId);
    if (!pkg) {
      throw new Error(`Package not found: ${packageId}`);
    }

    // TODO: Implement download and extraction
    const plugin: Plugin = {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      type: pkg.pluginType,
      entryPoint: 'index.ts',
    };

    const manifest: PluginManifest = {
      plugin,
      installedAt: new Date(),
      enabled: true,
      source: { type: 'marketplace', packageId },
    };

    return manifest;
  }

  /**
   * Check for updates for installed packages
   */
  async checkUpdates(installedPackages: PluginManifest[]): Promise<Map<string, string>> {
    const updates = new Map<string, string>();

    for (const manifest of installedPackages) {
      if (manifest.source.type !== 'marketplace') continue;

      const latest = await this.getPackage(manifest.source.packageId);
      if (latest && this.isNewerVersion(manifest.plugin.version, latest.version)) {
        updates.set(manifest.plugin.id, latest.version);
      }
    }

    return updates;
  }

  /**
   * Check if version b is newer than version a
   */
  private isNewerVersion(a: string, b: string): boolean {
    const partsA = a.replace(/^v/, '').split('.').map(Number);
    const partsB = b.replace(/^v/, '').split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] ?? 0;
      const numB = partsB[i] ?? 0;
      if (numB > numA) return true;
      if (numB < numA) return false;
    }
    return false;
  }

  /**
   * Clear the local cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export * from '../types/index.ts';
