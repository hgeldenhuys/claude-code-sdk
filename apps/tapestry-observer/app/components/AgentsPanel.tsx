/**
 * AgentsPanel Component
 *
 * Real-time list of registered agents with status indicators.
 */

import { useMemo, useState } from "react";
import { useSignalDB } from "~/lib/signaldb";
import {
  deriveAgentStatus,
  formatRelativeTime,
  type Agent,
  type AgentStatus,
} from "~/lib/types";
import { StatusBadge, StatusIndicator } from "./StatusIndicator";

interface AgentsPanelProps {
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string | null) => void;
}

export function AgentsPanel({
  selectedAgentId,
  onSelectAgent,
}: AgentsPanelProps) {
  const { agents } = useSignalDB();
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");

  // Enrich agents with derived status
  const enrichedAgents = useMemo(() => {
    return agents.map((agent) => ({
      ...agent,
      derivedStatus: deriveAgentStatus(agent.heartbeatAt),
    }));
  }, [agents]);

  // Filter agents
  const filteredAgents = useMemo(() => {
    if (statusFilter === "all") return enrichedAgents;
    return enrichedAgents.filter((a) => a.derivedStatus === statusFilter);
  }, [enrichedAgents, statusFilter]);

  // Sort: active first, then idle, then offline
  const sortedAgents = useMemo(() => {
    const statusOrder: Record<AgentStatus, number> = {
      active: 0,
      idle: 1,
      offline: 2,
    };
    return [...filteredAgents].sort(
      (a, b) => statusOrder[a.derivedStatus] - statusOrder[b.derivedStatus]
    );
  }, [filteredAgents]);

  // Count by status
  const statusCounts = useMemo(() => {
    const counts = { active: 0, idle: 0, offline: 0 };
    for (const agent of enrichedAgents) {
      counts[agent.derivedStatus]++;
    }
    return counts;
  }, [enrichedAgents]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">
          Agents
          <span className="ml-2 text-gray-500">({agents.length})</span>
        </h2>

        {/* Status filter */}
        <div className="flex items-center gap-2">
          <FilterButton
            label="All"
            count={enrichedAgents.length}
            active={statusFilter === "all"}
            onClick={() => setStatusFilter("all")}
          />
          <FilterButton
            label="Active"
            count={statusCounts.active}
            active={statusFilter === "active"}
            onClick={() => setStatusFilter("active")}
            color="green"
          />
          <FilterButton
            label="Idle"
            count={statusCounts.idle}
            active={statusFilter === "idle"}
            onClick={() => setStatusFilter("idle")}
            color="yellow"
          />
        </div>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        {sortedAgents.length === 0 ? (
          <div className="p-4 text-center text-gray-500 text-sm">
            {statusFilter === "all"
              ? "No agents registered"
              : `No ${statusFilter} agents`}
          </div>
        ) : (
          <ul className="divide-y divide-gray-800/50">
            {sortedAgents.map((agent) => (
              <AgentItem
                key={agent.id}
                agent={agent}
                status={agent.derivedStatus}
                selected={agent.id === selectedAgentId}
                onClick={() =>
                  onSelectAgent?.(
                    agent.id === selectedAgentId ? null : agent.id
                  )
                }
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Filter Button
// ============================================================================

interface FilterButtonProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: "green" | "yellow";
}

function FilterButton({
  label,
  count,
  active,
  onClick,
  color,
}: FilterButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        text-xs px-2 py-1 rounded transition-colors
        ${
          active
            ? color === "green"
              ? "bg-green-900/50 text-green-400"
              : color === "yellow"
                ? "bg-yellow-900/50 text-yellow-400"
                : "bg-gray-700 text-gray-200"
            : "text-gray-500 hover:text-gray-300 hover:bg-gray-800"
        }
      `}
    >
      {label}
      {count > 0 && <span className="ml-1 opacity-60">{count}</span>}
    </button>
  );
}

// ============================================================================
// Agent Item
// ============================================================================

interface AgentItemProps {
  agent: Agent;
  status: AgentStatus;
  selected: boolean;
  onClick: () => void;
}

function AgentItem({ agent, status, selected, onClick }: AgentItemProps) {
  const sessionDisplay = agent.sessionName || agent.sessionId?.slice(0, 8) || agent.machineId || "unknown";
  const projectDisplay = agent.projectPath
    ? agent.projectPath.split("/").pop()
    : null;

  return (
    <li>
      <button
        onClick={onClick}
        className={`
          w-full text-left p-3 transition-colors
          ${selected ? "bg-gray-800" : "hover:bg-gray-900"}
        `}
      >
        <div className="flex items-start gap-3">
          {/* Status indicator */}
          <div className="mt-1">
            <StatusIndicator status={status} size="md" pulse />
          </div>

          {/* Agent info */}
          <div className="flex-1 min-w-0">
            {/* Primary line: session name or ID */}
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-200 truncate">
                {sessionDisplay || "Unknown"}
              </span>
              <StatusBadge status={status} />
            </div>

            {/* Secondary line: machine ID */}
            <div className="text-xs text-gray-500 truncate mt-0.5">
              {agent.machineId || "unknown-machine"}
            </div>

            {/* Tertiary line: project path */}
            {projectDisplay && (
              <div className="text-xs text-gray-600 truncate mt-0.5 font-mono">
                {projectDisplay}
              </div>
            )}
          </div>

          {/* Heartbeat time */}
          <div className="text-xs text-gray-600 whitespace-nowrap">
            {formatRelativeTime(agent.heartbeatAt)}
          </div>
        </div>
      </button>
    </li>
  );
}
