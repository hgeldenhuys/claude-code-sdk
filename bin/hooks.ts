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
  command?: string;
  configPath?: string;
  debug: boolean;
  help: boolean;
  version: boolean;
  listHandlers: boolean;
  validateOnly: boolean;
  force: boolean;
  fix: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    debug: false,
    help: false,
    version: false,
    listHandlers: false,
    validateOnly: false,
    force: false,
    fix: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    // Check for subcommands first
    if (arg === 'init') {
      result.command = 'init';
    } else if (arg === 'doctor') {
      result.command = 'doctor';
    } else if (arg === '--fix') {
      result.fix = true;
    } else if (arg === '--config' || arg === '-c') {
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
    } else if (arg === '--force' || arg === '-f') {
      result.force = true;
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
  bun run bin/hooks.ts [COMMAND] [OPTIONS]

COMMANDS:
  init                  Initialize hook framework in current project
  doctor                Diagnose hook framework configuration issues
  (default)             Run hook framework (reads from stdin)

OPTIONS:
  -c, --config <path>   Path to YAML config file (default: ./hooks.yaml)
  -d, --debug           Enable debug logging
  -l, --list-handlers   List available built-in handlers
  --validate            Validate config file and exit
  -f, --force           Overwrite existing files (for init)
  --fix                 Auto-fix issues found by doctor
  -v, --version         Show version
  -h, --help            Show this help

INIT COMMAND:
  Sets up the hook framework in your project:
  - Creates hooks.yaml with sensible defaults
  - Updates .claude/settings.json to route all events through framework

  Example:
    bun run hooks init
    bun run hooks init --force  # Overwrite existing files

DOCTOR COMMAND:
  Diagnoses hook framework configuration:
  - Checks hooks.yaml exists and is valid
  - Verifies .claude/settings.json routes events to framework
  - Validates built-in handler configuration
  - Checks custom handler commands exist

  Example:
    bun run hooks doctor
    bun run hooks doctor --fix  # Auto-fix issues

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
// Init Command
// ============================================================================

const DEFAULT_HOOKS_YAML = `# Hook Framework Configuration
# ============================
# Generated by: bun run hooks init

version: 1

settings:
  debug: false
  parallel_execution: true
  default_timeout_ms: 30000
  default_error_strategy: continue

builtins:
  # Human-friendly session names (e.g., "brave-elephant")
  session-naming:
    enabled: true
    options:
      format: adjective-animal

  # Track turns between Stop events
  turn-tracker:
    enabled: true

  # Block dangerous Bash commands
  dangerous-command-guard:
    enabled: true
    options:
      strict: false
      blocked_patterns:
        - "rm -rf /"
        - "rm -rf ~"

  # Context injection (disabled by default)
  context-injection:
    enabled: false

  # Tool logging (disabled by default, enable for debugging)
  tool-logger:
    enabled: false
    options:
      log_level: info
      include_input: true
      format: text

# Custom handlers - add your own here
handlers: {}
`;

function generateSettingsJson(): object {
  // All hook events that should route through the framework
  const events = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'SubagentStop',
    'SessionEnd',
    'PreCompact',
  ];

  const hooks: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {};

  for (const event of events) {
    hooks[event] = [
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: 'bun "$CLAUDE_PROJECT_DIR"/node_modules/claude-code-sdk/bin/hooks.ts --config "$CLAUDE_PROJECT_DIR"/hooks.yaml',
          },
        ],
      },
    ];
  }

  return { hooks };
}

async function runInit(force: boolean): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const cwd = process.cwd();
  const hooksYamlPath = path.join(cwd, 'hooks.yaml');
  const claudeDir = path.join(cwd, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  console.log('Initializing Hook Framework...\n');

  // Check for existing files
  const hooksYamlExists = fs.existsSync(hooksYamlPath);
  const settingsExists = fs.existsSync(settingsPath);

  if (hooksYamlExists && !force) {
    console.log(`  hooks.yaml already exists. Use --force to overwrite.`);
  } else {
    fs.writeFileSync(hooksYamlPath, DEFAULT_HOOKS_YAML);
    console.log(`  Created: hooks.yaml`);
  }

  // Ensure .claude directory exists
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
    console.log(`  Created: .claude/`);
  }

  // Handle settings.json
  if (settingsExists) {
    // Merge with existing settings
    try {
      const existingContent = fs.readFileSync(settingsPath, 'utf-8');
      const existing = JSON.parse(existingContent);
      const newSettings = generateSettingsJson();

      if (force) {
        // Replace hooks entirely
        existing.hooks = (newSettings as { hooks: unknown }).hooks;
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        console.log(`  Updated: .claude/settings.json (replaced hooks)`);
      } else if (!existing.hooks) {
        // Add hooks if none exist
        existing.hooks = (newSettings as { hooks: unknown }).hooks;
        fs.writeFileSync(settingsPath, JSON.stringify(existing, null, 2));
        console.log(`  Updated: .claude/settings.json (added hooks)`);
      } else {
        console.log(`  .claude/settings.json already has hooks. Use --force to replace.`);
      }
    } catch (error) {
      console.error(`  Error updating settings.json: ${error}`);
    }
  } else {
    // Create new settings.json
    const newSettings = generateSettingsJson();
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    console.log(`  Created: .claude/settings.json`);
  }

  console.log(`
Done! Hook framework is now configured.

Built-in handlers enabled:
  - session-naming: Human-friendly session names
  - turn-tracker: Track turns between Stop events
  - dangerous-command-guard: Block dangerous commands

To customize, edit hooks.yaml and add your own handlers.

Test with:
  claude --debug
`);
}

// ============================================================================
// Doctor Command
// ============================================================================

interface DiagnosticResult {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: () => Promise<void>;
}

async function runDoctor(fix: boolean): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');

  const cwd = process.cwd();
  const results: DiagnosticResult[] = [];

  console.log('Hook Framework Doctor\n');
  console.log('Checking configuration...\n');

  // 1. Check hooks.yaml exists
  const hooksYamlPaths = [
    path.join(cwd, 'hooks.yaml'),
    path.join(cwd, 'hooks.yml'),
    path.join(cwd, '.claude', 'hooks.yaml'),
    path.join(cwd, '.claude', 'hooks.yml'),
  ];

  let foundConfig: string | null = null;
  for (const p of hooksYamlPaths) {
    if (fs.existsSync(p)) {
      foundConfig = p;
      break;
    }
  }

  if (foundConfig) {
    results.push({
      name: 'hooks.yaml',
      status: 'pass',
      message: `Found: ${path.relative(cwd, foundConfig)}`,
    });

    // 2. Validate YAML syntax
    try {
      const yaml = await import('yaml');
      const content = fs.readFileSync(foundConfig, 'utf-8');
      const config = yaml.parse(content);

      if (config.version !== 1) {
        results.push({
          name: 'Config version',
          status: 'warn',
          message: `Expected version: 1, got: ${config.version}`,
        });
      } else {
        results.push({
          name: 'Config version',
          status: 'pass',
          message: 'Version 1',
        });
      }

      // 3. Check builtins
      const builtins = config.builtins || {};
      const enabledBuiltins: string[] = [];
      for (const [name, cfg] of Object.entries(builtins)) {
        if ((cfg as { enabled?: boolean }).enabled) {
          enabledBuiltins.push(name);
        }
      }

      if (enabledBuiltins.length > 0) {
        results.push({
          name: 'Built-in handlers',
          status: 'pass',
          message: `Enabled: ${enabledBuiltins.join(', ')}`,
        });
      } else {
        results.push({
          name: 'Built-in handlers',
          status: 'warn',
          message: 'No built-in handlers enabled',
        });
      }

      // 4. Check custom handlers
      const handlers = config.handlers || {};
      const handlerNames = Object.keys(handlers);
      if (handlerNames.length > 0) {
        for (const [name, cfg] of Object.entries(handlers)) {
          const handler = cfg as { command?: string; enabled?: boolean };
          if (handler.enabled === false) continue;

          if (handler.command) {
            // Check if command exists (basic check)
            const cmdParts = handler.command.split(' ');
            const cmdPath = cmdParts[0]?.replace(/^\$\{.*\}\//, '').replace(/^"?\$CLAUDE_PROJECT_DIR"?\//, '');

            if (cmdPath && !cmdPath.startsWith('bun') && !cmdPath.startsWith('node')) {
              const fullPath = path.join(cwd, cmdPath);
              if (fs.existsSync(fullPath)) {
                results.push({
                  name: `Handler: ${name}`,
                  status: 'pass',
                  message: `Command exists: ${cmdPath}`,
                });
              } else {
                results.push({
                  name: `Handler: ${name}`,
                  status: 'warn',
                  message: `Command not found: ${cmdPath}`,
                });
              }
            } else {
              results.push({
                name: `Handler: ${name}`,
                status: 'pass',
                message: 'Command configured',
              });
            }
          }
        }
      }
    } catch (error) {
      results.push({
        name: 'Config syntax',
        status: 'fail',
        message: `Invalid YAML: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'hooks.yaml',
      status: 'fail',
      message: 'Not found. Run `bun run hooks init` to create.',
      fix: async () => {
        fs.writeFileSync(path.join(cwd, 'hooks.yaml'), DEFAULT_HOOKS_YAML);
      },
    });
  }

  // 5. Check .claude/settings.json
  const settingsPath = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      if (settings.hooks) {
        const events = Object.keys(settings.hooks);
        const expectedEvents = ['SessionStart', 'PreToolUse', 'PostToolUse', 'Stop'];
        const missingEvents = expectedEvents.filter((e) => !events.includes(e));

        if (missingEvents.length === 0) {
          results.push({
            name: 'settings.json hooks',
            status: 'pass',
            message: `${events.length} events configured`,
          });
        } else {
          results.push({
            name: 'settings.json hooks',
            status: 'warn',
            message: `Missing events: ${missingEvents.join(', ')}`,
            fix: async () => {
              const newSettings = generateSettingsJson();
              settings.hooks = (newSettings as { hooks: unknown }).hooks;
              fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
            },
          });
        }

        // Check if hooks point to framework
        let usesFramework = false;
        for (const [, eventHooks] of Object.entries(settings.hooks)) {
          const hookArray = eventHooks as Array<{ hooks?: Array<{ command?: string }> }>;
          for (const h of hookArray) {
            for (const hook of h.hooks || []) {
              if (hook.command?.includes('hooks.ts') || hook.command?.includes('hook-framework')) {
                usesFramework = true;
                break;
              }
            }
          }
        }

        if (usesFramework) {
          results.push({
            name: 'Framework integration',
            status: 'pass',
            message: 'Hooks route through framework',
          });
        } else {
          results.push({
            name: 'Framework integration',
            status: 'warn',
            message: 'Hooks may not use framework. Run `bun run hooks init --force`',
          });
        }
      } else {
        results.push({
          name: 'settings.json hooks',
          status: 'fail',
          message: 'No hooks configured. Run `bun run hooks init`',
          fix: async () => {
            const newSettings = generateSettingsJson();
            settings.hooks = (newSettings as { hooks: unknown }).hooks;
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
          },
        });
      }
    } catch (error) {
      results.push({
        name: 'settings.json',
        status: 'fail',
        message: `Invalid JSON: ${error instanceof Error ? error.message : error}`,
      });
    }
  } else {
    results.push({
      name: 'settings.json',
      status: 'fail',
      message: 'Not found. Run `bun run hooks init` to create.',
      fix: async () => {
        const claudeDir = path.join(cwd, '.claude');
        if (!fs.existsSync(claudeDir)) {
          fs.mkdirSync(claudeDir, { recursive: true });
        }
        const newSettings = generateSettingsJson();
        fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
      },
    });
  }

  // 6. Check environment
  if (process.env.CLAUDE_PROJECT_DIR) {
    results.push({
      name: 'CLAUDE_PROJECT_DIR',
      status: 'pass',
      message: process.env.CLAUDE_PROJECT_DIR,
    });
  } else {
    results.push({
      name: 'CLAUDE_PROJECT_DIR',
      status: 'warn',
      message: 'Not set (only available during hook execution)',
    });
  }

  // Print results
  console.log('Results:\n');

  let hasFailures = false;
  let hasFixable = false;

  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'warn' ? '⚠' : '✗';
    const color = r.status === 'pass' ? '\x1b[32m' : r.status === 'warn' ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${color}${icon}\x1b[0m ${r.name}: ${r.message}`);

    if (r.status === 'fail') hasFailures = true;
    if (r.fix) hasFixable = true;
  }

  console.log('');

  // Apply fixes if requested
  if (fix && hasFixable) {
    console.log('Applying fixes...\n');
    for (const r of results) {
      if (r.fix && (r.status === 'fail' || r.status === 'warn')) {
        try {
          await r.fix();
          console.log(`  ✓ Fixed: ${r.name}`);
        } catch (error) {
          console.log(`  ✗ Failed to fix: ${r.name} - ${error}`);
        }
      }
    }
    console.log('\nRun `bun run hooks doctor` again to verify.');
  } else if (hasFailures && !fix) {
    console.log('Run `bun run hooks doctor --fix` to auto-fix issues.');
  } else if (!hasFailures) {
    console.log('All checks passed! Hook framework is properly configured.');
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

  // Handle init command
  if (args.command === 'init') {
    await runInit(args.force);
    process.exit(0);
  }

  // Handle doctor command
  if (args.command === 'doctor') {
    await runDoctor(args.fix);
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
