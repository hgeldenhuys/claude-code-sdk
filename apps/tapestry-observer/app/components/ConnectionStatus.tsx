/**
 * ConnectionStatus Component
 *
 * Displays the SSE connection status for all streams.
 */

import { useSignalDB } from "~/lib/signaldb";

export function ConnectionStatus() {
  const { connected, apiUrl, apiKey, errors } = useSignalDB();

  const allConnected =
    connected.agents && connected.channels && connected.messages;
  const anyError = errors.agents || errors.channels || errors.messages;

  if (!apiKey) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <span className="w-2 h-2 rounded-full bg-gray-600" />
        Not configured
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {/* Overall status */}
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`w-2 h-2 rounded-full ${
            allConnected
              ? "bg-green-500 animate-pulse-green"
              : anyError
                ? "bg-red-500"
                : "bg-yellow-500"
          }`}
        />
        <span className={allConnected ? "text-green-400" : "text-gray-400"}>
          {allConnected ? "Connected" : anyError ? "Error" : "Connecting..."}
        </span>
      </div>

      {/* Stream breakdown */}
      <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
        <StreamStatus label="Agents" connected={connected.agents} />
        <StreamStatus label="Channels" connected={connected.channels} />
        <StreamStatus label="Messages" connected={connected.messages} />
      </div>

      {/* API URL */}
      {apiUrl && (
        <div className="hidden lg:block text-xs text-gray-600 font-mono truncate max-w-xs">
          {apiUrl.replace(/^https?:\/\//, "")}
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
