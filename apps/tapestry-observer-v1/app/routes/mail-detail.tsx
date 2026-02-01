/**
 * Mail Detail Route - Full Message View
 *
 * Shows full message with headers, content, thread chain, and metadata.
 */

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Avatar } from "~/components/Avatar";
import { buildNameMap, resolveName, parseTargetAddress } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { formatRelativeTime, formatTime, isMailMessage } from "~/lib/types";
import type { Message } from "~/lib/types";

export default function MailDetail() {
  const { messageId } = useParams();
  const { messages, agents } = useSignalDB();

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  const message = useMemo(
    () => messages.find((m) => m.id === messageId),
    [messages, messageId]
  );

  // Thread messages (other messages with same threadId)
  const threadMessages = useMemo(() => {
    if (!message?.threadId) return [];
    const result: Message[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.threadId === message.threadId && msg.id !== message.id) {
        result.push(msg);
      }
    }
    result.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    return result;
  }, [messages, message]);

  if (!message) {
    return (
      <div className="p-6">
        <Link
          to="/mail"
          className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block"
        >
          ← Back to mail
        </Link>
        <p className="text-gray-500">Message not found: {messageId}</p>
      </div>
    );
  }

  const senderName = resolveName(message.senderId, nameMap);
  const subject =
    (message.metadata?.subject as string) ||
    (message.content || "").split("\n")[0]?.slice(0, 80) ||
    "(no subject)";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <Link
          to="/mail"
          className="text-sm text-blue-400 hover:text-blue-300 mb-3 inline-block"
        >
          ← Back to mail
        </Link>

        <h1 className="text-lg font-semibold text-gray-200 mb-3">
          {subject}
        </h1>

        {/* Headers */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-1.5">
          <HeaderRow label="From">
            <div className="flex items-center gap-2">
              <Avatar name={senderName} id={message.senderId} size="sm" />
              <span className="text-sm text-gray-200">{senderName}</span>
            </div>
          </HeaderRow>
          <HeaderRow label="To">
            <span className="text-sm text-gray-300">
              {parseTargetAddress(message.targetAddress)}
            </span>
          </HeaderRow>
          <HeaderRow label="Date">
            <span className="text-sm text-gray-300">
              {new Date(message.createdAt).toLocaleString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </HeaderRow>
          <HeaderRow label="Status">
            <StatusPill status={message.status} />
          </HeaderRow>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          <pre className="text-sm whitespace-pre-wrap break-words font-mono text-gray-300 leading-relaxed">
            {message.content}
          </pre>

          {/* Thread chain */}
          {threadMessages.length > 0 && (
            <div className="mt-8 border-t border-gray-800 pt-6">
              <h3 className="text-sm font-semibold text-gray-400 mb-4">
                Thread ({threadMessages.length} related message
                {threadMessages.length !== 1 ? "s" : ""})
              </h3>
              <div className="space-y-4">
                {threadMessages.map((msg) => (
                  <ThreadMessage key={msg.id} message={msg} nameMap={nameMap} />
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          <MetadataSection metadata={message.metadata} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function HeaderRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-12 flex-shrink-0">{label}:</span>
      {children}
    </div>
  );
}

const statusPillColors: Record<string, string> = {
  pending: "bg-yellow-900/50 text-yellow-400",
  claimed: "bg-blue-900/50 text-blue-400",
  delivered: "bg-green-900/50 text-green-400",
  read: "bg-gray-700 text-gray-400",
  expired: "bg-red-900/50 text-red-400",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded ${
        statusPillColors[status] || "bg-gray-700 text-gray-400"
      }`}
    >
      {status}
    </span>
  );
}

function ThreadMessage({
  message,
  nameMap,
}: {
  message: Message;
  nameMap: Map<string, string>;
}) {
  const senderName = resolveName(message.senderId, nameMap);

  return (
    <Link
      to={`/mail/${message.id}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar name={senderName} id={message.senderId} size="sm" />
        <span className="text-sm font-medium text-gray-300">{senderName}</span>
        <span className="text-xs text-gray-600 ml-auto">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      <p className="text-xs text-gray-400 font-mono truncate">
        {(message.content || "").slice(0, 120)}
      </p>
    </Link>
  );
}

function MetadataSection({
  metadata,
}: {
  metadata: Record<string, unknown> | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = metadata || {};
  const keys = Object.keys(data);

  if (keys.length === 0) return null;

  // Filter out display keys already shown in headers
  const displayKeys = keys.filter(
    (k) => k !== "subject" && k !== "deliveryMode"
  );
  if (displayKeys.length === 0) return null;

  return (
    <div className="mt-6 border-t border-gray-800 pt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-semibold text-gray-500 hover:text-gray-400 transition-colors"
      >
        {expanded ? "▾" : "▸"} Metadata ({displayKeys.length} fields)
      </button>
      {expanded && (
        <pre className="mt-2 text-xs font-mono text-gray-500 bg-gray-950 border border-gray-800 rounded p-2 overflow-x-auto">
          {JSON.stringify(
            Object.fromEntries(displayKeys.map((k) => [k, data[k]])),
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
}
