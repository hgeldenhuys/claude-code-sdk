/**
 * ConnectionStatus Component
 *
 * Displays the SSE connection status for all streams.
 * No API key checks — server-side proxy handles credentials.
 */

import { useSignalDB } from "~/lib/signaldb";

export function ConnectionStatus() {
  const { connected, configured, apiHost, errors } = useSignalDB();

  const { mode } = connected;
  const allConnected =
    connected.agents && connected.channels && connected.messages;
  const anyError = errors.agents || errors.channels || errors.messages;

  if (!configured) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        Not configured
      </div>
    );
  }

  // Determine display state: live > polling > connecting > error
  let dotClass = "bg-yellow-500";
  let textClass = "text-gray-400";
  let label = "Connecting...";

  if (allConnected) {
    dotClass = "bg-green-500 animate-pulse-green";
    textClass = "text-green-400";
    label = "Live";
  } else if (mode === "polling") {
    dotClass = "bg-blue-500";
    textClass = "text-blue-400";
    label = "Polling";
  } else if (anyError && mode === "offline") {
    dotClass = "bg-red-500";
    textClass = "text-red-400";
    label = "Error";
  }

  return (
    <div className="flex items-center gap-4">
      {/* Overall status */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <span className={textClass}>{label}</span>
      </div>

      {/* Stream breakdown */}
      <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
        <StreamStatus label="Agents" connected={connected.agents} />
        <StreamStatus label="Channels" connected={connected.channels} />
        <StreamStatus label="Messages" connected={connected.messages} />
      </div>

      {/* API host (masked, no secrets) */}
      {apiHost && (
        <div className="hidden lg:block text-xs text-gray-600 font-mono truncate max-w-xs">
          {apiHost}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Stream Status
// ============================================================================

interface StreamStatusProps {
  label: string;
  connected: boolean;
}

function StreamStatus({ label, connected }: StreamStatusProps) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          connected ? "bg-green-500" : "bg-gray-600"
        }`}
      />
      {label}
    </span>
  );
}
