/**
 * Pastes Route - Paste Browser
 *
 * REST-polled paste list (no SSE for pastes).
 * Fetches through the BFF proxy — no API keys in the browser.
 */

import { useCallback, useMemo } from "react";
import { formatRelativeTime } from "~/lib/types";
import type { PasteView } from "~/lib/types";
import { usePoll } from "~/lib/use-polling";

// Snake to camel case for paste objects
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function convertKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertKeys);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      result[snakeToCamel(key)] = convertKeys(
        (obj as Record<string, unknown>)[key]
      );
    }
    return result;
  }
  return obj;
}

export default function Pastes() {
  const fetchPastes = useCallback(async (): Promise<PasteView[]> => {
    const resp = await fetch("/api/proxy/v1/pastes?limit=100");
    if (!resp.ok) throw new Error(`Failed to fetch pastes: ${resp.status}`);

    const json = await resp.json();
    const data = json.data || json;
    return (convertKeys(data) as PasteView[]) || [];
  }, []);

  const { data: pastes, loading, error, refresh } = usePoll(fetchPastes, {
    intervalMs: 30000,
    enabled: true,
  });

  const sortedPastes = useMemo(() => {
    if (!pastes) return [];
    return [...pastes].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [pastes]);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-200">
          Pastes
          <span className="ml-2 text-gray-500 text-sm font-normal">
            ({sortedPastes.length})
          </span>
        </h1>
        <div className="flex items-center gap-2">
          {loading && (
            <span className="text-xs text-gray-500">Refreshing...</span>
          )}
          <button
            onClick={refresh}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm mb-4">
          {error.message}
        </div>
      )}

      {sortedPastes.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-4">
          {loading ? "Loading pastes..." : "No pastes found."}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
          {sortedPastes.map((paste) => (
            <PasteRow key={paste.id} paste={paste} />
          ))}
        </div>
      )}

      <div className="mt-3 text-xs text-gray-600">
        Polls every 30s. Last fetch: {pastes ? "complete" : "pending"}
      </div>
    </div>
  );
}

// ============================================================================
// PasteRow
// ============================================================================

function PasteRow({ paste }: { paste: PasteView }) {
  const statusColors: Record<string, string> = {
    active: "text-green-400",
    expired: "text-red-400",
    deleted: "text-gray-600",
  };

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3 mb-1">
        <span className="text-xs font-mono text-gray-500">
          {paste.id?.slice(0, 8)}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
          {paste.contentType || "text"}
        </span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
          {paste.accessMode || "public"}
        </span>
        <span className={`text-xs ${statusColors[paste.status] || "text-gray-400"}`}>
          {paste.status || "active"}
        </span>
        <span className="text-xs text-gray-600 ml-auto">
          {formatRelativeTime(paste.createdAt)}
        </span>
      </div>
      <pre className="text-sm text-gray-400 font-mono whitespace-pre-wrap break-words truncate max-h-20 overflow-hidden">
        {(paste.content || "").slice(0, 200)}
        {(paste.content || "").length > 200 ? "..." : ""}
      </pre>
      {paste.ttlSeconds !== null && paste.ttlSeconds !== undefined && (
        <div className="text-xs text-gray-600 mt-1">
          TTL: {paste.ttlSeconds}s
        </div>
      )}
    </div>
  );
}
