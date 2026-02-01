/**
 * ChannelsPanel Component
 *
 * List of communication channels with member counts.
 */

import { useMemo, useState } from "react";
import { useSignalDB } from "~/lib/signaldb";
import type { Channel, ChannelType } from "~/lib/types";

interface ChannelsPanelProps {
  selectedChannelId?: string | null;
  onSelectChannel?: (channelId: string | null) => void;
}

export function ChannelsPanel({
  selectedChannelId,
  onSelectChannel,
}: ChannelsPanelProps) {
  const { channels, messages } = useSignalDB();
  const [typeFilter, setTypeFilter] = useState<ChannelType | "all">("all");

  // Count messages per channel
  const messageCountByChannel = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const msg of messages) {
      counts[msg.channelId] = (counts[msg.channelId] || 0) + 1;
    }
    return counts;
  }, [messages]);

  // Filter channels
  const filteredChannels = useMemo(() => {
    if (typeFilter === "all") return channels;
    return channels.filter((c) => c.type === typeFilter);
  }, [channels, typeFilter]);

  // Sort by message count (most active first)
  const sortedChannels = useMemo(() => {
    return [...filteredChannels].sort((a, b) => {
      const countA = messageCountByChannel[a.id] || 0;
      const countB = messageCountByChannel[b.id] || 0;
      return countB - countA;
    });
  }, [filteredChannels, messageCountByChannel]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">
          Channels
          <span className="ml-2 text-gray-500">({channels.length})</span>
        </h2>

        {/* Type filter */}
        <div className="flex items-center gap-1">
          <TypeFilterButton
            label="All"
            active={typeFilter === "all"}
            onClick={() => setTypeFilter("all")}
          />
          <TypeFilterButton
            label="Project"
            active={typeFilter === "project"}
            onClick={() => setTypeFilter("project")}
          />
          <TypeFilterButton
            label="Direct"
            active={typeFilter === "direct"}
            onClick={() => setTypeFilter("direct")}
          />
          <TypeFilterButton
            label="Broadcast"
            active={typeFilter === "broadcast"}
            onClick={() => setTypeFilter("broadcast")}
          />
        </div>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto">
        {sortedChannels.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No channels
          </div>
        ) : (
          <ul className="divide-y divide-gray-800/50">
            {sortedChannels.map((channel) => (
              <ChannelItem
                key={channel.id}
                channel={channel}
                messageCount={messageCountByChannel[channel.id] || 0}
                selected={channel.id === selectedChannelId}
                onClick={() =>
                  onSelectChannel?.(
                    channel.id === selectedChannelId ? null : channel.id
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Type Filter Button
// ============================================================================

interface TypeFilterButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function TypeFilterButton({ label, active, onClick }: TypeFilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        text-xs px-2 py-1 rounded transition-colors
        ${
          active
            ? "bg-gray-700 text-gray-200"
            : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
        }
      `}
    >
      {label}
    </button>
  );
}

// ============================================================================
// Channel Item
// ============================================================================

interface ChannelItemProps {
  channel: Channel;
  messageCount: number;
  selected: boolean;
  onClick: () => void;
}

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

const DEFAULT_ICON = "?";
const DEFAULT_COLOR = "text-gray-400";

function ChannelItem({
  channel,
  messageCount,
  selected,
  onClick,
}: ChannelItemProps) {
  const channelType = channel.type || "project";

  return (
    <li>
      <button
        onClick={onClick}
        className={`
          w-full text-left p-3 transition-colors
          ${selected ? "bg-gray-800" : "hover:bg-gray-900"}
        `}
      >
        <div className="flex items-center gap-3">
          {/* Type icon */}
          <span className={`text-lg font-mono ${typeColors[channelType] || DEFAULT_COLOR}`}>
            {typeIcons[channelType] || DEFAULT_ICON}
          </span>

          {/* Channel name */}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-gray-200 truncate">
              {channel.name || "unnamed"}
            </div>
            <div className="text-xs text-gray-500">
              {(channel.members || []).length} member
              {(channel.members || []).length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Message count */}
          {messageCount > 0 && (
            <div className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
              {messageCount}
            </div>
          )}
        </div>
      </button>
    </li>
  );
}
