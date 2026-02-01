/**
 * AppShell Layout
 *
 * Wraps all child routes with a sidebar, header, and footer.
 * Checks config on mount and passes configOk via Outlet context.
 * Sidebar collapses on mobile via hamburger toggle.
 */

import { useState, useEffect } from "react";
import { Outlet, NavLink, useOutletContext } from "react-router";

// ─── Outlet context type ────────────────────────────────

interface LayoutContext {
  configOk: boolean;
  configError: string | null;
}

/** Hook for child routes to access layout context */
export function useLayoutContext() {
  return useOutletContext<LayoutContext>();
}

// ─── Nav items ──────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: DashboardIcon, end: true },
  { to: "/agents", label: "Agents", icon: AgentsIcon, end: false },
  { to: "/channels", label: "Channels", icon: ChannelsIcon, end: false },
  { to: "/messages", label: "Messages", icon: MessagesIcon, end: false },
];

// ─── Component ──────────────────────────────────────────

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [configOk, setConfigOk] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Check config on mount
  useEffect(() => {
    let cancelled = false;
    async function checkConfig() {
      try {
        const res = await fetch("/api/config");
        const data = await res.json();
        if (!cancelled) {
          setConfigOk(data.configured === true);
          if (!data.configured) {
            setConfigError("Proxy not configured \u2014 TAPESTRY_LIVE_PROJECT_KEY missing from .env.tapestry");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setConfigOk(false);
          setConfigError(`Config check failed: ${err}`);
        }
      }
    }
    checkConfig();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* ── Header ──────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-gray-800 bg-gray-950/95 backdrop-blur-sm">
        <div className="h-14 px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Hamburger — mobile only */}
            <button
              type="button"
              className="lg:hidden p-1.5 -ml-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                {sidebarOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                )}
              </svg>
            </button>
            <h1 className="text-lg font-semibold text-gray-100">
              Tapestry Observer
            </h1>
            <span className="text-xs text-gray-500 hidden sm:inline">v2</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${configOk ? "bg-emerald-400" : "bg-red-400"}`} />
            <span className={`text-xs ${configOk ? "text-emerald-400" : "text-red-400"}`}>
              {configOk ? "Connected" : "Not configured"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Body: Sidebar + Content ─────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/50 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={`
            fixed lg:static inset-y-0 left-0 z-20
            w-56 border-r border-gray-800 bg-gray-950
            pt-14 lg:pt-0
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          <nav className="flex flex-col gap-1 px-3 py-4">
            {NAV_ITEMS.map((item) => {
              if (item.disabled) {
                return (
                  <span
                    key={item.label}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 cursor-not-allowed"
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                    <span className="ml-auto text-[10px] text-gray-700 font-medium">Soon</span>
                  </span>
                );
              }

              return (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.end}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? "bg-gray-800 text-gray-100 font-medium"
                        : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                    }`
                  }
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto">
          {/* Config error banner */}
          {configError && (
            <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <p className="text-sm text-red-300">{configError}</p>
              </div>
            </div>
          )}

          <div className="px-4 sm:px-6 py-6">
            <Outlet context={{ configOk, configError } satisfies LayoutContext} />
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Icons ──────────────────────────────────────────────

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
    </svg>
  );
}

function AgentsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
    </svg>
  );
}

function ChannelsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5-3.9 19.5m-2.1-19.5-3.9 19.5" />
    </svg>
  );
}

function MessagesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}
