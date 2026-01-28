/**
 * Agents Subcommand
 *
 * Lists all registered agents with full detail (full ID, all fields).
 *
 * Usage: comms agents [--json]
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
  hasJsonFlag,
  jsonOutput,
  parseEnvConfigPartial,
} from '../utils';

// ============================================================================
// Presence Derivation
// ============================================================================

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
 * Execute the agents subcommand.
 * Shows full agent details including capabilities and metadata.
 *
 * @param args - CLI arguments after "agents"
 */
export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);
  const config = parseEnvConfigPartial();

  const client = new SignalDBClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
  });

  const agents = await client.agents.list();

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

  console.log(bold(`Registered Agents (${enriched.length})\n`));

  for (let i = 0; i < enriched.length; i++) {
    const agent = enriched[i]!;
    const status = formatStatus(agent.presence);

    console.log(bold(`Agent: ${cyan(agent.sessionName ?? agent.id)}`));
    console.log(`  ${bold('ID:')}          ${agent.id}`);
    console.log(`  ${bold('Machine:')}     ${agent.machineId}`);
    console.log(`  ${bold('Session:')}     ${agent.sessionId ?? dim('none')}`);
    console.log(`  ${bold('Name:')}        ${agent.sessionName ?? dim('none')}`);
    console.log(`  ${bold('Project:')}     ${agent.projectPath ?? dim('none')}`);
    console.log(`  ${bold('Status:')}      ${status}`);
    console.log(`  ${bold('Heartbeat:')}   ${agent.heartbeatAt ? formatTimestamp(agent.heartbeatAt) : gray('never')}`);
    console.log(`  ${bold('Registered:')}  ${dim(agent.registeredAt)}`);

    const capKeys = Object.keys(agent.capabilities);
    if (capKeys.length > 0) {
      console.log(`  ${bold('Capabilities:')} ${dim(capKeys.join(', '))}`);
    }

    const metaKeys = Object.keys(agent.metadata);
    if (metaKeys.length > 0) {
      console.log(`  ${bold('Metadata:')}     ${dim(JSON.stringify(agent.metadata))}`);
    }

    if (i < enriched.length - 1) {
      console.log('');
    }
  }
}
