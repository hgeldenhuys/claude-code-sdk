#!/usr/bin/env bun
/**
 * Hook Framework Benchmark
 *
 * Measures the performance of hook framework initialization and execution.
 * Useful for diagnosing slowness issues.
 *
 * Usage:
 *   bun run bin/hooks-benchmark.ts
 *   bun run bin/hooks-benchmark.ts --iterations 10
 *   bun run bin/hooks-benchmark.ts --config ./hooks.yaml
 */

const PROCESS_START = performance.now();

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// Timing helpers
// ============================================================================

interface Timing {
  label: string;
  start: number;
  end?: number;
  durationMs?: number;
}

const timings: Timing[] = [];

function startTiming(label: string): number {
  const idx = timings.length;
  timings.push({ label, start: performance.now() });
  return idx;
}

function endTiming(idx: number): void {
  const t = timings[idx];
  if (t) {
    t.end = performance.now();
    t.durationMs = t.end - t.start;
  }
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ============================================================================
// Main benchmark
// ============================================================================

async function runBenchmark(configPath?: string, iterations: number = 5): Promise<void> {
  console.log('Hook Framework Benchmark');
  console.log('========================\n');

  // -------------------------------------------------------------------------
  // Phase 1: Measure import times
  // -------------------------------------------------------------------------
  console.log('Phase 1: Measuring import times...\n');

  const importStart = performance.now();

  const t1 = startTiming('Import: config loader');
  const { loadResolvedConfig, getConfigPath } = await import('../src/hooks/framework/config');
  endTiming(t1);

  const t2 = startTiming('Import: framework');
  const { createFramework, HookFramework } = await import('../src/hooks/framework');
  endTiming(t2);

  const t3 = startTiming('Import: handlers');
  const { createHandlerFromConfig, isBuiltinHandler, getDefaultEvents } = await import(
    '../src/hooks/framework/handlers'
  );
  endTiming(t3);

  const t4 = startTiming('Import: session store');
  const { getSessionStore, SessionStore } = await import('../src/hooks/sessions');
  endTiming(t4);

  const importEnd = performance.now();
  console.log(`  Total import time: ${formatMs(importEnd - importStart)}`);
  for (const t of timings) {
    if (t.durationMs !== undefined) {
      console.log(`    ${t.label}: ${formatMs(t.durationMs)}`);
    }
  }
  console.log('');

  // -------------------------------------------------------------------------
  // Phase 2: Measure config loading
  // -------------------------------------------------------------------------
  console.log('Phase 2: Measuring config loading...\n');

  const resolvedConfigPath = configPath || getConfigPath();
  if (!resolvedConfigPath) {
    console.log('  No config file found. Skipping config loading benchmark.\n');
  } else {
    console.log(`  Config path: ${resolvedConfigPath}\n`);

    const configTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const config = loadResolvedConfig(resolvedConfigPath);
      const end = performance.now();
      configTimes.push(end - start);
    }

    const avg = configTimes.reduce((a, b) => a + b, 0) / configTimes.length;
    const min = Math.min(...configTimes);
    const max = Math.max(...configTimes);

    console.log(`  Config loading (${iterations} iterations):`);
    console.log(`    Avg: ${formatMs(avg)}`);
    console.log(`    Min: ${formatMs(min)}`);
    console.log(`    Max: ${formatMs(max)}`);
    console.log('');
  }

  // -------------------------------------------------------------------------
  // Phase 3: Measure SessionStore initialization
  // -------------------------------------------------------------------------
  console.log('Phase 3: Measuring SessionStore initialization...\n');

  const storeTimes: number[] = [];
  const storeTimesSkipReg: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // With machine registration
    const start1 = performance.now();
    const store1 = new SessionStore();
    const end1 = performance.now();
    storeTimes.push(end1 - start1);

    // Without machine registration (optimized)
    const start2 = performance.now();
    const store2 = new SessionStore({ skipMachineRegistration: true });
    const end2 = performance.now();
    storeTimesSkipReg.push(end2 - start2);
  }

  const avgStore = storeTimes.reduce((a, b) => a + b, 0) / storeTimes.length;
  const avgStoreSkip = storeTimesSkipReg.reduce((a, b) => a + b, 0) / storeTimesSkipReg.length;

  console.log(`  SessionStore (${iterations} iterations):`);
  console.log(`    With registration:    Avg: ${formatMs(avgStore)}`);
  console.log(`    Skip registration:    Avg: ${formatMs(avgStoreSkip)}`);
  console.log(`    Savings:              ${formatMs(avgStore - avgStoreSkip)} (${((1 - avgStoreSkip / avgStore) * 100).toFixed(1)}%)`);
  console.log('');

  // -------------------------------------------------------------------------
  // Phase 4: Measure framework initialization
  // -------------------------------------------------------------------------
  console.log('Phase 4: Measuring HookFramework initialization...\n');

  const frameworkTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const framework = createFramework({ debug: false });
    const end = performance.now();
    frameworkTimes.push(end - start);
  }

  const avgFramework = frameworkTimes.reduce((a, b) => a + b, 0) / frameworkTimes.length;

  console.log(`  Framework creation (${iterations} iterations):`);
  console.log(`    Avg: ${formatMs(avgFramework)}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Phase 5: Measure full hook execution (simulated)
  // -------------------------------------------------------------------------
  console.log('Phase 5: Measuring simulated hook execution...\n');

  const simulatedEvent = {
    session_id: 'test-session-123',
    cwd: process.cwd(),
    hook_event_name: 'SessionStart',
    is_resume: false,
    permissions_mode: 'default',
  };

  const execTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();

    // Simulate what the hook framework does
    const framework = createFramework({ debug: false });
    const result = await framework.execute('SessionStart', simulatedEvent);

    const end = performance.now();
    execTimes.push(end - start);
  }

  const avgExec = execTimes.reduce((a, b) => a + b, 0) / execTimes.length;

  console.log(`  Full execution (${iterations} iterations):`);
  console.log(`    Avg: ${formatMs(avgExec)}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const totalTime = performance.now() - PROCESS_START;

  console.log('='.repeat(50));
  console.log('SUMMARY');
  console.log('='.repeat(50) + '\n');

  console.log(`Total benchmark time: ${formatMs(totalTime)}`);
  console.log('');
  console.log('Breakdown per hook invocation (estimated):');
  console.log(`  Process startup + imports: ~${formatMs(importEnd - PROCESS_START)}`);
  console.log(`  Config loading:            ~${formatMs(resolvedConfigPath ? (storeTimes.reduce((a, b) => a + b, 0) / storeTimes.length) : 0)}`);
  console.log(`  SessionStore init:         ~${formatMs(avgStore)}`);
  console.log(`  Framework init:            ~${formatMs(avgFramework)}`);
  console.log('');
  console.log('Recommendations:');

  if (avgStore > 10) {
    console.log('  ⚠️  SessionStore is slow. Consider using skipMachineRegistration.');
  }

  if (resolvedConfigPath && storeTimes.length > 0) {
    const configAvg = storeTimes.reduce((a, b) => a + b, 0) / storeTimes.length;
    if (configAvg > 20) {
      console.log('  ⚠️  Config loading is slow. Consider simplifying hooks.yaml.');
    }
  }

  const estimatedTotal = (importEnd - PROCESS_START) + avgStore + avgFramework;
  if (estimatedTotal > 100) {
    console.log('  ⚠️  Total hook overhead is high (>100ms).');
    console.log('      Consider using a long-running daemon instead of spawning per-hook.');
  } else {
    console.log('  ✓  Hook overhead is acceptable (<100ms per invocation).');
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(): { configPath?: string; iterations: number } {
  const args = process.argv.slice(2);
  let configPath: string | undefined;
  let iterations = 5;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' || arg === '-c') {
      configPath = args[++i];
    } else if (arg === '--iterations' || arg === '-n') {
      iterations = parseInt(args[++i] || '5', 10);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Hook Framework Benchmark

Usage:
  bun run bin/hooks-benchmark.ts [options]

Options:
  -c, --config <path>     Path to hooks.yaml config file
  -n, --iterations <n>    Number of iterations for each benchmark (default: 5)
  -h, --help              Show this help
`);
      process.exit(0);
    }
  }

  return { configPath, iterations };
}

const args = parseArgs();
runBenchmark(args.configPath, args.iterations).catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
