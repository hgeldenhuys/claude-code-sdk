/**
 * Channel Detail Page — /channels/:channelId
 *
 * Shows channel info, member list with status, messages list with SSE for live updates.
 * SSR-hydrated loader with parallel SignalDB fetches.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useLoaderData, useRevalidator, useSearchParams, Link } from "react-router";
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
  parseOneMessage,
  deriveAgentStatus,
  formatRelativeTime,
  truncateContent,
  getSenderInfo,
} from "../lib/utils";
import { DiscordIcon } from "../lib/icons";

// ─── Types ───────────────────────────────────────────────

const PAGE_SIZE = 50;
type AgentNameMap = Record<string, string>;

interface LoaderData {
  channel: Channel | null;
  messages: Message[];
  agents: AgentWithStatus[];
  agentNames: AgentNameMap;
  total: number;
  page: number;
  loadedAt: string;
  error: string | null;
}

// ─── Loader (SSR) ────────────────────────────────────────

export async function loader({ params, request }: LoaderFunctionArgs): Promise<LoaderData> {
  const channelId = params.channelId!;
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  try {
    const [channelsData, messagesData, agentsData] = await Promise.all([
      signalDBFetch<{ data: unknown[] }>("/v1/channels", { limit: "200" }),
      signalDBFetch<{ data: unknown[]; meta: { total: number } }>("/v1/messages", {
        "filter[channel_id]": channelId,
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
        orderBy: "created_at",
        order: "desc",
      }),
      signalDBFetch<{ data: unknown[] }>("/v1/agents", { limit: "200" }).catch(() => ({ data: [] })),
    ]);

    const allChannels = parseChannels(channelsData);
    const messages = parseMessages(messagesData);
    const rawAgents = parseAgents(agentsData);

    // Find the target channel
    let channel: Channel | null = null;
    for (const ch of allChannels) {
      if (ch.id === channelId) {
        channel = ch;
        break;
      }
    }

    // Build agent status list + name map
    const agents: AgentWithStatus[] = [];
    const agentNames: AgentNameMap = {};
    for (const a of rawAgents) {
      agents.push({ ...a, derivedStatus: deriveAgentStatus(a.heartbeatAt) });
      if (a.id && a.sessionName) {
        agentNames[a.id] = a.sessionName;
      }
    }

    const total = (messagesData as { meta?: { total?: number } })?.meta?.total ?? 0;

    return {
      channel,
      messages,
      agents,
      agentNames,
      total,
      page,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    return {
      channel: null,
      messages: [],
      agents: [],
      agentNames: {},
      total: 0,
      page: 1,
      loadedAt: new Date().toISOString(),
      error: String(err),
    };
  }
}

// ─── Component ───────────────────────────────────────────

export default function ChannelDetailPage() {
  const { configOk } = useLayoutContext();
  const data = useLoaderData<LoaderData>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [newMessages, setNewMessages] = useState<Message[]>([]);
  const [newCount, setNewCount] = useState(0);
  const toastIdRef = { current: 0 };

  const { channel, messages, agents, agentNames, total, loadedAt, error } = data;
  const page = parseInt(searchParams.get("page") || "1", 10);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Toast helpers
  const addToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 8000);
  }, []);

  // Show loader errors
  useEffect(() => {
    if (error) addToast(error, "error");
  }, [error, addToast]);

  // Timestamp refresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  void tick;

  // ─── SSE subscription ──────────────────────────────────

  useEffect(() => {
    if (!configOk || !loadedAt || !channel) return;

    const sseUrl = `/api/proxy/v1/messages/stream?filter[channel_id]=${encodeURIComponent(channel.id)}&filter[created_at][gt]=${encodeURIComponent(loadedAt)}`;
    const es = new EventSource(sseUrl);

    es.onopen = () => setSseConnected(true);

    es.addEventListener("insert", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const msg = parseOneMessage(parsed);
        if (!msg) return;

        if (page === 1) {
          setNewMessages((prev) => {
            for (const existing of prev) {
              if (existing.id === msg.id) return prev;
            }
            return [msg, ...prev];
          });
        } else {
          setNewCount((prev) => prev + 1);
        }
      } catch {
        // Malformed SSE data
      }
    });

    const revalidateHandler = () => revalidator.revalidate();
    es.addEventListener("update", revalidateHandler);
    es.addEventListener("delete", revalidateHandler);

    es.onerror = () => setSseConnected(false);

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [configOk, loadedAt, channel, page, revalidator]);

  // Clear live messages on loader refresh
  useEffect(() => {
    setNewMessages([]);
    setNewCount(0);
  }, [loadedAt]);

  // ─── Pagination ────────────────────────────────────────

  const goToPage = useCallback((p: number) => {
    const next = new URLSearchParams(searchParams);
    if (p <= 1) {
      next.delete("page");
    } else {
      next.set("page", String(p));
    }
    setSearchParams(next);
    setNewMessages([]);
    setNewCount(0);
  }, [searchParams, setSearchParams]);

  // ─── Derived data ─────────────────────────────────────

  const allMessages = page === 1 ? [...newMessages, ...messages] : messages;

  // Members from channel, resolved against agent registry
  const members = useMemo(() => {
    if (!channel) return [];
    const agentMap = new Map<string, AgentWithStatus>();
    for (const a of agents) {
      agentMap.set(a.id, a);
    }
    const result: Array<{ id: string; name: string; status: AgentWithStatus | null }> = [];
    for (const memberId of channel.members) {
      const agent = agentMap.get(memberId) || null;
      result.push({
        id: memberId,
        name: agent?.sessionName || memberId.slice(0, 12),
        status: agent,
      });
    }
    return result;
  }, [channel, agents]);

  // Message type breakdown
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { chat: 0, memo: 0, command: 0, response: 0, sync: 0 };
    for (const msg of allMessages) {
      if (msg.messageType in counts) counts[msg.messageType]++;
    }
    return counts;
  }, [allMessages]);

  // ─── Render ────────────────────────────────────────────

  if (!configOk) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 text-4xl mb-4">&#9888;</div>
        <h3 className="text-lg font-medium text-gray-400 mb-2">Not configured</h3>
        <p className="text-sm text-gray-500">Set up .env.tapestry to connect to SignalDB.</p>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link
          to="/channels"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Channels
        </Link>
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">#</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">Channel not found</h3>
          <p className="text-sm text-gray-500">This channel may have been deleted.</p>
        </div>
      </div>
    );
  }

  const knownType = channel.type in CHANNEL_TYPE_COLORS;
  const typeColors = knownType
    ? CHANNEL_TYPE_COLORS[channel.type]
    : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: channel.type || "unknown" };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to="/channels"
        className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Back to Channels
      </Link>

      {/* Channel Info Header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 mb-6">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="text-xl text-gray-500">#</span>
            <h2 className="text-xl font-semibold text-gray-100">
              {channel.name || channel.id.slice(0, 12)}
            </h2>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors.badge} ${typeColors.badgeText}`}
            >
              {typeColors.label}
            </span>
          </div>
          {/* SSE indicator */}
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? "bg-emerald-400 animate-heartbeat" : "bg-gray-500"}`} />
            <span className={sseConnected ? "text-emerald-400" : "text-gray-500"}>
              {sseConnected ? "Live" : "Connecting\u2026"}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{channel.members.length} member{channel.members.length !== 1 ? "s" : ""}</span>
          <span className="text-gray-700">&middot;</span>
          <span>Created {formatRelativeTime(channel.createdAt)}</span>
        </div>
        {channel.metadata?.description ? (
          <p className="mt-2 text-sm text-gray-500">{String(channel.metadata.description as string)}</p>
        ) : null}
      </div>

      {/* Members Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Members ({members.length})
        </h3>
        {members.length === 0 ? (
          <p className="text-sm text-gray-500">No members.</p>
        ) : (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
            {members.map((member) => {
              const agentColors = member.status
                ? STATUS_COLORS[member.status.derivedStatus]
                : STATUS_COLORS.offline;
              return (
                <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${agentColors.dot} ${
                    member.status?.derivedStatus === "active" ? "animate-heartbeat" : ""
                  }`} />
                  {member.status ? (
                    <Link
                      to={`/agents/${member.id}`}
                      className="text-sm text-gray-200 font-medium hover:text-gray-100 transition-colors truncate"
                    >
                      {member.name}
                    </Link>
                  ) : (
                    <span
                      className="text-sm text-gray-500 truncate"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                      title={member.id}
                    >
                      {member.name}
                    </span>
                  )}
                  <span className={`ml-auto text-xs ${agentColors.badgeText}`}>
                    {member.status ? agentColors.label : "unregistered"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Message Type Breakdown */}
      {allMessages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {(["chat", "memo", "command", "response", "sync"] as const).map((t) => {
            if (typeCounts[t] === 0) return null;
            const colors = MESSAGE_TYPE_COLORS[t];
            return (
              <span
                key={t}
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs border ${colors.badge} ${colors.badgeText}`}
              >
                {typeCounts[t]} {colors.label}
              </span>
            );
          })}
        </div>
      )}

      {/* New messages badge (page 2+) */}
      {page > 1 && newCount > 0 && (
        <button
          type="button"
          onClick={() => goToPage(1)}
          className="mb-4 w-full text-center py-2 px-4 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 text-sm hover:bg-blue-500/20 transition-colors"
        >
          {newCount} new message{newCount !== 1 ? "s" : ""} — click to view
        </button>
      )}

      {/* Revalidating indicator */}
      {revalidator.state === "loading" && (
        <div className="mb-4 text-xs text-gray-500 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          Refreshing&hellip;
        </div>
      )}

      {/* Messages Section */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Messages ({total > 0 ? `${allMessages.length} of ${total}` : allMessages.length})
        </h3>
        {allMessages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages in this channel yet.</p>
        ) : (
          <div className="space-y-2">
            {allMessages.map((msg, idx) => {
              const hasThread = !!msg.threadId;
              const threadLink = hasThread ? `/messages/thread/${msg.threadId}` : null;

              const card = (
                <ChannelMessageCard
                  key={msg.id}
                  message={msg}
                  agentNames={agentNames}
                  isNew={page === 1 && idx < newMessages.length}
                />
              );

              if (threadLink) {
                return <Link key={msg.id} to={threadLink} className="block">{card}</Link>;
              }
              return card;
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-800/60">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => goToPage(page - 1)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              page <= 1
                ? "border-gray-800 text-gray-600 cursor-not-allowed"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-gray-100"
            }`}
          >
            &larr; Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => goToPage(page + 1)}
            className={`px-4 py-2 text-sm rounded-lg border transition-colors ${
              page >= totalPages
                ? "border-gray-800 text-gray-600 cursor-not-allowed"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-gray-100"
            }`}
          >
            Next &rarr;
          </button>
        </div>
      )}

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

// ─── Channel Message Card ──────────────────────────────────

function ChannelMessageCard({ message, agentNames, isNew }: {
  message: Message;
  agentNames: AgentNameMap;
  isNew?: boolean;
}) {
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

  return (
    <div
      className={`group rounded-xl border bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 p-4 transition-colors ${
        isNew ? "border-blue-500/40 animate-fade-in" : "border-gray-800"
      } ${message.threadId ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 mr-2">
          {sender.isDiscord ? (
            <DiscordIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          )}
          <span className={`text-sm font-medium truncate ${sender.isDiscord ? "text-blue-300" : "text-gray-200"}`}>
            {resolvedName}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isNew && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
              NEW
            </span>
          )}
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors.badge} ${typeColors.badgeText}`}>
            {typeColors.label}
          </span>
          <span className="inline-flex items-center gap-1 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
            <span className={statusColors.text}>{statusColors.label}</span>
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-300 mb-2 line-clamp-2">{truncateContent(message.content)}</p>
      <div className="flex items-center gap-4 pt-2 border-t border-gray-800/60">
        <span className="text-xs text-gray-500">
          {formatRelativeTime(message.createdAt)}
        </span>
        {message.threadId && (
          <span className="text-xs text-blue-400">thread</span>
        )}
        {message.threadId && (
          <span className="ml-auto text-gray-600 group-hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}
