/**
 * Home Route - Main Dashboard
 *
 * Three-panel layout for observing COMMS activity.
 */

import { useState } from "react";
import { AgentsPanel } from "~/components/AgentsPanel";
import { ChannelsPanel } from "~/components/ChannelsPanel";
import { ConfigForm } from "~/components/ConfigForm";
import { ConnectionStatus } from "~/components/ConnectionStatus";
import { MessagesFeed } from "~/components/MessagesFeed";
import { SignalDBProvider, useSignalDB } from "~/lib/signaldb";

export function meta() {
  return [
    { title: "Tapestry Observer - COMMS Dashboard" },
    {
      name: "description",
      content: "Real-time monitoring of Claude Code agent communication",
    },
  ];
}

export default function Home() {
  return (
    <SignalDBProvider>
      <Dashboard />
    </SignalDBProvider>
  );
}

function Dashboard() {
  const { apiKey, clearCredentials, refresh } = useSignalDB();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null
  );

  // Show config form if not configured
  if (!apiKey) {
    return <ConfigForm />;
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900/50">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-gray-100">
            Tapestry Observer
          </h1>
          <ConnectionStatus />
        </div>

        <div className="flex items-center gap-2">
          {/* Refresh button */}
          <button
            onClick={refresh}
            className="
              p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800
              transition-colors
            "
            title="Refresh all data"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          {/* Clear filters */}
          {(selectedAgentId || selectedChannelId) && (
            <button
              onClick={() => {
                setSelectedAgentId(null);
                setSelectedChannelId(null);
              }}
              className="
                px-2 py-1 text-xs rounded-lg
                bg-gray-800 text-gray-400 hover:text-gray-200
                transition-colors
              "
            >
              Clear filters
            </button>
          )}

          {/* Disconnect */}
          <button
            onClick={clearCredentials}
            className="
              px-3 py-1.5 text-xs rounded-lg
              bg-red-900/50 text-red-400 hover:bg-red-900 hover:text-red-300
              border border-red-800
              transition-colors
            "
          >
            Disconnect
          </button>
        </div>
      </header>

      {/* Main content - 3 panel layout */}
      <main className="flex-1 flex min-h-0">
        {/* Left sidebar - Agents */}
        <aside className="w-72 border-r border-gray-800 flex-shrink-0 overflow-hidden">
          <AgentsPanel
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </aside>

        {/* Center - Messages */}
        <section className="flex-1 min-w-0 overflow-hidden">
          <MessagesFeed
            filterAgentId={selectedAgentId}
            filterChannelId={selectedChannelId}
          />
        </section>

        {/* Right sidebar - Channels */}
        <aside className="w-64 border-l border-gray-800 flex-shrink-0 overflow-hidden">
          <ChannelsPanel
            selectedChannelId={selectedChannelId}
            onSelectChannel={setSelectedChannelId}
          />
        </aside>
      </main>

      {/* Footer - Filter status */}
      {(selectedAgentId || selectedChannelId) && (
        <footer className="px-4 py-2 border-t border-gray-800 bg-gray-900/50 text-xs text-gray-500">
          Filtering:
          {selectedAgentId && (
            <span className="ml-2 text-blue-400">
              Agent: {selectedAgentId.slice(0, 8)}
            </span>
          )}
          {selectedChannelId && (
            <span className="ml-2 text-purple-400">
              Channel: {selectedChannelId.slice(0, 8)}
            </span>
          )}
        </footer>
      )}
    </div>
  );
}
