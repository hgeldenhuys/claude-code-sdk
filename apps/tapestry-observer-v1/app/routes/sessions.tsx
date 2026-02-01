/**
 * Sessions Browser Route
 *
 * Browse all indexed sessions, filter, sort, drill into detail.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { SearchInput } from "~/components/SearchInput";
import { useSignalDB } from "~/lib/signaldb";
import { useTranscriptLines } from "~/lib/sse-hooks";
import {
  formatDuration,
  formatRelativeTime,
  getLineTypeBgColor,
  type TranscriptLine,
} from "~/lib/types";

interface SessionSummary {
  sessionId: string;
  sessionName: string | null;
  machineId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  lineCount: number;
  typeCounts: Record<string, number>;
  gitBranch: string | null;
}

type SortField = "recent" | "lines" | "name";

export default function SessionsRoute() {
  const { configured } = useSignalDB();
  const transcriptStream = useTranscriptLines({ enabled: configured, maxItems: 500, fetchLimit: 500, stream: false });
  const transcriptLines = transcriptStream.data;
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("recent");
  const [machineFilter, setMachineFilter] = useState("");

  // Group lines by session
  const sessions = useMemo(() => {
    const map = new Map<string, SessionSummary>();

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      let session = map.get(line.sessionId);

      if (!session) {
        session = {
          sessionId: line.sessionId,
          sessionName: line.sessionName,
          machineId: line.machineId,
          firstTimestamp: line.timestamp,
          lastTimestamp: line.timestamp,
          lineCount: 0,
          typeCounts: {},
          gitBranch: line.gitBranch,
        };
        map.set(line.sessionId, session);
      }

      session.lineCount++;
      session.typeCounts[line.type] = (session.typeCounts[line.type] || 0) + 1;

      if (line.timestamp < session.firstTimestamp) session.firstTimestamp = line.timestamp;
      if (line.timestamp > session.lastTimestamp) session.lastTimestamp = line.timestamp;
      if (!session.sessionName && line.sessionName) session.sessionName = line.sessionName;
      if (!session.gitBranch && line.gitBranch) session.gitBranch = line.gitBranch;
    }

    return Array.from(map.values());
  }, [transcriptLines]);

  // Get unique machines for filter
  const machines = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < sessions.length; i++) {
      set.add(sessions[i]!.machineId);
    }
    return Array.from(set).sort();
  }, [sessions]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = sessions;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          (s.sessionName && s.sessionName.toLowerCase().includes(q)) ||
          s.sessionId.toLowerCase().includes(q)
      );
    }

    if (machineFilter) {
      result = result.filter((s) => s.machineId === machineFilter);
    }

    switch (sortBy) {
      case "recent":
        result = [...result].sort(
          (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
        );
        break;
      case "lines":
        result = [...result].sort((a, b) => b.lineCount - a.lineCount);
        break;
      case "name":
        result = [...result].sort((a, b) =>
          (a.sessionName || a.sessionId).localeCompare(b.sessionName || b.sessionId)
        );
        break;
    }

    return result;
  }, [sessions, search, sortBy, machineFilter]);

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-lg font-semibold text-gray-100">Sessions</h1>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 max-w-sm">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search sessions..."
          />
        </div>

        <select
          value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="">All machines</option>
          {machines.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortField)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="recent">Most Recent</option>
          <option value="lines">Most Lines</option>
          <option value="name">By Name</option>
        </select>

        <span className="text-xs text-gray-500">
          {filtered.length} session{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Session list */}
      {filtered.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          {transcriptLines.length === 0
            ? "No transcript lines synced yet. The daemon will stream them in real-time."
            : "No sessions match your filters."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((session) => (
            <SessionCard key={session.sessionId} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: SessionSummary }) {
  const duration = new Date(session.lastTimestamp).getTime() - new Date(session.firstTimestamp).getTime();

  return (
    <Link
      to={`/sessions/${encodeURIComponent(session.sessionId)}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Session name */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-200">
              {session.sessionName || "Unnamed Session"}
            </span>
            {session.gitBranch && (
              <span className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">
                {session.gitBranch}
              </span>
            )}
          </div>

          {/* Session ID + machine */}
          <div className="text-xs text-gray-500 font-mono mt-1">
            {session.sessionId.slice(0, 16)}... &middot; {session.machineId}
          </div>

          {/* Time range */}
          <div className="text-xs text-gray-500 mt-1">
            {formatRelativeTime(session.lastTimestamp)} &middot; duration {formatDuration(duration)}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Type breakdown badges */}
          {Object.entries(session.typeCounts).map(([type, count]) => (
            <span
              key={type}
              className={`text-xs px-1.5 py-0.5 rounded ${getLineTypeBgColor(type)}`}
            >
              {count} {type}
            </span>
          ))}

          {/* Total line count */}
          <span className="text-sm font-mono text-gray-400 ml-2">
            {session.lineCount} lines
          </span>
        </div>
      </div>
    </Link>
  );
}
