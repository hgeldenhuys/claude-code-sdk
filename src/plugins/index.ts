/**
 * Plugin Management Module
 *
 * Handles loading, enabling/disabling, and managing plugins
 * for Claude Code extensions.
 */

import type {
  HookDefinition,
  Plugin,
  PluginManifest,
  PluginSource,
  PluginType,
  SkillDefinition,
} from '../types/index.ts';

export interface PluginManagerConfig {
  pluginsDir?: string;
  autoLoad?: boolean;
  validateOnLoad?: boolean;
}

export class PluginManager {
  private config: PluginManagerConfig;
  private plugins: Map<string, PluginManifest> = new Map();
  private hooks: Map<string, HookDefinition[]> = new Map();

  constructor(config: PluginManagerConfig = {}) {
    this.config = {
      pluginsDir: config.pluginsDir ?? '.claude/plugins',
      autoLoad: config.autoLoad ?? true,
      validateOnLoad: config.validateOnLoad ?? true,
    };
  }

  /**
   * Load all plugins from the plugins directory
   */
  async loadAll(): Promise<PluginManifest[]> {
    // TODO: Implement directory scanning and loading
    return Array.from(this.plugins.values());
  }

  /**
   * Load a single plugin from a path
   */
  async loadPlugin(path: string): Promise<PluginManifest> {
    // TODO: Implement plugin loading from path
    throw new Error(`Not implemented: loadPlugin(${path})`);
  }

  /**
   * Install a plugin from a source
   */
  async install(source: PluginSource): Promise<PluginManifest> {
    switch (source.type) {
      case 'local':
        return this.installFromLocal(source.path);
      case 'git':
        return this.installFromGit(source.url, source.ref);
      case 'marketplace':
        throw new Error('Use Marketplace.install() for marketplace packages');
      default:
        throw new Error('Unknown source type');
    }
  }

  /**
   * Install from local path
   */
  private async installFromLocal(path: string): Promise<PluginManifest> {
    // TODO: Implement local installation
    throw new Error(`Not implemented: installFromLocal(${path})`);
  }

  /**
   * Install from git repository
   */
  private async installFromGit(url: string, ref?: string): Promise<PluginManifest> {
    // TODO: Implement git clone and installation
    throw new Error(`Not implemented: installFromGit(${url}, ${ref})`);
  }

  /**
   * Uninstall a plugin
   */
  async uninstall(pluginId: string): Promise<boolean> {
    const manifest = this.plugins.get(pluginId);
    if (!manifest) return false;

    // TODO: Implement cleanup
    this.plugins.delete(pluginId);
    return true;
  }

  /**
   * Enable a plugin
   */
  enable(pluginId: string): boolean {
    const manifest = this.plugins.get(pluginId);
    if (!manifest) return false;
    manifest.enabled = true;
    return true;
  }

  /**
   * Disable a plugin
   */
  disable(pluginId: string): boolean {
    const manifest = this.plugins.get(pluginId);
    if (!manifest) return false;
    manifest.enabled = false;
    return true;
  }

  /**
   * Get all installed plugins
   */
  getAll(): PluginManifest[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by type
   */
  getByType(type: PluginType): PluginManifest[] {
    return this.getAll().filter((m) => m.plugin.type === type);
  }

  /**
   * Get a specific plugin
   */
  get(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Check if a plugin is installed
   */
  isInstalled(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Check if a plugin is enabled
   */
  isEnabled(pluginId: string): boolean {
    const manifest = this.plugins.get(pluginId);
    return manifest?.enabled ?? false;
  }

  /**
   * Register a hook from a plugin
   */
  registerHook(pluginId: string, hook: HookDefinition): void {
    const event = hook.event;
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(hook);
    // Sort by priority
    this.hooks.get(event)!.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /**
   * Get all hooks for an event
   */
  getHooks(event: string): HookDefinition[] {
    return this.hooks.get(event) ?? [];
  }

  /**
   * Validate a plugin manifest
   */
  validate(plugin: Plugin): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!plugin.id) errors.push('Plugin ID is required');
    if (!plugin.name) errors.push('Plugin name is required');
    if (!plugin.version) errors.push('Plugin version is required');
    if (!plugin.type) errors.push('Plugin type is required');
    if (!plugin.entryPoint) errors.push('Plugin entry point is required');

    const validTypes: PluginType[] = ['skill', 'tool', 'hook', 'command', 'mcp-server'];
    if (plugin.type && !validTypes.includes(plugin.type)) {
      errors.push(`Invalid plugin type: ${plugin.type}`);
    }

    return { valid: errors.length === 0, errors };
  }
}

export * from '../types/index.ts';
