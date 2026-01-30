/**
 * Channel Detail Route - Discord-style Timeline
 *
 * Shows channel info, members, and messages in a Discord-style layout
 * with day separators and grouped same-sender messages.
 */

import { useEffect, useMemo, useRef } from "react";
import { Link, useParams } from "react-router";
import { Avatar } from "~/components/Avatar";
import { ChatBubble } from "~/components/ChatBubble";
import { DaySeparator } from "~/components/DaySeparator";
import { groupMessages } from "~/components/MessageGroup";
import { buildNameMap, resolveName } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { formatRelativeTime, isSameDay } from "~/lib/types";

export default function ChannelDetail() {
  const { channelId } = useParams();
  const { channels, messages, agents } = useSignalDB();
  const scrollRef = useRef<HTMLDivElement>(null);

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  const channel = useMemo(
    () => channels.find((c) => c.id === channelId),
    [channels, channelId]
  );

  // Messages in this channel, oldest first (chronological)
  const channelMessages = useMemo(() => {
    const result = messages.filter((m) => m.channelId === channelId);
    result.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return result;
  }, [messages, channelId]);

  // Group messages by sender within 2-minute windows
  const messageGroups = useMemo(
    () => groupMessages(channelMessages),
    [channelMessages]
  );

  // Resolve member names
  const memberNames = useMemo(() => {
    if (!channel) return [];
    const result: { id: string; name: string }[] = [];
    const members = channel.members || [];
    for (let i = 0; i < members.length; i++) {
      result.push({
        id: members[i]!,
        name: nameMap.get(members[i]!) || members[i]!.slice(0, 8),
      });
    }
    return result;
  }, [channel, nameMap]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [channelMessages.length]);

  if (!channel) {
    return (
      <div className="p-6">
        <Link
          to="/channels"
          className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block"
        >
          ← Back to channels
        </Link>
        <p className="text-gray-500">Channel not found: {channelId}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <Link
          to="/channels"
          className="text-sm text-blue-400 hover:text-blue-300 mb-2 inline-block"
        >
          ← Back to channels
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-lg font-semibold text-gray-200">
            # {channel.name || "Unnamed Channel"}
          </h1>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400">
            {channel.type}
          </span>
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <div>Created {formatRelativeTime(channel.createdAt)}</div>
          <div className="flex items-center gap-1">
            <span>Members ({memberNames.length}):</span>
            <div className="flex items-center gap-1">
              {memberNames.map((m) => (
                <span
                  key={m.id}
                  className="bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded text-xs"
                >
                  {m.name}
                </span>
              ))}
              {memberNames.length === 0 && (
                <span className="text-gray-600">none</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages - Discord-style timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        {channelMessages.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">
            No messages in this channel.
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
