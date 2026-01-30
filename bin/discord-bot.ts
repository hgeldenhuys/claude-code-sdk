#!/usr/bin/env bun
/**
 * discord-bot - Discord Bot Bridge for Agent Communication
 *
 * Centralized daemon that bridges Discord channels to the SignalDB
 * agent communication network. Auto-creates Discord channels for
 * online agents and routes messages between Discord users and agents.
 *
 * Usage:
 *   discord-bot [options]
 *
 * Options:
 *   --env <name>              Tapestry environment: dev|test|live (default: from .env.tapestry)
 *   --help, -h                Show help
 *   --version, -v             Show version
 *
 * Environment variables:
 *   TAPESTRY_ENV              Active environment (dev|test|live)
 *   DISCORD_TOKEN             Discord bot token (from Developer Portal)
 *   DISCORD_GUILD_ID          Discord server (guild) ID
 *   DISCORD_AGENT_CATEGORY_ID Optional: agent channel category ID
 *
 * Examples:
 *   # Using .env.tapestry (recommended)
 *   discord-bot
 *
 *   # Specify environment
 *   discord-bot --env live
 */

import {
  loadTapestryConfig,
  type TapestryEnvironment,
} from '../src/comms/config/environments';
import { DiscordBot } from '../src/comms/bridges/discord/discord-bot';

// ============================================================================
// Constants
// ============================================================================

const VERSION = '0.1.0';

// ============================================================================
// Argument Parsing
// ============================================================================

interface CLIArgs {
  env: TapestryEnvironment | null;
  showHelp: boolean;
  showVersion: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    env: null,
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
  console.log(`discord-bot v${VERSION} - Discord Bot Bridge for Agent Communication

Bridges Discord channels to the SignalDB agent network.
Auto-creates channels for online agents under an "Agents" category.

Usage:
  discord-bot [options]

Options:
  --env <name>              Tapestry environment: dev|test|live (default: from .env.tapestry)
  --help, -h                Show help
  --version, -v             Show version

Environment variables (in .env.tapestry):
  DISCORD_TOKEN             Discord bot token (required)
  DISCORD_GUILD_ID          Discord server (guild) ID (required)
  DISCORD_AGENT_CATEGORY_ID Optional: reuse existing category

Features:
  - Auto-creates #agent-name channels when agents come online
  - Archives channels when agents offline >30 minutes
  - Channel topics show status emoji, machine, project
  - Messages in agent channels route to the agent via SignalDB
  - Responses posted in threads for clean conversation flow
  - Slash commands: /chat, /agents, /memo, /paste

Examples:
  discord-bot              # Start with .env.tapestry defaults
  discord-bot --env live   # Explicit environment`);
}

// ============================================================================
// Env File Loader
// ============================================================================

function loadEnvFile(): Record<string, string> {
  const env: Record<string, string> = {};

  // Try loading .env.tapestry from cwd, then home
  const paths = [
    `${process.cwd()}/.env.tapestry`,
    `${process.env.HOME}/.env.tapestry`,
  ];

  for (let i = 0; i < paths.length; i++) {
    try {
      const file = Bun.file(paths[i]!);
      // Synchronously check via size (Bun.file is lazy)
      const text = require('node:fs').readFileSync(paths[i]!, 'utf-8') as string;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        env[key] = value;
        // Also set in process.env so loadTapestryConfig() can find them
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      break; // Use first found file
    } catch {
      continue;
    }
  }

  return env;
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
    console.log(`discord-bot v${VERSION}`);
    return 0;
  }

  // Load .env.tapestry
  const envVars = loadEnvFile();

  // Resolve Discord credentials
  const discordToken = process.env.DISCORD_TOKEN ?? envVars['DISCORD_TOKEN'];
  const guildId = process.env.DISCORD_GUILD_ID ?? envVars['DISCORD_GUILD_ID'];
  const agentCategoryId = process.env.DISCORD_AGENT_CATEGORY_ID ?? envVars['DISCORD_AGENT_CATEGORY_ID'];

  if (!discordToken) {
    console.error('error: DISCORD_TOKEN is required (set in .env.tapestry or environment)');
    return 1;
  }

  if (!guildId) {
    console.error('error: DISCORD_GUILD_ID is required (set in .env.tapestry or environment)');
    return 1;
  }

  // Resolve Tapestry config for SignalDB connection
  let apiUrl: string | undefined;
  let projectKey: string | undefined;

  try {
    const tapestryConfig = loadTapestryConfig(args.env || 'live');
    const envName = args.env || tapestryConfig.current;
    const envConfig = tapestryConfig[envName];

    if (envConfig) {
      apiUrl = envConfig.apiUrl;
      projectKey = envConfig.projectKey;
      console.log(`  Env:       ${envName}`);
    }
  } catch {
    // Fall through
  }

  // Fallback to direct env vars
  apiUrl = apiUrl ?? process.env.SIGNALDB_API_URL ?? envVars['TAPESTRY_LIVE_API_URL'];
  projectKey = projectKey ?? process.env.SIGNALDB_PROJECT_KEY ?? envVars['TAPESTRY_LIVE_PROJECT_KEY'];

  if (!apiUrl) {
    console.error('error: SignalDB API URL not found. Set TAPESTRY_LIVE_API_URL in .env.tapestry');
    return 1;
  }

  if (!projectKey) {
    console.error('error: SignalDB project key not found. Set TAPESTRY_LIVE_PROJECT_KEY in .env.tapestry');
    return 1;
  }

  // Create bot
  const bot = new DiscordBot({
    discordToken,
    guildId,
    apiUrl,
    projectKey,
    agentId: 'discord-bot',
    agentCategoryId: agentCategoryId || undefined,
  });

  // Print startup info
  console.log(`discord-bot v${VERSION}`);
  console.log(`  API:       ${apiUrl}`);
  console.log(`  Guild:     ${guildId}`);
  console.log(`  Category:  ${agentCategoryId || '(auto-create)'}`);
  console.log('');

  // Graceful shutdown
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nShutting down...');
    try {
      await bot.stop();
      console.log('Discord bot stopped.');
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the bot
  try {
    await bot.start();
    console.log('Discord bot started. Agent channels will sync automatically.');
    console.log('Press Ctrl+C to stop.\n');

    // Log status periodically
    setInterval(() => {
      const status = bot.getStatus();
      const ts = new Date().toISOString().slice(11, 19);
      console.log(
        `[${ts}] channels: ${status.agentChannelCount} | ` +
        `threads: ${status.threadMappings} | ` +
        `discord→signaldb: ${status.messagesFromDiscord} | ` +
        `signaldb→discord: ${status.messagesFromSignalDB}`
      );
    }, 60_000); // Every 60s

  } catch (err) {
    console.error('Fatal: bot failed to start:', err);
    return 1;
  }

  // Keep alive
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
