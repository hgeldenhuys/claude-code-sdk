#!/usr/bin/env bun
/**
 * agent-daemon - Claude Code Agent Daemon
 *
 * Background daemon that bridges local Claude Code sessions to the
 * SignalDB communication network. Discovers active sessions, registers
 * them as agents, maintains heartbeats, and routes incoming messages.
 *
 * Usage:
 *   agent-daemon [options]
 *
 * Options:
 *   --api-url <url>              SignalDB API URL (or SIGNALDB_API_URL env)
 *   --project-key <key>          SignalDB project key (or SIGNALDB_PROJECT_KEY env)
 *   --machine-id <id>            Machine identifier (default: hostname)
 *   --heartbeat-interval <ms>    Heartbeat interval in ms (default: 10000)
 *   --help, -h                   Show help
 *   --version, -v                Show version
 *
 * Environment variables:
 *   SIGNALDB_API_URL             SignalDB API base URL
 *   SIGNALDB_PROJECT_KEY         SignalDB project API key
 *   MACHINE_ID                   Machine identifier override
 *
 * Examples:
 *   # Using environment variables
 *   export SIGNALDB_API_URL=https://my-project.signaldb.live
 *   export SIGNALDB_PROJECT_KEY=sk_live_...
 *   agent-daemon
 *
 *   # Using CLI arguments
 *   agent-daemon --api-url https://my-project.signaldb.live --project-key sk_live_...
 *
 *   # Custom heartbeat interval
 *   agent-daemon --heartbeat-interval 5000
 */

import * as os from 'node:os';
import { SignalDBClient } from '../src/comms/client/signaldb';
import { AgentDaemon } from '../src/comms/daemon/agent-daemon';
import { createDefaultConfig } from '../src/comms/daemon/types';
import type { DaemonState } from '../src/comms/daemon/types';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '0.1.0';

// ============================================================================
// Argument Parsing
// ============================================================================

interface CLIArgs {
  apiUrl: string | null;
  projectKey: string | null;
  machineId: string;
  heartbeatIntervalMs: number;
  showHelp: boolean;
  showVersion: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    apiUrl: process.env.SIGNALDB_API_URL ?? null,
    projectKey: process.env.SIGNALDB_PROJECT_KEY ?? null,
    machineId: process.env.MACHINE_ID ?? os.hostname(),
    heartbeatIntervalMs: 10_000,
    showHelp: false,
    showVersion: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--api-url': {
        const val = argv[++i];
        if (val) args.apiUrl = val;
        break;
      }
      case '--project-key': {
        const val = argv[++i];
        if (val) args.projectKey = val;
        break;
      }
      case '--machine-id': {
        const val = argv[++i];
        if (val) args.machineId = val;
        break;
      }
      case '--heartbeat-interval': {
        const val = argv[++i];
        if (val) {
          const parsed = Number.parseInt(val, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            args.heartbeatIntervalMs = parsed;
          }
        }
        break;
      }
      case '--help':
      case '-h':
        args.showHelp = true;
        break;
      case '--version':
      case '-v':
        args.showVersion = true;
        break;
    }
  }

  return args;
}

// ============================================================================
// Help
// ============================================================================

function printHelp(): void {
  console.log(`agent-daemon v${VERSION} - Claude Code Agent Daemon

Bridges local Claude Code sessions to the SignalDB communication network.

Usage:
  agent-daemon [options]

Options:
  --api-url <url>              SignalDB API URL (or SIGNALDB_API_URL env)
  --project-key <key>          SignalDB project key (or SIGNALDB_PROJECT_KEY env)
  --machine-id <id>            Machine identifier (default: hostname)
  --heartbeat-interval <ms>    Heartbeat interval in ms (default: 10000)
  --help, -h                   Show help
  --version, -v                Show version

Environment variables:
  SIGNALDB_API_URL             SignalDB API base URL
  SIGNALDB_PROJECT_KEY         SignalDB project API key
  MACHINE_ID                   Machine identifier override

Examples:
  # Using environment variables
  export SIGNALDB_API_URL=https://my-project.signaldb.live
  export SIGNALDB_PROJECT_KEY=sk_live_...
  agent-daemon

  # Using CLI arguments
  agent-daemon --api-url https://my-project.signaldb.live --project-key sk_live_...

  # Custom heartbeat interval
  agent-daemon --heartbeat-interval 5000`);
}

// ============================================================================
// State Logging
// ============================================================================

const STATE_ICONS: Record<DaemonState, string> = {
  starting: '...',
  running: '>>>',
  stopping: '...',
  stopped: '---',
  error: '!!!',
};

function logState(state: DaemonState): void {
  const icon = STATE_ICONS[state] ?? '???';
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] [${icon}] Daemon state: ${state}`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    printHelp();
    return 0;
  }

  if (args.showVersion) {
    console.log(`agent-daemon v${VERSION}`);
    return 0;
  }

  // Validate required arguments
  if (!args.apiUrl) {
    console.error('error: --api-url or SIGNALDB_API_URL is required');
    return 1;
  }

  if (!args.projectKey) {
    console.error('error: --project-key or SIGNALDB_PROJECT_KEY is required');
    return 1;
  }

  // Create client
  const client = new SignalDBClient({
    apiUrl: args.apiUrl,
    projectKey: args.projectKey,
  });

  // Create config
  const config = createDefaultConfig(
    args.apiUrl,
    args.projectKey,
    args.machineId,
  );
  config.heartbeatIntervalMs = args.heartbeatIntervalMs;

  // Create daemon with logging callbacks
  const daemon = new AgentDaemon(client, config, {
    onStateChange: (state) => {
      logState(state);
    },
    onSessionDiscovered: (session) => {
      const name = session.sessionName ?? 'unnamed';
      console.log(`  + Session: ${session.sessionId.slice(0, 8)} (${name}) -> agent ${session.agentId?.slice(0, 8) ?? 'unregistered'}`);
    },
    onMessageRouted: (result) => {
      console.log(`  < Routed message ${result.messageId.slice(0, 8)}: ${result.response.slice(0, 80)}${result.response.length > 80 ? '...' : ''}`);
    },
    onMessageError: (result) => {
      console.error(`  ! Route failed for ${result.messageId.slice(0, 8)}: ${result.error}`);
    },
    onSSEStatus: (connected) => {
      console.log(`  ~ SSE: ${connected ? 'connected' : 'disconnected'}`);
    },
    onError: (error) => {
      console.error(`  ! Error: ${error.message}`);
    },
  });

  // Print startup info
  console.log(`agent-daemon v${VERSION}`);
  console.log(`  API:       ${args.apiUrl}`);
  console.log(`  Machine:   ${args.machineId}`);
  console.log(`  Heartbeat: ${args.heartbeatIntervalMs}ms`);
  console.log('');

  // Start the daemon
  try {
    await daemon.start();
  } catch {
    console.error('Fatal: daemon failed to start');
    return 1;
  }

  // Keep the process alive
  // The daemon manages its own lifecycle via signal handlers
  // This promise never resolves - the process exits via SIGINT/SIGTERM handlers
  await new Promise(() => {});

  return 0;
}

main().then((code) => {
  if (code !== 0) {
    process.exit(code);
  }
}).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
