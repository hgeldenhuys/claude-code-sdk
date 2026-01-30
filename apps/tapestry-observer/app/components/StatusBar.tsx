/**
 * StatusBar Component
 *
 * Bottom bar showing SSE stream status, counts, and connection info.
 * No API URL displayed — proxy handles routing server-side.
 */

import { useSignalDB } from "~/lib/signaldb";

export function StatusBar() {
  const { connected, agents, channels, messages, apiHost } = useSignalDB();

  const { mode } = connected;
  const allConnected =
    connected.agents && connected.channels && connected.messages;

  let statusLabel = "Connecting";
  let statusClass = "text-yellow-500";
  if (allConnected) {
    statusLabel = "Live";
    statusClass = "text-green-500";
  } else if (mode === "polling") {
    statusLabel = "Polling";
    statusClass = "text-blue-500";
  } else if (mode === "offline") {
    statusLabel = "Offline";
    statusClass = "text-gray-500";
  }

  return (
    <footer className="flex items-center justify-between px-4 py-1.5 border-t border-gray-800 bg-gray-900/50 text-xs text-gray-500">
      <div className="flex items-center gap-4">
        {/* SSE status */}
        <span className="flex items-center gap-1.5">
          {mode === "polling" ? "REST" : "SSE"}
          <StreamDot label="agents" connected={connected.agents} />
          <StreamDot label="channels" connected={connected.channels} />
          <StreamDot label="messages" connected={connected.messages} />
        </span>

        {/* Counts */}
        <span>
          {agents.length} agents · {channels.length} channels · {messages.length} msgs
        </span>
      </div>

      <div className="flex items-center gap-3">
        {/* Connection status */}
        <span className={statusClass}>{statusLabel}</span>

        {/* API host (masked, from server config) */}
        {apiHost && (
          <span className="font-mono text-gray-600 truncate max-w-[200px]">
            {apiHost}
          </span>
        )}
      </div>
    </footer>
  );
}

function StreamDot({
  label,
  connected,
}: {
  label: string;
  connected: boolean;
}) {
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full inline-block ${
        connected ? "bg-green-500" : "bg-gray-600"
      }`}
      title={`${label}: ${connected ? "connected" : "disconnected"}`}
    />
  );
}
