/**
 * Core types for the Claude Code SDK
 */

// Plugin system types
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  type: PluginType;
  entryPoint: string;
  dependencies?: string[];
  config?: Record<string, unknown>;
}

export type PluginType = 'skill' | 'tool' | 'hook' | 'command' | 'mcp-server';

export interface PluginManifest {
  plugin: Plugin;
  installedAt: Date;
  enabled: boolean;
  source: PluginSource;
}

export type PluginSource =
  | { type: 'marketplace'; packageId: string }
  | { type: 'local'; path: string }
  | { type: 'git'; url: string; ref?: string };

// Marketplace types
export interface MarketplacePackage {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  downloads: number;
  rating: number;
  tags: string[];
  pluginType: PluginType;
  repository?: string;
  homepage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MarketplaceSearchOptions {
  query?: string;
  type?: PluginType;
  tags?: string[];
  sortBy?: 'downloads' | 'rating' | 'recent';
  page?: number;
  limit?: number;
}

// Change tracker types
export interface ClaudeCodeChange {
  id: string;
  version: string;
  date: Date;
  category: ChangeCategory;
  title: string;
  description: string;
  breakingChange: boolean;
  affectedComponents: string[];
  migrationGuide?: string;
}

export type ChangeCategory =
  | 'feature'
  | 'bugfix'
  | 'deprecation'
  | 'breaking'
  | 'security'
  | 'performance'
  | 'documentation';

export interface ChangeFilter {
  fromVersion?: string;
  toVersion?: string;
  category?: ChangeCategory[];
  breakingOnly?: boolean;
  component?: string;
}

// Hook types for extending Claude Code
export interface HookDefinition {
  name: string;
  event: HookEvent;
  handler: string;
  priority?: number;
  condition?: string;
}

export type HookEvent =
  | 'pre-tool-call'
  | 'post-tool-call'
  | 'pre-message'
  | 'post-message'
  | 'on-error'
  | 'on-init'
  | 'on-exit';

// Skill types
export interface SkillDefinition {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  tools?: string[];
  examples?: SkillExample[];
}

export interface SkillExample {
  input: string;
  expectedBehavior: string;
}

// Configuration types
export interface SDKConfig {
  marketplaceUrl?: string;
  pluginsDir?: string;
  cacheDir?: string;
  autoUpdate?: boolean;
  telemetry?: boolean;
}
