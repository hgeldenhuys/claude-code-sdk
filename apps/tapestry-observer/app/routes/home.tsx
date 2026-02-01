/**
 * Dashboard — Landing page
 *
 * Summary view with agent counts and recent activity.
 * Uses polling (10s) for stable updates instead of SSE.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router";
import { useLayoutContext } from "./layout";
import {
  type Agent,
  type Channel,
  type Message,
  type AgentWithStatus,
  POLL_INTERVAL_MS,
  TICK_INTERVAL_MS,
  STATUS_COLORS,
  parseAgents,
  parseChannels,
  parseMessages,
  deriveAndSort,
  countByStatus,
  agentsChanged,
  channelsChanged,
  messagesChanged,
  formatRelativeTime,
} from "../lib/utils";

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
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

      {/* Recent activity */}
      {!loading && recentActive.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Recent Activity
            </h3>
            <Link
              to="/agents"
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              View all agents &rarr;
            </Link>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
            {recentActive.map((agent) => (
              <ActivityRow key={agent.id} agent={agent} />
            ))}
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
    <div className="flex items-center gap-3 px-4 py-3">
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
    </div>
  );
}
