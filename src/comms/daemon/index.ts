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
  MessageRouteResult,
  MessageRouteSuccess,
  MessageRouteFailure,
} from './types';

export { createDefaultConfig } from './types';

// Session discovery
export { discoverSessions } from './session-discovery';

// SSE client
export { SSEClient } from './sse-client';
export type {
  SSEMessageCallback,
  SSEStatusCallback,
  SSEErrorCallback,
} from './sse-client';

// Message router
export { MessageRouter } from './message-router';

// Daemon orchestrator
export { AgentDaemon } from './agent-daemon';
