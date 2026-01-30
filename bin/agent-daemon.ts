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
 *   --env <name>                 Tapestry environment: dev|test|live (default: from .env.tapestry)
 *   --api-url <url>              SignalDB API URL (overrides env config)
 *   --project-key <key>          SignalDB project key (overrides env config)
 *   --machine-id <id>            Machine identifier (default: hostname)
 *   --heartbeat-interval <ms>    Heartbeat interval in ms (default: 10000)
 *   --help, -h                   Show help
 *   --version, -v                Show version
 *
 * Environment variables:
 *   TAPESTRY_ENV                 Active environment (dev|test|live)
 *   TAPESTRY_MACHINE_ID          Machine identifier override
 *   TAPESTRY_LIVE_API_URL        SignalDB API URL for live env
 *   TAPESTRY_LIVE_PROJECT_KEY    SignalDB project key for live env
 *   SIGNALDB_API_URL             Legacy: SignalDB API base URL
 *   SIGNALDB_PROJECT_KEY         Legacy: SignalDB project API key
 *
 * Examples:
 *   # Using .env.tapestry (recommended)
 *   agent-daemon --env live
 *
 *   # Using CLI arguments (overrides env config)
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
import {
  loadTapestryConfig,
  toDaemonConfig,
  toSignalDBConfig,
  type TapestryEnvironment,
} from '../src/comms/config/environments';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '0.1.0';

// ============================================================================
// Argument Parsing
// ============================================================================

interface CLIArgs {
  env: TapestryEnvironment | null;
  apiUrl: string | null;
  projectKey: string | null;
  machineId: string;
  heartbeatIntervalMs: number;
  showHelp: boolean;
  showVersion: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    env: null,
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
      case '--env': {
        const val = argv[++i];
        if (val && ['dev', 'test', 'live'].includes(val)) {
          args.env = val as TapestryEnvironment;
        }
        break;
      }
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
  --env <name>                 Tapestry environment: dev|test|live (default: from .env.tapestry)
  --api-url <url>              SignalDB API URL (overrides env config)
  --project-key <key>          SignalDB project key (overrides env config)
  --machine-id <id>            Machine identifier (default: hostname)
  --heartbeat-interval <ms>    Heartbeat interval in ms (default: 10000)
  --help, -h                   Show help
  --version, -v                Show version

Configuration:
  Reads .env.tapestry from cwd or ~ for environment-specific settings.
  CLI flags --api-url/--project-key override environment config.

Examples:
  # Using .env.tapestry (recommended)
  agent-daemon --env live

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

  // Resolve configuration: --env (Tapestry config) or --api-url/--project-key (explicit)
  let apiUrl = args.apiUrl;
  let projectKey = args.projectKey;
  let machineId = args.machineId;

  if (args.env || (!apiUrl && !projectKey)) {
    // Try loading from .env.tapestry
    try {
      const tapestryConfig = loadTapestryConfig(args.env || 'live');
      const envName = args.env || tapestryConfig.current;
      const envConfig = tapestryConfig[envName];

      if (envConfig) {
        // Env config provides defaults; CLI flags override
        if (!apiUrl) apiUrl = envConfig.apiUrl;
        if (!projectKey) projectKey = envConfig.projectKey;
        machineId = envConfig.machineId || machineId;
        if (args.heartbeatIntervalMs === 10_000) {
          args.heartbeatIntervalMs = envConfig.heartbeatIntervalMs;
        }
        console.log(`  Env:       ${envName}`);
      }
    } catch {
      // Fall through to validation below
    }
  }

  // Validate required arguments
  if (!apiUrl) {
    console.error('error: --api-url, SIGNALDB_API_URL, or --env with .env.tapestry is required');
    return 1;
  }

  if (!projectKey) {
    console.error('error: --project-key, SIGNALDB_PROJECT_KEY, or --env with .env.tapestry is required');
    return 1;
  }

  // Create client
  const client = new SignalDBClient({
    apiUrl,
    projectKey,
  });

  // Create config
  const config = createDefaultConfig(
    apiUrl,
    projectKey,
    machineId,
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
    onSSEStatus: (_connected) => {
      // SSE flaps every ~11s (server timeout) -- suppress to reduce log noise.
      // Periodic polling (10s) handles reliability; SSE is just a fast-path.
    },
    onError: (error) => {
      console.error(`  ! Error: ${error.message}`);
    },
  });

  // Print startup info
  console.log(`agent-daemon v${VERSION}`);
  console.log(`  API:       ${apiUrl}`);
  console.log(`  Machine:   ${machineId}`);
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
