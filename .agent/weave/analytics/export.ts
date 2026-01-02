#!/usr/bin/env bun
/**
 * Weave Analytics Export Tool
 *
 * Exports analytics data in various formats for analysis.
 *
 * Usage:
 *   bun weave/analytics/export.ts summary           # Print session summary
 *   bun weave/analytics/export.ts prompts           # Export prompts for quality analysis
 *   bun weave/analytics/export.ts tools             # Tool usage patterns
 *   bun weave/analytics/export.ts files             # File change patterns
 *   bun weave/analytics/export.ts weave             # Export for Weave learning
 *   bun weave/analytics/export.ts --json            # Output as JSON
 *   bun weave/analytics/export.ts --since 7d       # Last 7 days only
 *
 * @module weave/analytics/export
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ============================================================================
// Configuration
// ============================================================================

const ANALYTICS_DIR = '.agent/weave/analytics';
const EVENTS_LOG = path.join(ANALYTICS_DIR, 'events.jsonl');
const SESSIONS_LOG = path.join(ANALYTICS_DIR, 'sessions.jsonl');
const PROMPTS_LOG = path.join(ANALYTICS_DIR, 'prompts.jsonl');

// ============================================================================
// Types
// ============================================================================

interface SessionMetrics {
  sessionId: string;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  promptCount: number;
  toolUseCount: number;
  toolsByName: Record<string, number>;
  filesEdited: string[];
  filesRead: string[];
  errorCount: number;
  model?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface PromptAnalytics {
  timestamp: string;
  sessionId: string;
  prompt: string;
  wordCount: number;
  charCount: number;
  hasQuestion: boolean;
  hasCodeReference: boolean;
  hasFileReference: boolean;
  hasContext: boolean;
  responseTimeMs?: number;
}

interface AnalyticsEvent {
  timestamp: string;
  eventType: string;
  sessionId: string;
  data: any;
}

// ============================================================================
// File Reading Utilities
// ============================================================================

async function readJsonlFile<T>(filePath: string, since?: Date): Promise<T[]> {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const results: T[] = [];
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (line.trim()) {
      try {
        const entry = JSON.parse(line) as T & { timestamp?: string };
        if (since && entry.timestamp) {
          const entryDate = new Date(entry.timestamp);
          if (entryDate < since) continue;
        }
        results.push(entry);
      } catch (e) {
        // Skip malformed lines
      }
    }
  }

  return results;
}

function parseSince(sinceArg: string): Date {
  const now = new Date();
  const match = sinceArg.match(/^(\d+)([dhwm])$/);
  if (!match) {
    throw new Error(`Invalid --since format: ${sinceArg}. Use: 7d, 24h, 2w, 1m`);
  }

  const [, num, unit] = match;
  const value = parseInt(num, 10);

  switch (unit) {
    case 'h': return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd': return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    case 'w': return new Date(now.getTime() - value * 7 * 24 * 60 * 60 * 1000);
    case 'm': return new Date(now.getTime() - value * 30 * 24 * 60 * 60 * 1000);
    default: throw new Error(`Unknown unit: ${unit}`);
  }
}

// ============================================================================
// Export Commands
// ============================================================================

async function exportSummary(since?: Date, asJson = false): Promise<void> {
  const sessions = await readJsonlFile<SessionMetrics>(SESSIONS_LOG, since);
  const events = await readJsonlFile<AnalyticsEvent>(EVENTS_LOG, since);

  const summary = {
    period: since ? `Since ${since.toISOString().split('T')[0]}` : 'All time',
    sessions: sessions.length,
    totalDuration: sessions.reduce((sum, s) => sum + (s.durationMs || 0), 0),
    totalPrompts: sessions.reduce((sum, s) => sum + s.promptCount, 0),
    totalToolUses: sessions.reduce((sum, s) => sum + s.toolUseCount, 0),
    totalTokens: sessions.reduce((sum, s) => sum + s.totalInputTokens + s.totalOutputTokens, 0),
    uniqueFilesEdited: [...new Set(sessions.flatMap(s => s.filesEdited))].length,
    uniqueFilesRead: [...new Set(sessions.flatMap(s => s.filesRead))].length,
    avgPromptsPerSession: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.promptCount, 0) / sessions.length) : 0,
    avgSessionDuration: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + (s.durationMs || 0), 0) / sessions.length / 60000) : 0,
  };

  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('\n=== Weave Analytics Summary ===\n');
  console.log(`Period: ${summary.period}`);
  console.log(`Sessions: ${summary.sessions}`);
  console.log(`Total Duration: ${Math.floor(summary.totalDuration / 60000)}m`);
  console.log(`Total Prompts: ${summary.totalPrompts}`);
  console.log(`Total Tool Uses: ${summary.totalToolUses}`);
  console.log(`Total Tokens: ${summary.totalTokens.toLocaleString()}`);
  console.log(`Unique Files Edited: ${summary.uniqueFilesEdited}`);
  console.log(`Unique Files Read: ${summary.uniqueFilesRead}`);
  console.log(`Avg Prompts/Session: ${summary.avgPromptsPerSession}`);
  console.log(`Avg Session Duration: ${summary.avgSessionDuration}m`);
}

async function exportPrompts(since?: Date, asJson = false): Promise<void> {
  const prompts = await readJsonlFile<PromptAnalytics>(PROMPTS_LOG, since);

  // Analyze prompt quality patterns
  const analysis = {
    totalPrompts: prompts.length,
    avgWordCount: prompts.length ? Math.round(prompts.reduce((sum, p) => sum + p.wordCount, 0) / prompts.length) : 0,
    withContext: prompts.filter(p => p.hasContext).length,
    withQuestions: prompts.filter(p => p.hasQuestion).length,
    withCodeReference: prompts.filter(p => p.hasCodeReference).length,
    withFileReference: prompts.filter(p => p.hasFileReference).length,
    shortPrompts: prompts.filter(p => p.wordCount < 10).length,
    longPrompts: prompts.filter(p => p.wordCount > 50).length,
    contextRate: prompts.length ? (prompts.filter(p => p.hasContext).length / prompts.length * 100).toFixed(1) : '0',
    // Sample prompts for quality review
    samples: {
      shortest: prompts.sort((a, b) => a.wordCount - b.wordCount).slice(0, 3).map(p => ({
        prompt: p.prompt.substring(0, 100),
        wordCount: p.wordCount,
      })),
      longest: prompts.sort((a, b) => b.wordCount - a.wordCount).slice(0, 3).map(p => ({
        prompt: p.prompt.substring(0, 100) + '...',
        wordCount: p.wordCount,
      })),
    },
  };

  if (asJson) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log('\n=== Prompt Quality Analysis ===\n');
  console.log(`Total Prompts: ${analysis.totalPrompts}`);
  console.log(`Avg Word Count: ${analysis.avgWordCount}`);
  console.log(`With Context ("because", etc): ${analysis.withContext} (${analysis.contextRate}%)`);
  console.log(`With Questions: ${analysis.withQuestions}`);
  console.log(`With Code References: ${analysis.withCodeReference}`);
  console.log(`With File References: ${analysis.withFileReference}`);
  console.log(`Short (<10 words): ${analysis.shortPrompts}`);
  console.log(`Long (>50 words): ${analysis.longPrompts}`);
  console.log('\nShortest prompts:');
  for (const s of analysis.samples.shortest) {
    console.log(`  - "${s.prompt}" (${s.wordCount} words)`);
  }
}

async function exportTools(since?: Date, asJson = false): Promise<void> {
  const sessions = await readJsonlFile<SessionMetrics>(SESSIONS_LOG, since);

  // Aggregate tool usage
  const toolUsage: Record<string, number> = {};
  for (const session of sessions) {
    for (const [tool, count] of Object.entries(session.toolsByName)) {
      toolUsage[tool] = (toolUsage[tool] || 0) + count;
    }
  }

  const sortedTools = Object.entries(toolUsage)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count, percent: (count / Object.values(toolUsage).reduce((a, b) => a + b, 0) * 100).toFixed(1) }));

  const analysis = {
    totalToolUses: Object.values(toolUsage).reduce((a, b) => a + b, 0),
    uniqueTools: Object.keys(toolUsage).length,
    tools: sortedTools,
  };

  if (asJson) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log('\n=== Tool Usage Patterns ===\n');
  console.log(`Total Tool Uses: ${analysis.totalToolUses}`);
  console.log(`Unique Tools: ${analysis.uniqueTools}`);
  console.log('\nBy frequency:');
  for (const t of sortedTools.slice(0, 15)) {
    console.log(`  ${t.tool.padEnd(20)} ${t.count.toString().padStart(5)} (${t.percent}%)`);
  }
}

async function exportFiles(since?: Date, asJson = false): Promise<void> {
  const sessions = await readJsonlFile<SessionMetrics>(SESSIONS_LOG, since);

  // Aggregate file patterns
  const filesEdited: Record<string, number> = {};
  const filesRead: Record<string, number> = {};

  for (const session of sessions) {
    for (const file of session.filesEdited) {
      filesEdited[file] = (filesEdited[file] || 0) + 1;
    }
    for (const file of session.filesRead) {
      filesRead[file] = (filesRead[file] || 0) + 1;
    }
  }

  const topEdited = Object.entries(filesEdited)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));

  const topRead = Object.entries(filesRead)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));

  // File type breakdown
  const editedByType: Record<string, number> = {};
  for (const file of Object.keys(filesEdited)) {
    const ext = path.extname(file) || 'no-ext';
    editedByType[ext] = (editedByType[ext] || 0) + filesEdited[file];
  }

  const analysis = {
    uniqueFilesEdited: Object.keys(filesEdited).length,
    uniqueFilesRead: Object.keys(filesRead).length,
    topEdited,
    topRead,
    editedByType: Object.entries(editedByType).sort((a, b) => b[1] - a[1]),
  };

  if (asJson) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log('\n=== File Change Patterns ===\n');
  console.log(`Unique Files Edited: ${analysis.uniqueFilesEdited}`);
  console.log(`Unique Files Read: ${analysis.uniqueFilesRead}`);
  console.log('\nMost edited files:');
  for (const f of topEdited.slice(0, 10)) {
    console.log(`  ${f.count.toString().padStart(3)}x ${f.file}`);
  }
  console.log('\nBy file type:');
  for (const [ext, count] of analysis.editedByType.slice(0, 10)) {
    console.log(`  ${ext.padEnd(10)} ${count}`);
  }
}

async function exportForWeave(since?: Date): Promise<void> {
  const sessions = await readJsonlFile<SessionMetrics>(SESSIONS_LOG, since);
  const prompts = await readJsonlFile<PromptAnalytics>(PROMPTS_LOG, since);
  const events = await readJsonlFile<AnalyticsEvent>(EVENTS_LOG, since);

  // Create a Weave-friendly export for learning
  const weaveExport = {
    exportedAt: new Date().toISOString(),
    period: since ? `Since ${since.toISOString()}` : 'All time',

    // Session patterns for Praxeology
    sessionPatterns: {
      avgDuration: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + (s.durationMs || 0), 0) / sessions.length / 60000) : 0,
      avgPrompts: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.promptCount, 0) / sessions.length) : 0,
      avgToolUses: sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.toolUseCount, 0) / sessions.length) : 0,
    },

    // Prompt patterns for Psyche/Prompt Coach
    promptPatterns: {
      avgWordCount: prompts.length ? Math.round(prompts.reduce((sum, p) => sum + p.wordCount, 0) / prompts.length) : 0,
      contextRate: prompts.length ? prompts.filter(p => p.hasContext).length / prompts.length : 0,
      questionRate: prompts.length ? prompts.filter(p => p.hasQuestion).length / prompts.length : 0,
      codeReferenceRate: prompts.length ? prompts.filter(p => p.hasCodeReference).length / prompts.length : 0,
      fileReferenceRate: prompts.length ? prompts.filter(p => p.hasFileReference).length / prompts.length : 0,
      shortPromptRate: prompts.length ? prompts.filter(p => p.wordCount < 10).length / prompts.length : 0,
    },

    // Tool patterns for Epistemology
    toolPatterns: (() => {
      const toolUsage: Record<string, number> = {};
      for (const session of sessions) {
        for (const [tool, count] of Object.entries(session.toolsByName)) {
          toolUsage[tool] = (toolUsage[tool] || 0) + count;
        }
      }
      return Object.entries(toolUsage)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tool, count]) => ({ tool, count }));
    })(),

    // File patterns for Ontology/Mereology
    filePatterns: {
      mostEdited: Object.entries(
        sessions.reduce((acc, s) => {
          for (const f of s.filesEdited) acc[f] = (acc[f] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1]).slice(0, 10),

      fileTypeDistribution: Object.entries(
        sessions.flatMap(s => s.filesEdited).reduce((acc, f) => {
          const ext = path.extname(f) || 'no-ext';
          acc[ext] = (acc[ext] || 0) + 1;
          return acc;
        }, {} as Record<string, number>)
      ).sort((a, b) => b[1] - a[1]),
    },

    // Raw data for deep analysis
    sessionCount: sessions.length,
    promptCount: prompts.length,
    eventCount: events.length,
  };

  console.log(JSON.stringify(weaveExport, null, 2));
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  const asJson = args.includes('--json');
  const sinceIdx = args.indexOf('--since');
  const since = sinceIdx >= 0 && args[sinceIdx + 1] ? parseSince(args[sinceIdx + 1]) : undefined;

  // Get command
  const command = args.find(a => !a.startsWith('--')) || 'summary';

  // Check if analytics exist
  if (!fs.existsSync(ANALYTICS_DIR)) {
    console.error(`No analytics data found at ${ANALYTICS_DIR}`);
    console.error('Run a session with the event-logger hook enabled first.');
    process.exit(1);
  }

  switch (command) {
    case 'summary':
      await exportSummary(since, asJson);
      break;
    case 'prompts':
      await exportPrompts(since, asJson);
      break;
    case 'tools':
      await exportTools(since, asJson);
      break;
    case 'files':
      await exportFiles(since, asJson);
      break;
    case 'weave':
      await exportForWeave(since);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available: summary, prompts, tools, files, weave');
      process.exit(1);
  }
}

main().catch(console.error);
