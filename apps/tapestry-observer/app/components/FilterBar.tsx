/**
 * FilterBar Component
 *
 * Reusable filter controls for messages, agents, etc.
 */

import type { MessageType } from "~/lib/types";

interface FilterBarProps {
  // Message type filter
  messageType: MessageType | "all";
  onMessageTypeChange: (type: MessageType | "all") => void;

  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;

  // View mode
  viewMode?: "chronological" | "by-thread" | "by-channel";
  onViewModeChange?: (mode: "chronological" | "by-thread" | "by-channel") => void;

  // Result count
  resultCount?: number;
  totalCount?: number;
}

export function FilterBar({
  messageType,
  onMessageTypeChange,
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  resultCount,
  totalCount,
}: FilterBarProps) {
  const typeOptions: { value: MessageType | "all"; label: string }[] = [
    { value: "all", label: "All" },
    { value: "chat", label: "Chat" },
    { value: "memo", label: "Memo" },
    { value: "command", label: "Command" },
    { value: "response", label: "Response" },
  ];

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Type filter */}
      <div className="flex items-center gap-1">
        {typeOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onMessageTypeChange(opt.value)}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              messageType === opt.value
                ? "bg-gray-700 text-gray-200"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search content..."
        className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
      />

      {/* View mode */}
      {onViewModeChange && (
        <div className="flex items-center gap-1 ml-auto">
          <ViewModeButton
            label="Time"
            active={viewMode === "chronological"}
            onClick={() => onViewModeChange("chronological")}
          />
          <ViewModeButton
            label="Thread"
            active={viewMode === "by-thread"}
            onClick={() => onViewModeChange("by-thread")}
          />
          <ViewModeButton
            label="Channel"
            active={viewMode === "by-channel"}
            onClick={() => onViewModeChange("by-channel")}
          />
        </div>
      )}

      {/* Count */}
      {resultCount !== undefined && (
        <span className="text-xs text-gray-500 ml-auto">
          {resultCount}
          {totalCount !== undefined && totalCount !== resultCount
            ? ` / ${totalCount}`
            : ""}{" "}
          messages
        </span>
      )}
    </div>
  );
}

function ViewModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-1 rounded transition-colors ${
        active
          ? "bg-blue-900/50 text-blue-400"
          : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
      }`}
    >
      {label}
    </button>
  );
}
