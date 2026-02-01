/**
 * MachineCard Component
 *
 * Displays machine health overview with agent status breakdown.
 */

import { Link } from "react-router";
import type { MachineNode } from "~/lib/types";
import { formatRelativeTime } from "~/lib/types";

interface MachineCardProps {
  machine: MachineNode;
}

export function MachineCard({ machine }: MachineCardProps) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      {/* Machine header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-200 font-mono text-sm">
          {machine.machineId}
        </h3>
        <span className="text-xs text-gray-500">
          {formatRelativeTime(machine.lastHeartbeat)}
        </span>
      </div>

      {/* Status breakdown */}
      <div className="flex items-center gap-3 mb-3">
        <StatusPill count={machine.activeCount} label="active" color="green" />
        <StatusPill count={machine.idleCount} label="idle" color="yellow" />
        <StatusPill count={machine.offlineCount} label="offline" color="gray" />
      </div>

      {/* Projects */}
      <div className="space-y-1.5">
        {machine.projects.map((project) => (
          <div
            key={project.projectPath}
            className="flex items-center justify-between text-xs"
          >
            <span className="text-gray-400 font-mono truncate max-w-[200px]">
              {project.projectName}
            </span>
            <span className="text-gray-500">
              {project.agentCount} agent{project.agentCount !== 1 ? "s" : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Link to agents page */}
      <Link
        to="/agents"
        className="mt-3 block text-xs text-blue-400 hover:text-blue-300 transition-colors"
      >
        View all agents
      </Link>
    </div>
  );
}

function StatusPill({
  count,
  label,
  color,
}: {
  count: number;
  label: string;
  color: "green" | "yellow" | "gray";
}) {
  if (count === 0) return null;

  const colorClasses = {
    green: "bg-green-900/50 text-green-400",
    yellow: "bg-yellow-900/50 text-yellow-400",
    gray: "bg-gray-800 text-gray-400",
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colorClasses[color]}`}>
      {count} {label}
    </span>
  );
}
