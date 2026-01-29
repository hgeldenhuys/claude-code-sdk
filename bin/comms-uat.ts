#!/usr/bin/env bun
/**
 * COMMS UAT CLI
 *
 * Interactive UAT runner for Tapestry SignalDB integration testing.
 *
 * Usage:
 *   comms-uat setup [--env <env>]              Initialize and verify environment
 *   comms-uat run <scenario|all> [--env <env>] Run specific or all scenarios
 *   comms-uat report [--json]                  Show last UAT report
 *   comms-uat clean [--env <env>]              Clean up test data
 *   comms-uat status                           Show environment status
 */

import {
  runUAT,
  runScenario,
  formatReport,
  formatReportJSON,
  setupUAT,
  cleanupAll,
  checkAllConnectivity,
  formatEnvironmentTable,
  formatConnectivityResults,
  ALL_SCENARIOS,
  type ScenarioName,
  type UATReport,
} from '../tests/uat/index';

import {
  loadTapestryConfig,
  getEnvironmentConfig,
  listConfiguredEnvironments,
  type TapestryEnvironment,
} from '../src/comms/config/environments';

// ============================================================================
// Colors (simple ANSI)
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function bold(s: string): string {
  return `${colors.bold}${s}${colors.reset}`;
}

function red(s: string): string {
  return `${colors.red}${s}${colors.reset}`;
}

function green(s: string): string {
  return `${colors.green}${s}${colors.reset}`;
}

function yellow(s: string): string {
  return `${colors.yellow}${s}${colors.reset}`;
}

function cyan(s: string): string {
  return `${colors.cyan}${s}${colors.reset}`;
}

function dim(s: string): string {
  return `${colors.dim}${s}${colors.reset}`;
}

// ============================================================================
// Argument Parsing
// ============================================================================

function getFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`) || args.includes(`-${flag.charAt(0)}`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex(a => a === `--${flag}` || a === `-${flag.charAt(0)}`);
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  return undefined;
}

function getEnv(args: string[]): TapestryEnvironment {
  const env = getFlagValue(args, 'env');
  if (env && ['dev', 'test', 'live'].includes(env)) {
    return env as TapestryEnvironment;
  }
  return 'dev';
}

// ============================================================================
// Commands
// ============================================================================

/**
 * Show help message.
 */
function showHelp(): void {
  console.log(`
${bold('COMMS UAT CLI')} - Tapestry SignalDB Integration Testing

${bold('Usage:')}
  comms-uat <command> [options]

${bold('Commands:')}
  ${cyan('setup')}              Initialize and verify SignalDB environment
  ${cyan('run')} <scenario>     Run specific UAT scenario
  ${cyan('run all')}            Run all UAT scenarios
  ${cyan('report')}             Show last UAT report (from current session)
  ${cyan('clean')}              Clean up test data from environment
  ${cyan('status')}             Show environment configuration status
  ${cyan('list')}               List available scenarios

${bold('Options:')}
  --env <env>        Target environment: ${cyan('dev')} | ${cyan('test')} | ${cyan('live')} (default: dev)
  --verbose, -v      Detailed output during test execution
  --json             Output results as JSON
  --help, -h         Show this help message

${bold('Scenarios:')}
  ${cyan('agent-lifecycle')}    Agent registration, heartbeat, discovery, deregistration
  ${cyan('realtime-messaging')} Channel pub/sub, message persistence, history
  ${cyan('async-memos')}        Memo compose, claim, state transitions, threading
  ${cyan('ephemeral-pastes')}   TTL expiry, read-once behavior, paste listing
  ${cyan('cross-machine')}      Multi-machine discovery and bidirectional messaging
  ${cyan('security')}           Rate limiting, validation, auth, isolation

${bold('Examples:')}
  comms-uat setup --env dev
  comms-uat run agent-lifecycle --env test -v
  comms-uat run all --env test --json
  comms-uat status
  comms-uat clean --env dev
`);
}

/**
 * Setup command - verify environment connectivity.
 */
async function cmdSetup(args: string[]): Promise<void> {
  const env = getEnv(args);
  const verbose = getFlag(args, 'verbose') || getFlag(args, 'v');

  console.log(bold(`\nSetting up ${env} environment...\n`));

  // Show environment table
  console.log(formatEnvironmentTable());
  console.log();

  // Check connectivity
  console.log(bold('Checking connectivity...\n'));
  const results = await checkAllConnectivity();
  console.log(formatConnectivityResults(results));
  console.log();

  // Try to setup the target environment
  const setupResult = await setupUAT(env);

  if (setupResult.success) {
    console.log(green(`\n${bold('Setup successful!')}`));
    console.log(`  Run ID: ${setupResult.context!.runId}`);
    console.log(`  Machine ID: ${setupResult.context!.envConfig.machineId}`);
    console.log(`  API URL: ${setupResult.context!.envConfig.apiUrl}`);
    console.log(`\nRun ${cyan(`comms-uat run all --env ${env}`)} to execute UAT scenarios.`);
  } else {
    console.log(red(`\n${bold('Setup failed!')}`));
    console.log(`  Error: ${setupResult.error}`);

    if (setupResult.details) {
      console.log('  Details:', JSON.stringify(setupResult.details, null, 2));
    }

    console.log(`\nMake sure you have configured ${cyan(`.env.tapestry`)} with valid credentials.`);
    console.log(`Copy ${cyan('.env.tapestry.example')} and fill in your SignalDB project keys.`);
    process.exit(1);
  }
}

/**
 * Run command - execute scenarios.
 */
async function cmdRun(args: string[]): Promise<void> {
  const env = getEnv(args);
  const verbose = getFlag(args, 'verbose') || getFlag(args, 'v');
  const json = getFlag(args, 'json');

  // Get scenario(s) to run
  const scenarioArg = args.find(a => !a.startsWith('-') && a !== 'run');

  if (!scenarioArg) {
    console.log(red('Error: Please specify a scenario or "all"'));
    console.log('  Usage: comms-uat run <scenario|all> [--env <env>]');
    console.log('  Use: comms-uat list  to see available scenarios');
    process.exit(1);
  }

  const scenarios: ScenarioName[] =
    scenarioArg === 'all'
      ? ALL_SCENARIOS
      : [scenarioArg as ScenarioName];

  // Validate scenario names
  for (const scenario of scenarios) {
    if (!ALL_SCENARIOS.includes(scenario)) {
      console.log(red(`Error: Unknown scenario "${scenario}"`));
      console.log(`Available scenarios: ${ALL_SCENARIOS.join(', ')}`);
      process.exit(1);
    }
  }

  if (!json) {
    console.log(bold(`\nRunning UAT on ${env} environment...\n`));
  }

  try {
    const report = await runUAT(env, { scenarios, verbose: verbose && !json });

    if (json) {
      console.log(formatReportJSON(report));
    } else {
      console.log(formatReport(report));
    }

    // Exit with error code if any tests failed
    if (report.summary.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(red(`\nError: ${error}`));
    }
    process.exit(1);
  }
}

/**
 * Status command - show environment configuration.
 */
async function cmdStatus(args: string[]): Promise<void> {
  const json = getFlag(args, 'json');

  const config = loadTapestryConfig();
  const configured = listConfiguredEnvironments(config);

  if (json) {
    const status = {
      currentEnvironment: config.current,
      configuredEnvironments: configured,
      environments: {
        dev: config.dev ? { apiUrl: config.dev.apiUrl, machineId: config.dev.machineId } : null,
        test: config.test ? { apiUrl: config.test.apiUrl, machineId: config.test.machineId } : null,
        live: config.live ? { apiUrl: config.live.apiUrl, machineId: config.live.machineId } : null,
      },
    };
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  console.log(bold('\nTapestry Environment Status\n'));
  console.log(formatEnvironmentTable());
  console.log();

  // Check connectivity
  console.log(bold('Connectivity:\n'));
  const results = await checkAllConnectivity();
  console.log(formatConnectivityResults(results));
}

/**
 * List command - show available scenarios.
 */
function cmdList(): void {
  console.log(bold('\nAvailable UAT Scenarios:\n'));

  const descriptions: Record<ScenarioName, string> = {
    'agent-lifecycle': 'Agent registration, heartbeat, discovery, deregistration',
    'realtime-messaging': 'Channel pub/sub, message persistence, history queries',
    'async-memos': 'Memo compose, claim, state transitions, threading',
    'ephemeral-pastes': 'TTL expiry, read-once behavior, paste listing',
    'cross-machine': 'Multi-machine discovery and bidirectional messaging',
    'security': 'Rate limiting, validation, authentication, isolation',
  };

  for (const scenario of ALL_SCENARIOS) {
    console.log(`  ${cyan(scenario.padEnd(20))} ${descriptions[scenario]}`);
  }

  console.log(`\nRun ${cyan('comms-uat run <scenario>')} to execute a specific scenario.`);
  console.log(`Run ${cyan('comms-uat run all')} to execute all scenarios.`);
}

/**
 * Clean command - cleanup test data.
 */
async function cmdClean(args: string[]): Promise<void> {
  const env = getEnv(args);
  const json = getFlag(args, 'json');

  if (!json) {
    console.log(bold(`\nCleaning up test data in ${env} environment...\n`));
  }

  try {
    const setupResult = await setupUAT(env);

    if (!setupResult.success || !setupResult.context) {
      if (json) {
        console.log(JSON.stringify({ error: setupResult.error }));
      } else {
        console.log(red(`Error: ${setupResult.error}`));
      }
      process.exit(1);
    }

    const stats = await cleanupAll(setupResult.context);

    if (json) {
      console.log(JSON.stringify(stats));
    } else {
      console.log(green('Cleanup complete:'));
      console.log(`  Agents cleaned: ${stats.agents}`);
      console.log(`  Channels cleaned: ${stats.channels}`);
      console.log(`  Messages cleaned: ${stats.messages}`);
      console.log(`  Pastes cleaned: ${stats.pastes}`);
    }
  } catch (error) {
    if (json) {
      console.log(JSON.stringify({ error: String(error) }));
    } else {
      console.log(red(`Error: ${error}`));
    }
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (getFlag(args, 'help') || getFlag(args, 'h') || !command) {
    showHelp();
    return;
  }

  switch (command) {
    case 'setup':
      await cmdSetup(args.slice(1));
      break;

    case 'run':
      await cmdRun(args.slice(1));
      break;

    case 'status':
      await cmdStatus(args.slice(1));
      break;

    case 'list':
      cmdList();
      break;

    case 'clean':
      await cmdClean(args.slice(1));
      break;

    case 'report':
      console.log(yellow('\nNote: Report command shows the last run from current session.'));
      console.log('Run "comms-uat run all --json" to generate a new report.\n');
      break;

    default:
      console.log(red(`Unknown command: ${command}`));
      console.log('Run "comms-uat --help" for usage information.');
      process.exit(1);
  }
}

main().catch(error => {
  console.error(red(`Fatal error: ${error}`));
  process.exit(1);
});
