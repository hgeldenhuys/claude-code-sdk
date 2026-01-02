#!/usr/bin/env bun
/**
 * Unified Conversation Viewer
 *
 * Shows all sessions in one stream with color-coded borders
 * Each unique session gets assigned a color (cycling through 10 colors)
 * Displays user-friendly session names when available
 *
 * Usage:
 *   tail -f .claude/logs/conversation.jsonl | bun .claude/scripts/conversation-viewer.ts
 *
 * Note: Uses ANSI codes directly (no external dependencies)
 */

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  italic: '\x1b[3m',

  // Foreground colors
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  greenBright: '\x1b[92m',
  blueBright: '\x1b[94m',
};

// Terminal colors for sessions (max 10)
const SESSION_COLORS = [
  colors.cyan,
  colors.green,
  colors.yellow,
  colors.blue,
  colors.magenta,
  colors.red,
  colors.white,
  colors.gray,
  colors.greenBright,
  colors.blueBright,
];

// Simple hash function for deterministic color assignment
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getSessionColor(sessionId: string): string {
  const colorIndex = hashString(sessionId) % SESSION_COLORS.length;
  return SESSION_COLORS[colorIndex];
}

function colorize(text: string, color: string): string {
  return `${color}${text}${colors.reset}`;
}

function formatBorder(sessionId: string, text: string): string {
  const color = getSessionColor(sessionId);
  const lines = text.split('\n');
  return lines.map(line => colorize('│ ', color) + line).join('\n');
}

// Try to get session name from sessions.json
function getSessionName(sessionId: string): string | null {
  try {
    const fs = require('fs');
    const path = require('path');
    const sessionsPath = path.join(process.cwd(), '.claude', 'sessions.json');
    if (fs.existsSync(sessionsPath)) {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf-8'));
      return sessions[sessionId]?.name || null;
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function formatSessionDivider(sessionId: string, source: string): void {
  const color = getSessionColor(sessionId);
  const shortId = sessionId.substring(0, 8);
  const sessionName = getSessionName(sessionId);

  console.log('');
  console.log(colorize('╔' + '═'.repeat(78) + '╗', color));

  const line1 = ` 🤖 Agent Started`;
  console.log(colorize('║', color) + colors.bold + line1 + colors.reset + ' '.repeat(78 - line1.length) + colorize('║', color));

  const line2 = sessionName
    ? `   Session: ${sessionName} (${shortId})`
    : `   Session: ${shortId}`;
  console.log(colorize('║', color) + line2 + ' '.repeat(78 - line2.length) + colorize('║', color));

  const line3 = `   Source: ${source}`;
  console.log(colorize('║', color) + line3 + ' '.repeat(78 - line3.length) + colorize('║', color));

  console.log(colorize('╚' + '═'.repeat(78) + '╝', color));
  console.log('');
}

function formatSessionEnd(sessionId: string, reason: string): void {
  const color = getSessionColor(sessionId);

  console.log('');
  console.log(colorize('╚' + '═'.repeat(78) + '╝', color));
  console.log(colorize(`  Session ended: ${reason}`, color));
  console.log('');
}

// Read from stdin line by line
for await (const line of console) {
  try {
    const entry = JSON.parse(line);
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const sessionId = entry.session_id;

    switch (entry.event) {
      case 'session_start':
        formatSessionDivider(sessionId, entry.source);
        break;

      case 'user_message':
        console.log(formatBorder(sessionId, colorize(`[${time}] 👤 User:`, colors.blue)));
        console.log(formatBorder(sessionId, colorize(entry.content, colors.white)));
        console.log(formatBorder(sessionId, ''));
        break;

      case 'assistant_message':
        console.log(formatBorder(sessionId, colorize(`[${time}] 🤖 Assistant:`, colors.green)));

        if (entry.thinking) {
          console.log(formatBorder(sessionId, colorize('💭 Thinking:', colors.yellow)));
          console.log(formatBorder(sessionId, colors.italic + colors.gray + entry.thinking + colors.reset));
          console.log(formatBorder(sessionId, ''));
        }

        if (entry.text) {
          console.log(formatBorder(sessionId, colorize(entry.text, colors.white)));
        }

        if (entry.tools && entry.tools.length > 0) {
          for (const tool of entry.tools) {
            console.log(formatBorder(sessionId, colorize(`🔧 ${tool.name}`, colors.cyan)));
            if (tool.description) {
              console.log(formatBorder(sessionId, colorize(`   ${tool.description}`, colors.gray)));
            }
          }
        }

        if (entry.usage) {
          const total = entry.usage.input_tokens + entry.usage.output_tokens;
          const cacheInfo = entry.usage.cache_read_input_tokens
            ? colorize(` [${entry.usage.cache_read_input_tokens.toLocaleString()} cached]`, colors.magenta)
            : '';
          console.log(formatBorder(sessionId, colorize(`📊 ${total.toLocaleString()} tokens (${entry.usage.input_tokens.toLocaleString()} in / ${entry.usage.output_tokens.toLocaleString()} out)`, colors.gray) + cacheInfo));
        }

        console.log(formatBorder(sessionId, ''));
        break;

      case 'session_end':
        formatSessionEnd(sessionId, entry.reason);
        break;
    }

  } catch (err) {
    // Ignore parse errors
  }
}
