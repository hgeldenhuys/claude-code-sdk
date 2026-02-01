/**
 * Agent Detail Page — /agents/:agentId
 *
 * Shows full agent info, sent/received messages, and channel memberships.
 * Data is SSR-loaded from SignalDB via parallel fetches.
 */

import { useState, useEffect } from "react";
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLayoutContext } from "./layout";
import { signalDBFetch } from "../lib/server";
import {
  type Agent,
  type AgentWithStatus,
  type Channel,
  type Message,
  type MessageType,
  type Toast,
  TICK_INTERVAL_MS,
  STATUS_COLORS,
  CHANNEL_TYPE_COLORS,
  MESSAGE_TYPE_COLORS,
  MESSAGE_STATUS_COLORS,
  parseAgents,
  parseChannels,
  parseMessages,
  deriveAgentStatus,
  formatRelativeTime,
  truncatePath,
  truncateContent,
  getSenderInfo,
} from "../lib/utils";
import { DiscordIcon } from "../lib/icons";

// ─── Types ───────────────────────────────────────────────

type AgentNameMap = Record<string, string>;

interface LoaderData {
  agent: AgentWithStatus | null;
  sentMessages: Message[];
  receivedMessages: Message[];
  channels: Channel[];
  agentNames: AgentNameMap;
  loadedAt: string;
  error: string | null;
}

// ─── Loader (SSR) ────────────────────────────────────────

export async function loader({ params }: LoaderFunctionArgs): Promise<LoaderData> {
  const agentId = params.agentId!;

  try {
    const [agentsData, sentData, recentData, channelsData] = await Promise.all([
      signalDBFetch<{ data: unknown[] }>("/v1/agents", { limit: "200" }),
      signalDBFetch<{ data: unknown[] }>("/v1/messages", {
        "filter[sender_id]": agentId,
        limit: "50",
        orderBy: "created_at",
        order: "desc",
      }),
      signalDBFetch<{ data: unknown[] }>("/v1/messages", {
        limit: "200",
        orderBy: "created_at",
        order: "desc",
      }),
      signalDBFetch<{ data: unknown[] }>("/v1/channels", {
        limit: "100",
      }),
    ]);

    const agents = parseAgents(agentsData);
    const sentMessages = parseMessages(sentData);
    const allRecent = parseMessages(recentData);
    const allChannels = parseChannels(channelsData);

    // Find the target agent
    let agent: AgentWithStatus | null = null;
    const agentNames: AgentNameMap = {};
    for (const a of agents) {
      if (a.id && a.sessionName) {
        agentNames[a.id] = a.sessionName;
      }
      if (a.id === agentId) {
        agent = { ...a, derivedStatus: deriveAgentStatus(a.heartbeatAt) };
      }
    }

    // Filter received messages: claimedBy matches this agent
    const receivedMessages: Message[] = [];
    for (const msg of allRecent) {
      if (msg.claimedBy === agentId) {
        receivedMessages.push(msg);
      }
    }

    // Filter channels where this agent is a member
    const memberChannels: Channel[] = [];
    for (const ch of allChannels) {
      if (ch.members.includes(agentId)) {
        memberChannels.push(ch);
      }
    }

    return {
      agent,
      sentMessages,
      receivedMessages,
      channels: memberChannels,
      agentNames,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    return {
      agent: null,
      sentMessages: [],
      receivedMessages: [],
      channels: [],
      agentNames: {},
      loadedAt: new Date().toISOString(),
      error: String(err),
    };
  }
}

// ─── Component ───────────────────────────────────────────

export default function AgentDetailPage() {
  const { configOk } = useLayoutContext();
  const data = useLoaderData<LoaderData>();
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = { current: 0 };

  const { agent, sentMessages, receivedMessages, channels, agentNames, error } = data;

  // Timestamp refresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  void tick;

  // Toast on load error
  useEffect(() => {
    if (error) {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev.slice(-4), { id, message: error, type: "error", timestamp: Date.now() }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000);
    }
  }, [error]);

  if (!configOk) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 text-4xl mb-4">&#9888;</div>
        <h3 className="text-lg font-medium text-gray-400 mb-2">Not configured</h3>
        <p className="text-sm text-gray-500">Set up .env.tapestry to connect to SignalDB.</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link
          to="/agents"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Agents
        </Link>
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">&#128269;</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">Agent not found</h3>
          <p className="text-sm text-gray-500">This agent may no longer be registered.</p>
        </div>
      </div>
    );
  }

  const colors = STATUS_COLORS[agent.derivedStatus];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to="/agents"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Agents
      </Link>

      {/* Agent Info Header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-100 mb-1">
              {agent.sessionName || agent.sessionId?.slice(0, 8) || "unknown"}
            </h2>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colors.badge} ${colors.badgeText}`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${
                  agent.derivedStatus === "active"
                    ? "animate-heartbeat"
                    : agent.derivedStatus === "idle"
                      ? "animate-idle-pulse"
                      : ""
                }`}
              />
              {colors.label}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <InfoRow icon="server" label="Machine ID" value={agent.machineId || "\u2014"} />
          <InfoRow icon="folder" label="Project" value={truncatePath(agent.projectPath, 50)} title={agent.projectPath} />
          <InfoRow icon="id" label="Session ID" value={agent.sessionId?.slice(0, 16) + "\u2026" || "\u2014"} title={agent.sessionId} mono />
          <InfoRow icon="clock" label="Last heartbeat">
            <span className={agent.derivedStatus === "active" ? "text-emerald-400" : "text-gray-400"}>
              {formatRelativeTime(agent.heartbeatAt)}
            </span>
          </InfoRow>
          <InfoRow icon="clock" label="Registered" value={formatRelativeTime(agent.registeredAt)} />
        </div>
      </div>

      {/* Capabilities */}
      {agent.capabilities && agent.capabilities.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Capabilities</h3>
          <div className="flex flex-wrap gap-2">
            {agent.capabilities.map((cap) => (
              <span
                key={cap}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border border-gray-700 bg-gray-800/50 text-gray-300"
              >
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      {agent.metadata && Object.keys(agent.metadata).length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">Metadata</h3>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <pre
              className="text-xs text-gray-300 overflow-x-auto"
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {JSON.stringify(agent.metadata, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* Sent Messages */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
            Sent ({sentMessages.length})
          </h3>
          {sentMessages.length > 20 && (
            <Link
              to={`/messages?sender=${agent.id}`}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              View all &rarr;
            </Link>
          )}
        </div>
        {sentMessages.length === 0 ? (
          <p className="text-sm text-gray-500">No sent messages found.</p>
        ) : (
          <div className="space-y-2">
            {sentMessages.slice(0, 20).map((msg) => (
              <CompactMessageCard key={msg.id} message={msg} agentNames={agentNames} />
            ))}
          </div>
        )}
      </div>

      {/* Received Messages */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Received ({receivedMessages.length})
        </h3>
        {receivedMessages.length === 0 ? (
          <p className="text-sm text-gray-500">No received messages found.</p>
        ) : (
          <div className="space-y-2">
            {receivedMessages.slice(0, 20).map((msg) => (
              <CompactMessageCard key={msg.id} message={msg} agentNames={agentNames} />
            ))}
          </div>
        )}
      </div>

      {/* Channel Memberships */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Channels ({channels.length})
        </h3>
        {channels.length === 0 ? (
          <p className="text-sm text-gray-500">Not a member of any channels.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {channels.map((ch) => {
              const knownType = ch.type in CHANNEL_TYPE_COLORS;
              const typeColors = knownType
                ? CHANNEL_TYPE_COLORS[ch.type]
                : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: ch.type || "unknown" };

              return (
                <Link
                  key={ch.id}
                  to={`/channels/${ch.id}`}
                  className="rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 p-4 transition-colors block"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-gray-500">#</span>
                    <span className="text-sm font-medium text-gray-200 truncate">
                      {ch.name || ch.id.slice(0, 12)}
                    </span>
                  </div>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${typeColors.badge} ${typeColors.badgeText}`}
                  >
                    {typeColors.label}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-4 py-3 shadow-lg animate-fade-in cursor-pointer ${
                toast.type === "error"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-300"
              }`}
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            >
              <p className="text-sm">{toast.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Info Row ──────────────────────────────────────────────

function InfoRow({ icon, label, value, title, mono, children }: {
  icon: string;
  label: string;
  value?: string;
  title?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  const iconSvg = icon === "server" ? (
    <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7" />
    </svg>
  ) : icon === "folder" ? (
    <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
    </svg>
  ) : icon === "id" ? (
    <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Zm6-10.125a1.875 1.875 0 1 1-3.75 0 1.875 1.875 0 0 1 3.75 0Zm1.294 6.336a6.721 6.721 0 0 1-3.17.789 6.721 6.721 0 0 1-3.168-.789 3.376 3.376 0 0 1 6.338 0Z" />
    </svg>
  ) : (
    <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );

  return (
    <div className="flex items-center gap-2">
      {iconSvg}
      <span className="text-gray-500 text-xs">{label}:</span>
      {children || (
        <span
          className={`text-gray-300 text-xs truncate ${mono ? "" : ""}`}
          title={title}
          style={mono ? { fontFamily: "'JetBrains Mono', monospace" } : undefined}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// ─── Compact Message Card ─────────────────────────────────

function CompactMessageCard({ message, agentNames }: { message: Message; agentNames: AgentNameMap }) {
  const sender = getSenderInfo(message);
  const resolvedName = agentNames[message.senderId] || sender.name;

  const knownType = message.messageType in MESSAGE_TYPE_COLORS;
  const typeColors = knownType
    ? MESSAGE_TYPE_COLORS[message.messageType]
    : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: message.messageType || "unknown" };

  const knownStatus = message.status in MESSAGE_STATUS_COLORS;
  const statusColors = knownStatus
    ? MESSAGE_STATUS_COLORS[message.status]
    : { dot: "bg-gray-500", text: "text-gray-400", label: message.status || "unknown" };

  const hasThread = !!message.threadId;
  const threadLink = hasThread ? `/messages/thread/${message.threadId}` : null;

  const card = (
    <div className="group rounded-lg border border-gray-800 bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 px-4 py-3 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        {sender.isDiscord ? (
          <DiscordIcon className="w-3 h-3 text-blue-400 shrink-0" />
        ) : (
          <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
          </svg>
        )}
        <span className={`text-xs font-medium truncate ${sender.isDiscord ? "text-blue-300" : "text-gray-300"}`}>
          {resolvedName}
        </span>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${typeColors.badge} ${typeColors.badgeText}`}>
          {typeColors.label}
        </span>
        <span className="inline-flex items-center gap-1 text-[10px]">
          <span className={`w-1 h-1 rounded-full ${statusColors.dot}`} />
          <span className={statusColors.text}>{statusColors.label}</span>
        </span>
        <span className="ml-auto text-[10px] text-gray-500 shrink-0">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      <p className="text-xs text-gray-400 line-clamp-1">{truncateContent(message.content, 100)}</p>
    </div>
  );

  if (threadLink) {
    return <Link to={threadLink} className="block">{card}</Link>;
  }
  return card;
}
