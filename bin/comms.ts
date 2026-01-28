#!/usr/bin/env bun
/**
 * Unified Comms CLI
 *
 * Terminal-based access to the agent communication system.
 *
 * Usage:
 *   comms <command> [args] [--json]
 *
 * Commands:
 *   status     Show connected agents with presence state
 *   agents     List registered agents with full details
 *   send       Send a message to an address
 *   listen     Subscribe to real-time channel messages
 *   channels   Manage channels (list, create, join, leave, archive)
 *   memo       Manage memos (list, compose, read, reply, archive)
 *   paste      Manage pastes (create, read, delete, list, shared)
 *   help       Show this help text
 *
 * Environment:
 *   SIGNALDB_API_URL        SignalDB API base URL
 *   SIGNALDB_PROJECT_KEY    Project API key
 *   SIGNALDB_AGENT_ID       This agent's ID (not needed for status/agents)
 */

import { execute as executeStatus } from '../src/comms/bridges/cli/commands/status';
import { execute as executeAgents } from '../src/comms/bridges/cli/commands/agents';
import { execute as executeSend } from '../src/comms/bridges/cli/commands/send';
import { execute as executeListen } from '../src/comms/bridges/cli/commands/listen';
import { execute as executeChannels } from '../src/comms/bridges/cli/commands/channels';
import { execute as executeMemo } from '../src/comms/bridges/cli/commands/memo';
import { execute as executePaste } from '../src/comms/bridges/cli/commands/paste';

// ============================================================================
// ANSI Helpers (minimal, for help text only)
// ============================================================================

const isTTY = process.stdout.isTTY ?? false;

function color(text: string, code: string): string {
  if (!isTTY) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function bold(text: string): string { return color(text, '1'); }
function dim(text: string): string { return color(text, '2'); }
function cyan(text: string): string { return color(text, '36'); }
function red(text: string): string { return color(text, '31'); }

// ============================================================================
// Command Registry
// ============================================================================

interface CommandEntry {
  description: string;
  execute: (args: string[]) => Promise<void>;
}

const commands: Record<string, CommandEntry> = {
  status: {
    description: 'Show connected agents with presence state',
    execute: executeStatus,
  },
  agents: {
    description: 'List registered agents with full details',
    execute: executeAgents,
  },
  send: {
    description: 'Send a message to an address',
    execute: executeSend,
  },
  listen: {
    description: 'Subscribe to real-time channel messages',
    execute: executeListen,
  },
  channels: {
    description: 'Manage channels (list, create, join, leave, archive)',
    execute: executeChannels,
  },
  memo: {
    description: 'Manage memos (list, compose, read, reply, archive)',
    execute: executeMemo,
  },
  paste: {
    description: 'Manage pastes (create, read, delete, list, shared)',
    execute: executePaste,
  },
};

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`${bold('comms')} - Agent Communication System CLI

${bold('Usage:')}
  comms <command> [args] [--json]

${bold('Commands:')}`);

  const commandNames = Object.keys(commands);
  for (let i = 0; i < commandNames.length; i++) {
    const name = commandNames[i]!;
    const entry = commands[name]!;
    console.log(`  ${cyan(name.padEnd(12))} ${dim(entry.description)}`);
  }

  console.log(`  ${cyan('help'.padEnd(12))} ${dim('Show this help text')}

${bold('Environment:')}
  SIGNALDB_API_URL       ${dim('SignalDB API base URL')}
  SIGNALDB_PROJECT_KEY   ${dim('Project API key')}
  SIGNALDB_AGENT_ID      ${dim('This agent\'s ID (not needed for status/agents)')}

${bold('Examples:')}
  comms status
  comms agents --json
  comms send broadcast://dev-team "Build complete"
  echo "Test results" | comms send agent://mac-1/agent-2
  comms listen dev-team
  comms channels list
  comms memo list --unread
  comms paste create "Hello world" --ttl 300`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp();
    return;
  }

  const subcommand = args[0]!;
  const subArgs = args.slice(1);

  if (subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
    showHelp();
    return;
  }

  const entry = commands[subcommand];
  if (!entry) {
    console.error(red(`Unknown command: '${subcommand}'.`));
    console.error(`Run ${cyan("'comms help'")} for available commands.`);
    process.exit(1);
  }

  await entry.execute(subArgs);
}

main().catch((error: Error) => {
  console.error(red(`Error: ${error.message}`));
  process.exit(1);
});
