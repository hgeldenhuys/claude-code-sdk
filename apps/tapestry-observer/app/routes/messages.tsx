/**
 * Messages List — SSR hydrated, URL-persisted filters, SSE new-only
 *
 * Shows all SignalDB messages with type badges, status indicators,
 * content preview, and sender info.
 *
 * Architecture:
 * - Server loader fetches initial data directly from SignalDB (SSR)
 * - Filters + pagination live in URL searchParams (survives refresh)
 * - SSE connects with created_at > loadedAt filter (new events only)
 * - On page 1: new messages prepend live. On page 2+: shows "X new" badge.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useLoaderData, useRevalidator, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLayoutContext } from "./layout";
import { signalDBFetch } from "../lib/server";
import {
  type Message,
  type MessageType,
  type MessageStatus,
  type Channel,
  type Toast,
  TICK_INTERVAL_MS,
  MESSAGE_TYPE_COLORS,
  MESSAGE_STATUS_COLORS,
  parseMessages,
  parseChannels,
  parseOneMessage,
  formatRelativeTime,
  truncateContent,
  getSenderInfo,
} from "../lib/utils";
import { DiscordIcon } from "../lib/icons";

// ─── Types ───────────────────────────────────────────────

const PAGE_SIZE = 100;

interface LoaderData {
  messages: Message[];
  channels: Channel[];
  total: number;
  page: number;
  loadedAt: string;
  error: string | null;
}

// ─── Loader (SSR) ────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs): Promise<LoaderData> {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const type = url.searchParams.get("type") || "";
  const status = url.searchParams.get("status") || "";
  const channel = url.searchParams.get("channel") || "";

  const params: Record<string, string> = {
    limit: String(PAGE_SIZE),
    offset: String((page - 1) * PAGE_SIZE),
    orderBy: "created_at",
    order: "desc",
  };
  if (type) params["filter[message_type]"] = type;
  if (status) params["filter[status]"] = status;
  if (channel) params["filter[channel_id]"] = channel;

  try {
    const [messagesData, channelsData] = await Promise.all([
      signalDBFetch<{ data: unknown[]; meta: { total: number } }>("/v1/messages", params),
      signalDBFetch<{ data: unknown[] }>("/v1/channels", { limit: "100", orderBy: "created_at", order: "desc" }),
    ]);

    return {
      messages: parseMessages(messagesData),
      channels: parseChannels(channelsData),
      total: (messagesData as { meta?: { total?: number } })?.meta?.total ?? 0,
      page,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    return {
      messages: [],
      channels: [],
      total: 0,
      page,
      loadedAt: new Date().toISOString(),
      error: String(err),
    };
  }
}

// ─── Component ───────────────────────────────────────────

export default function MessagesPage() {
  const { configOk } = useLayoutContext();
  const loaderData = useLoaderData<LoaderData>();
  const revalidator = useRevalidator();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sseConnected, setSseConnected] = useState(false);
  const [newMessages, setNewMessages] = useState<Message[]>([]);
  const [newCount, setNewCount] = useState(0);
  const toastIdRef = { current: 0 };

  // Derived from URL
  const filterType = searchParams.get("type") || "all";
  const filterStatus = searchParams.get("status") || "all";
  const filterChannel = searchParams.get("channel") || "all";
  const page = parseInt(searchParams.get("page") || "1", 10);

  // Loader data
  const { messages, channels, total, loadedAt, error: loaderError } = loaderData;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ─── Toast helpers ────────────────────────────────────

  const addToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Show loader errors as toasts
  useEffect(() => {
    if (loaderError) addToast(loaderError, "error");
  }, [loaderError, addToast]);

  // ─── URL state helpers ────────────────────────────────

  const updateFilter = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "all") {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    next.delete("page"); // reset to page 1 on filter change
    setSearchParams(next);
    // Clear live-prepended messages on filter change
    setNewMessages([]);
    setNewCount(0);
  }, [searchParams, setSearchParams]);

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

  const clearFilters = useCallback(() => {
    setSearchParams({});
    setNewMessages([]);
    setNewCount(0);
  }, [setSearchParams]);

  // ─── SSE subscription (new events only) ───────────────

  useEffect(() => {
    if (!configOk || !loadedAt) return;

    const sseUrl = `/api/proxy/v1/messages/stream?filter[created_at][gt]=${encodeURIComponent(loadedAt)}`;
    const es = new EventSource(sseUrl);

    es.onopen = () => setSseConnected(true);

    es.addEventListener("insert", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const msg = parseOneMessage(parsed);
        if (!msg) return;

        if (page === 1) {
          // Prepend live on page 1 (dedup by id)
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
        // Malformed SSE data — ignore
      }
    });

    // Updates/deletes → revalidate the whole page from loader
    const revalidateHandler = () => revalidator.revalidate();
    es.addEventListener("update", revalidateHandler);
    es.addEventListener("delete", revalidateHandler);

    es.onerror = () => {
      setSseConnected(false);
      // EventSource auto-reconnects
    };

    return () => {
      es.removeEventListener("insert", () => {});
      es.removeEventListener("update", revalidateHandler);
      es.removeEventListener("delete", revalidateHandler);
      es.close();
      setSseConnected(false);
    };
  }, [configOk, loadedAt, page, revalidator]);

  // Clear live messages when loader data refreshes (after revalidation)
  useEffect(() => {
    setNewMessages([]);
    setNewCount(0);
  }, [loadedAt]);

  // Mark as mounted after initial render
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Timestamp refresh (cheap, no network)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // ─── Derived data ─────────────────────────────────────

  void tick;

  // Combined: live new messages (page 1) + loader messages
  const allMessages = page === 1 ? [...newMessages, ...messages] : messages;

  // Build channel name lookup
  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      if (ch.id && ch.name) map.set(ch.id, ch.name);
    }
    return map;
  }, [channels]);

  // Count by type (from full page data)
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { chat: 0, memo: 0, command: 0, response: 0, sync: 0, other: 0 };
    for (const msg of allMessages) {
      if (msg.messageType in counts) counts[msg.messageType]++;
      else counts.other++;
    }
    return counts;
  }, [allMessages]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { pending: 0, claimed: 0, delivered: 0, read: 0, expired: 0 };
    for (const msg of allMessages) {
      if (msg.status in counts) counts[msg.status]++;
    }
    return counts;
  }, [allMessages]);

  // Build set of thread root IDs (messages that other messages reference via threadId)
  const threadRootIds = useMemo(() => {
    const roots = new Set<string>();
    for (const msg of allMessages) {
      if (msg.threadId) roots.add(msg.threadId);
    }
    return roots;
  }, [allMessages]);

  // Extract unique channel IDs for filter dropdown
  const messageChannelIds = useMemo(() => {
    const set = new Set<string>();
    for (const ch of channels) {
      if (ch.id) set.add(ch.id);
    }
    return [...set].sort();
  }, [channels]);

  const hasActiveFilters = filterType !== "all" || filterStatus !== "all" || filterChannel !== "all";

  // ─── Render ───────────────────────────────────────────

  if (!configOk) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 text-4xl mb-4">&#9888;</div>
        <h3 className="text-lg font-medium text-gray-400 mb-2">Not configured</h3>
        <p className="text-sm text-gray-500">Set up .env.tapestry to connect to SignalDB.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Title + stats bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold text-gray-100">Messages</h2>
          <span className="text-sm text-gray-500">
            {hasActiveFilters
              ? `${allMessages.length} filtered`
              : total > 0
                ? `${allMessages.length} of ${total}`
                : `(${allMessages.length})`}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {allMessages.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              {typeCounts.chat > 0 && (
                <span className="flex items-center gap-1.5 text-blue-300">
                  {typeCounts.chat} chat
                </span>
              )}
              {typeCounts.memo > 0 && (
                <span className="flex items-center gap-1.5 text-violet-300">
                  {typeCounts.memo} memo
                </span>
              )}
              {typeCounts.command > 0 && (
                <span className="flex items-center gap-1.5 text-orange-300">
                  {typeCounts.command} command
                </span>
              )}
              {typeCounts.response > 0 && (
                <span className="flex items-center gap-1.5 text-emerald-300">
                  {typeCounts.response} response
                </span>
              )}
              {typeCounts.sync > 0 && (
                <span className="flex items-center gap-1.5 text-cyan-300">
                  {typeCounts.sync} sync
                </span>
              )}
              {typeCounts.other > 0 && (
                <span className="flex items-center gap-1.5 text-gray-400">
                  {typeCounts.other} other
                </span>
              )}
            </div>
          )}
          {/* SSE status */}
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? "bg-emerald-400 animate-heartbeat" : "bg-gray-500"}`} />
            <span className={sseConnected ? "text-emerald-400" : "text-gray-500"}>
              {sseConnected ? "Live" : "Connecting\u2026"}
            </span>
          </span>
        </div>
      </div>

      {/* Filter bar */}
      {(allMessages.length > 0 || hasActiveFilters) && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <FilterSelect
            label="Type"
            value={filterType}
            onChange={(v) => updateFilter("type", v)}
            options={["chat", "memo", "command", "response", "sync"]}
            allLabel="All types"
          />
          <FilterSelect
            label="Status"
            value={filterStatus}
            onChange={(v) => updateFilter("status", v)}
            options={["pending", "claimed", "delivered", "read", "expired"]}
            allLabel="All statuses"
          />
          <FilterSelect
            label="Channel"
            value={filterChannel}
            onChange={(v) => updateFilter("channel", v)}
            options={messageChannelIds}
            formatOption={(id) => channelNameMap.get(id) || id.slice(0, 12)}
            allLabel="All channels"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Status summary pills */}
      {allMessages.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {(["pending", "claimed", "delivered", "read", "expired"] as MessageStatus[]).map((s) => {
            if (statusCounts[s] === 0) return null;
            const colors = MESSAGE_STATUS_COLORS[s];
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border border-gray-800 bg-gray-900/50"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                <span className={colors.text}>
                  {statusCounts[s]} {colors.label}
                </span>
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
          Refreshing\u2026
        </div>
      )}

      {/* Empty state — no messages at all */}
      {allMessages.length === 0 && !loaderError && (
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">&#128172;</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">
            {hasActiveFilters ? "No messages match filters" : "No messages found"}
          </h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                Clear all filters
              </button>
            ) : (
              "Messages appear when agents communicate through channels. Start agent daemons and send messages to see them here."
            )}
          </p>
        </div>
      )}

      {/* Message list */}
      {allMessages.length > 0 && (
        <div className="space-y-2">
          {allMessages.map((msg, idx) => {
            // A message is part of a thread if:
            // 1. It HAS a threadId (it's a reply) → link to /messages/thread/<threadId>
            // 2. It IS a thread root (other messages reference its id) → link to /messages/thread/<id>
            const isReply = !!msg.threadId;
            const isRoot = threadRootIds.has(msg.id);
            const hasThread = isReply || isRoot;
            const threadLink = isReply
              ? `/messages/thread/${msg.threadId}`
              : `/messages/thread/${msg.id}`;

            const card = (
              <MessageCard
                key={msg.id}
                message={msg}
                channelName={channelNameMap.get(msg.channelId)}
                animate={!mounted}
                isNew={page === 1 && idx < newMessages.length}
                clickable={hasThread}
              />
            );

            if (hasThread) {
              return (
                <Link key={msg.id} to={threadLink} className="block">
                  {card}
                </Link>
              );
            }
            return card;
          })}
        </div>
      )}

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
            {total > 0 && (
              <span className="text-gray-600"> ({total} total)</span>
            )}
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

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-4 py-3 shadow-lg animate-fade-in cursor-pointer ${
                toast.type === "error"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : toast.type === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    : "bg-blue-500/10 border-blue-500/30 text-blue-300"
              }`}
              onClick={() => dismissToast(toast.id)}
            >
              <p className="text-sm">{toast.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Select ──────────────────────────────────────

function FilterSelect({ label, value, onChange, options, formatOption, allLabel }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatOption?: (opt: string) => string;
  allLabel?: string;
}) {
  const fmt = formatOption || ((v: string) => v);
  const defaultAllLabel = allLabel || `All ${label.toLowerCase()}s`;
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-500 cursor-pointer appearance-none pr-7"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="all">{defaultAllLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{fmt(opt)}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Message Card ───────────────────────────────────────

function MessageCard({ message, channelName, animate, isNew, clickable }: {
  message: Message;
  channelName?: string;
  animate: boolean;
  isNew?: boolean;
  clickable?: boolean;
}) {
  const knownType = message.messageType in MESSAGE_TYPE_COLORS;
  const typeColors = knownType
    ? MESSAGE_TYPE_COLORS[message.messageType]
    : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: message.messageType || "unknown" };

  const knownStatus = message.status in MESSAGE_STATUS_COLORS;
  const statusColors = knownStatus
    ? MESSAGE_STATUS_COLORS[message.status]
    : { dot: "bg-gray-500", text: "text-gray-400", label: message.status || "unknown" };

  const sender = getSenderInfo(message);
  const channelDisplay = channelName || (message.channelId ? message.channelId.slice(0, 12) : "\u2014");
  const contentPreview = truncateContent(message.content);

  return (
    <div
      className={`group rounded-xl border bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 p-4 transition-colors ${
        clickable ? "cursor-pointer" : ""
      } ${
        isNew
          ? "border-blue-500/40 animate-fade-in"
          : animate
            ? "border-gray-800 animate-fade-in"
            : "border-gray-800"
      }`}
    >
      {/* Header: sender + badges */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0 mr-2">
          {/* Sender icon — Discord (blue) or generic user (gray) */}
          {sender.isDiscord ? (
            <DiscordIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          ) : (
            <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
          )}
          <span className={`text-sm font-medium truncate ${sender.isDiscord ? "text-blue-300" : "text-gray-200"}`}>{sender.name}</span>
          <span className="text-gray-600 shrink-0">&rarr;</span>
          {/* Channel */}
          <span className="text-xs text-gray-500 shrink-0">#</span>
          <span className="text-sm text-gray-400 truncate">{channelDisplay}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* New badge */}
          {isNew && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
              NEW
            </span>
          )}
          {/* Type badge */}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors.badge} ${typeColors.badgeText}`}
          >
            {typeColors.label}
          </span>
          {/* Status indicator */}
          <span className="inline-flex items-center gap-1 text-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`} />
            <span className={statusColors.text}>{statusColors.label}</span>
          </span>
        </div>
      </div>

      {/* Content preview */}
      <p className="text-sm text-gray-300 mb-2 line-clamp-2">{contentPreview}</p>

      {/* Footer: metadata row */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-800/60">
        {/* Timestamp */}
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span className="text-xs text-gray-500">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>

        {/* Thread indicator — show for both replies (threadId set) and roots (clickable) */}
        {clickable && (
          <div className="flex items-center gap-1.5">
            <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
            <span className="text-xs text-blue-400">thread</span>
          </div>
        )}

        {/* Clickable chevron for threaded messages */}
        {clickable && (
          <span className="ml-auto text-gray-600 group-hover:text-gray-300 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </span>
        )}

        {/* Target address (truncated) */}
        {message.targetAddress && (
          <span
            className="text-xs text-gray-600 truncate hidden sm:inline"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
            title={message.targetAddress}
          >
            {message.targetAddress.length > 30
              ? "\u2026" + message.targetAddress.slice(-28)
              : message.targetAddress}
          </span>
        )}

        {/* Expiry indicator */}
        {message.expiresAt && (
          <span className="text-xs text-red-400/60 ml-auto shrink-0">
            expires {formatRelativeTime(message.expiresAt)}
          </span>
        )}
      </div>
    </div>
  );
}
