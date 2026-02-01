/**
 * Hook Events Timeline Route
 *
 * Real-time monitoring of hook events across all sessions.
 */

import { useMemo, useState } from "react";
import { HookEventRow } from "~/components/HookEventRow";
import { SearchInput } from "~/components/SearchInput";
import { useSignalDB } from "~/lib/signaldb";
import { useHookEvents } from "~/lib/sse-hooks";

export default function HooksRoute() {
  const { configured } = useSignalDB();
  // Hook events timeline keeps SSE streaming (stream: true) for real-time updates
  const hookEventsStream = useHookEvents({ enabled: configured, maxItems: 300, fetchLimit: 300 });
  const hookEvents = hookEventsStream.data;
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [toolFilter, setToolFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");

  // Extract unique values for filters
  const { eventTypes, toolNames, sessionNames } = useMemo(() => {
    const eventSet = new Set<string>();
    const toolSet = new Set<string>();
    const sessionMap = new Map<string, string>();

    for (let i = 0; i < hookEvents.length; i++) {
      const e = hookEvents[i]!;
      eventSet.add(e.eventType);
      if (e.toolName) toolSet.add(e.toolName);
      if (e.sessionName) sessionMap.set(e.sessionId, e.sessionName);
    }

    return {
      eventTypes: Array.from(eventSet).sort(),
      toolNames: Array.from(toolSet).sort(),
      sessionNames: Array.from(sessionMap.entries()).sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [hookEvents]);

  // Filter and sort events
  const filteredEvents = useMemo(() => {
    let result = hookEvents;

    if (eventTypeFilter) {
      result = result.filter((e) => e.eventType === eventTypeFilter);
    }
    if (toolFilter) {
      const q = toolFilter.toLowerCase();
      result = result.filter((e) => e.toolName && e.toolName.toLowerCase().includes(q));
    }
    if (sessionFilter) {
      result = result.filter((e) => e.sessionId === sessionFilter);
    }

    // Sort by timestamp descending (most recent first)
    return [...result].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [hookEvents, eventTypeFilter, toolFilter, sessionFilter]);

  const isLive = hookEventsStream.mode === "live";

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      {/* Header with live indicator */}
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-100">Hook Events</h1>
        <span className="flex items-center gap-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${isLive ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
          <span className={isLive ? "text-green-400" : "text-gray-500"}>
            {isLive ? "Live" : "Polling"}
          </span>
        </span>
        <span className="text-xs text-gray-500">
          {hookEvents.length} total events
        </span>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="">All event types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <div className="w-48">
          <SearchInput
            value={toolFilter}
            onChange={setToolFilter}
            placeholder="Filter by tool..."
            debounceMs={200}
          />
        </div>

        <select
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300 focus:outline-none focus:border-blue-600"
        >
          <option value="">All sessions</option>
          {sessionNames.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>

        <span className="text-xs text-gray-500">
          Showing {filteredEvents.length} event{filteredEvents.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          {hookEvents.length === 0
            ? "No hook events synced yet. Events will appear here in real-time."
            : "No events match your filters."}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          {filteredEvents.map((event) => (
            <HookEventRow key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
