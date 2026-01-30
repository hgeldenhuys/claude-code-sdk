/**
 * Chat Thread Route - Bubble-style Conversation
 *
 * Shows messages in a thread with chat bubbles, day separators, and message groups.
 */

import { useEffect, useMemo, useRef } from "react";
import { Link, useParams } from "react-router";
import { ChatBubble } from "~/components/ChatBubble";
import { DaySeparator } from "~/components/DaySeparator";
import { Avatar } from "~/components/Avatar";
import { buildNameMap, resolveName } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { isChatMessage, isSameDay } from "~/lib/types";
import type { Message } from "~/lib/types";
import { groupMessages } from "~/components/MessageGroup";

export default function ChatThread() {
  const { threadId } = useParams();
  const { messages, agents } = useSignalDB();
  const scrollRef = useRef<HTMLDivElement>(null);

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  // Get thread messages sorted chronologically
  const threadMessages = useMemo(() => {
    const result: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (!isChatMessage(msg)) continue;
      const tid = msg.threadId || msg.id;
      if (tid === threadId) {
        result.push(msg);
      }
    }
    result.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return result;
  }, [messages, threadId]);

  // Get unique participants
  const participants = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < threadMessages.length; i++) {
      set.add(threadMessages[i]!.senderId);
    }
    const names: string[] = [];
    for (const id of set) {
      names.push(resolveName(id, nameMap));
    }
    return names;
  }, [threadMessages, nameMap]);

  // Group messages by sender within 2-minute windows
  const messageGroups = useMemo(
    () => groupMessages(threadMessages),
    [threadMessages]
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadMessages.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <Link
          to="/chat"
          className="text-sm text-blue-400 hover:text-blue-300 mb-2 inline-block"
        >
          ← Back to chat
        </Link>
        <h1 className="text-lg font-semibold text-gray-200">
          {participants.join(", ") || "Conversation"}
        </h1>
        <span className="text-xs text-gray-500">
          {threadMessages.length} message
          {threadMessages.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        {threadMessages.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            No messages in this thread.
          </div>
        ) : (
          <div className="space-y-1">
            {messageGroups.map((group, groupIdx) => {
              const firstMsg = group.messages[0]!;
              const senderName = resolveName(group.senderId, nameMap);

              // Check if we need a day separator
              let showDaySep = false;
              if (groupIdx === 0) {
                showDaySep = true;
              } else {
                const prevGroup = messageGroups[groupIdx - 1]!;
                const prevLast =
                  prevGroup.messages[prevGroup.messages.length - 1]!;
                if (!isSameDay(prevLast.createdAt, firstMsg.createdAt)) {
                  showDaySep = true;
                }
              }

              return (
                <div key={`${group.senderId}-${firstMsg.id}`}>
                  {showDaySep && (
                    <DaySeparator date={new Date(firstMsg.createdAt)} />
                  )}
                  <div className="flex gap-2 px-4 py-1">
                    <Avatar
                      name={senderName}
                      id={group.senderId}
                      size="sm"
                    />
                    <div className="flex flex-col gap-0.5 items-start">
                      {group.messages.map((msg, idx) => (
                        <ChatBubble
                          key={msg.id}
                          content={msg.content || ""}
                          timestamp={msg.createdAt}
                          senderName={senderName}
                          showSender={idx === 0}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
