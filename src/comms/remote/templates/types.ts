/**
 * Command Template Types
 *
 * Interfaces for parameterized command templates that generate
 * shell commands for common remote administration tasks.
 */

// ============================================================================
// Template Interface
// ============================================================================

/**
 * A reusable command template that generates shell commands from parameters.
 */
export interface CommandTemplate {
  /** Template name matching RemoteCommandType */
  name: string;
  /** Human-readable description */
  description: string;
  /** Build the shell command string from parameters */
  buildCommand(params: Record<string, unknown>): string;
  /** Validate parameters, throw Error if invalid */
  validateParams(params: Record<string, unknown>): void;
}

// ============================================================================
// Parameter Types
// ============================================================================

/**
 * Parameters for deploy commands.
 */
export interface DeployParams {
  /** Application name (required) */
  app: string;
  /** Git branch to deploy (default: 'main') */
  branch?: string;
  /** Build command override */
  buildCmd?: string;
  /** Deployment directory (default: '/app') */
  deployDir?: string;
}

/**
 * Parameters for status check commands.
 */
export interface StatusParams {
  /** Application name (required) */
  app: string;
  /** Health check port (default: 3000) */
  port?: number;
  /** Log file path (default: '/var/log/app.log') */
  logPath?: string;
  /** Number of log lines to tail (default: 50) */
  logLines?: number;
}

/**
 * Parameters for config update commands.
 */
export interface ConfigParams {
  /** Environment variables to set (required, at least one) */
  envVars: Record<string, string>;
  /** Application to restart after config change */
  app?: string;
  /** Whether to restart the app after setting env vars */
  restart?: boolean;
}

/**
 * Parameters for diagnostic commands.
 */
export interface DiagnosticParams {
  /** Diagnostic checks to run (required, at least one) */
  checks: ('disk' | 'memory' | 'processes' | 'storage')[];
  /** Paths for storage check */
  paths?: string[];
}

/**
 * Parameters for restart commands.
 */
export interface RestartParams {
  /** Application name (required) */
  app: string;
  /** Process manager type (required) */
  manager: 'pm2' | 'systemd';
}
