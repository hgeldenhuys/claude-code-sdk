/**
 * HookEventRow Component
 *
 * Displays a single hook event with type badge, tool name, and expandable detail.
 */

import { useState } from "react";
import { Link } from "react-router";
import { JsonViewer } from "~/components/JsonViewer";
import {
  formatRelativeTime,
  formatTime,
  getEventTypeColor,
  type HookEvent,
} from "~/lib/types";

interface HookEventRowProps {
  event: HookEvent;
  showSessionInfo?: boolean;
}

export function HookEventRow({ event, showSessionInfo = true }: HookEventRowProps) {
  const [expanded, setExpanded] = useState(false);

  let inputData: unknown = null;
  let handlerData: unknown = null;

  if (event.inputJson) {
    try { inputData = JSON.parse(event.inputJson); } catch { /* ignore */ }
  }
  if (event.handlerResultsJson) {
    try { handlerData = JSON.parse(event.handlerResultsJson); } catch { /* ignore */ }
  }

  return (
    <div className="border-b border-gray-800/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center gap-3 text-sm hover:bg-gray-800/30 transition-colors text-left"
      >
        {/* Expand indicator */}
        <span className="text-xs text-gray-600 font-mono w-4 flex-shrink-0">
          {expanded ? "\u25BC" : "\u25B6"}
        </span>

        {/* Event type badge */}
        <span
          className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${getEventTypeColor(event.eventType)}`}
        >
          {event.eventType}
        </span>

        {/* Tool name */}
        {event.toolName && (
          <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded flex-shrink-0">
            {event.toolName}
          </span>
        )}

        {/* Session / Turn */}
        {showSessionInfo && (
          <span className="text-xs text-gray-500 font-mono flex-shrink-0">
            {event.sessionName || event.sessionId.slice(0, 8)}
            {event.turnId && <span className="text-gray-600"> t{event.turnId.split(":").pop()}</span>}
          </span>
        )}

        {/* Decision badge */}
        {event.decision && event.decision !== "allow" && (
          <span className="text-xs bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded flex-shrink-0">
            {event.decision}
          </span>
        )}

        {/* Spacer */}
        <span className="flex-1" />

        {/* Timestamp */}
        <span className="text-xs text-gray-600 font-mono flex-shrink-0" title={event.timestamp}>
          {formatRelativeTime(event.timestamp)}
        </span>
        <span className="text-xs text-gray-700 font-mono flex-shrink-0">
          {formatTime(event.timestamp)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pl-12 space-y-2">
          {/* Metadata */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>Machine: <span className="text-gray-400 font-mono">{event.machineId}</span></span>
            <span>Session: <span className="text-gray-400 font-mono">{event.sessionId.slice(0, 12)}</span></span>
            {event.turnId && <span>Turn: <span className="text-gray-400 font-mono">{event.turnId}</span></span>}
            {event.gitBranch && <span>Branch: <span className="text-gray-400 font-mono">{event.gitBranch}</span></span>}
          </div>

          {/* Input JSON */}
          {inputData != null && (
            <JsonViewer data={inputData} label="Input" />
          )}

          {/* Handler Results */}
          {handlerData != null && (
            <JsonViewer data={handlerData} label="Handler Results" />
          )}

          {/* Link to detail page */}
          <Link
            to={`/hooks/${event.id}`}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            View full detail &rarr;
          </Link>
        </div>
      )}
    </div>
  );
}
