/**
 * Session Detail Route
 *
 * View a single session's transcript with hook events sidebar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { HookEventRow } from "~/components/HookEventRow";
import { TranscriptLineRow } from "~/components/TranscriptLineRow";
import { useSignalDB } from "~/lib/signaldb";
import { useHookEvents, useTranscriptLines } from "~/lib/sse-hooks";
import {
  formatDuration,
  formatRelativeTime,
  getLineTypeBgColor,
  type HookEvent,
  type TranscriptLine,
} from "~/lib/types";

export default function SessionDetailRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { configured } = useSignalDB();

  // Local streams scoped to this route (not global context)
  // Fetch-only (no SSE) — full session data is loaded on-demand via loadFullSession
  const transcriptStream = useTranscriptLines({ enabled: configured, maxItems: 200, fetchLimit: 200, stream: false });
  const hookEventsStream = useHookEvents({ enabled: configured, maxItems: 200, fetchLimit: 200, stream: false });

  const [showHookPanel, setShowHookPanel] = useState(true);
  const [onDemandLines, setOnDemandLines] = useState<TranscriptLine[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  // Lines from local stream for this session
  const contextLines = useMemo(() => {
    const lines: TranscriptLine[] = [];
    const data = transcriptStream.data;
    for (let i = 0; i < data.length; i++) {
      if (data[i]!.sessionId === sessionId) {
        lines.push(data[i]!);
      }
    }
    return lines.sort((a, b) => a.lineNumber - b.lineNumber);
  }, [transcriptStream.data, sessionId]);

  // Merge context lines with on-demand lines
  const allLines = useMemo(() => {
    const map = new Map<string, TranscriptLine>();
    for (let i = 0; i < onDemandLines.length; i++) {
      map.set(onDemandLines[i]!.id, onDemandLines[i]!);
    }
    for (let i = 0; i < contextLines.length; i++) {
      map.set(contextLines[i]!.id, contextLines[i]!);
    }
    return Array.from(map.values()).sort((a, b) => a.lineNumber - b.lineNumber);
  }, [contextLines, onDemandLines]);

  // Hook events for this session (from local stream)
  const sessionHookEvents = useMemo(() => {
    const events: HookEvent[] = [];
    const data = hookEventsStream.data;
    for (let i = 0; i < data.length; i++) {
      if (data[i]!.sessionId === sessionId) {
        events.push(data[i]!);
      }
    }
    return events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [hookEventsStream.data, sessionId]);

  // Session metadata
  const meta = useMemo(() => {
    if (allLines.length === 0) return null;
    const first = allLines[0]!;
    const last = allLines[allLines.length - 1]!;

    const typeCounts: Record<string, number> = {};
    const turnSet = new Set<string>();
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i]!;
      typeCounts[line.type] = (typeCounts[line.type] || 0) + 1;
      if (line.turnId) turnSet.add(line.turnId);
    }

    return {
      sessionName: first.sessionName || "Unnamed Session",
      machineId: first.machineId,
      gitBranch: first.gitBranch,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      lineCount: allLines.length,
      typeCounts,
      turnCount: turnSet.size,
      duration: new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime(),
    };
  }, [allLines]);

  // Load more lines on-demand from the proxy
  const loadFullSession = useCallback(async () => {
    if (!sessionId || loadingMore) return;
    setLoadingMore(true);
    try {
      const resp = await fetch(
        `/api/proxy/v1/transcript_lines?session_id=${encodeURIComponent(sessionId)}&limit=2000&sort=line_number`
      );
      if (resp.ok) {
        const json = await resp.json();
        const data = json.data || json;
        // Simple snake_case to camelCase for the response
        const lines: TranscriptLine[] = [];
        for (let i = 0; i < data.length; i++) {
          const d = data[i];
          lines.push({
            id: d.id,
            machineId: d.machine_id || d.machineId || "",
            sessionId: d.session_id || d.sessionId || "",
            sessionName: d.session_name || d.sessionName || null,
            slug: d.slug || null,
            lineNumber: d.line_number ?? d.lineNumber ?? 0,
            timestamp: d.timestamp || "",
            type: d.type || "",
            subtype: d.subtype || null,
            role: d.role || null,
            content: d.content || "",
            turnId: d.turn_id || d.turnId || null,
            gitHash: d.git_hash || d.gitHash || null,
            gitBranch: d.git_branch || d.gitBranch || null,
            sourceFile: d.source_file || d.sourceFile || "",
            syncedAt: d.synced_at || d.syncedAt || "",
          });
        }
        setOnDemandLines(lines);
      }
    } catch {
      // Silently fail — context lines are still available
    } finally {
      setLoadingMore(false);
    }
  }, [sessionId, loadingMore]);

  // Auto-load full session data from proxy on mount
  // The local SSE stream has capped data across all sessions, so we always
  // fetch the full session on-demand for the detail view.
  useEffect(() => {
    loadFullSession();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Identify turn boundaries
  const turnBoundaries = useMemo(() => {
    const boundaries = new Set<number>();
    let lastTurn: string | null = null;
    for (let i = 0; i < allLines.length; i++) {
      const line = allLines[i]!;
      if (line.turnId && line.turnId !== lastTurn) {
        boundaries.add(i);
        lastTurn = line.turnId;
      }
    }
    return boundaries;
  }, [allLines]);

  if (!sessionId) {
    return (
      <div className="p-6 text-gray-400">Session ID not found.</div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Main transcript area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-800 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Link to="/sessions" className="text-xs text-blue-400 hover:text-blue-300">&larr; Sessions</Link>
          </div>

          {meta ? (
            <>
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold text-gray-100">{meta.sessionName}</h1>
                {meta.gitBranch && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">
                    {meta.gitBranch}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 font-mono mt-1">
                {meta.machineId} &middot; {sessionId.slice(0, 20)}...
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                <span className="text-xs text-gray-400">{meta.lineCount} lines</span>
                <span className="text-xs text-gray-400">{meta.turnCount} turns</span>
                <span className="text-xs text-gray-400">{formatDuration(meta.duration)}</span>
                <span className="text-xs text-gray-500">{formatRelativeTime(meta.lastTimestamp)}</span>

                {Object.entries(meta.typeCounts).map(([type, count]) => (
                  <span key={type} className={`text-xs px-1.5 py-0.5 rounded ${getLineTypeBgColor(type)}`}>
                    {count} {type}
                  </span>
                ))}

                {allLines.length < 50 && (
                  <button
                    onClick={loadFullSession}
                    disabled={loadingMore}
                    className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                  >
                    {loadingMore ? "Loading..." : "Load full session"}
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="text-gray-500">Loading session...</div>
          )}
        </div>

        {/* Transcript lines */}
        <div className="flex-1 overflow-auto">
          {allLines.length === 0 ? (
            <div className="p-6 text-sm text-gray-500 text-center">
              No transcript lines for this session.
              <button
                onClick={loadFullSession}
                className="ml-2 text-blue-400 hover:text-blue-300"
              >
                Try loading from server
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-800/30">
              {allLines.map((line, idx) => (
                <div key={line.id}>
                  {turnBoundaries.has(idx) && idx > 0 && (
                    <div className="px-4 py-1 bg-gray-800/20 border-t border-gray-700/30">
                      <span className="text-[10px] text-gray-600 font-mono">
                        Turn {line.turnId || "?"}
                      </span>
                    </div>
                  )}
                  <TranscriptLineRow line={line} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hook events sidebar */}
      {showHookPanel && (
        <div className="w-80 flex-shrink-0 border-l border-gray-800 flex flex-col bg-gray-900/30">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h2 className="text-sm font-medium text-gray-300">
              Hook Events ({sessionHookEvents.length})
            </h2>
            <button
              onClick={() => setShowHookPanel(false)}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              &#x2715;
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {sessionHookEvents.length === 0 ? (
              <div className="p-4 text-xs text-gray-500 text-center">
                No hook events for this session.
              </div>
            ) : (
              sessionHookEvents.map((event) => (
                <HookEventRow key={event.id} event={event} showSessionInfo={false} />
              ))
            )}
          </div>
        </div>
      )}

      {/* Toggle hook panel button */}
      {!showHookPanel && (
        <button
          onClick={() => setShowHookPanel(true)}
          className="absolute right-4 top-20 text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded hover:text-gray-200"
        >
          Show Events
        </button>
      )}
    </div>
  );
}
