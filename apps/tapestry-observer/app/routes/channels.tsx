/**
 * Channels Route - Channel Browser
 *
 * List channels with type filter, member counts, and message activity.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useSignalDB } from "~/lib/signaldb";
import type { ChannelType } from "~/lib/types";

const typeIcons: Record<string, string> = {
  project: "#",
  direct: "@",
  broadcast: "!",
};

const typeColors: Record<string, string> = {
  project: "text-blue-400",
  direct: "text-purple-400",
  broadcast: "text-orange-400",
};

export default function Channels() {
  const { channels, messages } = useSignalDB();
  const [typeFilter, setTypeFilter] = useState<ChannelType | "all">("all");

  // Message counts per channel
  const messageCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const msg of messages) {
      counts[msg.channelId] = (counts[msg.channelId] || 0) + 1;
    }
    return counts;
  }, [messages]);

  // Filter
  const filtered = useMemo(() => {
    if (typeFilter === "all") return channels;
    return channels.filter((c) => c.type === typeFilter);
  }, [channels, typeFilter]);

  // Sort by activity
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const countA = messageCounts[a.id] || 0;
      const countB = messageCounts[b.id] || 0;
      return countB - countA;
    });
  }, [filtered, messageCounts]);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-200">
          Channels
          <span className="ml-2 text-gray-500 text-sm font-normal">
            ({channels.length})
          </span>
        </h1>

        <div className="flex items-center gap-1">
          {(["all", "project", "direct", "broadcast"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                typeFilter === type
                  ? "bg-gray-700 text-gray-200"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
              }`}
            >
              {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-gray-500 bg-gray-900 border border-gray-800 rounded-lg p-4">
          No channels found.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
          {sorted.map((channel) => {
            const channelType = channel.type || "project";
            const count = messageCounts[channel.id] || 0;
            return (
              <Link
                key={channel.id}
                to={`/channels/${channel.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors"
              >
                <span
                  className={`text-lg font-mono ${typeColors[channelType] || "text-gray-400"}`}
                >
                  {typeIcons[channelType] || "?"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-200 truncate">
                    {channel.name || "unnamed"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {(channel.members || []).length} member
                    {(channel.members || []).length !== 1 ? "s" : ""} ·{" "}
                    {channelType}
                  </div>
                </div>
                {count > 0 && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
                    {count} msg{count !== 1 ? "s" : ""}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
