/**
 * Dashboard Route - System Health Overview
 *
 * Shows machine cards, health indicators, recent activity, and stats.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { MachineCard } from "~/components/MachineCard";
import { buildHierarchy } from "~/lib/hierarchy";
import { useSignalDB } from "~/lib/signaldb";
import { useTranscriptLines } from "~/lib/sse-hooks";
import {
  deriveAgentStatus,
  formatTime,
  isChatMessage,
  isMailMessage,
  isMemoMessage,
} from "~/lib/types";

export default function Dashboard() {
  const { agents, channels, messages, connected, transcriptCounts, configured } = useSignalDB();

  // Small fetch-only load for "Recent Sessions" (no SSE stream)
  const localTranscriptStream = useTranscriptLines({ enabled: configured, maxItems: 100, fetchLimit: 100, stream: false });

  // Build machine hierarchy
  const machines = useMemo(() => buildHierarchy(agents), [agents]);

  // Agent status counts
  const statusCounts = useMemo(() => {
    const counts = { active: 0, idle: 0, offline: 0 };
    for (const agent of agents) {
      const status = deriveAgentStatus(agent.heartbeatAt);
      counts[status]++;
    }
    return counts;
  }, [agents]);

  // Message category counts
  const messageCounts = useMemo(() => {
    let chat = 0;
    let mail = 0;
    let memo = 0;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (isChatMessage(m)) chat++;
      if (isMailMessage(m)) mail++;
      if (isMemoMessage(m)) memo++;
    }
    return { chat, mail, memo };
  }, [messages]);

  // Recent messages (last 10)
  const recentMessages = useMemo(() => {
    return [...messages]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, 10);
  }, [messages]);

  // Agent name lookup
  const agentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.id, agent.sessionName || agent.machineId || agent.id.slice(0, 8));
    }
    return map;
  }, [agents]);

  // Recent sessions (from the small local stream)
  const recentSessions = useMemo(() => {
    const lines = localTranscriptStream.data;
    const map = new Map<string, { name: string | null; lastActive: string; lineCount: number }>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const existing = map.get(line.sessionId);
      if (!existing) {
        map.set(line.sessionId, { name: line.sessionName, lastActive: line.timestamp, lineCount: 1 });
      } else {
        existing.lineCount++;
        if (line.timestamp > existing.lastActive) existing.lastActive = line.timestamp;
        if (!existing.name && line.sessionName) existing.name = line.sessionName;
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => new Date(b[1].lastActive).getTime() - new Date(a[1].lastActive).getTime())
      .slice(0, 5);
  }, [localTranscriptStream.data]);

  const allConnected =
    connected.agents && connected.channels && connected.messages;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9 gap-4">
        <StatCard
          label="Agents"
          value={agents.length}
          detail={`${statusCounts.active} active`}
          color="blue"
        />
        <StatCard
          label="Channels"
          value={channels.length}
          color="purple"
        />
        <StatCard
          label="Chat"
          value={messageCounts.chat}
          color="emerald"
        />
        <StatCard
          label="Mail"
          value={messageCounts.mail}
          color="cyan"
        />
        <StatCard
          label="Memos"
          value={messageCounts.memo}
          color="amber"
        />
        <StatCard
          label="Sessions"
          value={transcriptCounts.sessions}
          color="indigo"
        />
        <StatCard
          label="Lines"
          value={transcriptCounts.lines}
          color="teal"
        />
        <StatCard
          label="Hook Events"
          value={transcriptCounts.hookEvents}
          color="rose"
        />
        <StatCard
          label="SSE"
          value={
            (connected.agents ? 1 : 0) +
            (connected.channels ? 1 : 0) +
            (connected.messages ? 1 : 0)
          }
          detail={allConnected ? "All connected" : "Partial"}
          color={allConnected ? "green" : "yellow"}
        />
      </div>

      {/* Machine cards */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          Machines
          <span className="ml-2 text-gray-500">({machines.length})</span>
        </h2>
        {machines.length === 0 ? (
          <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-4">
            No machines registered. Agents will appear here when they connect.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {machines.map((machine) => (
              <MachineCard key={machine.machineId} machine={machine} />
            ))}
          </div>
        )}
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">
            Recent Activity
          </h2>
          <Link
            to="/chat"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View all
          </Link>
        </div>
        {recentMessages.length === 0 ? (
          <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-4">
            No messages yet.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
            {recentMessages.map((msg) => (
              <div
                key={msg.id}
                className="px-4 py-2.5 flex items-center gap-3 text-sm"
              >
                <span className="text-xs text-gray-600 font-mono w-16 flex-shrink-0">
                  {formatTime(msg.createdAt)}
                </span>
                <TypeBadge type={msg.messageType} />
                <span className="text-gray-300 truncate">
                  {agentNames.get(msg.senderId) || (msg.senderId || msg.id || "unknown").slice(0, 8)}
                </span>
                <span className="text-gray-600">→</span>
                <span className="text-gray-500 truncate flex-1 min-w-0">
                  {(msg.content || "").slice(0, 60)}
                  {(msg.content || "").length > 60 ? "..." : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent sessions */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-300">
            Recent Sessions
          </h2>
          <Link
            to="/sessions"
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View all
          </Link>
        </div>
        {recentSessions.length === 0 ? (
          <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-4">
            No sessions yet. Transcript data will appear when synced.
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
            {recentSessions.map(([sessionId, data]) => (
              <Link
                key={sessionId}
                to={`/sessions/${encodeURIComponent(sessionId)}`}
                className="px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-gray-800/30 transition-colors block"
              >
                <span className="text-gray-300 truncate flex-1 min-w-0">
                  {data.name || sessionId.slice(0, 16)}
                </span>
                <span className="text-xs text-gray-500 font-mono flex-shrink-0">
                  {data.lineCount} lines
                </span>
                <span className="text-xs text-gray-600 font-mono flex-shrink-0">
                  {formatTime(data.lastActive)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function StatCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: number;
  detail?: string;
  color: string;
}) {
  const borderColor: Record<string, string> = {
    blue: "border-blue-800",
    purple: "border-purple-800",
    emerald: "border-emerald-800",
    cyan: "border-cyan-800",
    amber: "border-amber-800",
    green: "border-green-800",
    yellow: "border-yellow-800",
    indigo: "border-indigo-800",
    teal: "border-teal-800",
    rose: "border-rose-800",
  };

  const textColor: Record<string, string> = {
    blue: "text-blue-400",
    purple: "text-purple-400",
    emerald: "text-emerald-400",
    cyan: "text-cyan-400",
    amber: "text-amber-400",
    green: "text-green-400",
    yellow: "text-yellow-400",
    indigo: "text-indigo-400",
    teal: "text-teal-400",
    rose: "text-rose-400",
  };

  return (
    <div
      className={`bg-gray-900 border ${borderColor[color] || "border-gray-800"} rounded-lg p-4`}
    >
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${textColor[color] || "text-gray-200"}`}>
        {value}
      </div>
      {detail && <div className="text-xs text-gray-500 mt-1">{detail}</div>}
    </div>
  );
}

const typeBadgeColors: Record<string, string> = {
  chat: "bg-gray-700 text-gray-300",
  memo: "bg-blue-900/50 text-blue-400",
  command: "bg-orange-900/50 text-orange-400",
  response: "bg-green-900/50 text-green-400",
};

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
        typeBadgeColors[type] || "bg-gray-800 text-gray-400"
      }`}
    >
      {type}
    </span>
  );
}
