/**
 * Agents Route - Agent Hierarchy Browser
 *
 * Machine → Project → Session tree view.
 */

import { useMemo } from "react";
import { AgentTree } from "~/components/AgentTree";
import { buildHierarchy } from "~/lib/hierarchy";
import { useSignalDB } from "~/lib/signaldb";
import { deriveAgentStatus } from "~/lib/types";

export default function Agents() {
  const { agents } = useSignalDB();

  const machines = useMemo(() => buildHierarchy(agents), [agents]);

  const statusCounts = useMemo(() => {
    const counts = { active: 0, idle: 0, offline: 0 };
    for (const agent of agents) {
      counts[deriveAgentStatus(agent.heartbeatAt)]++;
    }
    return counts;
  }, [agents]);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-gray-200">
          Agents
          <span className="ml-2 text-gray-500 text-sm font-normal">
            ({agents.length})
          </span>
        </h1>

        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {statusCounts.active} active
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {statusCounts.idle} idle
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            {statusCounts.offline} offline
          </span>
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg">
        <AgentTree machines={machines} />
      </div>
    </div>
  );
}
