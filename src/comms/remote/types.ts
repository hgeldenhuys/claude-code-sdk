/**
 * Remote Administration Types
 *
 * Core types for remote command execution, receipt tracking,
 * and configuration of the remote administration module.
 */

import type { SignalDBClient } from '../client/signaldb';
import type { SecurityMiddleware } from '../security/middleware';
import type { SecurityConfig } from '../security/types';

// ============================================================================
// Command Types
// ============================================================================

/**
 * Types of remote commands that can be executed.
 * - deploy: application deployment workflow
 * - status: health/status check
 * - config-update: environment variable updates
 * - diagnostic: system diagnostics (disk, memory, etc.)
 * - restart: application restart via pm2 or launchd (macOS)
 * - raw: arbitrary shell command
 */
export type RemoteCommandType =
  | 'deploy'
  | 'status'
  | 'config-update'
  | 'diagnostic'
  | 'restart'
  | 'raw';

/**
 * Lifecycle status of a command execution receipt.
 * Follows a state machine: command_sent -> acknowledged -> executing -> completed | failed
 * (fail can also transition from command_sent or acknowledged)
 */
export type ReceiptStatus = 'command_sent' | 'acknowledged' | 'executing' | 'completed' | 'failed';

// ============================================================================
// Core Entities
// ============================================================================

/**
 * A remote command to be executed on a target agent.
 */
export interface RemoteCommand {
  /** Unique command identifier */
  id: string;
  /** Command type (deploy, status, etc.) */
  type: RemoteCommandType;
  /** Agent ID of the target executor */
  targetAgent: string;
  /** Channel through which the command is sent */
  channelId: string;
  /** The shell command payload */
  payload: string;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Arbitrary metadata attached to the command */
  metadata: Record<string, unknown>;
}

/**
 * Tracks the lifecycle of a remote command execution.
 */
export interface ExecutionReceipt {
  /** The command this receipt tracks */
  commandId: string;
  /** Agent that executes (or should execute) the command */
  targetAgent: string;
  /** Current lifecycle status */
  status: ReceiptStatus;
  /** When the command was sent */
  sentAt: string;
  /** When the target acknowledged receipt */
  acknowledgedAt: string | null;
  /** When execution began */
  executingAt: string | null;
  /** When execution completed successfully */
  completedAt: string | null;
  /** When execution failed */
  failedAt: string | null;
  /** Standard output from the command */
  output: string | null;
  /** Standard error from the command */
  stderr: string | null;
  /** Process exit code */
  exitCode: number | null;
  /** Error message if failed */
  error: string | null;
  /** Name of the command template used (null for raw commands) */
  templateName: string | null;
  /** Arbitrary metadata */
  metadata: Record<string, unknown>;
}

/**
 * Result of a command execution on the receiver side.
 */
export interface CommandResult {
  /** Whether execution succeeded (exit code 0) */
  success: boolean;
  /** Standard output */
  output: string;
  /** Standard error */
  stderr: string;
  /** Process exit code */
  exitCode: number;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Error message if execution failed */
  error: string | null;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the remote administration module.
 */
export interface RemoteConfig {
  /** SignalDB API base URL */
  apiUrl: string;
  /** SignalDB project API key */
  projectKey: string;
  /** This agent's UUID */
  agentId: string;
  /** Channel ID used for command messaging */
  channelId: string;
  /** Optional security configuration (requires signalDBClient to build SecurityManager) */
  securityConfig?: SecurityConfig;
  /** Optional pre-built security middleware (takes precedence over securityConfig) */
  securityMiddleware?: SecurityMiddleware;
  /** Optional SignalDB client for SecurityManager audit logging */
  signalDBClient?: SignalDBClient;
  /** Default command timeout in ms (default: 300000 = 5 minutes) */
  defaultTimeout?: number;
}

// ============================================================================
// Filters and Callbacks
// ============================================================================

/**
 * Filter criteria for listing execution receipts.
 */
export interface ReceiptFilter {
  /** Filter by receipt status */
  status?: ReceiptStatus;
  /** Filter by target agent ID */
  targetAgent?: string;
  /** Filter by command template name */
  templateName?: string;
}

/**
 * Callback invoked on receipt status transitions.
 */
export type ReceiptCallback = (receipt: ExecutionReceipt) => void;

// ============================================================================
// Formatted Response
// ============================================================================

/**
 * Human-readable formatted response from a command execution.
 */
export interface FormattedResponse {
  /** Whether the command succeeded */
  success: boolean;
  /** Terminal status */
  status: 'completed' | 'failed';
  /** The command ID */
  commandId: string;
  /** Template name if used, null for raw commands */
  templateName: string | null;
  /** Timing information */
  timing: {
    sentAt: string;
    acknowledgedAt: string | null;
    executingAt: string | null;
    completedAt: string | null;
    totalDurationMs: number | null;
    executionDurationMs: number | null;
  };
  /** Truncated stdout (max 500 chars) */
  output: string | null;
  /** Truncated stderr (max 500 chars) */
  stderr: string | null;
  /** Process exit code */
  exitCode: number | null;
  /** Error message */
  error: string | null;
}
