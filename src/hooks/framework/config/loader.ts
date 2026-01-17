/**
 * YAML Configuration Loader
 *
 * Loads and parses YAML configuration files for the hook framework.
 * Supports environment variable substitution and includes.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FrameworkSettings, ResolvedConfig, ResolvedHandlerConfig, YamlConfig } from './types';
import { validateConfig } from './validator';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG_PATHS = [
  './hooks.yaml',
  './hooks.yml',
  './.claude/hooks.yaml',
  './.claude/hooks.yml',
];

const DEFAULT_SETTINGS: Required<FrameworkSettings> = {
  debug: false,
  parallelExecution: true,
  defaultTimeoutMs: 30000,
  defaultErrorStrategy: 'continue',
};

// ============================================================================
// Loader Functions
// ============================================================================

/**
 * Load configuration from a YAML file
 *
 * @param configPath - Path to the config file (optional, will search default paths)
 * @returns Parsed YAML configuration
 * @throws Error if config file not found or invalid YAML
 */
export function loadConfigFile(configPath?: string): YamlConfig {
  const resolvedPath = resolveConfigPath(configPath);

  if (!resolvedPath) {
    throw new Error(
      configPath
        ? `Config file not found: ${configPath}`
        : `No config file found. Searched: ${DEFAULT_CONFIG_PATHS.join(', ')}`
    );
  }

  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const config = parseYamlContent(content, resolvedPath);

  return config;
}

/**
 * Load and validate configuration from a YAML file
 *
 * @param configPath - Path to the config file (optional)
 * @returns Validated YAML configuration
 * @throws Error if config is invalid
 */
export function loadConfig(configPath?: string): YamlConfig {
  const config = loadConfigFile(configPath);
  const validation = validateConfig(config);

  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `  - ${e.path}: ${e.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${errorMessages}`);
  }

  // Log warnings if debug mode
  if (config.settings?.debug && validation.warnings.length > 0) {
    const warningMessages = validation.warnings
      .map((w) => `  - ${w.path}: ${w.message}`)
      .join('\n');
    console.error(`[Config] Warnings:\n${warningMessages}`);
  }

  return config;
}

/**
 * Load, validate, and resolve configuration with defaults
 *
 * @param configPath - Path to the config file (optional)
 * @returns Fully resolved configuration
 */
export function loadResolvedConfig(configPath?: string): ResolvedConfig {
  const config = loadConfig(configPath);
  return resolveConfig(config);
}

/**
 * Resolve a YAML config to a fully populated config with defaults
 */
export function resolveConfig(config: YamlConfig): ResolvedConfig {
  const settings: Required<FrameworkSettings> = {
    ...DEFAULT_SETTINGS,
    ...config.settings,
  };

  const handlers: ResolvedHandlerConfig[] = [];

  // Process built-in handlers
  if (config.builtins) {
    const builtinDefaults: Record<string, { priority: number; events: string[] }> = {
      'metrics': { priority: 1, events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'SessionEnd', 'PreCompact'] },
      'turn-tracker': { priority: 5, events: ['SessionStart', 'Stop', 'SubagentStop', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] },
      'session-naming': { priority: 10, events: ['SessionStart'] },
      'dangerous-command-guard': { priority: 20, events: ['PreToolUse'] },
      'context-injection': { priority: 30, events: ['SessionStart', 'PreCompact'] },
      'tool-logger': { priority: 100, events: ['PostToolUse'] },
      'debug-logger': { priority: 999, events: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop', 'SessionEnd', 'PreCompact'] },
    };

    for (const [name, handlerConfig] of Object.entries(config.builtins)) {
      if (!handlerConfig) continue;

      const defaults = builtinDefaults[name] || { priority: 100, events: [] };

      handlers.push({
        id: name,
        type: name as import('./types').BuiltinHandlerType,
        enabled: handlerConfig.enabled ?? true,
        priority: handlerConfig.priority ?? defaults.priority,
        events: (handlerConfig.events ?? defaults.events) as import('../framework').HookEventType[],
        after: handlerConfig.after ?? [],
        onError: handlerConfig.onError ?? settings.defaultErrorStrategy,
        timeoutMs: handlerConfig.timeoutMs ?? settings.defaultTimeoutMs,
        options: (handlerConfig.options ?? {}) as Record<string, unknown>,
      });
    }
  }

  // Process custom handlers
  if (config.handlers) {
    for (const [name, handlerConfig] of Object.entries(config.handlers)) {
      if (!handlerConfig) continue;

      handlers.push({
        id: name,
        type: 'custom',
        enabled: handlerConfig.enabled ?? true,
        priority: handlerConfig.priority ?? 100,
        events: (handlerConfig.events ?? []) as import('../framework').HookEventType[],
        after: handlerConfig.after ?? [],
        onError: handlerConfig.onError ?? settings.defaultErrorStrategy,
        timeoutMs: handlerConfig.timeoutMs ?? settings.defaultTimeoutMs,
        options: (handlerConfig.options ?? {}) as Record<string, unknown>,
        command: handlerConfig.command,
      });
    }
  }

  // Sort handlers by priority
  handlers.sort((a, b) => a.priority - b.priority);

  return {
    version: config.version,
    settings,
    handlers,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve config path, checking default paths if not specified
 */
function resolveConfigPath(configPath?: string): string | null {
  if (configPath) {
    const resolved = path.resolve(configPath);
    return fs.existsSync(resolved) ? resolved : null;
  }

  for (const defaultPath of DEFAULT_CONFIG_PATHS) {
    const resolved = path.resolve(defaultPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

/**
 * Parse YAML content with environment variable substitution
 */
function parseYamlContent(content: string, filePath: string): YamlConfig {
  // Substitute environment variables (${VAR} or ${VAR:-default})
  const substituted = content.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const [varName, defaultValue] = expr.split(':-');
    return process.env[varName.trim()] ?? defaultValue?.trim() ?? '';
  });

  try {
    const parsed = parseYaml(substituted) as YamlConfig;

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Config file must contain a YAML object');
    }

    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse YAML at ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if a config file exists at the given path or default locations
 */
export function configExists(configPath?: string): boolean {
  return resolveConfigPath(configPath) !== null;
}

/**
 * Get the resolved path to the config file
 */
export function getConfigPath(configPath?: string): string | null {
  return resolveConfigPath(configPath);
}

/**
 * Create a default configuration object
 */
export function createDefaultConfig(): YamlConfig {
  return {
    version: 1,
    settings: {
      debug: false,
      parallelExecution: true,
      defaultTimeoutMs: 30000,
      defaultErrorStrategy: 'continue',
    },
    builtins: {
      'session-naming': {
        enabled: true,
        options: {
          format: 'adjective-animal',
        },
      },
      'dangerous-command-guard': {
        enabled: true,
        options: {
          blockedPatterns: [],
          strict: false,
        },
      },
      'context-injection': {
        enabled: false,
      },
      'tool-logger': {
        enabled: false,
      },
    },
    handlers: {},
  };
}
