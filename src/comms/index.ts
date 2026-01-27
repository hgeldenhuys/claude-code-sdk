/**
 * Claude Code Agent Communication System (Comms)
 *
 * Provides agent registration, discovery, messaging, and presence
 * via the SignalDB.live backend.
 *
 * Modules:
 * - protocol: Types, address resolution, presence derivation
 * - client: SignalDB REST client
 * - registry: Agent lifecycle management
 * - schema: PostgreSQL DDL
 *
 * @example
 * ```typescript
 * import {
 *   SignalDBClient,
 *   AgentRegistry,
 *   parseAddress,
 *   derivePresence,
 * } from 'claude-code-sdk/comms';
 *
 * const client = new SignalDBClient({
 *   apiUrl: 'https://my-project.signaldb.live',
 *   projectKey: 'sk_live_...',
 * });
 *
 * const registry = new AgentRegistry(client);
 * const agent = await registry.register({
 *   machineId: 'mac-001',
 *   sessionId: 'abc-123',
 * });
 * ```
 */

// Protocol: types, address resolution, presence
export type {
  AgentStatus,
  ChannelType,
  MessageType,
  MessageStatus,
  AccessType,
  AgentAddress,
  ProjectAddress,
  BroadcastAddress,
  Address,
  Agent,
  Channel,
  Message,
  Paste,
  AgentRegistration,
  ChannelCreate,
  MessageSend,
  PasteCreate,
  AgentFilter,
  ChannelFilter,
  MessageFilter,
} from './protocol/index';

export {
  parseAddress,
  formatAddress,
  validateAddress,
  resolveAgentAddress,
  AddressParseError,
  derivePresence,
  isActive,
  isIdle,
  isOffline,
  getPresenceThresholds,
} from './protocol/index';

// Client
export {
  SignalDBClient,
  SignalDBError,
  type SignalDBClientConfig,
} from './client/index';

// Registry
export {
  AgentRegistry,
  type AgentRegistrationOptions,
} from './registry/index';

// Schema
export { SCHEMA_SQL } from './schema/index';

// Daemon: local agent lifecycle, SSE, message routing
export {
  AgentDaemon,
  SSEClient,
  MessageRouter,
  discoverSessions,
  createDefaultConfig,
} from './daemon/index';

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
  SSEMessageCallback,
  SSEStatusCallback,
  SSEErrorCallback,
} from './daemon/index';

// Channels: real-time bidirectional messaging
export {
  ChannelClient,
  ChannelManager,
  MessagePublisher,
  MessageSubscriber,
  MessageQuery,
  OfflineQueue,
} from './channels/index';

export type {
  ChannelConfig,
  ChannelSubscription,
  PublishOptions,
  QueryOptions,
  ChannelInfo,
  ThreadSummary,
  QueuedMessageCallback,
} from './channels/index';
