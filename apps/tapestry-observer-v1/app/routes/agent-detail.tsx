/**
 * Agent Detail Route
 *
 * Full view of a single agent with metadata, messages, and channels.
 */

import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { JsonViewer } from "~/components/JsonViewer";
import { StatusBadge } from "~/components/StatusIndicator";
import { useSignalDB } from "~/lib/signaldb";
import { deriveAgentStatus, formatRelativeTime, formatTime } from "~/lib/types";

export default function AgentDetail() {
  const { agentId } = useParams();
  const { agents, messages, channels } = useSignalDB();

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId),
    [agents, agentId]
  );

  // Messages where this agent is sender
  const agentMessages = useMemo(
    () =>
      messages
        .filter((m) => m.senderId === agentId)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 50),
    [messages, agentId]
  );

  // Channels this agent belongs to
  const agentChannels = useMemo(
    () => channels.filter((c) => c.members?.includes(agentId || "")),
    [channels, agentId]
  );

  if (!agent) {
    return (
      <div className="p-6">
        <Link
          to="/agents"
          className="text-sm text-blue-400 hover:text-blue-300 mb-4 inline-block"
        >
          ← Back to agents
        </Link>
        <p className="text-gray-500">Agent not found: {agentId}</p>
      </div>
    );
  }

  const status = deriveAgentStatus(agent.heartbeatAt);

  return (
    <div className="p-6 max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <Link
        to="/agents"
        className="text-sm text-blue-400 hover:text-blue-300"
      >
        ← Back to agents
      </Link>

      {/* Header */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-3">
          <h1 className="text-lg font-semibold text-gray-200">
            {agent.sessionName || agent.sessionId?.slice(0, 12) || "Unnamed Agent"}
          </h1>
          <StatusBadge status={status} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <Field label="Machine" value={agent.machineId} mono />
          <Field label="Session ID" value={agent.sessionId} mono />
          <Field label="Project" value={agent.projectPath} mono />
          <Field label="Registered" value={formatRelativeTime(agent.registeredAt)} />
          <Field label="Last Heartbeat" value={formatRelativeTime(agent.heartbeatAt)} />
          <Field label="Status" value={status} />
        </div>

        {/* Capabilities */}
        <div className="mt-4">
          <JsonViewer data={agent.capabilities} label="Capabilities" />
        </div>

        {/* Metadata */}
        <div className="mt-2">
          <JsonViewer data={agent.metadata} label="Metadata" />
        </div>
      </div>

      {/* Channels */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">
          Channels ({agentChannels.length})
        </h2>
        {agentChannels.length === 0 ? (
          <div className="text-sm text-gray-500">Not a member of any channels.</div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
            {agentChannels.map((ch) => (
              <Link
                key={ch.id}
                to={`/channels/${ch.id}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-800/50 transition-colors"
              >
                <span className="text-blue-400 font-mono">#</span>
                <span className="text-gray-300">{ch.name}</span>
                <span className="text-xs text-gray-500 ml-auto">{ch.type}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent messages */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">
          Recent Messages ({agentMessages.length})
        </h2>
        {agentMessages.length === 0 ? (
          <div className="text-sm text-gray-500">No messages from this agent.</div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800/50">
            {agentMessages.map((msg) => (
              <div
                key={msg.id}
                className="px-4 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-600 font-mono">
                    {formatTime(msg.createdAt)}
                  </span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                    {msg.messageType}
                  </span>
                  <span className="text-gray-600">→</span>
                  <span className="text-xs text-gray-500 truncate">
                    {msg.targetAddress?.replace(/^(agent|project|broadcast):\/\//, "") || "unknown"}
                  </span>
                </div>
                <p className="text-gray-400 text-xs font-mono truncate">
                  {(msg.content || "").slice(0, 120)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div
        className={`text-gray-300 truncate ${mono ? "font-mono text-xs" : ""}`}
      >
        {value || "—"}
      </div>
    </div>
  );
}
