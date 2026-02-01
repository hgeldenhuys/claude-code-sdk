/**
 * Search Route
 *
 * Full-text search across transcript content and hook events.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { SearchInput } from "~/components/SearchInput";
import { TranscriptLineRow } from "~/components/TranscriptLineRow";
import { useSignalDB } from "~/lib/signaldb";
import { useTranscriptLines } from "~/lib/sse-hooks";
import type { TranscriptLine } from "~/lib/types";

interface SearchResultGroup {
  sessionId: string;
  sessionName: string | null;
  machineId: string;
  matches: TranscriptLine[];
}

export default function SearchRoute() {
  const { configured } = useSignalDB();
  const transcriptStream = useTranscriptLines({ enabled: configured, maxItems: 500, fetchLimit: 500, stream: false });
  const transcriptLines = transcriptStream.data;
  const [query, setQuery] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [machineFilter, setMachineFilter] = useState("");

  // Available types and machines for filters
  const { types, machines } = useMemo(() => {
    const typeSet = new Set<string>();
    const machineSet = new Set<string>();
    for (let i = 0; i < transcriptLines.length; i++) {
      typeSet.add(transcriptLines[i]!.type);
      machineSet.add(transcriptLines[i]!.machineId);
    }
    return {
      types: Array.from(typeSet).sort(),
      machines: Array.from(machineSet).sort(),
    };
  }, [transcriptLines]);

  // Search and group results
  const results = useMemo((): SearchResultGroup[] => {
    if (!query || query.length < 2) return [];

    const q = query.toLowerCase();
    const groups = new Map<string, SearchResultGroup>();

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;

      // Apply filters
      if (typeFilters.size > 0 && !typeFilters.has(line.type)) continue;
      if (machineFilter && line.machineId !== machineFilter) continue;

      // Search content
      if (!line.content || !line.content.toLowerCase().includes(q)) continue;

      let group = groups.get(line.sessionId);
      if (!group) {
        group = {
          sessionId: line.sessionId,
          sessionName: line.sessionName,
          machineId: line.machineId,
          matches: [],
        };
        groups.set(line.sessionId, group);
      }
      group.matches.push(line);
    }

    // Sort groups by most matches, limit to 50 results per group
    const sorted = Array.from(groups.values()).sort(
      (a, b) => b.matches.length - a.matches.length
    );

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i]!.matches.length > 50) {
        sorted[i]!.matches = sorted[i]!.matches.slice(0, 50);
      }
    }

    return sorted;
  }, [transcriptLines, query, typeFilters, machineFilter]);

  const totalMatches = useMemo(() => {
    let count = 0;
    for (let i = 0; i < results.length; i++) {
      count += results[i]!.matches.length;
    }
    return count;
  }, [results]);

  const toggleTypeFilter = (type: string) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <h1 className="text-lg font-semibold text-gray-100">Search Transcripts</h1>

      {/* Search bar */}
      <div className="max-w-2xl">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search across all transcript content..."
          debounceMs={300}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Type filter checkboxes */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Types:</span>
          {types.map((type) => (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                typeFilters.size === 0 || typeFilters.has(type)
                  ? "bg-gray-700 text-gray-200"
                  : "bg-gray-900 text-gray-600 border border-gray-800"
              }`}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Machine filter */}
        {machines.length > 1 && (
          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-600"
          >
            <option value="">All machines</option>
            {machines.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        )}

        {/* Result count */}
        {query.length >= 2 && (
          <span className="text-xs text-gray-500">
            {totalMatches} match{totalMatches !== 1 ? "es" : ""} in{" "}
            {results.length} session{results.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Results */}
      {query.length < 2 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          Type at least 2 characters to search.
        </div>
      ) : results.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
          No results found for "{query}".
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((group) => (
            <div
              key={group.sessionId}
              className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden"
            >
              {/* Session header */}
              <Link
                to={`/sessions/${encodeURIComponent(group.sessionId)}`}
                className="flex items-center justify-between px-4 py-2.5 bg-gray-800/50 hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">
                    {group.sessionName || "Unnamed Session"}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">
                    {group.machineId}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {group.matches.length} match{group.matches.length !== 1 ? "es" : ""} &rarr;
                </span>
              </Link>

              {/* Matching lines */}
              <div className="divide-y divide-gray-800/30">
                {group.matches.map((line) => (
                  <TranscriptLineRow
                    key={line.id}
                    line={line}
                    highlight={query}
                    maxContentLength={200}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
