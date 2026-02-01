/**
 * Layout Route
 *
 * Shell with sidebar navigation, header, and status bar.
 * SignalDBProvider wraps all child routes so they share data context.
 * No API key gate — the BFF proxy handles credentials server-side.
 */

import { Outlet } from "react-router";
import { ConnectionStatus } from "~/components/ConnectionStatus";
import { Sidebar } from "~/components/Sidebar";
import { StatusBar } from "~/components/StatusBar";
import { SignalDBProvider, useSignalDB } from "~/lib/signaldb";

export function meta() {
  return [
    { title: "Tapestry Observer" },
    {
      name: "description",
      content: "Real-time COMMS and Transcript Intelligence for Claude Code agents",
    },
  ];
}

export default function LayoutRoute() {
  return (
    <SignalDBProvider>
      <LayoutShell />
    </SignalDBProvider>
  );
}

function LayoutShell() {
  const { configured, configLoading, refresh } = useSignalDB();

  // Show loading state while checking config
  if (configLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400 text-sm">Checking configuration...</div>
      </div>
    );
  }

  // Show not-configured state if server lacks credentials
  if (!configured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-100 mb-2">
            Tapestry Observer
          </h1>
          <p className="text-gray-500 mb-6">
            Real-time COMMS monitoring for Claude Code agents
          </p>
          <div className="p-4 rounded-lg bg-yellow-900/30 border border-yellow-700 text-yellow-300 text-sm">
            <p className="font-medium mb-2">Server not configured</p>
            <p className="text-yellow-400/80">
              Set <code className="text-yellow-300">TAPESTRY_LIVE_PROJECT_KEY</code> in{" "}
              <code className="text-yellow-300">.env.tapestry</code> at the project root
              and restart the dev server.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 bg-gray-900/50 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-gray-100">
            Tapestry Observer
          </h1>
          <ConnectionStatus />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
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
        </div>
      </header>

      {/* Main content area: sidebar + outlet */}
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
