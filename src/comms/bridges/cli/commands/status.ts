/**
 * Status Subcommand
 *
 * Displays all registered agents with presence state in a formatted table.
 *
 * Usage: comms status [--json]
 */

import { SignalDBClient } from '../../../client/signaldb';
import type { Agent } from '../../../protocol/types';
import {
  bold,
  cyan,
  dim,
  formatStatus,
  formatTimestamp,
  gray,
  green,
  hasJsonFlag,
  jsonOutput,
  parseEnvConfigPartial,
  red,
  truncate,
  yellow,
} from '../utils';

// ============================================================================
// Presence Derivation
// ============================================================================

/**
 * Derive presence status from an agent's heartbeat timestamp.
 * - <10s: active (green)
 * - <5min: idle (yellow)
 * - else: offline (red)
 */
function derivePresence(agent: Agent): string {
  if (!agent.heartbeatAt) return 'offline';
  const diffMs = Date.now() - new Date(agent.heartbeatAt).getTime();
  if (diffMs < 10_000) return 'active';
  if (diffMs < 300_000) return 'idle';
  return 'offline';
}

// ============================================================================
// Execute
// ============================================================================

/**
 * Execute the status subcommand.
 *
 * @param args - CLI arguments after "status"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);
  const config = parseEnvConfigPartial();

  const client = new SignalDBClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
  });

  const agents = await client.agents.list();

  // Enrich agents with derived presence
  const enriched = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!;
    enriched.push({
      ...agent,
      presence: derivePresence(agent),
    });
  }

  if (jsonOutput(enriched, isJson)) return;

  if (enriched.length === 0) {
    console.log(dim('No agents registered.'));
    return;
  }

  console.log(bold(`Agents (${enriched.length})\n`));

  // Table header
  console.log(
    `${bold('ID'.padEnd(10))} ${bold('Name'.padEnd(14))} ${bold('Status'.padEnd(10))} ${bold('Heartbeat'.padEnd(12))} ${bold('Machine'.padEnd(14))} ${bold('Project'.padEnd(20))} ${bold('Session')}`,
  );
  console.log(dim('-'.repeat(100)));

  for (let i = 0; i < enriched.length; i++) {
    const agent = enriched[i]!;
    const id = truncate(agent.id, 8);
    const name = truncate(agent.sessionName ?? agent.id, 12);
    const status = formatStatus(agent.presence);
    const heartbeat = agent.heartbeatAt ? formatTimestamp(agent.heartbeatAt) : gray('never');
    const machine = truncate(agent.machineId, 12);
    const project = truncate(agent.projectPath ?? '-', 18);
    const session = truncate(agent.sessionId ?? '-', 12);

    console.log(
      `${gray(id.padEnd(10))} ${cyan(name.padEnd(14))} ${status.padEnd(18)} ${dim(heartbeat.padEnd(12))} ${dim(machine.padEnd(14))} ${dim(project.padEnd(20))} ${dim(session)}`,
    );
  }
}
