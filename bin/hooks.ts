#!/usr/bin/env bun
/**
 * Hook Framework CLI Entry Point
 *
 * Main entry point for running the hook framework with YAML configuration.
 * Reads hook events from stdin and outputs results to stdout.
 *
 * Usage:
 *   bun run bin/hooks.ts --config ./hooks.yaml
 *   bun run bin/hooks.ts                          # Uses ./hooks.yaml or ./.claude/hooks.yaml
 *
 * Configuration in Claude Code settings.json:
 *   {
 *     "hooks": {
 *       "PreToolUse": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }],
 *       "PostToolUse": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }],
 *       "SessionStart": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }]
 *     }
 *   }
 */

import { loadResolvedConfig, configExists, getConfigPath } from '../src/hooks/framework/config';
import { createFramework, type HookEventType } from '../src/hooks/framework';
import {
  builtinHandlers,
  createHandlerFromConfig,
  isBuiltinHandler,
  getDefaultEvents,
} from '../src/hooks/framework/handlers';
import type { ResolvedConfig, ResolvedHandlerConfig } from '../src/hooks/framework/config/types';

// ============================================================================
// CLI Arguments
// ============================================================================

interface CLIArgs {
  configPath?: string;
  debug: boolean;
  help: boolean;
  version: boolean;
  listHandlers: boolean;
  validateOnly: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    debug: false,
    help: false,
    version: false,
    listHandlers: false,
    validateOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--config' || arg === '-c') {
      result.configPath = args[++i];
    } else if (arg === '--debug' || arg === '-d') {
      result.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--list-handlers' || arg === '-l') {
      result.listHandlers = true;
    } else if (arg === '--validate' || arg === '--validate-only') {
      result.validateOnly = true;
    } else if (arg.startsWith('--config=')) {
      result.configPath = arg.slice('--config='.length);
    }
  }

  return result;
}

// ============================================================================
// Help and Info
// ============================================================================

function printHelp(): void {
  console.log(`
Hook Framework CLI

USAGE:
  bun run bin/hooks.ts [OPTIONS]

OPTIONS:
  -c, --config <path>   Path to YAML config file (default: ./hooks.yaml)
  -d, --debug           Enable debug logging
  -l, --list-handlers   List available built-in handlers
  --validate            Validate config file and exit
  -v, --version         Show version
  -h, --help            Show this help

DESCRIPTION:
  Runs the hook framework with the specified YAML configuration.
  Hook events are read from stdin (JSON) and results are output to stdout.

  The framework automatically detects the event type from the input and
  runs the appropriate handlers.

CONFIG FILE SEARCH ORDER:
  1. Path specified with --config
  2. ./hooks.yaml
  3. ./hooks.yml
  4. ./.claude/hooks.yaml
  5. ./.claude/hooks.yml

EXAMPLE CONFIG:
  version: 1
  settings:
    debug: false
    parallelExecution: true
    defaultTimeoutMs: 30000

  builtins:
    session-naming:
      enabled: true
      options:
        format: adjective-animal
    dangerous-command-guard:
      enabled: true
      options:
        blockedPatterns:
          - "rm -rf /"

EXAMPLE CLAUDE CODE SETTINGS:
  {
    "hooks": {
      "PreToolUse": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }],
      "PostToolUse": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }],
      "SessionStart": [{ "command": "bun run bin/hooks.ts --config ./hooks.yaml" }]
    }
  }
`);
}

function printVersion(): void {
  // Read version from package.json if possible
  try {
    const pkg = require('../package.json');
    console.log(`hook-framework v${pkg.version}`);
  } catch {
    console.log('hook-framework v0.1.0');
  }
}

function listHandlers(): void {
  console.log('\nAvailable Built-in Handlers:\n');

  for (const [type, meta] of Object.entries(builtinHandlers)) {
    console.log(`  ${type}`);
    console.log(`    Name: ${meta.name}`);
    console.log(`    Description: ${meta.description}`);
    console.log(`    Default Events: ${meta.defaultEvents.join(', ')}`);
    console.log(`    Default Priority: ${meta.defaultPriority}`);
    console.log('');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  // Handle info commands
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    printVersion();
    process.exit(0);
  }

  if (args.listHandlers) {
    listHandlers();
    process.exit(0);
  }

  // Check for config file
  const configPath = getConfigPath(args.configPath);
  if (!configPath) {
    if (args.configPath) {
      console.error(`Error: Config file not found: ${args.configPath}`);
    } else {
      console.error('Error: No config file found. Create hooks.yaml or use --config');
    }
    process.exit(1);
  }

  // Load and validate config
  let config: ResolvedConfig;
  try {
    config = loadResolvedConfig(configPath);
  } catch (error) {
    console.error(`Error loading config: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Validate-only mode
  if (args.validateOnly) {
    console.log(`Config file is valid: ${configPath}`);
    console.log(`  Version: ${config.version}`);
    console.log(`  Handlers: ${config.handlers.length}`);
    console.log(`  Debug: ${config.settings.debug}`);
    console.log(`  Parallel Execution: ${config.settings.parallelExecution}`);
    console.log(`  Default Timeout: ${config.settings.defaultTimeoutMs}ms`);
    process.exit(0);
  }

  // Apply debug override from CLI
  const debug = args.debug || config.settings.debug;

  if (debug) {
    console.error(`[hooks] Loading config from: ${configPath}`);
    console.error(`[hooks] Handlers: ${config.handlers.map((h) => h.id).join(', ')}`);
  }

  // Create framework
  const framework = createFramework({
    debug,
    defaultTimeoutMs: config.settings.defaultTimeoutMs,
    defaultErrorStrategy: config.settings.defaultErrorStrategy,
  });

  // Register handlers from config
  for (const handlerConfig of config.handlers) {
    if (!handlerConfig.enabled) {
      if (debug) {
        console.error(`[hooks] Skipping disabled handler: ${handlerConfig.id}`);
      }
      continue;
    }

    // Create handler from config
    const handler = createHandlerFromConfig(handlerConfig);
    if (!handler) {
      if (debug) {
        console.error(`[hooks] Could not create handler: ${handlerConfig.id}`);
      }
      continue;
    }

    // Register handler for each configured event
    const events = handlerConfig.events.length > 0
      ? handlerConfig.events
      : (isBuiltinHandler(handlerConfig.type)
        ? getDefaultEvents(handlerConfig.type)
        : []);

    for (const event of events) {
      framework.on(event as HookEventType, {
        ...handler,
        id: `${handlerConfig.id}-${event}`, // Unique ID per event type
      });
    }

    if (debug) {
      console.error(`[hooks] Registered handler: ${handlerConfig.id} for events: ${events.join(', ')}`);
    }
  }

  // Run the framework (reads from stdin, writes to stdout)
  try {
    await framework.run();
  } catch (error) {
    if (debug) {
      console.error(`[hooks] Error: ${error instanceof Error ? error.message : error}`);
    }
    // Output empty to not block Claude
    console.log('');
    process.exit(1);
  }
}

// Run
main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
