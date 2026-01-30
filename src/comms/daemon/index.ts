/**
 * Agent Daemon Exports
 *
 * Local agent daemon that bridges Claude Code sessions to SignalDB.
 * Provides session discovery, SSE subscription, message routing,
 * and orchestrated daemon lifecycle management.
 */

// Types
export type {
  DaemonConfig,
  DaemonState,
  DaemonCallbacks,
  LocalSession,
  SSEConfig,
  SSEEvent,
  LogLevel,
  MessageRouteResult,
  MessageRouteSuccess,
  MessageRouteFailure,
} from './types';

export { createDefaultConfig } from './types';

// Logger
export { createLogger } from './logger';
export type { LogFields } from './logger';

// Session discovery
export { discoverSessions } from './session-discovery';

// SSE client
export { SSEClient } from './sse-client';
export type {
  SSEMessageCallback,
  SSEStatusCallback,
  SSEErrorCallback,
  SSEHealthStatus,
} from './sse-client';

// Message router
export { MessageRouter } from './message-router';

// Daemon orchestrator
export { AgentDaemon } from './agent-daemon';
