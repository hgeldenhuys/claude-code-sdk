/**
 * SignalDB Protocol Types
 *
 * TypeScript type definitions mirroring the SignalDB PostgreSQL schema.
 * Used by the REST client, agent registry, and all comms modules.
 */

// ============================================================================
// Enums
// ============================================================================

/**
 * Agent presence status derived from heartbeat timestamps.
 * - active: heartbeat within 10 seconds
 * - idle: heartbeat between 10 seconds and 5 minutes
 * - offline: heartbeat older than 5 minutes or never sent
 */
export type AgentStatus = 'active' | 'idle' | 'offline';

/**
 * Channel communication type.
 * - direct: one-to-one between two agents
 * - project: scoped to a project/repository
 * - broadcast: open to all listeners
 */
export type ChannelType = 'direct' | 'project' | 'broadcast';

/**
 * Message content type.
 * - chat: conversational message
 * - memo: asynchronous knowledge sharing
 * - command: executable instruction
 * - response: reply to a command
 */
export type MessageType = 'chat' | 'memo' | 'command' | 'response';

/**
 * Message delivery lifecycle status.
 * - pending: queued, not yet delivered
 * - claimed: picked up by a recipient agent
 * - delivered: confirmed received
 * - read: acknowledged by recipient
 * - expired: TTL exceeded without delivery
 */
export type MessageStatus = 'pending' | 'claimed' | 'delivered' | 'read' | 'expired';

/**
 * Paste access mode.
 * - read_once: deleted after first read
 * - ttl: expires after configured time-to-live
 */
export type AccessType = 'read_once' | 'ttl';

// ============================================================================
// Address Types (Discriminated Unions)
// ============================================================================

/**
 * Address targeting a specific agent by machine ID and identifier.
 * URI format: agent://machine-id/identifier
 */
export interface AgentAddress {
  type: 'agent';
  machineId: string;
  identifier: string;
}

/**
 * Address targeting agents in a project.
 * URI format: project://machine-id/repo-path
 */
export interface ProjectAddress {
  type: 'project';
  machineId: string;
  repoPath: string;
}

/**
 * Address targeting a broadcast channel.
 * URI format: broadcast://channel-name
 */
export interface BroadcastAddress {
  type: 'broadcast';
  channelName: string;
}

/**
 * Discriminated union of all address types.
 * Use the `type` field to narrow.
 */
export type Address = AgentAddress | ProjectAddress | BroadcastAddress;

// ============================================================================
// Entity Interfaces
// ============================================================================

/**
 * Registered agent in the SignalDB system.
 * Represents a running Claude Code session.
 */
export interface Agent {
  id: string;
  machineId: string;
  sessionId: string | null;
  sessionName: string | null;
  projectPath: string | null;
  status: AgentStatus;
  capabilities: Record<string, unknown>;
  heartbeatAt: string | null;
  metadata: Record<string, unknown>;
  registeredAt: string;
}

/**
 * Communication channel for message routing.
 */
export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  members: string[];
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Message in the SignalDB message bus.
 */
export interface Message {
  id: string;
  channelId: string;
  senderId: string;
  targetType: string;
  targetAddress: string;
  messageType: MessageType;
  content: string;
  metadata: Record<string, unknown>;
  status: MessageStatus;
  claimedBy: string | null;
  claimedAt: string | null;
  threadId: string | null;
  createdAt: string;
  expiresAt: string | null;
}

/**
 * Ephemeral content with TTL or read-once semantics.
 */
export interface Paste {
  id: string;
  creatorId: string;
  content: string;
  contentType: string;
  accessType: AccessType;
  ttlSeconds: number | null;
  recipientId: string | null;
  readBy: string[];
  readAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  deletedAt: string | null;
}

// ============================================================================
// Input Types (for create/update operations)
// ============================================================================

/**
 * Data required to register a new agent.
 */
export interface AgentRegistration {
  machineId: string;
  sessionId?: string;
  sessionName?: string;
  projectPath?: string;
  capabilities?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Data required to create a new channel.
 */
export interface ChannelCreate {
  name: string;
  type: ChannelType;
  members?: string[];
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Data required to send a new message.
 */
export interface MessageSend {
  channelId: string;
  senderId: string;
  targetType: string;
  targetAddress: string;
  messageType: MessageType;
  content: string;
  metadata?: Record<string, unknown>;
  threadId?: string;
  expiresAt?: string;
}

/**
 * Data required to create a new paste.
 */
export interface PasteCreate {
  creatorId: string;
  content: string;
  contentType?: string;
  accessType?: AccessType;
  ttlSeconds?: number;
  recipientId?: string;
}

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Filters for querying agents.
 */
export interface AgentFilter {
  machineId?: string;
  sessionId?: string;
  projectPath?: string;
  status?: AgentStatus;
}

/**
 * Filters for querying channels.
 */
export interface ChannelFilter {
  type?: ChannelType;
  name?: string;
}

/**
 * Filters for querying messages.
 */
export interface MessageFilter {
  status?: MessageStatus;
  messageType?: MessageType;
  targetAddress?: string;
  threadId?: string;
  limit?: number;
  offset?: number;
}
