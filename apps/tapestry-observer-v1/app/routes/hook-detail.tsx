/**
 * Hook Event Detail Route
 *
 * Detailed view of a single hook event with full JSON data.
 */

import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { JsonTreeViewer } from "~/components/JsonTreeViewer";
import { useSignalDB } from "~/lib/signaldb";
import { useHookEvents } from "~/lib/sse-hooks";
import { formatRelativeTime, formatTime, getEventTypeColor } from "~/lib/types";

export default function HookDetailRoute() {
  const { eventId } = useParams<{ eventId: string }>();
  const { configured } = useSignalDB();
  const hookEventsStream = useHookEvents({ enabled: configured, maxItems: 300, fetchLimit: 300, stream: false });
  const hookEvents = hookEventsStream.data;

  const event = useMemo(() => {
    for (let i = 0; i < hookEvents.length; i++) {
      if (hookEvents[i]!.id === eventId) return hookEvents[i]!;
    }
    return null;
  }, [hookEvents, eventId]);

  if (!event) {
    return (
      <div className="p-6 space-y-4 max-w-4xl">
        <Link to="/hooks" className="text-xs text-blue-400 hover:text-blue-300">&larr; Hook Events</Link>
        <div className="text-gray-400">Event not found. It may not have been loaded yet.</div>
      </div>
    );
  }

  let inputData: unknown = null;
  let handlerData: unknown = null;

  if (event.inputJson) {
    try { inputData = JSON.parse(event.inputJson); } catch { /* ignore */ }
  }
  if (event.handlerResultsJson) {
    try { handlerData = JSON.parse(event.handlerResultsJson); } catch { /* ignore */ }
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Breadcrumb */}
      <Link to="/hooks" className="text-xs text-blue-400 hover:text-blue-300">&larr; Hook Events</Link>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className={`text-sm px-2 py-1 rounded ${getEventTypeColor(event.eventType)}`}>
            {event.eventType}
          </span>
          {event.toolName && (
            <span className="text-sm bg-gray-700 text-gray-300 px-2 py-1 rounded">
              {event.toolName}
            </span>
          )}
          {event.decision && event.decision !== "allow" && (
            <span className="text-sm bg-red-900/50 text-red-400 px-2 py-1 rounded">
              {event.decision}
            </span>
          )}
        </div>

        <div className="text-xs text-gray-500 font-mono">
          ID: {event.id}
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-4">
        <MetadataField label="Session" value={event.sessionName || event.sessionId.slice(0, 16)} mono />
        <MetadataField label="Machine" value={event.machineId} mono />
        <MetadataField label="Turn" value={event.turnId || "—"} mono />
        <MetadataField label="Timestamp" value={`${formatTime(event.timestamp)} (${formatRelativeTime(event.timestamp)})`} />
        {event.gitBranch && <MetadataField label="Git Branch" value={event.gitBranch} mono />}
        {event.gitHash && <MetadataField label="Git Hash" value={event.gitHash.slice(0, 8)} mono />}
        <MetadataField label="Source File" value={event.sourceFile} mono />
      </div>

      {/* Input JSON */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">Input</h2>
        {inputData ? (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <JsonTreeViewer data={inputData} label="Input Data" defaultExpanded maxDepth={6} />
          </div>
        ) : (
          <div className="text-xs text-gray-600 italic">No input data</div>
        )}
      </section>

      {/* Handler Results */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">Handler Results</h2>
        {handlerData ? (
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
            <JsonTreeViewer data={handlerData} label="Handler Results" defaultExpanded maxDepth={6} />
          </div>
        ) : (
          <div className="text-xs text-gray-600 italic">No handler results</div>
        )}
      </section>

      {/* Link to session */}
      <div>
        <Link
          to={`/sessions/${encodeURIComponent(event.sessionId)}`}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          View session context &rarr;
        </Link>
      </div>
    </div>
  );
}

function MetadataField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-sm text-gray-300 ${mono ? "font-mono" : ""} break-all`}>{value}</div>
    </div>
  );
}
