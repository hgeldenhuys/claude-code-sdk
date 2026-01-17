/**
 * Metrics Handler
 *
 * Collects and reports timing metrics for hook execution.
 * Useful for diagnosing performance issues.
 *
 * Output is written to stderr (or a log file) so it doesn't interfere
 * with hook output.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MetricsOptions } from '../config/types';
import type { HandlerDefinition, HandlerResult, PipelineContext } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface TimingMetric {
  timestamp: string;
  event: string;
  sessionId?: string;
  phase: string;
  durationMs: number;
  details?: Record<string, unknown>;
}

export interface AggregateStats {
  totalInvocations: number;
  totalDurationMs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  minDurationMs: number;
  byEvent: Record<string, {
    count: number;
    totalMs: number;
    avgMs: number;
    maxMs: number;
    minMs: number;
  }>;
  lastUpdated: string;
}

// ============================================================================
// Timing Utilities
// ============================================================================

// Capture the absolute earliest time we can
const PROCESS_START_TIME = performance.now();

/** High-resolution timer */
export function now(): number {
  return performance.now();
}

/** Format duration in ms with precision */
export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)}μs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(1)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Get the time since process started (in ms)
 */
export function getProcessAge(): number {
  return performance.now() - PROCESS_START_TIME;
}

/**
 * Get detailed startup breakdown
 */
export function getStartupBreakdown(): Record<string, number> {
  return {
    processInitMs: PROCESS_START_TIME,
    sinceInitMs: getProcessAge(),
  };
}

// ============================================================================
// Stats File Management
// ============================================================================

const DEFAULT_STATS_PATH = join(
  process.env.HOME || process.env.USERPROFILE || '',
  '.claude',
  'hook-metrics.json'
);

function loadStats(statsPath: string = DEFAULT_STATS_PATH): AggregateStats {
  if (!existsSync(statsPath)) {
    return createEmptyStats();
  }

  try {
    const content = readFileSync(statsPath, 'utf-8');
    return JSON.parse(content) as AggregateStats;
  } catch {
    return createEmptyStats();
  }
}

function saveStats(stats: AggregateStats, statsPath: string = DEFAULT_STATS_PATH): void {
  const dir = dirname(statsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(statsPath, JSON.stringify(stats, null, 2));
}

function createEmptyStats(): AggregateStats {
  return {
    totalInvocations: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    maxDurationMs: 0,
    minDurationMs: Number.MAX_VALUE,
    byEvent: {},
    lastUpdated: new Date().toISOString(),
  };
}

function updateStats(stats: AggregateStats, event: string, durationMs: number): void {
  stats.totalInvocations++;
  stats.totalDurationMs += durationMs;
  stats.avgDurationMs = stats.totalDurationMs / stats.totalInvocations;
  stats.maxDurationMs = Math.max(stats.maxDurationMs, durationMs);
  stats.minDurationMs = Math.min(stats.minDurationMs, durationMs);
  stats.lastUpdated = new Date().toISOString();

  if (!stats.byEvent[event]) {
    stats.byEvent[event] = {
      count: 0,
      totalMs: 0,
      avgMs: 0,
      maxMs: 0,
      minMs: Number.MAX_VALUE,
    };
  }

  const eventStats = stats.byEvent[event]!;
  eventStats.count++;
  eventStats.totalMs += durationMs;
  eventStats.avgMs = eventStats.totalMs / eventStats.count;
  eventStats.maxMs = Math.max(eventStats.maxMs, durationMs);
  eventStats.minMs = Math.min(eventStats.minMs, durationMs);
}

function formatMetricLog(metric: TimingMetric, warnThreshold: number): string {
  const duration = formatDuration(metric.durationMs);
  const warn = metric.durationMs > warnThreshold ? ' ⚠️ SLOW' : '';
  return `[metrics] ${metric.event}: ${duration}${warn}`;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create a metrics handler that tracks hook execution timing
 */
export function createMetricsHandler(options: MetricsOptions = {}): HandlerDefinition {
  const {
    logToStderr = true,
    logFile,
    detailed = false,
    warnThresholdMs = 100,
    collectStats = true,
  } = options;

  return {
    id: 'metrics',
    name: 'Metrics',
    description: 'Records timing metrics for hook execution performance analysis',
    priority: 1, // Run first to capture full timing
    enabled: true,
    handler: async (ctx: PipelineContext): Promise<HandlerResult> => {
      const totalTimeToHandler = now() - PROCESS_START_TIME;

      const metric: TimingMetric = {
        timestamp: new Date().toISOString(),
        event: ctx.eventType,
        sessionId: ctx.sessionId,
        phase: 'process-start-to-handler',
        durationMs: totalTimeToHandler,
      };

      if (detailed) {
        metric.details = {
          pid: process.pid,
          memoryUsage: process.memoryUsage().heapUsed,
          cwd: ctx.cwd,
        };
      }

      // Log the metric
      const logLine = formatMetricLog(metric, warnThresholdMs);

      if (logToStderr) {
        console.error(logLine);
      }

      if (logFile) {
        const dir = dirname(logFile);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        appendFileSync(logFile, JSON.stringify(metric) + '\n');
      }

      // Update aggregate stats
      if (collectStats) {
        try {
          const stats = loadStats();
          updateStats(stats, ctx.eventType, totalTimeToHandler);
          saveStats(stats);
        } catch (err) {
          // Don't fail the hook if stats update fails
          if (logToStderr) {
            console.error(`[metrics] Failed to update stats: ${err}`);
          }
        }
      }

      return {
        success: true,
        data: { timing: metric },
      };
    },
  };
}

// ============================================================================
// CLI for viewing stats
// ============================================================================

/**
 * Print aggregate stats to stdout
 */
export function printStats(statsPath?: string): void {
  const stats = loadStats(statsPath);

  if (stats.totalInvocations === 0) {
    console.log('No metrics collected yet.');
    return;
  }

  console.log('\n=== Hook Execution Metrics ===\n');
  console.log(`Total invocations: ${stats.totalInvocations}`);
  console.log(`Total time: ${formatDuration(stats.totalDurationMs)}`);
  console.log(`Average: ${formatDuration(stats.avgDurationMs)}`);
  console.log(`Min: ${formatDuration(stats.minDurationMs)}`);
  console.log(`Max: ${formatDuration(stats.maxDurationMs)}`);
  console.log(`Last updated: ${stats.lastUpdated}`);

  console.log('\n--- By Event ---\n');

  const events = Object.entries(stats.byEvent).sort((a, b) => b[1].avgMs - a[1].avgMs);

  for (const [event, eventStats] of events) {
    console.log(`${event}:`);
    console.log(`  Count: ${eventStats.count}`);
    console.log(`  Avg: ${formatDuration(eventStats.avgMs)}`);
    console.log(`  Min: ${formatDuration(eventStats.minMs)}`);
    console.log(`  Max: ${formatDuration(eventStats.maxMs)}`);
  }
}

/**
 * Reset aggregate stats
 */
export function resetStats(statsPath?: string): void {
  const path = statsPath || DEFAULT_STATS_PATH;
  saveStats(createEmptyStats(), path);
  console.log('Metrics reset.');
}

// ============================================================================
// Re-export types for external use
// ============================================================================

export type { MetricsOptions };
