/**
 * Mail Route - Async Inbox
 *
 * Three-panel email layout: folders (left) + message list (middle) + preview.
 * Shows pull-delivery messages.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import { Avatar } from "~/components/Avatar";
import { buildNameMap, resolveName } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { useUrlState } from "~/lib/use-url-state";
import { formatRelativeTime, isMailMessage } from "~/lib/types";
import type { Message } from "~/lib/types";

type Folder = "inbox" | "sent" | "all";

export default function Mail() {
  const { messages, agents } = useSignalDB();
  const [folder, setFolder] = useUrlState("folder", "inbox");
  const [statusFilter, setStatusFilter] = useUrlState("status", "all");
  const [search, setSearch] = useUrlState("search");

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  // Get current agent IDs for sent detection
  const agentIds = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < agents.length; i++) {
      set.add(agents[i]!.id);
    }
    return set;
  }, [agents]);

  // Filter mail messages
  const mailMessages = useMemo(() => {
    const result: Message[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (!isMailMessage(msg)) continue;

      // Folder filter
      if (folder === "inbox" && agentIds.has(msg.senderId)) continue;
      if (folder === "sent" && !agentIds.has(msg.senderId)) continue;

      // Status filter
      if (statusFilter !== "all") {
        const isRead = msg.status === "read" || msg.status === "delivered";
        if (statusFilter === "unread" && isRead) continue;
        if (statusFilter === "read" && !isRead) continue;
      }

      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const subject = ((msg.metadata?.subject as string) || "").toLowerCase();
        const content = (msg.content || "").toLowerCase();
        const sender = resolveName(msg.senderId, nameMap).toLowerCase();
        if (!subject.includes(q) && !content.includes(q) && !sender.includes(q)) {
          continue;
        }
      }

      result.push(msg);
    }

    // Sort newest first
    result.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return result;
  }, [messages, folder, statusFilter, search, agentIds, nameMap]);

  const folders: { key: Folder; label: string; count: number }[] = useMemo(() => {
    let inboxCount = 0;
    let sentCount = 0;
    let allCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (!isMailMessage(msg)) continue;
      allCount++;
      if (agentIds.has(msg.senderId)) {
        sentCount++;
      } else {
        inboxCount++;
      }
    }

    return [
      { key: "inbox" as Folder, label: "Inbox", count: inboxCount },
      { key: "sent" as Folder, label: "Sent", count: sentCount },
      { key: "all" as Folder, label: "All Mail", count: allCount },
    ];
  }, [messages, agentIds]);

  return (
    <div className="flex h-full">
      {/* Folder panel */}
      <div className="w-44 border-r border-gray-800 flex-shrink-0 py-4">
        <h2 className="text-xs font-semibold text-gray-500 uppercase px-4 mb-2">
          Folders
        </h2>
        {folders.map((f) => (
          <button
            key={f.key}
            onClick={() => setFolder(f.key)}
            className={`w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-colors ${
              folder === f.key
                ? "bg-gray-800 text-gray-200"
                : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-300"
            }`}
          >
            <span>{f.label}</span>
            <span className="text-xs text-gray-600">{f.count}</span>
          </button>
        ))}
      </div>

      {/* Message list panel */}
      <div className="w-80 border-r border-gray-800 flex flex-col flex-shrink-0">
        <div className="p-3 border-b border-gray-800 space-y-2">
          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mail..."
            className="w-full text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          {/* Status filter */}
          <div className="flex items-center gap-1">
            {(["all", "unread", "read"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  statusFilter === s
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mailMessages.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No mail messages.</div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {mailMessages.map((msg) => (
                <MailRow key={msg.id} message={msg} nameMap={nameMap} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel: empty state */}
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Select a message to read
      </div>
    </div>
  );
}

// ============================================================================
// MailRow
// ============================================================================

const statusColors: Record<string, string> = {
  pending: "bg-yellow-500",
  claimed: "bg-blue-500",
  delivered: "bg-green-500",
  read: "bg-gray-600",
  expired: "bg-red-500",
};

function MailRow({
  message,
  nameMap,
}: {
  message: Message;
  nameMap: Map<string, string>;
}) {
  const senderName = resolveName(message.senderId, nameMap);
  const subject =
    (message.metadata?.subject as string) ||
    (message.content || "").split("\n")[0]?.slice(0, 60) ||
    "(no subject)";
  const preview = (message.content || "").slice(0, 80);
  const isUnread =
    message.status === "pending" || message.status === "claimed";

  return (
    <Link
      to={`/mail/${message.id}`}
      className="block px-3 py-2.5 hover:bg-gray-900/50 transition-colors"
    >
      <div className="flex items-center gap-2 mb-0.5">
        <Avatar name={senderName} id={message.senderId} size="sm" />
        <span
          className={`text-sm truncate flex-1 ${
            isUnread ? "font-semibold text-gray-200" : "text-gray-400"
          }`}
        >
          {senderName}
        </span>
        <span className="text-xs text-gray-600 flex-shrink-0">
          {formatRelativeTime(message.createdAt)}
        </span>
      </div>
      <div
        className={`text-sm truncate ml-8 ${
          isUnread ? "text-gray-200" : "text-gray-400"
        }`}
      >
        {subject}
      </div>
      <div className="text-xs text-gray-600 truncate ml-8 mt-0.5">
        {preview}
      </div>
      <div className="flex items-center gap-2 ml-8 mt-1">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            statusColors[message.status] || "bg-gray-600"
          }`}
        />
        <span className="text-xs text-gray-600">{message.status}</span>
      </div>
    </Link>
  );
}
