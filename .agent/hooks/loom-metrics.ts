#!/usr/bin/env bun
/**
 * Loom Automatic Metrics Hook
 *
 * Tracks key Loom 2.0 metrics automatically via hooks:
 * - Actor spawns (Task tool calls with actor types)
 * - Direct implementation edits (potential violations)
 * - Delegation rate (spawns / total implementation changes)
 * - Circuit breaker triggers
 *
 * Metrics are stored in .agent/loom/metrics/ for analysis.
 *
 * @module hooks/loom-metrics
 */

import { HookManager } from 'claude-hooks-sdk';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const METRICS_DIR = '.agent/loom/metrics';
const SPAWNS_LOG = path.join(METRICS_DIR, 'actor-spawns.jsonl');
const EDITS_LOG = path.join(METRICS_DIR, 'implementation-edits.jsonl');
const DAILY_SUMMARY = path.join(METRICS_DIR, 'daily-summary.json');

// Ensure directory exists
if (!fs.existsSync(METRICS_DIR)) {
  fs.mkdirSync(METRICS_DIR, { recursive: true });
}

// ============================================================================
// Actor Detection
// ============================================================================

/**
 * Known actor types from Loom 2.0
 */
const IMPLEMENTATION_ACTORS = [
  'architect',
  'backend-dev',
  'frontend-dev',
  'qa-engineer',
  'devops',
  'tech-writer',
];

/**
 * Workflow orchestration agents
 */
const WORKFLOW_AGENTS = [
  'loom-executor',
  'loom-planner',
  'loom-ideator',
  'loom-finalizer',
];

/**
 * All trackable agent types
 */
const ALL_AGENT_TYPES = [...IMPLEMENTATION_ACTORS, ...WORKFLOW_AGENTS];

/**
 * Extract actor type from Task tool call
 */
function extractActorType(toolInput: any): string | null {
  const subagentType = toolInput.subagent_type || '';
  const prompt = toolInput.prompt || '';
  const description = toolInput.description || '';

  // Direct subagent_type match (most reliable)
  if (ALL_AGENT_TYPES.includes(subagentType)) {
    return subagentType;
  }

  // Check prompt/description for agent keywords
  const searchText = `${prompt} ${description}`.toLowerCase();

  // Check all known agent types
  for (const agentType of ALL_AGENT_TYPES) {
    if (searchText.includes(agentType.replace('-', ' ')) || searchText.includes(agentType)) {
      return agentType;
    }
  }

  // Check for architect indicators
  if (searchText.includes('design') || searchText.includes('architect')) {
    return 'architect';
  }

  // Check for QA indicators
  if (searchText.includes('test') || searchText.includes('qa') || searchText.includes('validate')) {
    return 'qa-engineer';
  }

  // Check for workflow agent indicators
  if (searchText.includes('ideate') || searchText.includes('ideation')) {
    return 'loom-ideator';
  }
  if (searchText.includes('plan') || searchText.includes('planning')) {
    return 'loom-planner';
  }
  if (searchText.includes('execute') || searchText.includes('execution')) {
    return 'loom-executor';
  }
  if (searchText.includes('finalize') || searchText.includes('retrospective')) {
    return 'loom-finalizer';
  }

  // If it's a Task tool call but we can't identify the type, still track it
  return 'unknown-agent';
}

/**
 * Check if a file path is an implementation file
 */
function isImplementationPath(filePath: string): boolean {
  const implementationPatterns = [
    /^src\//,
    /^app\//,
    /^packages\//,
    /^apps\//,
    /^lib\//,
    /\.(ts|tsx|js|jsx)$/,
  ];

  const normalizedPath = filePath.replace(/^\/Users\/[^/]+\/[^/]+\/[^/]+\//, '');

  // Exclude domain memory and coordination files
  if (
    normalizedPath.startsWith('.agent/') ||
    normalizedPath.startsWith('.claude/') ||
    normalizedPath.endsWith('.md')
  ) {
    return false;
  }

  return implementationPatterns.some((pattern) => pattern.test(normalizedPath));
}

// ============================================================================
// Metrics Storage
// ============================================================================

interface DailySummary {
  date: string;
  actorSpawns: number;
  actorsByType: Record<string, number>;
  implementationEdits: number;
  directEdits: number;
  delegatedEdits: number;
  delegationRate: number;
  violations: number;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function loadDailySummary(): Record<string, DailySummary> {
  try {
    if (fs.existsSync(DAILY_SUMMARY)) {
      return JSON.parse(fs.readFileSync(DAILY_SUMMARY, 'utf-8'));
    }
  } catch {
    // Ignore errors, start fresh
  }
  return {};
}

function saveDailySummary(summary: Record<string, DailySummary>): void {
  fs.writeFileSync(DAILY_SUMMARY, JSON.stringify(summary, null, 2));
}

function getOrCreateTodaySummary(): DailySummary {
  const summaries = loadDailySummary();
  const today = getTodayKey();

  if (!summaries[today]) {
    summaries[today] = {
      date: today,
      actorSpawns: 0,
      actorsByType: {},
      implementationEdits: 0,
      directEdits: 0,
      delegatedEdits: 0,
      delegationRate: 0,
      violations: 0,
    };
  }

  return summaries[today];
}

function updateDailySummary(updater: (summary: DailySummary) => void): void {
  const summaries = loadDailySummary();
  const today = getTodayKey();

  if (!summaries[today]) {
    summaries[today] = {
      date: today,
      actorSpawns: 0,
      actorsByType: {},
      implementationEdits: 0,
      directEdits: 0,
      delegatedEdits: 0,
      delegationRate: 0,
      violations: 0,
    };
  }

  updater(summaries[today]);

  // Recalculate delegation rate
  const total = summaries[today].directEdits + summaries[today].delegatedEdits;
  summaries[today].delegationRate = total > 0 ? summaries[today].delegatedEdits / total : 0;

  saveDailySummary(summaries);
}

// ============================================================================
// Logging Functions
// ============================================================================

function logActorSpawn(
  sessionId: string,
  actorType: string,
  taskIds: string[],
  description: string
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId,
    actorType,
    taskIds,
    description,
  };

  fs.appendFileSync(SPAWNS_LOG, JSON.stringify(entry) + '\n');

  updateDailySummary((summary) => {
    summary.actorSpawns++;
    summary.actorsByType[actorType] = (summary.actorsByType[actorType] || 0) + 1;
  });
}

function logImplementationEdit(
  sessionId: string,
  toolName: string,
  filePath: string,
  isDelegated: boolean
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId,
    toolName,
    filePath,
    isDelegated,
    isActorSession: !!process.env.LOOM_ACTOR_TYPE,
  };

  fs.appendFileSync(EDITS_LOG, JSON.stringify(entry) + '\n');

  updateDailySummary((summary) => {
    summary.implementationEdits++;
    if (isDelegated || process.env.LOOM_ACTOR_TYPE) {
      summary.delegatedEdits++;
    } else {
      summary.directEdits++;
    }
  });
}

// ============================================================================
// Hook Manager
// ============================================================================

// Debug mode - set to true to see hook activity
const DEBUG = process.env.LOOM_METRICS_DEBUG === 'true';

function debug(msg: string, data?: any): void {
  if (DEBUG) {
    console.error(`[loom-metrics:debug] ${msg}`, data ? JSON.stringify(data) : '');
  }
}

const manager = new HookManager({
  clientId: 'loom-metrics',
  logEvents: false,
});

/**
 * Post-Tool Use: Track metrics after tool execution
 */
manager.onPostToolUse(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};

  debug('PostToolUse received', { toolName, sessionId });

  // Track Task tool calls (actor spawns)
  if (toolName === 'Task') {
    debug('Task tool detected', { subagent_type: toolInput.subagent_type, description: toolInput.description });
    const actorType = extractActorType(toolInput);
    debug('Actor type extracted', { actorType });

    if (actorType) {
      const description = toolInput.description || '';
      const prompt = toolInput.prompt || '';

      // Try to extract task IDs from prompt
      const taskIdMatches = prompt.match(/T-\d{3}/g) || [];

      logActorSpawn(sessionId, actorType, taskIdMatches, description);

      // Summary to stderr
      console.error(`[loom-metrics] Actor spawn: ${actorType} (${taskIdMatches.length} tasks)`);
    }
  }

  // Track Edit/Write to implementation files
  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || toolInput.path || '';

    if (filePath && isImplementationPath(filePath)) {
      // Check if this is from an Actor session
      const isDelegated = !!process.env.LOOM_ACTOR_TYPE;

      logImplementationEdit(sessionId, toolName, filePath, isDelegated);

      if (!isDelegated) {
        console.error(`[loom-metrics] Direct edit: ${filePath}`);
      }
    }
  }
});

/**
 * Session End: Print daily summary
 */
manager.onSessionEnd(async (_input) => {
  const summary = getOrCreateTodaySummary();

  if (summary.actorSpawns > 0 || summary.implementationEdits > 0) {
    console.error(`
[loom-metrics] Daily Summary (${summary.date}):
  Actor Spawns: ${summary.actorSpawns}
  Implementation Edits: ${summary.implementationEdits}
  Delegation Rate: ${(summary.delegationRate * 100).toFixed(1)}%
  Direct Edits: ${summary.directEdits}
`);
  }
});

manager.run();
