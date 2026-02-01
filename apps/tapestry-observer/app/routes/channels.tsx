/**
 * Channels List — Polling-based channel cards
 *
 * Shows all SignalDB channels with type badges, member count, and creation time.
 * Uses 10s REST polling consistent with the agents page pattern.
 * Filterable by channel type (direct/project/broadcast).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link } from "react-router";
import { useLayoutContext } from "./layout";
import {
  type Channel,
  type ChannelType,
  type Toast,
  POLL_INTERVAL_MS,
  TICK_INTERVAL_MS,
  CHANNEL_TYPE_COLORS,
  parseChannels,
  channelsChanged,
  formatRelativeTime,
} from "../lib/utils";

export default function ChannelsPage() {
  const { configOk } = useLayoutContext();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [lastPolled, setLastPolled] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filterType, setFilterType] = useState<string>("all");
  const channelsRef = useRef<Channel[]>([]);
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

  const fetchChannels = useCallback(async () => {
    if (!configOk) return;
    try {
      const res = await fetch("/api/proxy/v1/channels?limit=100&orderBy=created_at&order=desc");
      if (!res.ok) {
        addToast(`Failed to fetch channels: HTTP ${res.status}`, "error");
        return;
      }
      const data = await res.json();
      const parsed = parseChannels(data);
      if (channelsChanged(channelsRef.current, parsed)) {
        channelsRef.current = parsed;
        setChannels(parsed);
      }
      setLastPolled(new Date());
      setLoading(false);
    } catch (err) {
      addToast(`Failed to fetch channels: ${err}`, "error");
      setLoading(false);
    }
  }, [configOk, addToast]);

  // Initial fetch + polling interval
  useEffect(() => {
    fetchChannels();
    const interval = setInterval(fetchChannels, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchChannels]);

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

  void tick;

  // Sort: most members first, then by creation date
  const sorted = useMemo(() => {
    const copy = [...channels];
    copy.sort((a, b) => {
      const memberDiff = b.members.length - a.members.length;
      if (memberDiff !== 0) return memberDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return copy;
  }, [channels]);

  // Count by type (unknown types counted as "other")
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { direct: 0, project: 0, broadcast: 0, other: 0 };
    for (const ch of channels) {
      if (ch.type in counts) counts[ch.type]++;
      else counts.other++;
    }
    return counts;
  }, [channels]);

  // Apply filter
  const filtered = filterType === "all"
    ? sorted
    : sorted.filter((ch) => ch.type === filterType);

  const hasActiveFilter = filterType !== "all";

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
          <h2 className="text-xl font-semibold text-gray-100">Channels</h2>
          {!loading && (
            <span className="text-sm text-gray-500">
              {hasActiveFilter ? `${filtered.length} of ${channels.length}` : `(${channels.length})`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {!loading && channels.length > 0 && (
            <div className="flex items-center gap-4 text-xs">
              {typeCounts.direct > 0 && (
                <span className="flex items-center gap-1.5 text-blue-300">
                  {typeCounts.direct} direct
                </span>
              )}
              {typeCounts.project > 0 && (
                <span className="flex items-center gap-1.5 text-violet-300">
                  {typeCounts.project} project
                </span>
              )}
              {typeCounts.broadcast > 0 && (
                <span className="flex items-center gap-1.5 text-orange-300">
                  {typeCounts.broadcast} broadcast
                </span>
              )}
              {typeCounts.other > 0 && (
                <span className="flex items-center gap-1.5 text-gray-400">
                  {typeCounts.other} untyped
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
      {!loading && channels.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">Type</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-gray-500 cursor-pointer appearance-none pr-7"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
              }}
            >
              <option value="all">All types</option>
              <option value="direct">Direct</option>
              <option value="project">Project</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </div>
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => setFilterType("all")}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Clear filter
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
              <div className="h-4 w-20 bg-gray-800 rounded mb-2" />
              <div className="h-3 w-16 bg-gray-800 rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state — no channels at all */}
      {!loading && channels.length === 0 && (
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">#</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">No channels found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Channels are created when agents communicate. Start agent daemons to see channels appear.
          </p>
        </div>
      )}

      {/* Empty state — filter matched nothing */}
      {!loading && channels.length > 0 && filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="text-gray-600 text-3xl mb-3">&#128683;</div>
          <h3 className="text-base font-medium text-gray-400 mb-2">No channels match filter</h3>
          <button
            type="button"
            onClick={() => setFilterType("all")}
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Channel cards grid */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((channel) => (
            <Link key={channel.id} to={`/channels/${channel.id}`} className="block">
              <ChannelCard channel={channel} animate={!mounted} />
            </Link>
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

// ─── Channel Card ───────────────────────────────────────

function ChannelCard({ channel, animate }: { channel: Channel; animate: boolean }) {
  const knownType = channel.type in CHANNEL_TYPE_COLORS;
  const typeColors = knownType
    ? CHANNEL_TYPE_COLORS[channel.type]
    : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: channel.type || "unknown" };
  const displayName = channel.name || channel.id?.slice(0, 12) || "unnamed";

  return (
    <div
      className={`group rounded-xl border border-gray-800 bg-gray-900/50 hover:bg-gray-900/80 hover:border-gray-700 p-5 transition-colors cursor-pointer ${
        animate ? "animate-fade-in" : ""
      }`}
    >
      {/* Header: channel name + type badge */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0 mr-2">
          <span className="text-gray-500 shrink-0">#</span>
          <h3 className={`text-base font-semibold truncate ${channel.name ? "text-gray-100" : "text-gray-500 italic"}`}>
            {displayName}
          </h3>
        </div>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${typeColors.badge} ${typeColors.badgeText} shrink-0`}
        >
          {typeColors.label}
        </span>
      </div>

      {/* Members count */}
      <div className="flex items-center gap-2 mb-1.5">
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
        <span className="text-sm text-gray-400">
          {channel.members.length} {channel.members.length === 1 ? "member" : "members"}
        </span>
      </div>

      {/* Metadata preview — show description if available */}
      {channel.metadata?.description && (
        <p className="text-xs text-gray-500 mb-3 line-clamp-2">
          {String(channel.metadata.description)}
        </p>
      )}

      {/* Created timestamp + hover chevron */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-800/60">
        <svg className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span className="text-xs text-gray-500">
          Created {formatRelativeTime(channel.createdAt)}
        </span>
        <span className="ml-auto text-gray-600 group-hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
