/**
 * Name Resolution
 *
 * Maps agent UUIDs to human-readable session names.
 */

import type { Agent } from "./types";

/**
 * Build a lookup map from agent ID → display name.
 */
export function buildNameMap(agents: Agent[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of agents) {
    const name =
      agent.sessionName ||
      agent.machineId ||
      agent.sessionId?.slice(0, 8) ||
      agent.id.slice(0, 8);
    map.set(agent.id, name);
  }
  return map;
}

/**
 * Resolve an agent ID to a display name.
 */
export function resolveName(
  id: string | null | undefined,
  nameMap: Map<string, string>
): string {
  if (!id) return "unknown";
  return nameMap.get(id) || id.slice(0, 8);
}

/**
 * Parse a target address for display.
 * agent://machine/session → session
 * project://machine/project → project
 * broadcast:// → broadcast
 */
export function parseTargetAddress(address: string): string {
  if (!address) return "unknown";
  return address.replace(/^(agent|project|broadcast):\/\//, "");
}
