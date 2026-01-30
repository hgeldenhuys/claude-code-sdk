/**
 * Agent Daemon Types
 *
 * Configuration, state, and result types for the local agent daemon
 * that bridges Claude Code sessions to SignalDB.
 */

import type { Agent, Message } from '../protocol/types';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configuration for the agent daemon process.
 */
export interface DaemonConfig {
  /** SignalDB API base URL (e.g. "https://my-project.signaldb.live") */
  apiUrl: string;
  /** SignalDB project API key */
  projectKey: string;
  /** Unique machine identifier for this host */
  machineId: string;
  /** Heartbeat interval in milliseconds (default: 10000) */
  heartbeatIntervalMs: number;
  /** SSE connection configuration */
  sse: SSEConfig;
}

/**
 * Server-Sent Events connection configuration.
 */
export interface SSEConfig {
  /** SSE stream endpoint path (default: "/v1/messages/stream") */
  endpoint: string;
  /** Last received event ID for resumption */
  lastEventId: string | null;
  /** Initial reconnect delay in milliseconds (default: 1000) */
  reconnectBaseMs: number;
  /** Maximum reconnect delay in milliseconds (default: 30000) */
  reconnectMaxMs: number;
  /** Backoff multiplier (default: 2) */
  reconnectMultiplier: number;
}

// ============================================================================
// State
// ============================================================================

/**
 * Daemon lifecycle state.
 * - starting: initializing, discovering sessions
 * - running: actively processing messages and sending heartbeats
 * - stopping: graceful shutdown in progress
 * - stopped: fully stopped, no connections active
 * - error: encountered a fatal error
 */
export type DaemonState = 'starting' | 'running' | 'stopping' | 'stopped' | 'error';

// ============================================================================
// Session Discovery
// ============================================================================

/**
 * A locally-discovered Claude Code session on this machine.
 * Maps a local session to its SignalDB agent registration.
 */
export interface LocalSession {
  /** Claude Code session UUID */
  sessionId: string;
  /** Human-friendly session name (e.g. "jolly-squid") */
  sessionName: string | null;
  /** Absolute path to the project directory */
  projectPath: string;
  /** SignalDB agent ID after registration (null before registration) */
  agentId: string | null;
}

// ============================================================================
// Message Routing Results (Discriminated Union)
// ============================================================================

/**
 * Successful message route result.
 */
export interface MessageRouteSuccess {
  ok: true;
  /** The response content from the Claude session */
  response: string;
  /** The original message that was routed */
  messageId: string;
}

/**
 * Failed message route result.
 */
export interface MessageRouteFailure {
  ok: false;
  /** Error description */
  error: string;
  /** The original message that failed to route */
  messageId: string;
}

/**
 * Discriminated union result from routing a message to a local session.
 * Use the `ok` field to narrow the type.
 */
export type MessageRouteResult = MessageRouteSuccess | MessageRouteFailure;

// ============================================================================
// Logging
// ============================================================================

/**
 * Log level for the structured daemon logger.
 * Configured via COMMS_LOG_LEVEL environment variable.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// ============================================================================
// SSE Event Types
// ============================================================================

/**
 * A parsed Server-Sent Event from the SignalDB stream.
 */
export interface SSEEvent {
  /** Event ID for resumption (from "id:" field) */
  id: string | null;
  /** Event type (from "event:" field, defaults to "message") */
  event: string;
  /** Parsed data payload (from "data:" field) */
  data: unknown;
}

// ============================================================================
// Daemon Event Callbacks
// ============================================================================

/**
 * Callback signatures for daemon lifecycle events.
 */
export interface DaemonCallbacks {
  /** Called when daemon state changes */
  onStateChange?: (state: DaemonState) => void;
  /** Called when a session is discovered */
  onSessionDiscovered?: (session: LocalSession) => void;
  /** Called when a message is routed successfully */
  onMessageRouted?: (result: MessageRouteSuccess) => void;
  /** Called when a message routing fails */
  onMessageError?: (result: MessageRouteFailure) => void;
  /** Called when SSE connection state changes */
  onSSEStatus?: (connected: boolean) => void;
  /** Called on any error that doesn't stop the daemon */
  onError?: (error: Error) => void;
}

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Create a DaemonConfig with sensible defaults.
 * Requires apiUrl, projectKey, and machineId.
 */
export function createDefaultConfig(
  apiUrl: string,
  projectKey: string,
  machineId: string,
): DaemonConfig {
  return {
    apiUrl,
    projectKey,
    machineId,
    heartbeatIntervalMs: 10_000,
    sse: {
      endpoint: '/v1/messages/stream',
      lastEventId: null,
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 30_000,
      reconnectMultiplier: 2,
    },
  };
}
