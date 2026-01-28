/**
 * CLI Bridge Types
 *
 * Shared type definitions for the unified comms CLI.
 */

// ============================================================================
// Command Interface
// ============================================================================

/**
 * A CLI subcommand that can be executed with arguments.
 */
export interface CLICommand {
  /** Subcommand name (e.g. "status", "send") */
  name: string;
  /** Short description for help text */
  description: string;
  /** Execute the subcommand with the given args */
  execute(args: string[]): Promise<void>;
}

// ============================================================================
// Environment Config
// ============================================================================

/**
 * Parsed and validated environment configuration.
 */
export interface EnvConfig {
  /** SignalDB API base URL */
  apiUrl: string;
  /** Project API key for authentication */
  projectKey: string;
  /** This agent's UUID in SignalDB */
  agentId: string;
}

/**
 * Partial env config that only requires apiUrl and projectKey.
 * Used by commands that don't need agentId (e.g. status, agents).
 */
export interface EnvConfigPartial {
  /** SignalDB API base URL */
  apiUrl: string;
  /** Project API key for authentication */
  projectKey: string;
}
