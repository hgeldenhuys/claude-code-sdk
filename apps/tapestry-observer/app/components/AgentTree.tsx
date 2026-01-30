/**
 * AgentTree Component
 *
 * Renders Machine → Project → Agent hierarchy as a tree.
 */

import { useState } from "react";
import { Link } from "react-router";
import type { Agent, MachineNode, ProjectNode } from "~/lib/types";
import { deriveAgentStatus, formatRelativeTime } from "~/lib/types";
import { StatusIndicator } from "./StatusIndicator";

interface AgentTreeProps {
  machines: MachineNode[];
}

export function AgentTree({ machines }: AgentTreeProps) {
  if (machines.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-500">
        No agents registered. Start a daemon to see agents here.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {machines.map((machine) => (
        <MachineRow key={machine.machineId} machine={machine} />
      ))}
    </div>
  );
}

// ============================================================================
// Machine Row
// ============================================================================

function MachineRow({ machine }: { machine: MachineNode }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-900/50 transition-colors rounded"
      >
        <span className="text-gray-500 font-mono text-xs w-4">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="font-mono text-gray-300 font-medium">
          {machine.machineId}
        </span>
        <span className="flex items-center gap-1.5 ml-auto">
          {machine.activeCount > 0 && (
            <StatusCount count={machine.activeCount} color="green" />
          )}
          {machine.idleCount > 0 && (
            <StatusCount count={machine.idleCount} color="yellow" />
          )}
          {machine.offlineCount > 0 && (
            <StatusCount count={machine.offlineCount} color="gray" />
          )}
          <span className="text-xs text-gray-500 ml-2">
            {machine.agentCount} agent{machine.agentCount !== 1 ? "s" : ""}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="ml-4 border-l border-gray-800">
          {machine.projects.map((project) => (
            <ProjectRow key={project.projectPath} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Project Row
// ============================================================================

function ProjectRow({ project }: { project: ProjectNode }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-900/50 transition-colors rounded"
      >
        <span className="text-gray-600 font-mono text-xs w-4 ml-2">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="font-mono text-gray-400">
          {project.projectName}
        </span>
        <span className="text-xs text-gray-600 ml-auto">
          {project.agentCount} agent{project.agentCount !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="ml-8">
          {project.agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Agent Row
// ============================================================================

function AgentRow({ agent }: { agent: Agent }) {
  const status = deriveAgentStatus(agent.heartbeatAt);
  const name = agent.sessionName || agent.sessionId?.slice(0, 8) || "(unnamed)";

  return (
    <Link
      to={`/agents/${agent.id}`}
      className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-800/50 transition-colors rounded group"
    >
      <StatusIndicator status={status} size="sm" pulse />
      <span className="text-gray-300 group-hover:text-gray-100 transition-colors">
        {name}
      </span>
      <span className="text-xs text-gray-600 ml-auto">
        {formatRelativeTime(agent.heartbeatAt)}
      </span>
    </Link>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function StatusCount({
  count,
  color,
}: {
  count: number;
  color: "green" | "yellow" | "gray";
}) {
  const dotColor = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    gray: "bg-gray-500",
  };

  return (
    <span className="flex items-center gap-1 text-xs text-gray-500">
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor[color]}`} />
      {count}
    </span>
  );
}
