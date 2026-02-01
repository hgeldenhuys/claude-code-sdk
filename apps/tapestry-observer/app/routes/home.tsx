/**
 * Dashboard — Landing page
 *
 * Summary view with agent counts, message stats, delivery health,
 * activity feed, and top channels. Uses polling (10s) for stable updates.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { useLayoutContext } from "./layout";
import {
  type Agent,
  type Channel,
  type Message,
  type MessageType,
  type AgentWithStatus,
  POLL_INTERVAL_MS,
  TICK_INTERVAL_MS,
  STATUS_COLORS,
  MESSAGE_TYPE_COLORS,
  parseAgents,
  parseChannels,
  parseMessages,
  deriveAndSort,
  countByStatus,
  agentsChanged,
  channelsChanged,
  messagesChanged,
  formatRelativeTime,
  truncateContent,
  getSenderInfo,
} from "../lib/utils";
import { DiscordIcon } from "../lib/icons";

export default function Dashboard() {
  const { configOk } = useLayoutContext();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const agentsRef = useRef<Agent[]>([]);
  const channelsRef = useRef<Channel[]>([]);
  const messagesRef = useRef<Message[]>([]);

  // ─── Polling ──────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!configOk) return;
    try {
      const [agentsRes, channelsRes, messagesRes] = await Promise.all([
        fetch("/api/proxy/v1/agents?limit=50&orderBy=heartbeat_at&order=desc"),
        fetch("/api/proxy/v1/channels?limit=100&orderBy=created_at&order=desc"),
        fetch("/api/proxy/v1/messages?limit=100&orderBy=created_at&order=desc"),
      ]);

      if (agentsRes.ok) {
        const data = await agentsRes.json();
        const parsed = parseAgents(data);
        if (agentsChanged(agentsRef.current, parsed)) {
          agentsRef.current = parsed;
          setAgents(parsed);
        }
      }

      if (channelsRes.ok) {
        const data = await channelsRes.json();
        const parsed = parseChannels(data);
        if (channelsChanged(channelsRef.current, parsed)) {
          channelsRef.current = parsed;
          setChannels(parsed);
        }
      }

      if (messagesRes.ok) {
        const data = await messagesRes.json();
        const parsed = parseMessages(data);
        if (messagesChanged(messagesRef.current, parsed)) {
          messagesRef.current = parsed;
          setMessages(parsed);
        }
      }

      setLastPolled(new Date());
      setLoading(false);
    } catch {
      // Silently fail — dashboard is non-critical
      setLoading(false);
    }
  }, [configOk]);

  // Initial fetch + polling interval
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Timestamp refresh (cheap, no network)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // ─── Derived data ─────────────────────────────────────

  void tick; // force re-computation on tick
  const sorted = deriveAndSort(agents);
  const counts = countByStatus(sorted);
  const recentActive = sorted.filter((a) => a.derivedStatus !== "offline").slice(0, 5);

  // Message type breakdown
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { chat: 0, memo: 0, command: 0, response: 0, sync: 0 };
    for (const msg of messages) {
      if (msg.messageType in c) c[msg.messageType]++;
    }
    return c;
  }, [messages]);

  // Delivery health
  const deliveryStats = useMemo(() => {
    let pending = 0;
    let delivered = 0;
    let total = 0;
    for (const msg of messages) {
      total++;
      if (msg.status === "pending") pending++;
      else if (msg.status === "delivered" || msg.status === "read") delivered++;
    }
    return { pending, delivered, total, pct: total > 0 ? Math.round((delivered / total) * 100) : 0 };
  }, [messages]);

  // Active threads count
  const threadCount = useMemo(() => {
    const ids = new Set<string>();
    for (const msg of messages) {
      if (msg.threadId) ids.add(msg.threadId);
    }
    return ids.size;
  }, [messages]);

  // Recent 10 messages for activity feed
  const recentMessages = useMemo(() => {
    const copy = [...messages];
    copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return copy.slice(0, 10);
  }, [messages]);

  // Channel name map
  const channelNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) {
      if (ch.id && ch.name) map.set(ch.id, ch.name);
    }
    return map;
  }, [channels]);

  // Top 5 channels by message count
  const topChannels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const msg of messages) {
      if (msg.channelId) {
        counts.set(msg.channelId, (counts.get(msg.channelId) || 0) + 1);
      }
    }
    const entries = [...counts.entries()];
    entries.sort((a, b) => b[1] - a[1]);
    return entries.slice(0, 5).map(([id, count]) => ({
      id,
      name: channelNameMap.get(id) || id.slice(0, 12),
      count,
    }));
  }, [messages, channelNameMap]);

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
      {/* Title */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-100">Dashboard</h2>
        {lastPolled && (
          <span className="text-xs text-gray-500">
            Last updated: {lastPolled.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 animate-pulse">
              <div className="h-8 w-16 bg-gray-800 rounded mb-2" />
              <div className="h-4 w-24 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <StatCard
            count={counts.active}
            label="Active agents"
            dotColor="bg-emerald-400"
            textColor="text-emerald-400"
          />
          <StatCard
            count={counts.idle}
            label="Idle agents"
            dotColor="bg-amber-400"
            textColor="text-amber-300"
          />
          <StatCard
            count={counts.offline}
            label="Offline agents"
            dotColor="bg-gray-500"
            textColor="text-gray-400"
          />
          <StatCard
            count={channels.length}
            label="Channels"
            dotColor="bg-blue-400"
            textColor="text-blue-400"
          />
          <StatCard
            count={messages.length}
            label="Messages"
            dotColor="bg-violet-400"
            textColor="text-violet-400"
          />
        </div>
      )}

      {/* Message Volume Breakdown + Delivery Health + Threads row */}
      {!loading && messages.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Message Volume */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Message Volume</h4>
            <div className="flex flex-wrap gap-2">
              {(["chat", "memo", "command", "response", "sync"] as const).map((t) => {
                if (typeCounts[t] === 0) return null;
                const colors = MESSAGE_TYPE_COLORS[t];
                return (
                  <span
                    key={t}
                    className={`inline-flex items-center px-2 py-1 rounded-full text-xs border ${colors.badge} ${colors.badgeText}`}
                  >
                    {typeCounts[t]} {colors.label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Delivery Health */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Delivery Health</h4>
            <div className="flex items-center gap-4 mb-2">
              {deliveryStats.pending > 0 && (
                <span className="text-xs text-amber-300">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1" />
                  {deliveryStats.pending} pending
                </span>
              )}
              <span className="text-xs text-emerald-300">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" />
                {deliveryStats.delivered} delivered
              </span>
            </div>
            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                style={{ width: `${deliveryStats.pct}%` }}
              />
            </div>
            <span className="text-[11px] text-gray-500 mt-1 block">{deliveryStats.pct}% delivered</span>
          </div>

          {/* Active Threads */}
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Active Threads</h4>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
              <span className="text-2xl font-bold text-blue-400">{threadCount}</span>
              <span className="text-sm text-gray-500">thread{threadCount !== 1 ? "s" : ""}</span>
            </div>
            <Link
              to="/messages"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-2 inline-block"
            >
              View messages &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* Two-column layout: Activity Feed + Top Channels */}
      {!loading && (messages.length > 0 || recentActive.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Recent Activity Feed */}
          {recentMessages.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                  Recent Activity
                </h3>
                <Link
                  to="/messages"
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  View all &rarr;
                </Link>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
                {recentMessages.map((msg) => {
                  const sender = getSenderInfo(msg);
                  const channelName = channelNameMap.get(msg.channelId);
                  const threadLink = msg.threadId ? `/messages/thread/${msg.threadId}` : null;
                  const row = (
                    <div key={msg.id} className={`flex items-center gap-2 px-4 py-2.5 ${threadLink ? "hover:bg-gray-800/40 cursor-pointer" : ""} transition-colors`}>
                      {sender.isDiscord ? (
                        <DiscordIcon className="w-3 h-3 text-blue-400 shrink-0" />
                      ) : (
                        <svg className="w-3 h-3 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                      )}
                      <span className={`text-xs font-medium shrink-0 ${sender.isDiscord ? "text-blue-300" : "text-gray-300"}`}>
                        {sender.name}
                      </span>
                      {channelName && (
                        <>
                          <span className="text-gray-600 shrink-0">&rarr;</span>
                          <span className="text-xs text-gray-500 shrink-0">#{channelName}</span>
                        </>
                      )}
                      <span className="text-xs text-gray-500 truncate mx-1">
                        {truncateContent(msg.content, 40)}
                      </span>
                      <span className="ml-auto text-[10px] text-gray-600 whitespace-nowrap shrink-0">
                        {formatRelativeTime(msg.createdAt)}
                      </span>
                    </div>
                  );
                  if (threadLink) {
                    return <Link key={msg.id} to={threadLink} className="block">{row}</Link>;
                  }
                  return row;
                })}
              </div>
            </div>
          )}

          {/* Right column: Top Channels + Active Agents */}
          <div className="space-y-6">
            {/* Top Channels */}
            {topChannels.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                    Top Channels
                  </h3>
                  <Link
                    to="/channels"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View all &rarr;
                  </Link>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
                  {topChannels.map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/channels/${ch.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-800/40 transition-colors block"
                    >
                      <span className="text-gray-500 shrink-0">#</span>
                      <span className="text-sm text-gray-200 font-medium truncate">{ch.name}</span>
                      <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-400/15 border border-violet-400/30 text-violet-300 shrink-0">
                        {ch.count} msg{ch.count !== 1 ? "s" : ""}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Active Agents */}
            {recentActive.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
                    Active Agents
                  </h3>
                  <Link
                    to="/agents"
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    View all &rarr;
                  </Link>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
                  {recentActive.map((agent) => (
                    <ActivityRow key={agent.id} agent={agent} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && agents.length === 0 && (
        <div className="text-center py-16">
          <div className="text-gray-600 text-4xl mb-4">&#128269;</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">No agents found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Start a Claude Code agent daemon to see agents appear here.
            Run <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>bun run agent-daemon</code> in a project directory.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function StatCard({ count, label, dotColor, textColor }: {
  count: number;
  label: string;
  dotColor: string;
  textColor: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${dotColor}`} />
        <span className={`text-3xl font-bold ${textColor}`}>{count}</span>
      </div>
      <p className="text-sm text-gray-500">{label}</p>
    </div>
  );
}

function ActivityRow({ agent }: { agent: AgentWithStatus }) {
  const colors = STATUS_COLORS[agent.derivedStatus];
  return (
    <Link
      to={`/agents/${agent.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40 transition-colors block"
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot} ${
        agent.derivedStatus === "active" ? "animate-heartbeat" : ""
      }`} />
      <span className="text-sm text-gray-200 font-medium truncate">
        {agent.sessionName || agent.sessionId?.slice(0, 8) || "unknown"}
      </span>
      <span className="text-xs text-gray-500 truncate hidden sm:inline">
        {agent.machineId}
      </span>
      <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">
        heartbeat {formatRelativeTime(agent.heartbeatAt)}
      </span>
    </Link>
  );
}
