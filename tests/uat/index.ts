/**
 * COMMS UAT Orchestrator
 *
 * Runs all UAT scenarios and generates reports.
 */

import {
  type TapestryEnvironment,
  setupUAT,
  cleanupAll,
  formatEnvironmentTable,
  formatConnectivityResults,
  checkAllConnectivity,
  type UATContext,
  type ConnectivityResult,
} from './setup';

import { runAgentLifecycleScenario, type AgentLifecycleResult } from './agent-lifecycle';
import { runRealtimeMessagingScenario, type RealtimeMessagingResult } from './realtime-messaging';
import { runAsyncMemosScenario, type AsyncMemosResult } from './async-memos';
import { runEphemeralPastesScenario, type EphemeralPastesResult } from './ephemeral-pastes';
import { runCrossMachineScenario, type CrossMachineResult } from './cross-machine';
import { runSecurityScenario, type SecurityResult } from './security';

// ============================================================================
// Types
// ============================================================================

export type ScenarioName =
  | 'agent-lifecycle'
  | 'realtime-messaging'
  | 'async-memos'
  | 'ephemeral-pastes'
  | 'cross-machine'
  | 'security';

export type ScenarioResult =
  | AgentLifecycleResult
  | RealtimeMessagingResult
  | AsyncMemosResult
  | EphemeralPastesResult
  | CrossMachineResult
  | SecurityResult;

export interface UATReport {
  environment: TapestryEnvironment;
  runId: string;
  startedAt: string;
  completedAt: string;
  duration: number;
  scenarios: ScenarioResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    passRate: string;
  };
}

export interface RunOptions {
  scenarios?: ScenarioName[];
  verbose?: boolean;
  json?: boolean;
}

// ============================================================================
// Scenario Registry
// ============================================================================

const SCENARIO_RUNNERS: Record<ScenarioName, (ctx: UATContext) => Promise<ScenarioResult>> = {
  'agent-lifecycle': runAgentLifecycleScenario,
  'realtime-messaging': runRealtimeMessagingScenario,
  'async-memos': runAsyncMemosScenario,
  'ephemeral-pastes': runEphemeralPastesScenario,
  'cross-machine': runCrossMachineScenario,
  'security': runSecurityScenario,
};

const ALL_SCENARIOS: ScenarioName[] = [
  'agent-lifecycle',
  'realtime-messaging',
  'async-memos',
  'ephemeral-pastes',
  'cross-machine',
  'security',
];

// ============================================================================
// Runner Functions
// ============================================================================

/**
 * Run UAT scenarios for a specific environment.
 */
export async function runUAT(
  env: TapestryEnvironment,
  options: RunOptions = {},
): Promise<UATReport> {
  const startedAt = new Date();
  const scenariosToRun = options.scenarios || ALL_SCENARIOS;

  // Setup
  if (options.verbose) {
    console.log(`\nSetting up UAT for ${env} environment...`);
  }

  const setupResult = await setupUAT(env);

  if (!setupResult.success || !setupResult.context) {
    throw new Error(`Failed to setup UAT: ${setupResult.error}`);
  }

  const ctx = setupResult.context;

  if (options.verbose) {
    console.log(`UAT run ID: ${ctx.runId}`);
    console.log(`Machine ID: ${ctx.envConfig.machineId}`);
    console.log(`API URL: ${ctx.envConfig.apiUrl}\n`);
  }

  // Run scenarios
  const results: ScenarioResult[] = [];

  for (const scenario of scenariosToRun) {
    const runner = SCENARIO_RUNNERS[scenario];

    if (!runner) {
      console.warn(`Unknown scenario: ${scenario}`);
      continue;
    }

    if (options.verbose) {
      console.log(`Running scenario: ${scenario}...`);
    }

    const result = await runner(ctx);
    results.push(result);

    if (options.verbose) {
      const status = result.passed ? '✓ PASSED' : '✗ FAILED';
      console.log(`  ${status} (${result.duration}ms)`);

      if (!result.passed && result.error) {
        console.log(`  Error: ${result.error}`);
      }

      // Show step details
      for (const step of result.steps) {
        const stepStatus = step.passed ? '  ✓' : '  ✗';
        console.log(`    ${stepStatus} ${step.name} (${step.duration}ms)`);

        if (!step.passed && step.error) {
          console.log(`      Error: ${step.error}`);
        }
      }

      console.log();
    }
  }

  // Cleanup
  if (options.verbose) {
    console.log('Cleaning up...');
  }

  await cleanupAll(ctx);

  // Generate report
  const completedAt = new Date();
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  const report: UATReport = {
    environment: env,
    runId: ctx.runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    duration: completedAt.getTime() - startedAt.getTime(),
    scenarios: results,
    summary: {
      total: results.length,
      passed,
      failed,
      passRate: `${Math.round((passed / results.length) * 100)}%`,
    },
  };

  return report;
}

/**
 * Run a single scenario.
 */
export async function runScenario(
  env: TapestryEnvironment,
  scenario: ScenarioName,
  options: Omit<RunOptions, 'scenarios'> = {},
): Promise<ScenarioResult> {
  const report = await runUAT(env, { ...options, scenarios: [scenario] });
  const result = report.scenarios[0];
  if (!result) {
    throw new Error(`Scenario ${scenario} did not produce a result`);
  }
  return result;
}

// ============================================================================
// Display Functions
// ============================================================================

/**
 * Format a UAT report for console display.
 */
export function formatReport(report: UATReport): string {
  const lines: string[] = [];

  lines.push('═'.repeat(70));
  lines.push('  COMMS UAT Report');
  lines.push('═'.repeat(70));
  lines.push(`  Environment: ${report.environment}`);
  lines.push(`  Run ID: ${report.runId}`);
  lines.push(`  Started: ${report.startedAt}`);
  lines.push(`  Duration: ${report.duration}ms`);
  lines.push('─'.repeat(70));
  lines.push('  SCENARIO RESULTS');
  lines.push('─'.repeat(70));

  for (const result of report.scenarios) {
    const status = result.passed ? '✓' : '✗';
    const statusColor = result.passed ? 'PASSED' : 'FAILED';
    lines.push(`  ${status} ${result.scenario.padEnd(25)} ${statusColor.padEnd(10)} ${result.duration}ms`);

    // Show failed steps
    if (!result.passed) {
      for (const step of result.steps) {
        if (!step.passed) {
          lines.push(`      ✗ ${step.name}: ${step.error}`);
        }
      }
    }
  }

  lines.push('─'.repeat(70));
  lines.push('  SUMMARY');
  lines.push('─'.repeat(70));
  lines.push(`  Total: ${report.summary.total}`);
  lines.push(`  Passed: ${report.summary.passed}`);
  lines.push(`  Failed: ${report.summary.failed}`);
  lines.push(`  Pass Rate: ${report.summary.passRate}`);
  lines.push('═'.repeat(70));

  const overallStatus = report.summary.failed === 0 ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED';
  lines.push(`  ${overallStatus}`);
  lines.push('═'.repeat(70));

  return lines.join('\n');
}

/**
 * Format a UAT report as JSON.
 */
export function formatReportJSON(report: UATReport): string {
  return JSON.stringify(report, null, 2);
}

// ============================================================================
// Exports
// ============================================================================

export {
  // Setup
  setupUAT,
  cleanupAll,
  checkAllConnectivity,
  formatEnvironmentTable,
  formatConnectivityResults,
  // Types
  type UATContext,
  type ConnectivityResult,
  // Scenario runners (for individual use)
  runAgentLifecycleScenario,
  runRealtimeMessagingScenario,
  runAsyncMemosScenario,
  runEphemeralPastesScenario,
  runCrossMachineScenario,
  runSecurityScenario,
};

// Export all scenarios list
export { ALL_SCENARIOS };
