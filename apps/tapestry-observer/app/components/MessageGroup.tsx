/**
 * MessageGroup Component
 *
 * Groups consecutive messages from the same sender.
 * Shows avatar + name once, then stacked content bubbles.
 */

import type { Message } from "~/lib/types";
import { Avatar } from "./Avatar";
import { ChatBubble } from "./ChatBubble";

interface MessageGroupProps {
  messages: Message[];
  senderName: string;
  senderId: string;
  isOwn?: boolean;
}

export function MessageGroup({
  messages,
  senderName,
  senderId,
  isOwn = false,
}: MessageGroupProps) {
  if (messages.length === 0) return null;

  return (
    <div
      className={`flex gap-2 px-4 py-1 ${isOwn ? "flex-row-reverse" : ""}`}
    >
      <Avatar name={senderName} id={senderId} size="sm" />
      <div className={`flex flex-col gap-0.5 ${isOwn ? "items-end" : "items-start"}`}>
        {messages.map((msg, idx) => (
          <ChatBubble
            key={msg.id}
            content={msg.content || ""}
            timestamp={msg.createdAt}
            senderName={senderName}
            isOwn={isOwn}
            showSender={idx === 0}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Group messages by sender within a 2-minute window.
 * Returns arrays of consecutive same-sender messages.
 */
export function groupMessages(
  messages: Message[]
): { senderId: string; messages: Message[] }[] {
  const groups: { senderId: string; messages: Message[] }[] = [];
  const TWO_MINUTES = 2 * 60 * 1000;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const lastGroup = groups[groups.length - 1];

    if (lastGroup && lastGroup.senderId === msg.senderId) {
      const lastMsg = lastGroup.messages[lastGroup.messages.length - 1]!;
      const timeDiff =
        new Date(msg.createdAt).getTime() -
        new Date(lastMsg.createdAt).getTime();

      if (Math.abs(timeDiff) <= TWO_MINUTES) {
        lastGroup.messages.push(msg);
        continue;
      }
    }

    groups.push({ senderId: msg.senderId, messages: [msg] });
  }

  return groups;
}
