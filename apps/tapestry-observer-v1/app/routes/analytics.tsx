/**
 * Analytics Dashboard Route
 *
 * Aggregated statistics and visual breakdowns for transcript data.
 * All charts are CSS/div-based — no chart library dependency.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { useSignalDB } from "~/lib/signaldb";
import { useHookEvents, useTranscriptLines } from "~/lib/sse-hooks";
import { getEventTypeColor, getLineTypeBgColor } from "~/lib/types";

export default function AnalyticsRoute() {
  const { agents, configured } = useSignalDB();
  const transcriptStream = useTranscriptLines({ enabled: configured, maxItems: 500, fetchLimit: 500, stream: false });
  const hookEventsStream = useHookEvents({ enabled: configured, maxItems: 300, fetchLimit: 300, stream: false });
  const transcriptLines = transcriptStream.data;
  const hookEvents = hookEventsStream.data;

  // ── Computed Stats ──
  const stats = useMemo(() => {
    const sessionSet = new Set<string>();
    const machineSet = new Set<string>();
    const typeCounts: Record<string, number> = {};

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      sessionSet.add(line.sessionId);
      machineSet.add(line.machineId);
      typeCounts[line.type] = (typeCounts[line.type] || 0) + 1;
    }

    return {
      totalSessions: sessionSet.size,
      totalLines: transcriptLines.length,
      totalHookEvents: hookEvents.length,
      activeMachines: machineSet.size,
      typeCounts,
    };
  }, [transcriptLines, hookEvents]);

  // ── Top Sessions ──
  const topSessions = useMemo(() => {
    const map = new Map<string, { name: string | null; count: number; lastActive: string }>();

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      const existing = map.get(line.sessionId);
      if (!existing) {
        map.set(line.sessionId, {
          name: line.sessionName,
          count: 1,
          lastActive: line.timestamp,
        });
      } else {
        existing.count++;
        if (line.timestamp > existing.lastActive) existing.lastActive = line.timestamp;
        if (!existing.name && line.sessionName) existing.name = line.sessionName;
      }
    }

    return Array.from(map.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
  }, [transcriptLines]);

  // ── Hook Event Type Distribution ──
  const hookTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < hookEvents.length; i++) {
      const type = hookEvents[i]!.eventType;
      counts[type] = (counts[type] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [hookEvents]);

  // ── Machine Activity ──
  const machineActivity = useMemo(() => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < transcriptLines.length; i++) {
      const machine = transcriptLines[i]!.machineId;
      counts[machine] = (counts[machine] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [transcriptLines]);

  // ── Activity Timeline (last 24 hours, hourly buckets) ──
  const activityTimeline = useMemo(() => {
    const now = Date.now();
    const buckets: number[] = new Array(24).fill(0);

    for (let i = 0; i < transcriptLines.length; i++) {
      const ts = new Date(transcriptLines[i]!.timestamp).getTime();
      const hoursAgo = Math.floor((now - ts) / 3600000);
      if (hoursAgo >= 0 && hoursAgo < 24) {
        buckets[23 - hoursAgo]!++;
      }
    }

    return buckets;
  }, [transcriptLines]);

  const maxTimelineValue = Math.max(...activityTimeline, 1);

  // ── Type breakdown max for bar chart scaling ──
  const typeEntries = Object.entries(stats.typeCounts).sort((a, b) => b[1] - a[1]);
  const maxTypeCount = typeEntries.length > 0 ? typeEntries[0]![1] : 1;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <h1 className="text-lg font-semibold text-gray-100">Analytics</h1>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Sessions" value={stats.totalSessions} color="blue" />
        <StatCard label="Transcript Lines" value={stats.totalLines} color="emerald" />
        <StatCard label="Hook Events" value={stats.totalHookEvents} color="purple" />
        <StatCard label="Machines" value={stats.activeMachines} color="cyan" />
      </div>

      {/* Activity timeline */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          Activity (Last 24 Hours)
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="flex items-end gap-0.5 h-24">
            {activityTimeline.map((count, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end">
                <div
                  className="w-full bg-blue-600/60 rounded-t-sm min-h-[2px] transition-all"
                  style={{ height: `${(count / maxTimelineValue) * 100}%` }}
                  title={`${24 - i}h ago: ${count} lines`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-gray-600">-24h</span>
            <span className="text-[10px] text-gray-600">-12h</span>
            <span className="text-[10px] text-gray-600">now</span>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line type breakdown */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Line Type Breakdown
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
            {typeEntries.length === 0 ? (
              <div className="text-xs text-gray-500">No data yet.</div>
            ) : (
              typeEntries.map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className={`text-xs px-1.5 py-0.5 rounded w-20 text-center ${getLineTypeBgColor(type)}`}>
                    {type}
                  </span>
                  <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-blue-600/50 rounded-full transition-all"
                      style={{ width: `${(count / maxTypeCount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400 font-mono w-12 text-right">
                    {count}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Hook event type distribution */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Hook Event Types
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
            {hookTypeCounts.length === 0 ? (
              <div className="text-xs text-gray-500">No data yet.</div>
            ) : (
              hookTypeCounts.map(([type, count]) => {
                const maxHook = hookTypeCounts[0]![1];
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className={`text-xs px-1.5 py-0.5 rounded w-28 text-center ${getEventTypeColor(type)}`}>
                      {type}
                    </span>
                    <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-purple-600/50 rounded-full transition-all"
                        style={{ width: `${(count / maxHook) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 font-mono w-12 text-right">
                      {count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top sessions */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Top Sessions by Lines
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {topSessions.length === 0 ? (
              <div className="p-4 text-xs text-gray-500">No sessions yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-800">
                    <th className="px-3 py-2 text-left font-normal">Session</th>
                    <th className="px-3 py-2 text-right font-normal">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {topSessions.map(([id, data]) => (
                    <tr key={id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                      <td className="px-3 py-2">
                        <Link
                          to={`/sessions/${encodeURIComponent(id)}`}
                          className="text-blue-400 hover:text-blue-300"
                        >
                          {data.name || id.slice(0, 12)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400 font-mono">
                        {data.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Machine activity */}
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">
            Machine Activity
          </h2>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
            {machineActivity.length === 0 ? (
              <div className="text-xs text-gray-500">No data yet.</div>
            ) : (
              machineActivity.map(([machine, count]) => {
                const maxMachine = machineActivity[0]![1];
                return (
                  <div key={machine} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-mono w-24 truncate" title={machine}>
                      {machine}
                    </span>
                    <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full bg-cyan-600/50 rounded-full transition-all"
                        style={{ width: `${(count / maxMachine) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400 font-mono w-12 text-right">
                      {count}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const borderColor: Record<string, string> = {
    blue: "border-blue-800",
    emerald: "border-emerald-800",
    purple: "border-purple-800",
    cyan: "border-cyan-800",
  };
  const textColor: Record<string, string> = {
    blue: "text-blue-400",
    emerald: "text-emerald-400",
    purple: "text-purple-400",
    cyan: "text-cyan-400",
  };

  return (
    <div className={`bg-gray-900 border ${borderColor[color] || "border-gray-800"} rounded-lg p-4`}>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${textColor[color] || "text-gray-200"}`}>
        {value}
      </div>
    </div>
  );
}
