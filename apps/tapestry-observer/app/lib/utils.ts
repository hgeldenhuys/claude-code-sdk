/**
 * Shared utilities for Tapestry Observer
 *
 * Types and helpers used by both the dashboard (home.tsx) and agents list (agents.tsx).
 * Extracted here because they're needed by 2+ routes.
 */

// ─── Types ─────────────────────────────────────────────

export interface Agent {
  id: string;
  machineId: string;
  sessionId: string;
  sessionName: string;
  projectPath: string;
  heartbeatAt: string;
  registeredAt: string;
  status: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export type AgentStatus = "active" | "idle" | "offline";

export interface AgentWithStatus extends Agent {
  derivedStatus: AgentStatus;
}

export interface Toast {
  id: number;
  message: string;
  type: "error" | "warning" | "info";
  timestamp: number;
}

export type ChannelType = "direct" | "project" | "broadcast";

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  members: string[];
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Channel type color configs */
export const CHANNEL_TYPE_COLORS: Record<ChannelType, { badge: string; badgeText: string; label: string }> = {
  direct: {
    badge: "bg-blue-400/15 border-blue-400/30",
    badgeText: "text-blue-300",
    label: "direct",
  },
  project: {
    badge: "bg-violet-400/15 border-violet-400/30",
    badgeText: "text-violet-300",
    label: "project",
  },
  broadcast: {
    badge: "bg-orange-400/15 border-orange-400/30",
    badgeText: "text-orange-300",
    label: "broadcast",
  },
};

// ─── Constants ─────────────────────────────────────────

/** Polling interval in milliseconds (10 seconds) */
export const POLL_INTERVAL_MS = 10_000;

/** Timestamp refresh interval (3 seconds) — cheap, no network */
export const TICK_INTERVAL_MS = 3_000;

/** Status color configs */
export const STATUS_COLORS: Record<AgentStatus, { dot: string; badge: string; badgeText: string; label: string }> = {
  active: {
    dot: "bg-emerald-400",
    badge: "bg-emerald-400/15 border-emerald-400/30",
    badgeText: "text-emerald-300",
    label: "active",
  },
  idle: {
    dot: "bg-amber-400",
    badge: "bg-amber-400/15 border-amber-400/30",
    badgeText: "text-amber-300",
    label: "idle",
  },
  offline: {
    dot: "bg-gray-500",
    badge: "bg-gray-500/15 border-gray-500/30",
    badgeText: "text-gray-400",
    label: "offline",
  },
};

// ─── Utilities ─────────────────────────────────────────

/** Convert snake_case keys to camelCase (SignalDB returns snake_case) */
export function snakeToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = obj[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[camelKey] = snakeToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

/** Derive agent status from heartbeat timestamp */
export function deriveAgentStatus(heartbeatAt: string): AgentStatus {
  if (!heartbeatAt) return "offline";
  const hb = new Date(heartbeatAt).getTime();
  if (isNaN(hb)) return "offline";
  const diffSec = (Date.now() - hb) / 1000;

  if (diffSec <= 30) return "active";
  if (diffSec <= 300) return "idle"; // 5 minutes
  return "offline";
}

/** Format a timestamp as relative time ("3s ago", "2m ago", "1h ago") */
export function formatRelativeTime(isoString: string): string {
  if (!isoString) return "never";
  const then = new Date(isoString).getTime();
  if (isNaN(then)) return "never";
  const diffSec = Math.floor((Date.now() - then) / 1000);

  if (diffSec < 0) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/** Truncate a project path for display */
export function truncatePath(path: string, maxLen = 40): string {
  if (!path || path.length <= maxLen) return path || "\u2014";
  return "\u2026" + path.slice(path.length - maxLen + 1);
}

/**
 * Parse raw REST response into Agent[].
 * SignalDB wraps results in { data: [...], meta: {...} } or returns array directly.
 * Deduplicates by agent ID.
 */
export function parseAgents(data: unknown): Agent[] {
  const rawAgents: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.data)
      ? (data as Record<string, unknown>).data as Record<string, unknown>[]
      : [];

  const seen = new Map<string, Agent>();
  for (const raw of rawAgents) {
    const agent = snakeToCamel(raw) as unknown as Agent;
    if (agent.id) {
      seen.set(agent.id, agent);
    }
  }
  return [...seen.values()];
}

/** Derive status for all agents and sort: active first, then idle, then offline */
export function deriveAndSort(agents: Agent[]): AgentWithStatus[] {
  const withStatus: AgentWithStatus[] = [];
  for (const agent of agents) {
    withStatus.push({
      ...agent,
      derivedStatus: deriveAgentStatus(agent.heartbeatAt),
    });
  }

  const order: Record<AgentStatus, number> = { active: 0, idle: 1, offline: 2 };
  withStatus.sort((a, b) => {
    const diff = order[a.derivedStatus] - order[b.derivedStatus];
    if (diff !== 0) return diff;
    return new Date(b.heartbeatAt).getTime() - new Date(a.heartbeatAt).getTime();
  });

  return withStatus;
}

/** Count agents by status */
export function countByStatus(agents: AgentWithStatus[]): { active: number; idle: number; offline: number } {
  let active = 0;
  let idle = 0;
  let offline = 0;
  for (const a of agents) {
    if (a.derivedStatus === "active") active++;
    else if (a.derivedStatus === "idle") idle++;
    else offline++;
  }
  return { active, idle, offline };
}

/**
 * Compare two agent arrays to see if they meaningfully changed.
 * Avoids unnecessary re-renders by comparing IDs + heartbeat timestamps.
 */
export function agentsChanged(prev: Agent[], next: Agent[]): boolean {
  if (prev.length !== next.length) return true;

  // Build a fingerprint from sorted IDs + heartbeats
  const fingerprint = (agents: Agent[]) => {
    const sorted = [...agents].sort((a, b) => a.id.localeCompare(b.id));
    const parts: string[] = [];
    for (const a of sorted) {
      parts.push(`${a.id}:${a.heartbeatAt}`);
    }
    return parts.join("|");
  };

  return fingerprint(prev) !== fingerprint(next);
}

// ─── Channel Utilities ─────────────────────────────────

/**
 * Parse raw REST response into Channel[].
 * Deduplicates by channel ID.
 */
export function parseChannels(data: unknown): Channel[] {
  const rawChannels: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.data)
      ? (data as Record<string, unknown>).data as Record<string, unknown>[]
      : [];

  const seen = new Map<string, Channel>();
  for (const raw of rawChannels) {
    const ch = snakeToCamel(raw) as unknown as Channel;
    // Ensure members is always an array
    if (!Array.isArray(ch.members)) ch.members = [];
    if (ch.id) {
      seen.set(ch.id, ch);
    }
  }
  return [...seen.values()];
}

/**
 * Compare two channel arrays to see if they meaningfully changed.
 * Compares IDs + member counts + names.
 */
export function channelsChanged(prev: Channel[], next: Channel[]): boolean {
  if (prev.length !== next.length) return true;

  const fingerprint = (channels: Channel[]) => {
    const sorted = [...channels].sort((a, b) => a.id.localeCompare(b.id));
    const parts: string[] = [];
    for (const c of sorted) {
      parts.push(`${c.id}:${c.name}:${c.members.length}`);
    }
    return parts.join("|");
  };

  return fingerprint(prev) !== fingerprint(next);
}

// ─── Message Types & Utilities ──────────────────

export type MessageType = "chat" | "memo" | "command" | "response" | "sync";
export type MessageStatus = "pending" | "claimed" | "delivered" | "read" | "expired";

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

/** Message type color configs */
export const MESSAGE_TYPE_COLORS: Record<MessageType, { badge: string; badgeText: string; label: string }> = {
  chat: {
    badge: "bg-blue-400/15 border-blue-400/30",
    badgeText: "text-blue-300",
    label: "chat",
  },
  memo: {
    badge: "bg-violet-400/15 border-violet-400/30",
    badgeText: "text-violet-300",
    label: "memo",
  },
  command: {
    badge: "bg-orange-400/15 border-orange-400/30",
    badgeText: "text-orange-300",
    label: "command",
  },
  response: {
    badge: "bg-emerald-400/15 border-emerald-400/30",
    badgeText: "text-emerald-300",
    label: "response",
  },
  sync: {
    badge: "bg-cyan-400/15 border-cyan-400/30",
    badgeText: "text-cyan-300",
    label: "sync",
  },
};

/** Message status color configs */
export const MESSAGE_STATUS_COLORS: Record<MessageStatus, { dot: string; text: string; label: string }> = {
  pending: { dot: "bg-amber-400", text: "text-amber-300", label: "pending" },
  claimed: { dot: "bg-blue-400", text: "text-blue-300", label: "claimed" },
  delivered: { dot: "bg-emerald-400", text: "text-emerald-300", label: "delivered" },
  read: { dot: "bg-gray-400", text: "text-gray-300", label: "read" },
  expired: { dot: "bg-red-400", text: "text-red-300", label: "expired" },
};

/**
 * Parse raw REST response into Message[].
 * Deduplicates by message ID.
 */
export function parseMessages(data: unknown): Message[] {
  const rawMessages: Record<string, unknown>[] = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>)?.data)
      ? (data as Record<string, unknown>).data as Record<string, unknown>[]
      : [];

  const seen = new Map<string, Message>();
  for (const raw of rawMessages) {
    const msg = snakeToCamel(raw) as unknown as Message;
    if (msg.id) {
      seen.set(msg.id, msg);
    }
  }
  return [...seen.values()];
}

/**
 * Compare two message arrays to see if they meaningfully changed.
 * Compares IDs + statuses.
 */
export function messagesChanged(prev: Message[], next: Message[]): boolean {
  if (prev.length !== next.length) return true;

  const fingerprint = (messages: Message[]) => {
    const sorted = [...messages].sort((a, b) => a.id.localeCompare(b.id));
    const parts: string[] = [];
    for (const m of sorted) {
      parts.push(`${m.id}:${m.status}`);
    }
    return parts.join("|");
  };

  return fingerprint(prev) !== fingerprint(next);
}

/**
 * Parse a single raw SSE message event into a Message.
 * SSE insert events from SignalDB wrap the record as { id, data: {...}, ts }.
 */
export function parseOneMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // SSE events wrap in { data: {...} } — unwrap if present
  const record = (obj.data && typeof obj.data === "object" ? obj.data : obj) as Record<string, unknown>;
  const msg = snakeToCamel(record) as unknown as Message;
  return msg.id ? msg : null;
}

/** Truncate message content for card preview */
export function truncateContent(content: string, maxLen = 120): string {
  if (!content) return "\u2014";
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + "\u2026";
}

// ─── Thread Utilities ─────────────────────────────────

/** Extract unique participant sender IDs from a thread */
export function getThreadParticipants(messages: Message[]): string[] {
  const senders = new Set<string>();
  for (const msg of messages) {
    if (msg.senderId) senders.add(msg.senderId);
  }
  return [...senders];
}

/** Identify sender from message metadata and senderId */
export function getSenderInfo(msg: Message): { name: string; isLocal: boolean; isDiscord: boolean } {
  // SignalDB returns metadata_json → snakeToCamel → metadataJson
  // But our Message type says metadata. Handle both at runtime.
  const raw = msg as Record<string, unknown>;
  const meta = (msg.metadata || raw.metadataJson || {}) as Record<string, unknown>;

  // Discord bridge messages (sender_id = "discord-bot", metadata has source: "discord")
  if (meta.source === "discord" || msg.senderId === "discord-bot") {
    // Field is discordUser (not discordUsername) in production data
    const username = (meta.discordUser || meta.discordUsername || "Discord User") as string;
    return { name: username, isLocal: false, isDiscord: true };
  }

  // Agent address: agent://machine/session-name → extract session-name
  if (msg.senderId?.startsWith("agent://")) {
    const parts = msg.senderId.split("/");
    const name = parts[parts.length - 1] || "agent";
    return { name, isLocal: true, isDiscord: false };
  }

  // Response type messages are from local agents (even if senderId is a UUID)
  if (msg.messageType === "response") {
    // Try to extract a name from targetAddress (often agent://machine/session-name)
    if (msg.targetAddress?.startsWith("agent://")) {
      const parts = msg.targetAddress.split("/");
      return { name: parts[parts.length - 1] || shortSenderId(msg.senderId), isLocal: true, isDiscord: false };
    }
    return { name: shortSenderId(msg.senderId), isLocal: true, isDiscord: false };
  }

  // Fallback
  return { name: shortSenderId(msg.senderId), isLocal: false, isDiscord: false };
}

/** Split content into text and code segments for rendering */
export function splitContentSegments(content: string): Array<{ type: "text" | "code"; content: string; language?: string }> {
  const segments: Array<{ type: "text" | "code"; content: string; language?: string }> = [];
  const parts = content.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith("```")) {
      const match = part.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        segments.push({ type: "code", content: match[2], language: match[1] || undefined });
      } else {
        segments.push({ type: "text", content: part });
      }
    } else if (part.trim()) {
      segments.push({ type: "text", content: part });
    }
  }
  return segments;
}

/** Extract a short sender name from senderId (often a UUID or agent address) */
export function shortSenderId(senderId: string): string {
  if (!senderId) return "unknown";
  // If it looks like agent://machine/session-name, extract session-name
  if (senderId.startsWith("agent://")) {
    const parts = senderId.split("/");
    return parts[parts.length - 1] || senderId.slice(0, 12);
  }
  // If it's a UUID, truncate
  if (senderId.length > 16) return senderId.slice(0, 12);
  return senderId;
}
