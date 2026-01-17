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
    } else if (arg === 'inspect') {
      result.command = 'inspect';
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
  inspect               Inspect all configured hooks across all sources
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

INSPECT COMMAND:
  Inspects all configured hooks across all sources:
  - Global hooks (~/.claude/settings.json)
  - Project hooks (.claude/settings.json, .claude/settings.local.json)
  - Plugin hooks (.claude-plugin/hooks.json, plugins/*/hooks.json)

  Shows:
  - Which hooks fire on each event type
  - Source of each hook (global, project, plugin)
  - Command executed for each hook
  - Count of hooks per event

  Example:
    bun run hooks inspect

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
  const os = await import('os');

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

      // 3b. Check event-logger specifically for hook event logging
      const eventLoggerConfig = builtins['event-logger'] as { enabled?: boolean; options?: { outputDir?: string } } | undefined;
      const hooksDir = eventLoggerConfig?.options?.outputDir || path.join(os.homedir(), '.claude', 'hooks');

      if (eventLoggerConfig?.enabled) {
        results.push({
          name: 'Event logger',
          status: 'pass',
          message: `Enabled (logging to ${hooksDir})`,
        });

        // Check if hooks directory exists and has files
        if (fs.existsSync(hooksDir)) {
          const hookProjects = fs.readdirSync(hooksDir).filter(f =>
            fs.statSync(path.join(hooksDir, f)).isDirectory()
          );
          if (hookProjects.length > 0) {
            let totalHookFiles = 0;
            for (const project of hookProjects) {
              const projectDir = path.join(hooksDir, project);
              const hookFiles = fs.readdirSync(projectDir).filter(f => f.endsWith('.hooks.jsonl'));
              totalHookFiles += hookFiles.length;
            }
            results.push({
              name: 'Hook event files',
              status: 'pass',
              message: `${totalHookFiles} .hooks.jsonl files in ${hookProjects.length} projects`,
            });
          } else {
            results.push({
              name: 'Hook event files',
              status: 'warn',
              message: 'No hook event files yet (will be created on first hook execution)',
            });
          }
        } else {
          results.push({
            name: 'Hook event files',
            status: 'warn',
            message: `Hooks directory not found: ${hooksDir} (will be created on first hook execution)`,
          });
        }
      } else {
        results.push({
          name: 'Event logger',
          status: 'warn',
          message: 'Disabled. Enable in hooks.yaml to log hook events for analysis.',
          fix: async () => {
            // Add event-logger to config
            const yaml = await import('yaml');
            const content = fs.readFileSync(foundConfig!, 'utf-8');
            const cfg = yaml.parse(content);
            cfg.builtins = cfg.builtins || {};
            cfg.builtins['event-logger'] = { enabled: true };
            fs.writeFileSync(foundConfig!, yaml.stringify(cfg));
          },
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
// Inspect Command
// ============================================================================

interface HookSource {
  source: 'global' | 'project' | 'project-local' | 'plugin';
  file: string;
  command: string;
  matcher?: string;
  type?: string;
}

interface HooksByEvent {
  [event: string]: HookSource[];
}

async function runInspect(): Promise<void> {
  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  const cwd = process.cwd();
  const homeDir = os.homedir();
  const hooksByEvent: HooksByEvent = {};

  console.log('Hook Configuration Inspector\n');
  console.log('Scanning all hook sources...\n');

  // Helper to extract hooks from settings.json format
  function extractHooksFromSettings(
    content: string,
    source: HookSource['source'],
    filePath: string
  ): void {
    try {
      const settings = JSON.parse(content);
      if (!settings.hooks) return;

      for (const [event, eventHooks] of Object.entries(settings.hooks)) {
        if (!hooksByEvent[event]) hooksByEvent[event] = [];

        const hookArray = eventHooks as Array<{
          matcher?: string;
          hooks?: Array<{ type?: string; command?: string }>;
        }>;

        for (const hookGroup of hookArray) {
          const matcher = hookGroup.matcher || '*';
          for (const hook of hookGroup.hooks || []) {
            if (hook.command) {
              hooksByEvent[event].push({
                source,
                file: filePath,
                command: hook.command,
                matcher,
                type: hook.type || 'command',
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`  Warning: Could not parse ${filePath}: ${error}`);
    }
  }

  // Helper to extract hooks from hooks.json format (plugins)
  function extractHooksFromPluginFormat(
    content: string,
    filePath: string
  ): void {
    try {
      const config = JSON.parse(content);
      if (!config.hooks) return;

      for (const [event, eventHooks] of Object.entries(config.hooks)) {
        if (!hooksByEvent[event]) hooksByEvent[event] = [];

        const hookArray = eventHooks as Array<{
          matcher?: string;
          hooks?: Array<{ type?: string; command?: string }>;
        }>;

        for (const hookGroup of hookArray) {
          const matcher = hookGroup.matcher || '*';
          for (const hook of hookGroup.hooks || []) {
            if (hook.command) {
              hooksByEvent[event].push({
                source: 'plugin',
                file: filePath,
                command: hook.command,
                matcher,
                type: hook.type || 'command',
              });
            }
          }
        }
      }
    } catch (error) {
      console.error(`  Warning: Could not parse ${filePath}: ${error}`);
    }
  }

  // 1. Global settings (~/.claude/settings.json)
  const globalSettingsPath = path.join(homeDir, '.claude', 'settings.json');
  if (fs.existsSync(globalSettingsPath)) {
    console.log(`  ✓ Global: ${globalSettingsPath}`);
    const content = fs.readFileSync(globalSettingsPath, 'utf-8');
    extractHooksFromSettings(content, 'global', globalSettingsPath);
  } else {
    console.log(`  - Global: Not found`);
  }

  // 2. Project settings (.claude/settings.json)
  const projectSettingsPath = path.join(cwd, '.claude', 'settings.json');
  if (fs.existsSync(projectSettingsPath)) {
    console.log(`  ✓ Project: ${projectSettingsPath}`);
    const content = fs.readFileSync(projectSettingsPath, 'utf-8');
    extractHooksFromSettings(content, 'project', projectSettingsPath);
  } else {
    console.log(`  - Project settings: Not found`);
  }

  // 3. Project local settings (.claude/settings.local.json)
  const projectLocalSettingsPath = path.join(cwd, '.claude', 'settings.local.json');
  if (fs.existsSync(projectLocalSettingsPath)) {
    console.log(`  ✓ Project local: ${projectLocalSettingsPath}`);
    const content = fs.readFileSync(projectLocalSettingsPath, 'utf-8');
    extractHooksFromSettings(content, 'project-local', projectLocalSettingsPath);
  } else {
    console.log(`  - Project local: Not found`);
  }

  // 4. Plugin hooks (.claude-plugin/hooks.json)
  const pluginHooksPath = path.join(cwd, '.claude-plugin', 'hooks.json');
  if (fs.existsSync(pluginHooksPath)) {
    console.log(`  ✓ Plugin: ${pluginHooksPath}`);
    const content = fs.readFileSync(pluginHooksPath, 'utf-8');
    extractHooksFromPluginFormat(content, pluginHooksPath);
  }

  // 5. Plugin hooks in plugins directory (plugins/*/hooks.json, plugins/*/.claude-plugin/hooks.json)
  const pluginPatterns = [
    'plugins/*/hooks.json',
    'plugins/*/.claude-plugin/hooks.json',
    'plugins/*/hooks/hooks.json',
  ];

  for (const pattern of pluginPatterns) {
    const globResult = new Bun.Glob(pattern);
    for await (const match of globResult.scan({ cwd, absolute: true })) {
      console.log(`  ✓ Plugin: ${path.relative(cwd, match)}`);
      const content = fs.readFileSync(match, 'utf-8');
      extractHooksFromPluginFormat(content, match);
    }
  }

  // 6. Check node_modules for plugins with hooks
  const nodeModulesGlob = new Bun.Glob('node_modules/*/.claude-plugin/hooks.json');
  for await (const match of nodeModulesGlob.scan({ cwd, absolute: true })) {
    console.log(`  ✓ Node module: ${path.relative(cwd, match)}`);
    const content = fs.readFileSync(match, 'utf-8');
    extractHooksFromPluginFormat(content, match);
  }

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('HOOKS BY EVENT');
  console.log('='.repeat(80) + '\n');

  const eventOrder = [
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'PostToolUse',
    'Stop',
    'SubagentStop',
    'PreCompact',
    'SessionEnd',
    'Notification',
  ];

  // Sort events: known events first in order, then any others
  const allEvents = Object.keys(hooksByEvent);
  const sortedEvents = [
    ...eventOrder.filter(e => allEvents.includes(e)),
    ...allEvents.filter(e => !eventOrder.includes(e)).sort(),
  ];

  let totalHooks = 0;

  for (const event of sortedEvents) {
    const hooks = hooksByEvent[event];
    if (!hooks || hooks.length === 0) continue;

    totalHooks += hooks.length;

    const color = hooks.length > 2 ? '\x1b[33m' : '\x1b[32m'; // Yellow if >2, green otherwise
    console.log(`${color}${event}\x1b[0m (${hooks.length} hook${hooks.length > 1 ? 's' : ''}):`);

    for (const hook of hooks) {
      const sourceColor =
        hook.source === 'global' ? '\x1b[36m' :
        hook.source === 'project' ? '\x1b[35m' :
        hook.source === 'project-local' ? '\x1b[34m' :
        '\x1b[33m';

      const shortFile = hook.file.replace(homeDir, '~').replace(cwd, '.');
      const shortCommand = hook.command.length > 60
        ? hook.command.substring(0, 57) + '...'
        : hook.command;

      console.log(`  ${sourceColor}[${hook.source}]\x1b[0m ${shortCommand}`);
      console.log(`    └─ ${shortFile} (matcher: ${hook.matcher})`);
    }
    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80) + '\n');

  console.log(`Total hooks: ${totalHooks}`);
  console.log(`Events with hooks: ${sortedEvents.length}`);

  // Count by source
  const bySource: Record<string, number> = {};
  for (const hooks of Object.values(hooksByEvent)) {
    for (const hook of hooks) {
      bySource[hook.source] = (bySource[hook.source] || 0) + 1;
    }
  }

  console.log('\nBy source:');
  for (const [source, count] of Object.entries(bySource)) {
    console.log(`  ${source}: ${count}`);
  }

  // Warn about potential slowness
  const sessionStartHooks = hooksByEvent['SessionStart']?.length || 0;
  if (sessionStartHooks > 2) {
    console.log(`\n\x1b[33m⚠ Warning: ${sessionStartHooks} hooks on SessionStart may cause slow startup.\x1b[0m`);
    console.log('  Consider consolidating hooks or using the hook framework.');
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

  // Handle inspect command
  if (args.command === 'inspect') {
    await runInspect();
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
