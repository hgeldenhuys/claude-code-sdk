/**
 * Thread Detail View — Chat bubble conversation
 *
 * Shows a full thread as a chronological chat-bubble view.
 * Discord/external senders align left (blue accent),
 * local agent replies align right (emerald accent).
 *
 * SSR-hydrated via loader, with SSE for live new replies.
 */

import { useState, useEffect, useRef } from "react";
import { useLoaderData, useRevalidator, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { useLayoutContext } from "./layout";
import { signalDBFetch } from "../lib/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type Message,
  type MessageType,
  MESSAGE_TYPE_COLORS,
  parseMessages,
  parseAgents,
  parseOneMessage,
  formatRelativeTime,
  getSenderInfo,
  getThreadParticipants,
  TICK_INTERVAL_MS,
} from "../lib/utils";

// ─── Types ───────────────────────────────────────────────

/** Map of agent UUID → friendly session name */
type AgentNameMap = Record<string, string>;

interface LoaderData {
  thread: Message[];
  threadId: string;
  agentNames: AgentNameMap;
  loadedAt: string;
  error: string | null;
}

// ─── Loader (SSR) ────────────────────────────────────────

export async function loader({ params }: LoaderFunctionArgs): Promise<LoaderData> {
  const threadId = params.threadId!;

  try {
    // Parallel fetch: root message + thread replies + agent registry
    const [rootData, repliesData, agentsData] = await Promise.all([
      signalDBFetch<{ data: unknown[] }>("/v1/messages", {
        "filter[id]": threadId,
        limit: "1",
      }),
      signalDBFetch<{ data: unknown[] }>("/v1/messages", {
        "filter[thread_id]": threadId,
        orderBy: "created_at",
        order: "asc",
        limit: "500",
      }),
      signalDBFetch<{ data: unknown[] }>("/v1/agents", {
        limit: "200",
      }).catch(() => ({ data: [] })), // Non-critical — fall back gracefully
    ]);

    const roots = parseMessages(rootData);
    const replies = parseMessages(repliesData);
    const agents = parseAgents(agentsData);

    // Build agent UUID → session name lookup
    const agentNames: AgentNameMap = {};
    for (const agent of agents) {
      if (agent.id && agent.sessionName) {
        agentNames[agent.id] = agent.sessionName;
      }
    }

    // Also infer names from target_address fields in messages
    const allMsgs = [...roots, ...replies];
    for (const msg of allMsgs) {
      if (!msg.targetAddress || !msg.claimedBy) continue;

      // Pattern 1: agent://machine/session-name → claimedBy UUID = session-name
      if (msg.targetAddress.startsWith("agent://")) {
        const parts = msg.targetAddress.split("/");
        const name = parts[parts.length - 1];
        if (name && !agentNames[msg.claimedBy]) {
          agentNames[msg.claimedBy] = name;
        }
        continue;
      }

      // Pattern 2: plain session name (not a UUID) → claimedBy UUID = that name
      // e.g., target_address = "swift-bear", claimed_by = "740aacd7-..."
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(msg.targetAddress);
      if (!isUUID && !agentNames[msg.claimedBy]) {
        agentNames[msg.claimedBy] = msg.targetAddress;
      }
    }

    // Build chronological thread: root first, then replies sorted asc
    const root = roots.length > 0 ? roots[0] : null;
    const thread = root ? [root, ...replies] : replies;

    return {
      thread,
      threadId,
      agentNames,
      loadedAt: new Date().toISOString(),
      error: null,
    };
  } catch (err) {
    return {
      thread: [],
      threadId,
      agentNames: {},
      loadedAt: new Date().toISOString(),
      error: String(err),
    };
  }
}

// ─── Component ───────────────────────────────────────────

export default function ThreadDetailPage() {
  const { configOk } = useLayoutContext();
  const loaderData = useLoaderData<LoaderData>();
  const revalidator = useRevalidator();
  const [tick, setTick] = useState(0);
  const [sseConnected, setSseConnected] = useState(false);
  const [liveMessages, setLiveMessages] = useState<Message[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { thread, threadId, agentNames, loadedAt, error } = loaderData;

  // Combine SSR thread + live messages (dedup)
  const allMessages = (() => {
    if (liveMessages.length === 0) return thread;
    const ids = new Set<string>();
    for (const msg of thread) ids.add(msg.id);
    const newOnes: Message[] = [];
    for (const msg of liveMessages) {
      if (!ids.has(msg.id)) newOnes.push(msg);
    }
    return [...thread, ...newOnes];
  })();

  const participants = getThreadParticipants(allMessages);
  const rootMessage = allMessages.length > 0 ? allMessages[0] : null;
  const rootSender = rootMessage ? getSenderInfo(rootMessage) : null;

  // ─── SSE for live thread updates ─────────────────────

  useEffect(() => {
    if (!configOk || !loadedAt) return;

    const sseUrl = `/api/proxy/v1/messages/stream?filter[thread_id]=${encodeURIComponent(threadId)}&filter[created_at][gt]=${encodeURIComponent(loadedAt)}`;
    const es = new EventSource(sseUrl);

    es.onopen = () => setSseConnected(true);

    es.addEventListener("insert", (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const msg = parseOneMessage(parsed);
        if (!msg) return;
        setLiveMessages((prev) => {
          for (const existing of prev) {
            if (existing.id === msg.id) return prev;
          }
          return [...prev, msg];
        });
      } catch {
        // Malformed SSE data — ignore
      }
    });

    const revalidateHandler = () => revalidator.revalidate();
    es.addEventListener("update", revalidateHandler);
    es.addEventListener("delete", revalidateHandler);

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      es.close();
      setSseConnected(false);
    };
  }, [configOk, loadedAt, threadId, revalidator]);

  // Clear live messages when loader data refreshes
  useEffect(() => {
    setLiveMessages([]);
  }, [loadedAt]);

  // Timestamp refresh
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  void tick;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (liveMessages.length > 0 && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveMessages.length]);

  // ─── Render ────────────────────────────────────────────

  if (!configOk) {
    return (
      <div className="text-center py-20">
        <div className="text-gray-600 text-4xl mb-4">&#9888;</div>
        <h3 className="text-lg font-medium text-gray-400 mb-2">Not configured</h3>
        <p className="text-sm text-gray-500">Set up .env.tapestry to connect to SignalDB.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Back link + header */}
      <div className="mb-6">
        <Link
          to="/messages"
          className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Messages
        </Link>

        {/* Thread header */}
        {rootMessage && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-gray-100 truncate">
                Thread: {rootSender?.name || "Unknown"}
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                {/* SSE indicator */}
                <span className="flex items-center gap-1.5 text-xs">
                  <span className={`w-1.5 h-1.5 rounded-full ${sseConnected ? "bg-emerald-400 animate-heartbeat" : "bg-gray-500"}`} />
                  <span className={sseConnected ? "text-emerald-400" : "text-gray-500"}>
                    {sseConnected ? "Live" : "Connecting\u2026"}
                  </span>
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-400 line-clamp-2 mb-3">
              {rootMessage.content ? rootMessage.content.slice(0, 200) : "\u2014"}
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>{allMessages.length} message{allMessages.length !== 1 ? "s" : ""}</span>
              <span className="text-gray-700">&middot;</span>
              <span>{participants.length} participant{participants.length !== 1 ? "s" : ""}</span>
              <span className="text-gray-700">&middot;</span>
              <span>{formatRelativeTime(rootMessage.createdAt)}</span>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}
      </div>

      {/* Empty state */}
      {allMessages.length === 0 && !error && (
        <div className="text-center py-20">
          <div className="text-gray-600 text-4xl mb-4">&#128172;</div>
          <h3 className="text-lg font-medium text-gray-400 mb-2">Thread not found</h3>
          <p className="text-sm text-gray-500">
            This thread may have been deleted or the ID is invalid.
          </p>
          <Link
            to="/messages"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            &larr; Return to messages
          </Link>
        </div>
      )}

      {/* Chat bubbles */}
      {allMessages.length > 0 && (
        <div className="space-y-3 pb-8">
          {allMessages.map((msg, idx) => {
            // Resolve root sender name for alignment comparison
            const rootName = rootMessage
              ? (agentNames[rootMessage.senderId] || getSenderInfo(rootMessage).name)
              : null;
            return (
              <ChatBubble
                key={msg.id}
                message={msg}
                isFirst={idx === 0}
                agentNames={agentNames}
                rootSenderName={rootName}
              />
            );
          })}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

// ─── Chat Bubble ──────────────────────────────────────────

function ChatBubble({ message, isFirst, agentNames, rootSenderName }: { message: Message; isFirst: boolean; agentNames: AgentNameMap; rootSenderName: string | null }) {
  const sender = getSenderInfo(message);
  // Resolve UUID sender names to friendly session names from agent registry
  const resolvedName = agentNames[message.senderId] || sender.name;

  const knownType = message.messageType in MESSAGE_TYPE_COLORS;
  const typeColors = knownType
    ? MESSAGE_TYPE_COLORS[message.messageType]
    : { badge: "bg-gray-400/15 border-gray-400/30", badgeText: "text-gray-300", label: message.messageType || "unknown" };

  // Alignment: root sender → left (gray), others → right (emerald)
  // Discord senders always left (blue)
  const isSameAsRoot = rootSenderName ? resolvedName === rootSenderName : false;
  const isRight = !sender.isDiscord && !isSameAsRoot;

  return (
    <div
      className={`flex ${isRight ? "justify-end" : "justify-start"} ${
        isRight ? "animate-slide-right" : "animate-slide-left"
      }`}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isRight
            ? "bg-emerald-500/10 border border-emerald-500/25"
            : sender.isDiscord
              ? "bg-blue-500/10 border border-blue-500/25"
              : "bg-gray-800/80 border border-gray-700"
        }`}
      >
        {/* Sender header */}
        <div className={`flex items-center gap-2 mb-1.5 ${isRight ? "justify-end" : "justify-start"}`}>
          {/* Discord icon for discord senders */}
          {sender.isDiscord && (
            <DiscordIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          )}
          {/* Agent icon for non-discord senders */}
          {!sender.isDiscord && (
            <svg className={`w-3.5 h-3.5 shrink-0 ${isRight ? "text-emerald-400" : "text-gray-400"}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-16.5-3a3 3 0 0 1 3-3h13.5a3 3 0 0 1 3 3m-19.5 0a4.5 4.5 0 0 1 .9-2.7L5.737 5.1a3.375 3.375 0 0 1 2.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 0 1 .9 2.7" />
            </svg>
          )}
          <span className={`text-xs font-medium ${
            isRight ? "text-emerald-300" : sender.isDiscord ? "text-blue-300" : "text-gray-300"
          }`}>
            {resolvedName}
          </span>
          {/* Type badge */}
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${typeColors.badge} ${typeColors.badgeText}`}>
            {typeColors.label}
          </span>
          {/* Root indicator */}
          {isFirst && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-600/20 border border-gray-600/30 text-gray-400">
              root
            </span>
          )}
        </div>

        {/* Message content — rendered as Markdown */}
        <div className="text-sm text-gray-200 leading-relaxed prose-bubble">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={mdComponents}
          >
            {message.content || "\u2014"}
          </Markdown>
        </div>

        {/* Timestamp footer */}
        <div className={`flex items-center gap-2 mt-2 ${isRight ? "justify-end" : "justify-start"}`}>
          <span className="text-[11px] text-gray-500">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Markdown component overrides for dark chat bubbles ───

const mdComponents = {
  h1: ({ children, ...props }: React.ComponentProps<"h1">) => (
    <h1 className="text-base font-bold text-gray-100 mt-3 mb-1.5" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.ComponentProps<"h2">) => (
    <h2 className="text-sm font-bold text-gray-100 mt-3 mb-1" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.ComponentProps<"h3">) => (
    <h3 className="text-sm font-semibold text-gray-200 mt-2 mb-1" {...props}>{children}</h3>
  ),
  p: ({ children, ...props }: React.ComponentProps<"p">) => (
    <p className="mb-2 last:mb-0" {...props}>{children}</p>
  ),
  strong: ({ children, ...props }: React.ComponentProps<"strong">) => (
    <strong className="font-semibold text-gray-100" {...props}>{children}</strong>
  ),
  em: ({ children, ...props }: React.ComponentProps<"em">) => (
    <em className="italic text-gray-300" {...props}>{children}</em>
  ),
  ul: ({ children, ...props }: React.ComponentProps<"ul">) => (
    <ul className="list-disc list-inside mb-2 space-y-0.5" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.ComponentProps<"ol">) => (
    <ol className="list-decimal list-inside mb-2 space-y-0.5" {...props}>{children}</ol>
  ),
  li: ({ children, ...props }: React.ComponentProps<"li">) => (
    <li className="text-gray-200" {...props}>{children}</li>
  ),
  a: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-2" {...props}>{children}</a>
  ),
  code: ({ children, className, ...props }: React.ComponentProps<"code">) => {
    // Fenced code blocks get a className like "language-typescript"
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className="text-gray-300 text-xs" {...props}>{children}</code>
      );
    }
    // Inline code
    return (
      <code className="px-1 py-0.5 rounded bg-gray-700/60 text-emerald-300 text-xs" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }} {...props}>{children}</code>
    );
  },
  pre: ({ children, ...props }: React.ComponentProps<"pre">) => (
    <pre className="my-2 p-3 rounded-lg bg-gray-950/60 border border-gray-700/50 text-xs overflow-x-auto" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }} {...props}>{children}</pre>
  ),
  blockquote: ({ children, ...props }: React.ComponentProps<"blockquote">) => (
    <blockquote className="border-l-2 border-gray-600 pl-3 my-2 text-gray-400 italic" {...props}>{children}</blockquote>
  ),
  table: ({ children, ...props }: React.ComponentProps<"table">) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-gray-700/50">
      <table className="min-w-full text-xs" {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }: React.ComponentProps<"thead">) => (
    <thead className="bg-gray-800/60" {...props}>{children}</thead>
  ),
  th: ({ children, ...props }: React.ComponentProps<"th">) => (
    <th className="px-3 py-1.5 text-left font-medium text-gray-300 border-b border-gray-700/50" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.ComponentProps<"td">) => (
    <td className="px-3 py-1.5 text-gray-400 border-b border-gray-800/40" {...props}>{children}</td>
  ),
  hr: (props: React.ComponentProps<"hr">) => (
    <hr className="my-3 border-gray-700/50" {...props} />
  ),
};

// ─── Discord Icon ─────────────────────────────────────────

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}
