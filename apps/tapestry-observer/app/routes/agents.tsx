/**
 * Agents List — Polling-based agent cards
 *
 * Replaces SSE with 10s REST polling for stable, jank-free updates.
 * Cards use stable sort by ID within status groups to prevent jumping.
 *
 * Anti-jank strategy:
 *   - Diff before setState (only update if data actually changed)
 *   - No animate-fade-in on poll updates (only on mount)
 *   - Relative timestamps update via a separate 3s tick interval (no network)
 *   - Stable sort: active > idle > offline, then by heartbeat within group
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useLayoutContext } from "./layout";
import {
  type Agent,
  type AgentWithStatus,
  type AgentStatus,
  type Toast,
  POLL_INTERVAL_MS,
  TICK_INTERVAL_MS,
  STATUS_COLORS,
  parseAgents,
  deriveAndSort,
  countByStatus,
  agentsChanged,
  formatRelativeTime,
  truncatePath,
} from "../lib/utils";

/** Extract the last directory name from a project path for short display */
function projectShortName(path: string): string {
  if (!path) return "\u2014";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

export default function AgentsPage() {
  const { configOk } = useLayoutContext();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filterMachine, setFilterMachine] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const agentsRef = useRef<Agent[]>([]);
  const toastIdRef = useRef(0);

  // ─── Toast helpers ────────────────────────────────────

  const addToast = useCallback((message: string, type: Toast["type"] = "error") => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Polling ──────────────────────────────────────────

  const fetchAgents = useCallback(async () => {
    if (!configOk) return;
    try {
      const res = await fetch("/api/proxy/v1/agents?limit=50&orderBy=heartbeat_at&order=desc");
      if (!res.ok) {
        addToast(`Failed to fetch agents: HTTP ${res.status}`, "error");
        return;
      }
      const data = await res.json();
      const parsed = parseAgents(data);
      // Only update state if data actually changed
      if (agentsChanged(agentsRef.current, parsed)) {
        agentsRef.current = parsed;
        setAgents(parsed);
      }
      setLastPolled(new Date());
      setLoading(false);
    } catch (err) {
      addToast(`Failed to fetch agents: ${err}`, "error");
      setLoading(false);
    }
  }, [configOk, addToast]);

  // Initial fetch + polling interval
  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Mark as mounted after initial render (controls animate-fade-in)
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 500);
    return () => clearTimeout(timer);
  }, []);

  // Timestamp refresh (cheap, no network)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // ─── Derived data ─────────────────────────────────────

  void tick; // force re-computation on tick
  const sorted = deriveAndSort(agents);
  const counts = countByStatus(sorted);

  // Extract unique filter options from ALL agents (not filtered subset)
  const machines = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.machineId) set.add(a.machineId);
    }
    return [...set].sort();
  }, [agents]);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      if (a.projectPath) set.add(a.projectPath);
    }
    return [...set].sort();
  }, [agents]);

  // Apply filters
  const filtered = sorted.filter((a) => {
    if (filterMachine !== "all" && a.machineId !== filterMachine) return false;
    if (filterProject !== "all" && a.projectPath !== filterProject) return false;
    if (filterStatus !== "all" && a.derivedStatus !== filterStatus) return false;
    return true;
  });

  const hasActiveFilters = filterMachine !== "all" || filterProject !== "all" || filterStatus !== "all";

  // ─── Render ───────────────────────────────────────────

  if (!configOk) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 text-4xl mb-4">&#9888;</div>
        <h3 className="text-lg font-medium text-gray-400 mb-2">Not configured</h3>
        <p className="text-sm text-gray-500">Set up .env.tapestry to connect to SignalDB.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Title + stats bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold text-gray-100">Agents</h2>
          {!loading && (
            <span className="text-sm text-gray-500">
              {hasActiveFilters ? `${filtered.length} of ${agents.length}` : `(${agents.length})`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {!loading && agents.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              {counts.active > 0 && (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  {counts.active} active
                </span>
              )}
              {counts.idle > 0 && (
                <span className="flex items-center gap-1.5 text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {counts.idle} idle
                </span>
              )}
              {counts.offline > 0 && (
                <span className="flex items-center gap-1.5 text-gray-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                  {counts.offline} offline
                </span>
              )}
            </div>
          )}
          {lastPolled && (
            <span className="text-xs text-gray-600 hidden sm:inline">
              Polled {formatRelativeTime(lastPolled.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {!loading && agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <FilterSelect
            label="Machine"
            value={filterMachine}
            onChange={setFilterMachine}
            options={machines}
          />
          <FilterSelect
            label="Project"
            value={filterProject}
            onChange={setFilterProject}
            options={projects}
            formatOption={projectShortName}
          />
          <FilterSelect
            label="Status"
            value={filterStatus}
            onChange={setFilterStatus}
            options={["active", "idle", "offline"]}
            allLabel="All statuses"
          />
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => {
                setFilterMachine("all");
                setFilterProject("all");
                setFilterStatus("all");
              }}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-800 bg-gray-900/50 p-5 animate-pulse"
            >
              <div className="h-5 w-32 bg-gray-800 rounded mb-3" />
              <div className="h-4 w-24 bg-gray-800 rounded mb-2" />
              <div className="h-4 w-48 bg-gray-800 rounded mb-4" />
              <div className="h-3 w-16 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no agents at all */}
      {!loading && agents.length === 0 && (
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">&#128269;</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">No agents found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Start a Claude Code agent daemon to see agents appear here.
            Run <code className="text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>bun run agent-daemon</code> in a project directory.
          </p>
        </div>
      )}

      {/* Empty state — filters matched nothing */}
      {!loading && agents.length > 0 && filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="text-gray-600 text-3xl mb-3">&#128683;</div>
          <h3 className="text-base font-medium text-gray-400 mb-2">No agents match filters</h3>
          <button
            type="button"
            onClick={() => {
              setFilterMachine("all");
              setFilterProject("all");
              setFilterStatus("all");
            }}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear all filters
          </button>
        </div>
      )}

      {/* Agent cards grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} animate={!mounted} />
          ))}
        </div>
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`rounded-lg border px-4 py-3 shadow-lg animate-fade-in cursor-pointer ${
                toast.type === "error"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : toast.type === "warning"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                    : "bg-blue-500/10 border-blue-500/30 text-blue-300"
              }`}
              onClick={() => dismissToast(toast.id)}
            >
              <p className="text-sm">{toast.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter Select ──────────────────────────────────────

function FilterSelect({ label, value, onChange, options, formatOption, allLabel }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  formatOption?: (opt: string) => string;
  allLabel?: string;
}) {
  const fmt = formatOption || ((v: string) => v);
  const defaultAllLabel = allLabel || `All ${label.toLowerCase()}s`;
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-500 cursor-pointer appearance-none pr-7"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 8px center",
        }}
      >
        <option value="all">{defaultAllLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{fmt(opt)}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Agent Card ─────────────────────────────────────────

function AgentCard({ agent, animate }: { agent: AgentWithStatus; animate: boolean }) {
  const colors = STATUS_COLORS[agent.derivedStatus];

  return (
    <div
      className={`rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 p-5 transition-colors ${
        animate ? "animate-fade-in" : ""
      }`}
    >
      {/* Header: session name + status badge */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-base font-semibold text-gray-100 truncate mr-2">
          {agent.sessionName || agent.sessionId?.slice(0, 8) || "unknown"}
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colors.badge} ${colors.badgeText} shrink-0`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${colors.dot} ${
              agent.derivedStatus === "active"
                ? "animate-heartbeat"
                : agent.derivedStatus === "idle"
                  ? "animate-idle-pulse"
                  : ""
            }`}
          />
          {colors.label}
        </span>
      </div>

      {/* Machine ID */}
      <div className="flex items-center gap-2 mb-1.5">
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7m0 0a3 3 0 0 1-3 3m0 3h.008v.008h-.008v-.008Zm0-6h.008v.008h-.008v-.008Z" />
        </svg>
        <span className="text-sm text-gray-400">
          {agent.machineId || "\u2014"}
        </span>
      </div>

      {/* Project path */}
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
        </svg>
        <span
          className="text-xs text-gray-500 truncate"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
          title={agent.projectPath}
        >
          {truncatePath(agent.projectPath)}
        </span>
      </div>

      {/* Heartbeat timestamp */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-800/60">
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span className="text-xs text-gray-500">
          Last heartbeat:{" "}
          <span className={agent.derivedStatus === "active" ? "text-emerald-400" : "text-gray-400"}>
            {formatRelativeTime(agent.heartbeatAt)}
          </span>
        </span>
      </div>
    </div>
  );
}
