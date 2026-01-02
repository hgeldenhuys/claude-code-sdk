#!/usr/bin/env bun
/**
 * Weave Analytics Hook
 *
 * Comprehensive event logging for field testing and learning.
 * Captures all hook events to .agent/weave/analytics/ for analysis.
 *
 * This is the unified analytics hook - replaces separate conversation-logger.
 *
 * Usage:
 *   Add to .claude/settings.json hooks for all events
 *   Export data with: bun .agent/weave/analytics/export.ts
 *
 * @module hooks/weave-analytics
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

// ============================================================================
// State
// ============================================================================

let currentSession: SessionMetrics | null = null;
let lastPromptTime: number | null = null;

// ============================================================================
// Logging Functions
// ============================================================================

function logEvent(eventType: string, sessionId: string, data: any): void {
  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    sessionId,
    data,
  };
  fs.appendFileSync(EVENTS_LOG, JSON.stringify(entry) + '\n');
}

function logSession(session: SessionMetrics): void {
  fs.appendFileSync(SESSIONS_LOG, JSON.stringify(session) + '\n');
}

function logPrompt(sessionId: string, prompt: string): void {
  const entry = {
    timestamp: new Date().toISOString(),
    sessionId,
    prompt,
    wordCount: prompt.split(/\s+/).length,
    charCount: prompt.length,
    hasQuestion: /\?/.test(prompt),
    hasCodeReference: /`[^`]+`/.test(prompt) || /```/.test(prompt),
    hasFileReference: /\b\w+\.(ts|js|tsx|jsx|py|go|rs|json|md)\b/i.test(prompt),
    hasContext: /\b(because|since|context|background|goal)\b/i.test(prompt),
  };
  fs.appendFileSync(PROMPTS_LOG, JSON.stringify(entry) + '\n');
}

// ============================================================================
// Hook Manager
// ============================================================================

const manager = new HookManager({
  clientId: 'weave-analytics',
  logEvents: false,
});

// Session Start
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
});

// User Prompt
manager.onUserPromptSubmit(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const prompt = input.prompt || '';

  lastPromptTime = Date.now();

  if (currentSession) {
    currentSession.promptCount++;
  }

  logEvent('user_prompt', sessionId, {
    promptLength: prompt.length,
    wordCount: prompt.split(/\s+/).length,
  });

  // Log full prompt separately
  logPrompt(sessionId, prompt);
});

// Pre Tool Use
manager.onPreToolUse(async (input) => {
  const sessionId = input.session_id || 'unknown';
  const toolName = input.tool_name || 'unknown';

  logEvent('tool_start', sessionId, {
    tool: toolName,
  });

  return { continue: true };
});

// Post Tool Use
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

    // Track errors
    if (input.tool_error) {
      currentSession.errorCount++;
    }
  }

  logEvent('tool_end', sessionId, {
    tool: toolName,
    success: !input.tool_error,
  });
});

// Stop (Response Complete)
manager.onStop(async (input, context) => {
  const sessionId = input.session_id || 'unknown';
  const responseTimeMs = lastPromptTime ? Date.now() - lastPromptTime : undefined;

  try {
    const transcript = await context.getFullTranscript();
    if (transcript.length > 0) {
      const lastLine = transcript[transcript.length - 1];
      if (lastLine.content?.message) {
        const message = lastLine.content.message;

        if (currentSession && message.usage) {
          currentSession.totalInputTokens += message.usage.input_tokens || 0;
          currentSession.totalOutputTokens += message.usage.output_tokens || 0;
          currentSession.model = message.model;
        }

        logEvent('response', sessionId, {
          responseTimeMs,
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
          model: message.model,
        });
      }
    }
  } catch (error) {
    logEvent('response', sessionId, { responseTimeMs, error: true });
  }
});

// Session End
manager.onSessionEnd(async (input) => {
  const sessionId = input.session_id || 'unknown';

  if (currentSession) {
    currentSession.endTime = new Date().toISOString();
    currentSession.durationMs = Date.now() - new Date(currentSession.startTime).getTime();

    logSession(currentSession);

    logEvent('session_end', sessionId, {
      reason: input.reason,
      duration: currentSession.durationMs,
      prompts: currentSession.promptCount,
      tools: currentSession.toolUseCount,
      tokens: currentSession.totalInputTokens + currentSession.totalOutputTokens,
    });

    // Summary to stderr (visible to user)
    const min = Math.floor(currentSession.durationMs / 60000);
    const sec = Math.floor((currentSession.durationMs % 60000) / 1000);
    console.error(`[weave] Session: ${min}m${sec}s, ${currentSession.promptCount} prompts, ${currentSession.toolUseCount} tools`);
  }

  currentSession = null;
});

manager.run();
