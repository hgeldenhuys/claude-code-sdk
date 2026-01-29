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
  SecureChannelClient,
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

// Security: guardrails, authentication, rate limiting, audit
export {
  SecurityManager,
  SecurityMiddleware,
  RateLimitError,
  ContentValidationError,
  DirectoryGuardError,
  DirectoryGuard,
  ToolPolicyEngine,
  AuditLogger,
  RLSPolicyGenerator,
  JWTManager,
  RateLimiter,
  MessageValidator,
  createDefaultSecurityConfig,
} from './security/index';

export type {
  SecurityConfig,
  ToolPolicy,
  RateLimitAction,
  RateLimitConfig,
  RateLimitState,
  RateLimitResult,
  JWTConfig,
  JWTPayload,
  AuditLogConfig,
  AuditEntry,
  SecurityViolation,
  DirectoryViolation,
  ToolViolation,
  RateLimitViolation,
  AuthViolation,
  ContentViolation,
  ValidationResult,
} from './security/index';

// Memos: async knowledge sharing between agents
export {
  MemoClient,
  MemoComposer,
  MemoInbox,
  MemoClaimer,
  MemoThreading,
  messageToMemoView,
  SecureMemoClient,
} from './memos/index';

export type {
  MemoCategory,
  MemoPriority,
  MemoCompose,
  MemoView,
  MemoFilter,
  ClaimResult,
  ThreadSummary as MemoThreadSummary,
  MemoConfig,
} from './memos/index';

// Pastes: ephemeral content sharing with TTL and read-once
export {
  PasteClient,
  PasteManager,
  PasteSharing,
  SecurePasteClient,
  pasteToView,
} from './pastes/index';

export type {
  PasteContentType,
  PasteCompose,
  PasteView,
  PasteFilter,
  PasteConfig,
} from './pastes/index';

// Remote: administration and command execution
export {
  RemoteClient,
  CommandExecutor,
  CommandHandler,
  ReceiptTracker,
  ResponseFormatter,
  getTemplate,
} from './remote/index';

export type {
  RemoteCommandType,
  ReceiptStatus,
  RemoteCommand,
  ExecutionReceipt,
  CommandResult,
  RemoteConfig,
  ReceiptFilter,
  ReceiptCallback,
  CommandTemplate,
  DeployParams,
  StatusParams,
  ConfigParams,
  DiagnosticParams,
  RestartParams,
  FormattedResponse,
} from './remote/index';

// Config: Multi-environment configuration for Tapestry
export {
  loadTapestryConfig,
  getEnvironmentConfig,
  getCurrentEnvironmentConfig,
  toSignalDBConfig,
  toDaemonConfig,
  listConfiguredEnvironments,
  validateEnvironments,
  getEnvironmentInfo,
  EnvironmentConfigError,
} from './config/index';

export type {
  TapestryEnvironment,
  EnvironmentConfig,
  TapestryConfig,
  EnvironmentInfo,
} from './config/index';

// Discord Bridge: Discord <-> SignalDB message bridging
export {
  DiscordBot,
  DiscordGateway,
  SlashCommandManager,
  ThreadMapper,
  PresenceSync,
  MessageFormatter,
  DiscordRateLimiter,
  MessageBridge,
  DiscordGatewayOpcode,
  DiscordIntent,
  DiscordInteractionType,
  DiscordInteractionCallbackType,
  DiscordMessageFlags,
} from './bridges/discord/index';

export type {
  DiscordBotConfig,
  DiscordChannelMapping,
  ThreadMapping,
  PresenceConfig,
  MessageFormatConfig,
  SlashCommandDef,
  SlashCommandOption,
  SlashCommandOptionType,
  DiscordGatewayPayload,
  DiscordHelloData,
  DiscordIdentifyData,
  DiscordReadyData,
  DiscordUser,
  DiscordMessage,
  DiscordAttachment,
  DiscordEmbed,
  DiscordThread,
  DiscordGuildMember,
  DiscordActivity,
  DiscordInteraction,
  DiscordInteractionData,
  DiscordInteractionOption,
  DiscordInteractionResponse,
  DiscordResolvedData,
  DiscordPresenceUpdate,
  GatewayConnectionStatus,
  DiscordRateLimitResult,
  DiscordBotStatus,
  DiscordThreadCreateResponse,
  DiscordMessageCreateResponse,
  DiscordEventCallback,
} from './bridges/discord/index';
