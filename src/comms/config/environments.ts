/**
 * Tapestry Environment Configuration
 *
 * Multi-environment loader for SignalDB projects:
 * - dev: Local development, throwaway data
 * - test: UAT, CI/CD integration tests
 * - live: Production agent communication
 */

import { hostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SignalDBClientConfig } from '../client/signaldb';
import type { DaemonConfig } from '../daemon/types';

// ============================================================================
// Types
// ============================================================================

/**
 * Tapestry environment name.
 */
export type TapestryEnvironment = 'dev' | 'test' | 'live';

/**
 * Environment-specific configuration.
 */
export interface EnvironmentConfig {
  /** Environment name */
  name: TapestryEnvironment;
  /** SignalDB API URL */
  apiUrl: string;
  /** SignalDB project API key */
  projectKey: string;
  /** Machine identifier */
  machineId: string;
  /** Whether SSE is enabled */
  sseEnabled: boolean;
  /** Whether audit logging is enabled */
  auditEnabled: boolean;
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs: number;
  /** Rate limits */
  rateLimits: {
    messagesPerMinute: number;
    channelsPerMinute: number;
    pastesPerMinute: number;
  };
}

/**
 * All loaded environments.
 */
export interface TapestryConfig {
  dev?: EnvironmentConfig;
  test?: EnvironmentConfig;
  live?: EnvironmentConfig;
  /** Current active environment */
  current: TapestryEnvironment;
}

/**
 * Error thrown when environment configuration is missing or invalid.
 */
export class EnvironmentConfigError extends Error {
  constructor(
    message: string,
    public readonly environment?: TapestryEnvironment,
    public readonly missingKeys?: string[],
  ) {
    super(message);
    this.name = 'EnvironmentConfigError';
  }
}

// ============================================================================
// Environment Loading
// ============================================================================

/**
 * Load environment variables from a .env file into process.env.
 * Does not override existing environment variables.
 */
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim();
    let value = trimmed.substring(equalIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Don't override existing env vars
    if (process.env[key] === undefined && value !== '') {
      process.env[key] = value;
    }
  }
}

/**
 * Get a required environment variable.
 */
function getRequired(key: string, env: TapestryEnvironment): string {
  const value = process.env[key];
  if (!value) {
    throw new EnvironmentConfigError(
      `Missing required environment variable: ${key}`,
      env,
      [key],
    );
  }
  return value;
}

/**
 * Get an optional environment variable with a default value.
 */
function getOptional(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Get an optional boolean environment variable.
 */
function getOptionalBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get an optional integer environment variable.
 */
function getOptionalInt(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Load configuration for a specific environment.
 * Returns undefined if the environment is not configured.
 */
function loadEnvironmentConfig(env: TapestryEnvironment): EnvironmentConfig | undefined {
  const prefix = `TAPESTRY_${env.toUpperCase()}_`;
  const apiUrl = process.env[`${prefix}API_URL`];
  const projectKey = process.env[`${prefix}PROJECT_KEY`];

  // Skip if not configured
  if (!apiUrl || !projectKey) {
    return undefined;
  }

  const machineId = getOptional('TAPESTRY_MACHINE_ID', hostname());
  const defaultAuditEnabled = env !== 'live';

  return {
    name: env,
    apiUrl,
    projectKey,
    machineId,
    sseEnabled: getOptionalBool('TAPESTRY_SSE_ENABLED', true),
    auditEnabled: getOptionalBool('TAPESTRY_AUDIT_ENABLED', defaultAuditEnabled),
    heartbeatIntervalMs: getOptionalInt('TAPESTRY_HEARTBEAT_INTERVAL_MS', 10_000),
    rateLimits: {
      messagesPerMinute: getOptionalInt('TAPESTRY_RATE_LIMIT_MESSAGES', 60),
      channelsPerMinute: getOptionalInt('TAPESTRY_RATE_LIMIT_CHANNELS', 10),
      pastesPerMinute: getOptionalInt('TAPESTRY_RATE_LIMIT_PASTES', 30),
    },
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Load Tapestry configuration from environment variables.
 *
 * Searches for .env.tapestry files in:
 * 1. Current working directory
 * 2. Project root (if different from cwd)
 * 3. Home directory
 *
 * @param defaultEnv The default environment to use
 * @returns Loaded configuration
 *
 * @example
 * ```typescript
 * const config = loadTapestryConfig('dev');
 * const client = new SignalDBClient(config.dev!);
 * ```
 */
export function loadTapestryConfig(defaultEnv: TapestryEnvironment = 'dev'): TapestryConfig {
  // Load .env.tapestry files
  const searchPaths = [
    join(process.cwd(), '.env.tapestry'),
    join(process.env.HOME || '', '.env.tapestry'),
  ];

  for (const path of searchPaths) {
    loadEnvFile(path);
  }

  // Also load from .env if present (for CI/CD where secrets are injected)
  loadEnvFile(join(process.cwd(), '.env'));

  return {
    dev: loadEnvironmentConfig('dev'),
    test: loadEnvironmentConfig('test'),
    live: loadEnvironmentConfig('live'),
    current: (process.env.TAPESTRY_ENV as TapestryEnvironment) || defaultEnv,
  };
}

/**
 * Get configuration for a specific environment.
 *
 * @param env Environment name
 * @param config Optional pre-loaded config
 * @returns Environment configuration
 * @throws EnvironmentConfigError if environment is not configured
 *
 * @example
 * ```typescript
 * const devConfig = getEnvironmentConfig('dev');
 * const client = new SignalDBClient(devConfig);
 * ```
 */
export function getEnvironmentConfig(
  env: TapestryEnvironment,
  config?: TapestryConfig,
): EnvironmentConfig {
  const tapestryConfig = config || loadTapestryConfig(env);
  const envConfig = tapestryConfig[env];

  if (!envConfig) {
    const prefix = `TAPESTRY_${env.toUpperCase()}_`;
    throw new EnvironmentConfigError(
      `Environment '${env}' is not configured. Set ${prefix}API_URL and ${prefix}PROJECT_KEY.`,
      env,
      [`${prefix}API_URL`, `${prefix}PROJECT_KEY`],
    );
  }

  return envConfig;
}

/**
 * Get the currently active environment configuration.
 *
 * @param config Optional pre-loaded config
 * @returns Current environment configuration
 */
export function getCurrentEnvironmentConfig(config?: TapestryConfig): EnvironmentConfig {
  const tapestryConfig = config || loadTapestryConfig();
  return getEnvironmentConfig(tapestryConfig.current, tapestryConfig);
}

/**
 * Convert environment config to SignalDB client config.
 */
export function toSignalDBConfig(envConfig: EnvironmentConfig): SignalDBClientConfig {
  return {
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  };
}

/**
 * Convert environment config to daemon config.
 */
export function toDaemonConfig(envConfig: EnvironmentConfig): DaemonConfig {
  return {
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
    machineId: envConfig.machineId,
    heartbeatIntervalMs: envConfig.heartbeatIntervalMs,
    sse: {
      endpoint: '/v1/messages/stream',
      lastEventId: null,
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 30_000,
      reconnectMultiplier: 2,
    },
  };
}

/**
 * List all configured environments.
 */
export function listConfiguredEnvironments(config?: TapestryConfig): TapestryEnvironment[] {
  const tapestryConfig = config || loadTapestryConfig();
  const envs: TapestryEnvironment[] = [];

  if (tapestryConfig.dev) envs.push('dev');
  if (tapestryConfig.test) envs.push('test');
  if (tapestryConfig.live) envs.push('live');

  return envs;
}

/**
 * Validate that all required environments are configured.
 *
 * @param requiredEnvs Environments that must be configured
 * @param config Optional pre-loaded config
 * @returns Validation result
 */
export function validateEnvironments(
  requiredEnvs: TapestryEnvironment[],
  config?: TapestryConfig,
): { valid: boolean; missing: TapestryEnvironment[] } {
  const tapestryConfig = config || loadTapestryConfig();
  const configured = listConfiguredEnvironments(tapestryConfig);
  const missing = requiredEnvs.filter(env => !configured.includes(env));

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Environment display info for CLI output.
 */
export interface EnvironmentInfo {
  name: TapestryEnvironment;
  apiUrl: string;
  machineId: string;
  configured: boolean;
  isCurrent: boolean;
}

/**
 * Get display info for all environments.
 */
export function getEnvironmentInfo(config?: TapestryConfig): EnvironmentInfo[] {
  const tapestryConfig = config || loadTapestryConfig();
  const envs: TapestryEnvironment[] = ['dev', 'test', 'live'];

  return envs.map(name => {
    const envConfig = tapestryConfig[name];
    return {
      name,
      apiUrl: envConfig?.apiUrl || '(not configured)',
      machineId: envConfig?.machineId || '(not configured)',
      configured: !!envConfig,
      isCurrent: name === tapestryConfig.current,
    };
  });
}
