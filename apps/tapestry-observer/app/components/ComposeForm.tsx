/**
 * ComposeForm Component
 *
 * Form for composing and sending messages with mode selector.
 * Modes: Chat (push), Mail (pull), Memo (broadcast), Channel.
 */

import { useState } from "react";
import type { Agent, Channel } from "~/lib/types";

type ComposeMode = "chat" | "mail" | "memo" | "channel";

interface ComposeFormProps {
  agents: Agent[];
  channels: Channel[];
  defaultMode?: ComposeMode;
  onSend: (payload: {
    senderId: string;
    targetType: string;
    targetAddress: string;
    messageType: string;
    content: string;
    channelId?: string;
    metadata?: Record<string, unknown>;
    threadId?: string;
  }) => Promise<void>;
}

const MODE_CONFIG: Record<
  ComposeMode,
  { label: string; icon: string; description: string }
> = {
  chat: { label: "Chat", icon: "◇", description: "Real-time push delivery" },
  mail: { label: "Mail", icon: "✉", description: "Async pull delivery" },
  memo: { label: "Memo", icon: "▤", description: "One-way broadcast" },
  channel: { label: "Channel", icon: "#", description: "Topic pub/sub" },
};

export function ComposeForm({
  agents,
  channels,
  defaultMode = "chat",
  onSend,
}: ComposeFormProps) {
  const [mode, setMode] = useState<ComposeMode>(defaultMode);
  const [senderId, setSenderId] = useState("");
  const [targetAddress, setTargetAddress] = useState("");
  const [channelId, setChannelId] = useState("");
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSending(true);

    try {
      const metadata: Record<string, unknown> = {};

      if (mode === "chat") {
        metadata.deliveryMode = "push";
      } else if (mode === "mail") {
        metadata.deliveryMode = "pull";
        if (subject) metadata.subject = subject;
      } else if (mode === "memo") {
        metadata.deliveryMode = "broadcast";
        if (subject) metadata.subject = subject;
        metadata.category = category;
        metadata.priority = priority;
      }

      await onSend({
        senderId,
        targetType: mode === "memo" ? "broadcast" : mode === "channel" ? "channel" : "agent",
        targetAddress:
          mode === "memo"
            ? "broadcast://"
            : mode === "channel"
              ? `channel://${channelId}`
              : targetAddress,
        messageType: mode === "memo" ? "memo" : "chat",
        content,
        channelId: mode === "channel" ? channelId : undefined,
        metadata,
      });

      setSuccess(true);
      setContent("");
      setSubject("");
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Mode selector */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Mode
        </label>
        <div className="flex items-center gap-2">
          {(["chat", "mail", "memo", "channel"] as const).map((m) => {
            const cfg = MODE_CONFIG[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                  mode === m
                    ? "bg-blue-900/50 text-blue-400 border border-blue-700"
                    : "bg-gray-900 text-gray-400 border border-gray-700 hover:bg-gray-800"
                }`}
                title={cfg.description}
              >
                <span className="font-mono">{cfg.icon}</span>
                {cfg.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-600 mt-1">
          {MODE_CONFIG[mode].description}
        </p>
      </div>

      {/* Sender */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Sender (Agent)
        </label>
        <select
          value={senderId}
          onChange={(e) => setSenderId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          required
        >
          <option value="">Select an agent...</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.sessionName || agent.machineId || agent.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {/* Target address (Chat & Mail only) */}
      {(mode === "chat" || mode === "mail") && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Target Address
          </label>
          <input
            type="text"
            value={targetAddress}
            onChange={(e) => setTargetAddress(e.target.value)}
            placeholder="agent://machine/session"
            className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm"
            required
          />
        </div>
      )}

      {/* Channel picker (Channel mode only) */}
      {mode === "channel" && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Channel
          </label>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          >
            <option value="">Select a channel...</option>
            {channels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                # {ch.name || ch.id.slice(0, 8)} ({ch.type})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Subject (Mail & Memo modes) */}
      {(mode === "mail" || mode === "memo") && (
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={mode === "memo" ? "Memo subject..." : "Message subject..."}
            className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
          />
        </div>
      )}

      {/* Category & Priority (Memo mode only) */}
      {mode === "memo" && (
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {["general", "security", "policy", "deployment", "maintenance", "incident"].map(
                (cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                )
              )}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Priority
            </label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {["normal", "low", "high", "urgent"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Content */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Content
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-sm resize-y"
          placeholder="Message content..."
          required
        />
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900/50 border border-red-700 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="p-3 rounded-lg bg-green-900/50 border border-green-700 text-green-300 text-sm">
          Message sent successfully.
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={sending || !senderId || !content}
        className="w-full py-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {sending ? "Sending..." : `Send ${MODE_CONFIG[mode].label}`}
      </button>
    </form>
  );
}
