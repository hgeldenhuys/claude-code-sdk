/**
 * Chat Route - Real-time Conversations
 *
 * Two-panel layout: conversation list (left) + thread preview (right).
 * Shows push-delivery messages grouped by threadId.
 */

import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { Avatar } from "~/components/Avatar";
import { buildNameMap, resolveName } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { useUrlState } from "~/lib/use-url-state";
import type { ChatThread, Message } from "~/lib/types";
import { formatRelativeTime, isChatMessage } from "~/lib/types";

export default function Chat() {
  const { messages, agents } = useSignalDB();
  const [search, setSearch] = useUrlState("search");
  const [agentFilter, setAgentFilter] = useUrlState("agent");

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  // Build chat threads from push-delivery messages
  const threads = useMemo(() => {
    const threadMap = new Map<string, Message[]>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (!isChatMessage(msg)) continue;

      // Filter by agent
      if (agentFilter && msg.senderId !== agentFilter) continue;

      // Filter by search
      if (search) {
        const q = search.toLowerCase();
        const senderName = resolveName(msg.senderId, nameMap).toLowerCase();
        if (
          !(msg.content || "").toLowerCase().includes(q) &&
          !senderName.includes(q)
        ) {
          continue;
        }
      }

      const tid = msg.threadId || msg.id;
      const existing = threadMap.get(tid);
      if (existing) {
        existing.push(msg);
      } else {
        threadMap.set(tid, [msg]);
      }
    }

    // Build thread summaries
    const result: ChatThread[] = [];
    for (const [threadId, msgs] of threadMap) {
      // Sort messages chronologically
      msgs.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      const participantSet = new Set<string>();
      for (let i = 0; i < msgs.length; i++) {
        participantSet.add(msgs[i]!.senderId);
      }

      result.push({
        threadId,
        participants: Array.from(participantSet),
        lastMessage: msgs[msgs.length - 1]!,
        messageCount: msgs.length,
        unreadCount: 0,
      });
    }

    // Sort by most recent message
    result.sort(
      (a, b) =>
        new Date(b.lastMessage.createdAt).getTime() -
        new Date(a.lastMessage.createdAt).getTime()
    );

    return result;
  }, [messages, nameMap, search, agentFilter]);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-semibold text-gray-200 mb-3">
            Chat
            <span className="ml-2 text-gray-500 text-sm font-normal">
              ({threads.length})
            </span>
          </h1>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {/* Agent filter */}
          {agentFilter && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Agent: {resolveName(agentFilter, nameMap)}
              </span>
              <button
                onClick={() => setAgentFilter("")}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                ×
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">
              No chat conversations yet.
            </div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {threads.map((thread) => (
                <ConversationRow
                  key={thread.threadId}
                  thread={thread}
                  nameMap={nameMap}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: empty state */}
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Select a conversation to view messages
      </div>
    </div>
  );
}

// ============================================================================
// ConversationRow
// ============================================================================

function ConversationRow({
  thread,
  nameMap,
}: {
  thread: ChatThread;
  nameMap: Map<string, string>;
}) {
  const lastMsg = thread.lastMessage;
  const senderName = resolveName(lastMsg.senderId, nameMap);
  const preview = (lastMsg.content || "").slice(0, 60);

  // Get display name for thread (participants minus self or first participant)
  const participantNames: string[] = [];
  for (let i = 0; i < thread.participants.length; i++) {
    participantNames.push(resolveName(thread.participants[i]!, nameMap));
  }
  const threadName = participantNames.join(", ");

  return (
    <Link
      to={`/chat/${thread.threadId}`}
      className="block px-4 py-3 hover:bg-gray-900/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        <Avatar
          name={senderName}
          id={thread.participants[0] || thread.threadId}
          size="md"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-sm font-medium text-gray-200 truncate">
              {threadName}
            </span>
            <span className="text-xs text-gray-600 flex-shrink-0 ml-2">
              {formatRelativeTime(lastMsg.createdAt)}
            </span>
          </div>
          <div className="text-xs text-gray-500 truncate">
            {preview}
            {(lastMsg.content || "").length > 60 ? "..." : ""}
          </div>
          {thread.messageCount > 1 && (
            <span className="text-xs text-gray-600 mt-0.5 inline-block">
              {thread.messageCount} messages
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
