#!/usr/bin/env bun
/**
 * Weave Analytics Event Logger
 *
 * Captures ALL hook events for post-session analysis and learning.
 * Data is stored in JSONL format for easy streaming analysis.
 *
 * Logs to: .agent/weave/analytics/events.jsonl
 *
 * What we capture:
 * - Session lifecycle (start, end, duration)
 * - User prompts (for prompt quality analysis)
 * - Tool usage patterns (what tools, how often, success rate)
 * - File changes (what files, how often)
 * - Errors and fixes (what broke, what fixed it)
 * - Response patterns (thinking, tool use, text)
 *
 * @module weave/analytics/event-logger
 */

import { HookManager } from 'claude-hooks-sdk';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const ANALYTICS_DIR = '.agent/weave/analytics';
const EVENTS_LOG = path.join(ANALYTICS_DIR, 'events.jsonl');
const SESSIONS_LOG = path.join(ANALYTICS_DIR, 'sessions.jsonl');
const PROMPTS_LOG = path.join(ANALYTICS_DIR, 'prompts.jsonl');

// Ensure directories exist
if (!fs.existsSync(ANALYTICS_DIR)) {
  fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
}

// ============================================================================
// Types
// ============================================================================

interface AnalyticsEvent {
  timestamp: string;
  eventType: string;
  sessionId: string;
  data: any;
}

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

// ============================================================================
// State
// ============================================================================

let currentSession: SessionMetrics | null = null;
let lastPromptTime: number | null = null;

// ============================================================================
// Logging Functions
// ============================================================================

function logEvent(eventType: string, sessionId: string, data: any): void {
  const event: AnalyticsEvent = {
    timestamp: new Date().toISOString(),
    eventType,
    sessionId,
    data,
  };
  fs.appendFileSync(EVENTS_LOG, JSON.stringify(event) + '\n');
}

function logSession(session: SessionMetrics): void {
  fs.appendFileSync(SESSIONS_LOG, JSON.stringify(session) + '\n');
}

function logPrompt(analytics: PromptAnalytics): void {
  fs.appendFileSync(PROMPTS_LOG, JSON.stringify(analytics) + '\n');
}

function analyzePrompt(prompt: string): Omit<PromptAnalytics, 'timestamp' | 'sessionId' | 'prompt' | 'responseTimeMs'> {
  return {
    wordCount: prompt.split(/\s+/).length,
    charCount: prompt.length,
    hasQuestion: /\?/.test(prompt),
    hasCodeReference: /`[^`]+`/.test(prompt) || /```/.test(prompt),
    hasFileReference: /\b\w+\.(ts|js|tsx|jsx|py|go|rs|json|md)\b/i.test(prompt),
    hasContext: /\b(because|since|context|background|goal)\b/i.test(prompt),
  };
}

// ============================================================================
// Hook Manager Setup
// ============================================================================

const manager = new HookManager({
  clientId: 'weave-analytics',
  logEvents: false,
});

// ----------------------------------------------------------------------------
// Session Start
// ----------------------------------------------------------------------------

manager.onSessionStart(async (input) => {
  const sessionId = input.session_id || `unknown-${Date.now()}`;

  currentSession = {
    sessionId,
    startTime: new Date().toISOString(),
    promptCount: 0,
    toolUseCount: 0,
    toolsByName: {},
    filesEdited: [],
    filesRead: [],
    errorCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  logEvent('session_start', sessionId, {
    source: input.source,
    cwd: input.cwd,
  });

  console.error(`[weave-analytics] Session started: ${sessionId.substring(0, 8)}`);
});

// ----------------------------------------------------------------------------
// User Prompt Submit
// ----------------------------------------------------------------------------

manager.onUserPromptSubmit(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const prompt = input.prompt || '';

  lastPromptTime = Date.now();

  if (currentSession) {
    currentSession.promptCount++;
  }

  const analysis = analyzePrompt(prompt);

  logEvent('user_prompt', sessionId, {
    promptLength: prompt.length,
    ...analysis,
  });

  // Log full prompt for later analysis (separate file for privacy control)
  logPrompt({
    timestamp: new Date().toISOString(),
    sessionId,
    prompt,
    ...analysis,
  });
});

// ----------------------------------------------------------------------------
// Pre Tool Use
// ----------------------------------------------------------------------------

manager.onPreToolUse(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const toolName = input.tool_name || 'unknown';

  logEvent('tool_use_start', sessionId, {
    tool: toolName,
    // Don't log full input to avoid bloat - just key info
    inputKeys: Object.keys(input.tool_input || {}),
  });

  return { continue: true };
});

// ----------------------------------------------------------------------------
// Post Tool Use
// ----------------------------------------------------------------------------

manager.onPostToolUse(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const toolName = input.tool_name || 'unknown';
  const toolInput = input.tool_input || {};

  if (currentSession) {
    currentSession.toolUseCount++;
    currentSession.toolsByName[toolName] = (currentSession.toolsByName[toolName] || 0) + 1;

    // Track file operations
    if (toolName === 'Edit' || toolName === 'Write') {
      const filePath = toolInput.file_path;
      if (filePath && !currentSession.filesEdited.includes(filePath)) {
        currentSession.filesEdited.push(filePath);
      }
    } else if (toolName === 'Read') {
      const filePath = toolInput.file_path;
      if (filePath && !currentSession.filesRead.includes(filePath)) {
        currentSession.filesRead.push(filePath);
      }
    }
  }

  logEvent('tool_use_end', sessionId, {
    tool: toolName,
    success: !input.tool_error,
    error: input.tool_error ? String(input.tool_error).substring(0, 200) : undefined,
  });
});

// ----------------------------------------------------------------------------
// Stop (Response Complete)
// ----------------------------------------------------------------------------

manager.onStop(async (input, context) => {
  const sessionId = input.session_id || 'unknown';
  const stopReason = input.stop_hook_reason || 'unknown';

  // Calculate response time
  const responseTimeMs = lastPromptTime ? Date.now() - lastPromptTime : undefined;

  try {
    // Get transcript for usage stats
    const transcript = await context.getFullTranscript();
    if (transcript.length > 0) {
      const lastLine = transcript[transcript.length - 1];
      if (lastLine.content?.message) {
        const message = lastLine.content.message;

        // Update token counts
        if (currentSession && message.usage) {
          currentSession.totalInputTokens += message.usage.input_tokens || 0;
          currentSession.totalOutputTokens += message.usage.output_tokens || 0;
          currentSession.model = message.model;
        }

        // Count content types
        let textBlocks = 0;
        let thinkingBlocks = 0;
        let toolUseBlocks = 0;

        for (const content of message.content || []) {
          if (content.type === 'text') textBlocks++;
          else if (content.type === 'thinking') thinkingBlocks++;
          else if (content.type === 'tool_use') toolUseBlocks++;
        }

        logEvent('response_complete', sessionId, {
          stopReason,
          responseTimeMs,
          textBlocks,
          thinkingBlocks,
          toolUseBlocks,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
          model: message.model,
        });
      }
    }
  } catch (error) {
    // Transcript read failed - log what we can
    logEvent('response_complete', sessionId, {
      stopReason,
      responseTimeMs,
      transcriptError: true,
    });
  }
});

// ----------------------------------------------------------------------------
// Session End
// ----------------------------------------------------------------------------

manager.onSessionEnd(async (input) => {
  const sessionId = input.session_id || 'unknown';

  if (currentSession) {
    currentSession.endTime = new Date().toISOString();
    currentSession.durationMs = Date.now() - new Date(currentSession.startTime).getTime();

    logSession(currentSession);

    logEvent('session_end', sessionId, {
      reason: input.reason,
      duration: currentSession.durationMs,
      promptCount: currentSession.promptCount,
      toolUseCount: currentSession.toolUseCount,
      filesEdited: currentSession.filesEdited.length,
      filesRead: currentSession.filesRead.length,
      totalTokens: currentSession.totalInputTokens + currentSession.totalOutputTokens,
    });

    // Print summary
    const durationMin = Math.floor(currentSession.durationMs / 60000);
    const durationSec = Math.floor((currentSession.durationMs % 60000) / 1000);

    console.error(`\n[weave-analytics] Session Summary`);
    console.error(`  Duration: ${durationMin}m ${durationSec}s`);
    console.error(`  Prompts: ${currentSession.promptCount}`);
    console.error(`  Tool uses: ${currentSession.toolUseCount}`);
    console.error(`  Files edited: ${currentSession.filesEdited.length}`);
    console.error(`  Files read: ${currentSession.filesRead.length}`);
    console.error(`  Tokens: ${currentSession.totalInputTokens + currentSession.totalOutputTokens}`);
    console.error(`  Logs: ${ANALYTICS_DIR}/`);
  }

  currentSession = null;
});

// ============================================================================
// Run
// ============================================================================

manager.run();
