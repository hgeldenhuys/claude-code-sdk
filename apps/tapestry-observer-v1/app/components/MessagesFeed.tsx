/**
 * MessagesFeed Component
 *
 * Real-time stream of messages with auto-scroll and filtering.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useSignalDB } from "~/lib/signaldb";
import type { Message, MessageStatus, MessageType } from "~/lib/types";
import { formatTime } from "~/lib/types";

interface MessagesFeedProps {
  filterAgentId?: string | null;
  filterChannelId?: string | null;
}

export function MessagesFeed({
  filterAgentId,
  filterChannelId,
}: MessagesFeedProps) {
  const { messages, agents } = useSignalDB();
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const feedRef = useRef<HTMLDivElement>(null);
  const lastMessageCountRef = useRef(0);

  // Create agent lookup
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents) {
      map.set(agent.id, agent.sessionName || agent.machineId);
    }
    return map;
  }, [agents]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (filterAgentId && msg.senderId !== filterAgentId) return false;
      if (filterChannelId && msg.channelId !== filterChannelId) return false;
      return true;
    });
  }, [messages, filterAgentId, filterChannelId]);

  // Sort by createdAt (newest last for natural scroll)
  const sortedMessages = useMemo(() => {
    return [...filteredMessages].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
  }, [filteredMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && feedRef.current) {
      if (sortedMessages.length > lastMessageCountRef.current) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    }
    lastMessageCountRef.current = sortedMessages.length;
  }, [sortedMessages.length, autoScroll]);

  // Handle scroll to detect manual scrolling
  const handleScroll = () => {
    if (!feedRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  // Toggle message expansion
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">
          Messages
          <span className="ml-2 text-gray-500">
            ({sortedMessages.length}
            {(filterAgentId || filterChannelId) &&
              ` / ${messages.length}`})
          </span>
        </h2>

        {/* Auto-scroll indicator */}
        <button
          onClick={() => {
            setAutoScroll(true);
            if (feedRef.current) {
              feedRef.current.scrollTop = feedRef.current.scrollHeight;
            }
          }}
          className={`
            text-xs px-2 py-1 rounded transition-colors
            ${
              autoScroll
                ? "bg-blue-900/50 text-blue-400"
                : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
            }
          `}
        >
          {autoScroll ? "Auto-scroll ON" : "Scroll to bottom"}
        </button>
      </div>

      {/* Message feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {sortedMessages.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            No messages
          </div>
        ) : (
          <div className="divide-y divide-gray-800/30">
            {sortedMessages.map((msg) => (
              <MessageItem
                key={msg.id}
                message={msg}
                senderName={agentMap.get(msg.senderId)}
                expanded={expandedIds.has(msg.id)}
                onToggle={() => toggleExpand(msg.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Message Item
// ============================================================================

interface MessageItemProps {
  message: Message;
  senderName?: string;
  expanded: boolean;
  onToggle: () => void;
}

const typeColors: Record<string, string> = {
  chat: "text-gray-300",
  memo: "text-blue-400",
  command: "text-orange-400",
  response: "text-green-400",
  text: "text-gray-400",
};

const typeBadgeColors: Record<string, string> = {
  chat: "bg-gray-700 text-gray-300",
  memo: "bg-blue-900/50 text-blue-400",
  command: "bg-orange-900/50 text-orange-400",
  response: "bg-green-900/50 text-green-400",
  text: "bg-gray-800 text-gray-400",
};

const statusColors: Record<string, string> = {
  pending: "text-yellow-500",
  claimed: "text-blue-500",
  delivered: "text-green-500",
  read: "text-gray-500",
  expired: "text-red-500",
  sent: "text-gray-400",
};

const DEFAULT_TYPE_COLOR = "text-gray-400";
const DEFAULT_BADGE_COLOR = "bg-gray-800 text-gray-400";
const DEFAULT_STATUS_COLOR = "text-gray-500";

function MessageItem({
  message,
  senderName,
  expanded,
  onToggle,
}: MessageItemProps) {
  const content = message.content || "";
  const contentPreview =
    content.length > 100 && !expanded
      ? `${content.slice(0, 100)}...`
      : content;

  const msgType = message.messageType || "text";
  const msgStatus = message.status || "pending";
  const targetAddr = message.targetAddress || "";

  return (
    <div
      className={`
        p-3 animate-fade-in
        ${expanded ? "bg-gray-900/50" : "hover:bg-gray-900/30"}
      `}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        {/* Time */}
        <span className="text-xs text-gray-600 font-mono">
          {formatTime(message.createdAt)}
        </span>

        {/* Type badge */}
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${typeBadgeColors[msgType] || DEFAULT_BADGE_COLOR}`}
        >
          {msgType}
        </span>

        {/* Sender */}
        <span className="text-sm font-medium text-gray-300">
          {senderName || message.senderId?.slice(0, 8) || "unknown"}
        </span>

        {/* Arrow */}
        <span className="text-gray-600">→</span>

        {/* Target */}
        <span className="text-sm text-gray-500 truncate max-w-[200px]">
          {targetAddr.replace(/^(agent|project|broadcast):\/\//, "") || "unknown"}
        </span>

        {/* Status */}
        <span className={`text-xs ${statusColors[msgStatus] || DEFAULT_STATUS_COLOR}`}>
          {msgStatus}
        </span>
      </div>

      {/* Content */}
      <button
        onClick={onToggle}
        className="w-full text-left mt-1"
      >
        <pre
          className={`
            text-sm whitespace-pre-wrap break-words font-mono
            ${typeColors[msgType] || DEFAULT_TYPE_COLOR}
          `}
        >
          {contentPreview}
        </pre>
        {content.length > 100 && (
          <span className="text-xs text-gray-600 mt-1 block">
            {expanded ? "Click to collapse" : "Click to expand"}
          </span>
        )}
      </button>

      {/* Thread indicator */}
      {message.threadId && (
        <div className="text-xs text-gray-600 mt-2">
          Thread: {message.threadId.slice(0, 8)}
        </div>
      )}
    </div>
  );
}
