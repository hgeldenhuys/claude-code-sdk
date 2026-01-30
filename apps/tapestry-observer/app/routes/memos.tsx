/**
 * Memos Route - Announcement Feed
 *
 * Single-column announcement feed with category pills and priority filters.
 * Memos are one-way broadcasts — no conversation threading.
 */

import { useMemo } from "react";
import { Avatar } from "~/components/Avatar";
import { CategoryPill } from "~/components/CategoryPill";
import { buildNameMap, resolveName } from "~/lib/resolve-names";
import { useSignalDB } from "~/lib/signaldb";
import { useUrlState } from "~/lib/use-url-state";
import { formatRelativeTime, isMemoMessage } from "~/lib/types";
import type { MemoView } from "~/lib/types";

const PRIORITY_ICONS: Record<string, string> = {
  urgent: "🔴",
  high: "🟠",
  normal: "",
  low: "⚪",
};

export default function Memos() {
  const { messages, agents } = useSignalDB();
  const [categoryFilter, setCategoryFilter] = useUrlState("category", "all");
  const [priorityFilter, setPriorityFilter] = useUrlState("priority", "all");

  const nameMap = useMemo(() => buildNameMap(agents), [agents]);

  // Extract memos from messages
  const memos: MemoView[] = useMemo(() => {
    const result: MemoView[] = [];
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (!isMemoMessage(m)) continue;

      const memo: MemoView = {
        message: m,
        subject: (m.metadata?.subject as string) || "(no subject)",
        category: (m.metadata?.category as string) || "general",
        priority: (m.metadata?.priority as string) || "normal",
      };

      // Apply filters
      if (categoryFilter !== "all" && memo.category !== categoryFilter) continue;
      if (priorityFilter !== "all" && memo.priority !== priorityFilter) continue;

      result.push(memo);
    }

    result.sort(
      (a, b) =>
        new Date(b.message.createdAt).getTime() -
        new Date(a.message.createdAt).getTime()
    );
    return result;
  }, [messages, categoryFilter, priorityFilter]);

  // Extract unique categories from all memos
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      if (!isMemoMessage(m)) continue;
      set.add((m.metadata?.category as string) || "general");
    }
    return Array.from(set).sort();
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="p-4 border-b border-gray-800 flex-shrink-0">
        <h1 className="text-lg font-semibold text-gray-200 mb-3">
          Memos
          <span className="ml-2 text-gray-500 text-sm font-normal">
            ({memos.length})
          </span>
        </h1>

        <div className="flex items-center gap-4 flex-wrap">
          {/* Category pills */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">Category:</span>
            <CategoryPill
              category="all"
              active={categoryFilter === "all"}
              onClick={() => setCategoryFilter("all")}
            />
            {categories.map((cat) => (
              <CategoryPill
                key={cat}
                category={cat}
                active={categoryFilter === cat}
                onClick={() => setCategoryFilter(cat)}
              />
            ))}
          </div>

          {/* Priority filter */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Priority:</span>
            {(["all", "urgent", "high", "normal", "low"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPriorityFilter(p)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  priorityFilter === p
                    ? "bg-gray-700 text-gray-200"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Memo feed */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
          {memos.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              No memos match the current filters.
            </div>
          ) : (
            memos.map((memo) => (
              <MemoCard key={memo.message.id} memo={memo} nameMap={nameMap} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MemoCard
// ============================================================================

/**
 * Try to extract structured content from a memo's content field.
 * Some memos store JSON like {"subject":"...","body":"...","category":"..."}
 */
function parseMemoContent(raw: string): { subject?: string; body: string } {
  if (!raw) return { body: "" };
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.body === "string") {
      return { subject: parsed.subject, body: parsed.body };
    }
  } catch {
    // Not JSON — use raw content
  }
  return { body: raw };
}

function MemoCard({
  memo,
  nameMap,
}: {
  memo: MemoView;
  nameMap: Map<string, string>;
}) {
  const senderName = resolveName(memo.message.senderId, nameMap);
  const priorityIcon = PRIORITY_ICONS[memo.priority] || "";

  // Parse content — extract body if stored as JSON
  const parsed = parseMemoContent(memo.message.content || "");
  const displaySubject = memo.subject !== "(no subject)" ? memo.subject : parsed.subject || "(no subject)";
  const displayBody = parsed.body;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <CategoryPill category={memo.category} />
        {priorityIcon && <span className="text-sm">{priorityIcon}</span>}
        <span className="text-xs text-gray-600 ml-auto">
          {formatRelativeTime(memo.message.createdAt)}
        </span>
      </div>

      {/* Subject */}
      <h3 className="text-base font-semibold text-gray-200 mb-2">
        {displaySubject}
      </h3>

      {/* Content */}
      <pre className="text-sm whitespace-pre-wrap break-words font-mono text-gray-400 leading-relaxed">
        {displayBody}
      </pre>

      {/* Sender */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-800">
        <Avatar
          name={senderName}
          id={memo.message.senderId}
          size="sm"
        />
        <span className="text-xs text-gray-500">{senderName}</span>
      </div>
    </div>
  );
}
