/**
 * Agent Resolver
 *
 * Shared agent resolution logic used by both the CLI chat command
 * and the Discord chat handler.
 *
 * Resolution order:
 *   1. Full agent:// URI match
 *   2. Exact session name match
 *   3. Project directory name match (last path segment)
 *   4. Agent ID prefix match
 *   5. Fuzzy: session name or project name contains query
 */

import type { SignalDBClient } from '../client/signaldb';
import type { Agent } from './types';

/**
 * Resolve a name or address to a specific agent.
 *
 * Fetches the agent list from SignalDB and matches using a priority cascade:
 * 1. Full agent:// URI -> parse and match by session name, session ID, or agent ID
 * 2. Exact session name match
 * 3. Project directory name match (last path segment of projectPath)
 * 4. Agent ID prefix match
 * 5. Fuzzy: session name or project name contains query
 *
 * Active agents are preferred over idle/offline ones.
 *
 * @param client - SignalDB REST client
 * @param nameOrAddress - Name, address, or ID to resolve
 * @returns Matched agent or null
 */
export async function resolveAgent(
  client: SignalDBClient,
  nameOrAddress: string,
): Promise<Agent | null> {
  const agents = await client.agents.list();

  // Prefer active agents, then idle, then offline
  const sorted = [...agents].sort((a, b) => {
    const order: Record<string, number> = { active: 0, idle: 1, offline: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  // If it looks like a full URI, match by content
  if (nameOrAddress.includes('://')) {
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      if (a.sessionName && nameOrAddress.includes(a.sessionName)) return a;
      if (a.sessionId && nameOrAddress.includes(a.sessionId)) return a;
      if (nameOrAddress.includes(a.id)) return a;
    }
    return null;
  }

  const query = nameOrAddress.toLowerCase();

  // 1. Exact session name match
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.sessionName?.toLowerCase() === query) return a;
  }

  // 2. Project directory name match (last path segment)
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.projectPath) {
      const projectName = a.projectPath.split('/').pop()?.toLowerCase();
      if (projectName === query) return a;
    }
  }

  // 3. Agent ID prefix match
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.id.toLowerCase().startsWith(query)) return a;
  }

  // 4. Fuzzy: session name or project name contains query
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (a.sessionName?.toLowerCase().includes(query)) return a;
    if (a.projectPath?.toLowerCase().includes(query)) return a;
  }

  return null;
}
