/**
 * Agent Hierarchy Builder
 *
 * Pure function that builds a Machine → Project → Agent tree
 * from a flat array of agents.
 */

import type { Agent, MachineNode, ProjectNode } from "./types";
import { deriveAgentStatus } from "./types";

/**
 * Build a hierarchical tree from a flat agent list.
 * Groups by machineId → projectPath → agents.
 */
export function buildHierarchy(agents: Agent[]): MachineNode[] {
  const machineMap = new Map<string, Map<string, Agent[]>>();

  for (const agent of agents) {
    const machineId = agent.machineId || "unknown";
    const projectPath = agent.projectPath || "(no project)";

    if (!machineMap.has(machineId)) {
      machineMap.set(machineId, new Map());
    }
    const projectMap = machineMap.get(machineId)!;

    if (!projectMap.has(projectPath)) {
      projectMap.set(projectPath, []);
    }
    projectMap.get(projectPath)!.push(agent);
  }

  const machines: MachineNode[] = [];

  for (const [machineId, projectMap] of machineMap) {
    const projects: ProjectNode[] = [];
    let activeCount = 0;
    let idleCount = 0;
    let offlineCount = 0;
    let lastHeartbeat: string | null = null;

    for (const [projectPath, projectAgents] of projectMap) {
      const projectName = projectPath === "(no project)"
        ? "(no project)"
        : projectPath.split("/").pop() || projectPath;

      projects.push({
        projectPath,
        projectName,
        agents: projectAgents,
        agentCount: projectAgents.length,
      });

      for (const agent of projectAgents) {
        const status = deriveAgentStatus(agent.heartbeatAt);
        if (status === "active") activeCount++;
        else if (status === "idle") idleCount++;
        else offlineCount++;

        if (
          agent.heartbeatAt &&
          (!lastHeartbeat || agent.heartbeatAt > lastHeartbeat)
        ) {
          lastHeartbeat = agent.heartbeatAt;
        }
      }
    }

    // Sort projects by agent count descending
    projects.sort((a, b) => b.agentCount - a.agentCount);

    machines.push({
      machineId,
      projects,
      agentCount: activeCount + idleCount + offlineCount,
      activeCount,
      idleCount,
      offlineCount,
      lastHeartbeat,
    });
  }

  // Sort machines by agent count descending
  machines.sort((a, b) => b.agentCount - a.agentCount);

  return machines;
}
