#!/usr/bin/env bun
/**
 * Conversation Logger Hook
 *
 * Logs all conversations from all sessions to a unified log file
 * Each session gets a unique ID for color-coding in the viewer
 *
 * Logs to: .claude/logs/conversation.jsonl
 */

import { HookManager } from 'claude-hooks-sdk';
import * as fs from 'fs';
import * as path from 'path';

const LOG_PATH = '.claude/logs/conversation.jsonl';

// Ensure log directory exists
const logDir = path.dirname(LOG_PATH);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Helper to write JSONL log entries
function log(event: string, data: any) {
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
}

const manager = new HookManager({
  clientId: 'conversation-logger',
  logEvents: false,
});

// Track session start
manager.onSessionStart(async (input) => {
  log('session_start', {
    session_id: input.session_id,
    source: input.source,
  });
});

// Track user prompts
manager.onUserPromptSubmit(async (input) => {
  log('user_message', {
    session_id: input.session_id,
    content: input.prompt,
  });
});

// Track assistant responses
manager.onStop(async (input, context) => {
  try {
    // Get last assistant message from transcript
    const transcript = await context.getFullTranscript();
    if (transcript.length > 0) {
      const lastLine = transcript[transcript.length - 1];

      if (lastLine.content?.message && lastLine.content.message.role === 'assistant') {
        const message = lastLine.content.message;

        // Extract text, thinking, and tool uses
        const textContent: string[] = [];
        const thinkingContent: string[] = [];
        const toolUses: any[] = [];

        for (const content of message.content || []) {
          if (content.type === 'text') {
            textContent.push(content.text);
          } else if (content.type === 'thinking') {
            thinkingContent.push(content.thinking);
          } else if (content.type === 'tool_use') {
            toolUses.push({
              name: content.name,
              description: content.input?.description,
            });
          }
        }

        log('assistant_message', {
          session_id: input.session_id,
          text: textContent.join('\n'),
          thinking: thinkingContent.length > 0 ? thinkingContent.join('\n') : undefined,
          tools: toolUses.length > 0 ? toolUses : undefined,
          model: message.model,
          usage: message.usage,
        });
      }
    }
  } catch (error) {
    // Transcript read failed - skip
  }
});

// Track session end
manager.onSessionEnd(async (input) => {
  log('session_end', {
    session_id: input.session_id,
    reason: input.reason,
  });
});

manager.run();
