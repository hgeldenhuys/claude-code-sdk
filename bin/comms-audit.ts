#!/usr/bin/env bun
/**
 * Comms Audit CLI
 *
 * View and query agent communication audit logs from SignalDB.
 *
 * Usage:
 *   comms-audit list [--agent <id>] [--machine <id>] [--from <iso>] [--to <iso>] [--type <type>] [--limit <n>] [--json]
 *   comms-audit stats [--agent <id>] [--from <iso>] [--to <iso>]
 *   comms-audit violations [--agent <id>] [--from <iso>] [--to <iso>] [--limit <n>] [--json]
 */

import { SignalDBClient } from '../src/comms/client/signaldb';
import type { AuditEntry } from '../src/comms/security/types';

// ============================================================================
// Types
// ============================================================================

interface CLIOptions {
  subcommand: 'list' | 'stats' | 'violations' | 'help';
  agent?: string;
  machine?: string;
  from?: string;
  to?: string;
  type?: string;
  limit: number;
  json: boolean;
}

interface AuditQueryResponse {
  entries: AuditEntry[];
  total: number;
}

interface AuditStatsResponse {
  totalCommands: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  averageDurationMs: number;
  topAgents: { agentId: string; count: number }[];
  topCommands: { command: string; count: number }[];
}

// ============================================================================
// ANSI Color Helpers
// ============================================================================

const isTTY = process.stdout.isTTY ?? false;

function color(text: string, code: string): string {
  if (!isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function bold(text: string): string { return color(text, '1'); }
function dim(text: string): string { return color(text, '2'); }
function red(text: string): string { return color(text, '31'); }
function green(text: string): string { return color(text, '32'); }
function yellow(text: string): string { return color(text, '33'); }
function cyan(text: string): string { return color(text, '36'); }
function gray(text: string): string { return color(text, '90'); }

// ============================================================================
// Argument Parsing
// ============================================================================

function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    subcommand: 'help',
    limit: 50,
    json: false,
  };

  if (args.length === 0) {
    return options;
  }

  const sub = args[0];
  if (sub === 'list' || sub === 'stats' || sub === 'violations') {
    options.subcommand = sub;
  } else if (sub === 'help' || sub === '--help' || sub === '-h') {
    options.subcommand = 'help';
    return options;
  } else {
    console.error(red(`Unknown subcommand: ${sub}`));
    options.subcommand = 'help';
    return options;
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case '--agent':
        options.agent = next;
        i++;
        break;
      case '--machine':
        options.machine = next;
        i++;
        break;
      case '--from':
        options.from = next;
        i++;
        break;
      case '--to':
        options.to = next;
        i++;
        break;
      case '--type':
        options.type = next;
        i++;
        break;
      case '--limit':
        options.limit = parseInt(next ?? '50', 10);
        i++;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        console.error(yellow(`Unknown flag: ${arg}`));
    }
  }

  return options;
}

// ============================================================================
// Client Setup
// ============================================================================

function createClient(): SignalDBClient {
  const apiUrl = process.env.SIGNALDB_API_URL;
  const projectKey = process.env.SIGNALDB_PROJECT_KEY;

  if (!apiUrl || !projectKey) {
    console.error(red('Missing environment variables:'));
    if (!apiUrl) console.error(red('  SIGNALDB_API_URL'));
    if (!projectKey) console.error(red('  SIGNALDB_PROJECT_KEY'));
    process.exit(1);
  }

  return new SignalDBClient({ apiUrl, projectKey });
}

// ============================================================================
// Subcommands
// ============================================================================

async function listEntries(client: SignalDBClient, options: CLIOptions): Promise<void> {
  const params: Record<string, string | undefined> = {
    limit: String(options.limit),
  };
  if (options.agent) params.agent_id = options.agent;
  if (options.machine) params.machine_id = options.machine;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;
  if (options.type) params.type = options.type;

  const response = await client.request<AuditQueryResponse>('GET', '/v1/audit', undefined, params);

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response.entries.length === 0) {
    console.log(dim('No audit entries found.'));
    return;
  }

  console.log(bold(`Audit Log (${response.entries.length} of ${response.total} entries)\n`));

  // Table header
  console.log(
    `${bold('Timestamp'.padEnd(24))} ${bold('Sender'.padEnd(12))} ${bold('Receiver'.padEnd(12))} ${bold('Command'.padEnd(30))} ${bold('Result'.padEnd(10))} ${bold('Duration')}`,
  );
  console.log(dim('-'.repeat(110)));

  for (const entry of response.entries) {
    const ts = formatTimestamp(entry.timestamp);
    const sender = truncate(entry.senderId, 10);
    const receiver = truncate(entry.receiverId || '-', 10);
    const command = truncate(entry.command, 28);
    const result = formatResult(entry.result);
    const duration = `${entry.durationMs}ms`;

    console.log(
      `${gray(ts.padEnd(24))} ${cyan(sender.padEnd(12))} ${sender === receiver ? dim(receiver.padEnd(12)) : receiver.padEnd(12)} ${command.padEnd(30)} ${result.padEnd(18)} ${dim(duration)}`,
    );
  }

  if (response.total > response.entries.length) {
    console.log(dim(`\n... and ${response.total - response.entries.length} more entries. Use --limit to see more.`));
  }
}

async function showStats(client: SignalDBClient, options: CLIOptions): Promise<void> {
  const params: Record<string, string | undefined> = {};
  if (options.agent) params.agent_id = options.agent;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;

  const stats = await client.request<AuditStatsResponse>('GET', '/v1/audit/stats', undefined, params);

  if (options.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log(bold('Audit Statistics\n'));

  console.log(`  ${bold('Total Commands:')}  ${stats.totalCommands}`);
  console.log(`  ${bold('Successful:')}      ${green(String(stats.successCount))}`);
  console.log(`  ${bold('Failed:')}          ${red(String(stats.failureCount))}`);
  console.log(`  ${bold('Blocked:')}         ${yellow(String(stats.blockedCount))}`);
  console.log(`  ${bold('Avg Duration:')}    ${stats.averageDurationMs}ms`);

  if (stats.topAgents.length > 0) {
    console.log(`\n  ${bold('Top Agents:')}`);
    for (const agent of stats.topAgents) {
      console.log(`    ${cyan(agent.agentId.padEnd(20))} ${dim(String(agent.count) + ' commands')}`);
    }
  }

  if (stats.topCommands.length > 0) {
    console.log(`\n  ${bold('Top Commands:')}`);
    for (const cmd of stats.topCommands) {
      console.log(`    ${cmd.command.padEnd(30)} ${dim(String(cmd.count) + ' times')}`);
    }
  }
}

async function showViolations(client: SignalDBClient, options: CLIOptions): Promise<void> {
  const params: Record<string, string | undefined> = {
    limit: String(options.limit),
    result: 'blocked',
  };
  if (options.agent) params.agent_id = options.agent;
  if (options.from) params.from = options.from;
  if (options.to) params.to = options.to;

  const response = await client.request<AuditQueryResponse>('GET', '/v1/audit', undefined, params);

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (response.entries.length === 0) {
    console.log(green('No security violations found.'));
    return;
  }

  console.log(bold(red(`Security Violations (${response.entries.length} of ${response.total})\n`)));

  for (const entry of response.entries) {
    const ts = formatTimestamp(entry.timestamp);
    console.log(`${red('BLOCKED')} ${gray(ts)}`);
    console.log(`  Agent:   ${cyan(entry.senderId)}`);
    console.log(`  Machine: ${dim(entry.machineId)}`);
    console.log(`  Command: ${entry.command}`);
    console.log(`  Result:  ${yellow(entry.result)}`);
    console.log('');
  }
}

function showHelp(): void {
  console.log(`${bold('comms-audit')} - Agent communication audit log viewer

${bold('Usage:')}
  comms-audit ${cyan('list')}        List audit log entries
  comms-audit ${cyan('stats')}       Show audit statistics
  comms-audit ${cyan('violations')}  Show security violations (blocked commands)

${bold('Filters:')}
  --agent ${dim('<id>')}      Filter by agent ID
  --machine ${dim('<id>')}    Filter by machine ID
  --from ${dim('<iso>')}      Start date (ISO 8601)
  --to ${dim('<iso>')}        End date (ISO 8601)
  --type ${dim('<type>')}     Filter by command type
  --limit ${dim('<n>')}       Maximum entries (default: 50)
  --json             Output as JSON

${bold('Environment:')}
  SIGNALDB_API_URL        SignalDB API base URL
  SIGNALDB_PROJECT_KEY    Project API key

${bold('Examples:')}
  comms-audit list --agent agent-001 --limit 20
  comms-audit stats --from 2026-01-01T00:00:00Z
  comms-audit violations --json | jq '.entries[].command'`);
}

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').replace('Z', '');
  } catch {
    return iso;
  }
}

function formatResult(result: string): string {
  switch (result) {
    case 'success':
      return green('success');
    case 'failure':
      return red('failure');
    case 'blocked':
      return yellow('BLOCKED');
    default:
      return red(truncate(result, 8));
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 2) + '..';
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.subcommand === 'help') {
    showHelp();
    return;
  }

  const client = createClient();

  switch (options.subcommand) {
    case 'list':
      await listEntries(client, options);
      break;
    case 'stats':
      await showStats(client, options);
      break;
    case 'violations':
      await showViolations(client, options);
      break;
  }
}

main().catch((error: Error) => {
  console.error(red(`Error: ${error.message}`));
  process.exit(1);
});
