/**
 * UAT Test Setup
 *
 * Environment setup and validation for COMMS UAT testing.
 * Ensures SignalDB environments are properly configured and accessible.
 */

import { SignalDBClient, SignalDBError } from '../../src/comms/client/signaldb';
import {
  loadTapestryConfig,
  getEnvironmentConfig,
  validateEnvironments,
  toSignalDBConfig,
  getEnvironmentInfo,
} from '../../src/comms/config/environments';
import type {
  TapestryEnvironment,
  TapestryConfig,
  EnvironmentConfig,
} from '../../src/comms/config/environments';

// Re-export types from config for convenience
export type { TapestryEnvironment, TapestryConfig, EnvironmentConfig };

// ============================================================================
// Types
// ============================================================================

export interface UATContext {
  /** Loaded Tapestry configuration */
  config: TapestryConfig;
  /** Active environment configuration */
  envConfig: EnvironmentConfig;
  /** SignalDB client for the active environment */
  client: SignalDBClient;
  /** Test run identifier */
  runId: string;
  /** Test agent prefix for cleanup */
  agentPrefix: string;
  /** Start timestamp */
  startedAt: Date;
}

export interface SetupResult {
  success: boolean;
  context?: UATContext;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ConnectivityResult {
  environment: TapestryEnvironment;
  apiUrl: string;
  reachable: boolean;
  latencyMs?: number;
  error?: string;
}

// ============================================================================
// Setup Functions
// ============================================================================

/**
 * Generate a unique test run ID.
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `uat-${timestamp}-${random}`;
}

/**
 * Initialize UAT context for a specific environment.
 *
 * @param env Target environment
 * @returns Setup result with context on success
 *
 * @example
 * ```typescript
 * const result = await setupUAT('dev');
 * if (result.success) {
 *   const { context } = result;
 *   // Run tests with context.client
 * }
 * ```
 */
export async function setupUAT(env: TapestryEnvironment): Promise<SetupResult> {
  try {
    // Load configuration
    const config = loadTapestryConfig(env);

    // Validate environment is configured
    const validation = validateEnvironments([env], config);
    if (!validation.valid) {
      return {
        success: false,
        error: `Environment '${env}' is not configured`,
        details: { missingEnvironments: validation.missing },
      };
    }

    // Get environment config
    const envConfig = getEnvironmentConfig(env, config);

    // Create client
    const client = new SignalDBClient(toSignalDBConfig(envConfig));

    // Verify connectivity
    const connectivity = await checkConnectivity(client, env, envConfig.apiUrl);
    if (!connectivity.reachable) {
      return {
        success: false,
        error: `Cannot reach SignalDB at ${envConfig.apiUrl}`,
        details: { connectivity },
      };
    }

    // Generate test identifiers
    const runId = generateRunId();
    const agentPrefix = `uat-agent-${runId}`;

    const context: UATContext = {
      config,
      envConfig,
      client,
      runId,
      agentPrefix,
      startedAt: new Date(),
    };

    return { success: true, context };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check connectivity to a SignalDB environment.
 */
export async function checkConnectivity(
  client: SignalDBClient,
  env: TapestryEnvironment,
  apiUrl: string,
): Promise<ConnectivityResult> {
  const start = Date.now();

  try {
    // Try to list agents (lightweight operation, no filters for compatibility)
    await client.agents.list();

    return {
      environment: env,
      apiUrl,
      reachable: true,
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      environment: env,
      apiUrl,
      reachable: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check connectivity to all configured environments.
 */
export async function checkAllConnectivity(): Promise<ConnectivityResult[]> {
  const config = loadTapestryConfig();
  const results: ConnectivityResult[] = [];

  const envs: TapestryEnvironment[] = ['dev', 'test', 'live'];

  for (const env of envs) {
    const envConfig = config[env];
    if (envConfig) {
      const client = new SignalDBClient(toSignalDBConfig(envConfig));
      const result = await checkConnectivity(client, env, envConfig.apiUrl);
      results.push(result);
    } else {
      results.push({
        environment: env,
        apiUrl: '(not configured)',
        reachable: false,
        error: 'Environment not configured',
      });
    }
  }

  return results;
}

// ============================================================================
// Cleanup Functions
// ============================================================================

/**
 * Cleanup test agents created during a UAT run.
 *
 * @param context UAT context
 * @returns Number of agents cleaned up
 */
export async function cleanupTestAgents(context: UATContext): Promise<number> {
  const agents = await context.client.agents.list();
  let cleaned = 0;

  for (const agent of agents) {
    // Check if this is a test agent from our run
    if (agent.sessionId?.startsWith(context.agentPrefix)) {
      try {
        await context.client.agents.deregister(agent.id);
        cleaned++;
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return cleaned;
}

/**
 * Cleanup all test resources created during a UAT run.
 *
 * @param context UAT context
 */
export async function cleanupAll(context: UATContext): Promise<{
  agents: number;
  channels: number;
  messages: number;
  pastes: number;
}> {
  const stats = { agents: 0, channels: 0, messages: 0, pastes: 0 };

  // Cleanup test agents
  stats.agents = await cleanupTestAgents(context);

  // Note: Channels, messages, and pastes cleanup would require additional
  // metadata tracking or server-side cleanup APIs

  return stats;
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a unique test agent ID for a UAT run.
 */
export function createTestAgentId(context: UATContext, suffix: string): string {
  return `${context.agentPrefix}-${suffix}`;
}

/**
 * Create a unique test channel name for a UAT run.
 */
export function createTestChannelName(context: UATContext, suffix: string): string {
  return `uat-channel-${context.runId}-${suffix}`;
}

/**
 * Wait for a condition with timeout.
 */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs: number = 5000,
  intervalMs: number = 100,
): Promise<T | null> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return null;
}

/**
 * Sleep for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Assertions
// ============================================================================

export class UATAssertionError extends Error {
  constructor(
    message: string,
    public readonly expected?: unknown,
    public readonly actual?: unknown,
  ) {
    super(message);
    this.name = 'UATAssertionError';
  }
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  if (actual !== expected) {
    throw new UATAssertionError(
      message || `Expected ${expected} but got ${actual}`,
      expected,
      actual,
    );
  }
}

export function assertDefined<T>(value: T | null | undefined, message?: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new UATAssertionError(message || 'Expected value to be defined');
  }
}

export function assertTrue(value: boolean, message?: string): void {
  if (!value) {
    throw new UATAssertionError(message || 'Expected true but got false');
  }
}

export function assertFalse(value: boolean, message?: string): void {
  if (value) {
    throw new UATAssertionError(message || 'Expected false but got true');
  }
}

export function assertThrows(fn: () => void, message?: string): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new UATAssertionError(message || 'Expected function to throw');
  }
}

export async function assertThrowsAsync(
  fn: () => Promise<unknown>,
  message?: string,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new UATAssertionError(message || 'Expected async function to throw');
  }
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Format environment info for CLI display.
 */
export function formatEnvironmentTable(): string {
  const info = getEnvironmentInfo();
  const lines: string[] = [];

  lines.push('Tapestry Environments:');
  lines.push('─'.repeat(70));
  lines.push('  Env      │ Status       │ API URL');
  lines.push('─'.repeat(70));

  for (const env of info) {
    const status = env.configured
      ? (env.isCurrent ? 'Active' : 'Ready')
      : 'Not configured';
    const statusColor = env.configured ? (env.isCurrent ? '●' : '○') : '✗';
    lines.push(`  ${env.name.padEnd(8)} │ ${statusColor} ${status.padEnd(10)} │ ${env.apiUrl}`);
  }

  lines.push('─'.repeat(70));
  return lines.join('\n');
}

/**
 * Format connectivity results for CLI display.
 */
export function formatConnectivityResults(results: ConnectivityResult[]): string {
  const lines: string[] = [];

  lines.push('Connectivity Check:');
  lines.push('─'.repeat(60));

  for (const result of results) {
    const status = result.reachable ? '✓' : '✗';
    const latency = result.latencyMs !== undefined ? `${result.latencyMs}ms` : 'N/A';
    const error = result.error ? ` (${result.error})` : '';
    lines.push(`  ${status} ${result.environment.padEnd(6)} │ ${latency.padEnd(8)} │ ${result.apiUrl}${error}`);
  }

  lines.push('─'.repeat(60));
  return lines.join('\n');
}
