/**
 * ChatBubble Component
 *
 * Chat message bubble with sender, content, timestamp.
 */

import { formatTime } from "~/lib/types";

interface ChatBubbleProps {
  content: string;
  timestamp: string;
  senderName?: string;
  isOwn?: boolean;
  showSender?: boolean;
}

export function ChatBubble({
  content,
  timestamp,
  senderName,
  isOwn = false,
  showSender = true,
}: ChatBubbleProps) {
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 ${
          isOwn
            ? "bg-blue-600 text-white"
            : "bg-gray-800 text-gray-200"
        }`}
      >
        {showSender && senderName && (
          <div
            className={`text-xs font-medium mb-0.5 ${
              isOwn ? "text-blue-200" : "text-gray-400"
            }`}
          >
            {senderName}
          </div>
        )}
        <pre className="text-sm whitespace-pre-wrap break-words font-sans">
          {content}
        </pre>
        <div
          className={`text-xs mt-1 ${
            isOwn ? "text-blue-300" : "text-gray-500"
          }`}
        >
          {formatTime(timestamp)}
        </div>
      </div>
    </div>
  );
}
