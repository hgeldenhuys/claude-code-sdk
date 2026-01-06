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

// Skill types (aligned with Claude Code 2.0.74)
export interface SkillDefinition {
  name: string;
  description: string;
  triggers: string[];
  instructions: string;
  allowedTools?: string[];  // Tools Claude can use without permission when skill is active
  model?: string;           // Model to use when skill is active (e.g., 'claude-sonnet-4-20250514')
  version?: string;         // Skill version for tracking
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

// Claude Code Settings types (aligned with 2.0.74 docs)
export interface ClaudeCodeSettings {
  permissions?: PermissionSettings;
  env?: Record<string, string>;
  hooks?: Record<string, HookConfig[]>;
  disableAllHooks?: boolean;
  allowManagedHooksOnly?: boolean;  // Enterprise: only allow managed/SDK hooks
  model?: string;
  enabledPlugins?: Record<string, boolean>;
  extraKnownMarketplaces?: Record<string, MarketplaceSource>;
  strictKnownMarketplaces?: MarketplaceSourceSpec[];  // Enterprise: allowlist of marketplaces
  attribution?: AttributionSettings;
  sandbox?: SandboxSettings;
}

export interface PermissionSettings {
  allow?: string[];
  ask?: string[];
  deny?: string[];
  additionalDirectories?: string[];
  defaultMode?: 'acceptEdits' | 'plan' | 'normal';
  disableBypassPermissionsMode?: 'disable';
}

export interface AttributionSettings {
  commit?: string;
  pr?: string;
}

export interface SandboxSettings {
  enabled?: boolean;
  autoAllowBashIfSandboxed?: boolean;
  excludedCommands?: string[];
  allowUnsandboxedCommands?: boolean;
  network?: {
    allowUnixSockets?: string[];
    allowLocalBinding?: boolean;
    httpProxyPort?: number;
    socksProxyPort?: number;
  };
  enableWeakerNestedSandbox?: boolean;
}

export interface MarketplaceSource {
  source: MarketplaceSourceSpec;
}

export type MarketplaceSourceSpec =
  | { source: 'github'; repo: string; ref?: string; path?: string }
  | { source: 'git'; url: string; ref?: string; path?: string }
  | { source: 'url'; url: string; headers?: Record<string, string> }
  | { source: 'npm'; package: string }
  | { source: 'file'; path: string }
  | { source: 'directory'; path: string };

export interface HookConfig {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HookCommand {
  type: 'command';
  command: string;
  timeout?: number;
}
