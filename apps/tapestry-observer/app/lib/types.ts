/**
 * Tapestry Observer Types
 *
 * Shared type definitions for the COMMS observer app.
 * These mirror the SignalDB protocol types from the SDK.
 */

// ============================================================================
// Enums
// ============================================================================

export type AgentStatus = "active" | "idle" | "offline";
export type ChannelType = "direct" | "project" | "broadcast";
export type MessageType = "chat" | "memo" | "command" | "response";
export type MessageStatus =
  | "pending"
  | "claimed"
  | "delivered"
  | "read"
  | "expired";

// ============================================================================
// Entity Types
// ============================================================================

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

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  members: string[];
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

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

// ============================================================================
// SSE Event Types
// ============================================================================

export type SSEEventType = "insert" | "update" | "delete" | "initial";

export interface SSEEvent<T> {
  type: SSEEventType;
  data: T;
  id?: string;
}

// ============================================================================
// Connection State
// ============================================================================

export type StreamMode = "live" | "polling" | "offline";

export interface ConnectionState {
  agents: boolean;
  messages: boolean;
  channels: boolean;
  mode: StreamMode;
}

// ============================================================================
// Hierarchy Types (for Agent Tree)
// ============================================================================

export interface MachineNode {
  machineId: string;
  projects: ProjectNode[];
  agentCount: number;
  activeCount: number;
  idleCount: number;
  offlineCount: number;
  lastHeartbeat: string | null;
}

export interface ProjectNode {
  projectPath: string;
  projectName: string;
  agents: Agent[];
  agentCount: number;
}

// ============================================================================
// Delivery Mode
// ============================================================================

export type DeliveryMode = "push" | "pull" | "broadcast";

// ============================================================================
// Memo & Paste View Types
// ============================================================================

export interface MemoView {
  message: Message;
  subject: string;
  category: string;
  priority: string;
}

export interface PasteView {
  id: string;
  creatorId: string;
  content: string;
  contentType: string;
  accessMode: string;
  ttlSeconds: number | null;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
}

// ============================================================================
// Chat & Mail View Types
// ============================================================================

export interface ChatThread {
  threadId: string;
  participants: string[];
  lastMessage: Message;
  messageCount: number;
  unreadCount: number;
}

export interface MailMessage {
  message: Message;
  subject: string;
  folder: "inbox" | "sent" | "all";
  isRead: boolean;
}

// ============================================================================
// Delivery Helpers
// ============================================================================

export function getDeliveryMode(msg: Message): DeliveryMode {
  return (msg.metadata?.deliveryMode as DeliveryMode) || "push";
}

export function isChatMessage(msg: Message): boolean {
  return msg.messageType === "chat" && getDeliveryMode(msg) !== "pull";
}

export function isMailMessage(msg: Message): boolean {
  return msg.messageType === "chat" && getDeliveryMode(msg) === "pull";
}

export function isMemoMessage(msg: Message): boolean {
  return msg.messageType === "memo";
}

/**
 * Format date for day separator display.
 */
export function formatDate(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Check if two timestamps are on the same calendar day.
 */
export function isSameDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

// ============================================================================
// Presence Utilities
// ============================================================================

const ACTIVE_THRESHOLD_MS = 10_000; // 10 seconds
const IDLE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

/**
 * Derive agent status from heartbeat timestamp.
 */
export function deriveAgentStatus(heartbeatAt: string | null): AgentStatus {
  if (!heartbeatAt) return "offline";

  const lastBeat = new Date(heartbeatAt).getTime();
  const now = Date.now();
  const elapsed = now - lastBeat;

  if (elapsed <= ACTIVE_THRESHOLD_MS) return "active";
  if (elapsed <= IDLE_THRESHOLD_MS) return "idle";
  return "offline";
}

/**
 * Format relative time (e.g., "2m ago", "just now").
 */
export function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "never";

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

/**
 * Format timestamp for display.
 */
export function formatTime(timestamp: string | null | undefined): string {
  if (!timestamp) return "--:--:--";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "--:--:--";

  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
