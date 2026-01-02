#!/usr/bin/env bun
/**
 * Session Lookup Script
 *
 * Finds session IDs by name or pattern.
 *
 * Usage:
 *   bun .claude/scripts/session-lookup.ts <name-or-pattern>
 *   bun .claude/scripts/session-lookup.ts main          # Find main/latest session
 *   bun .claude/scripts/session-lookup.ts "notification" # Find by keyword
 *   bun .claude/scripts/session-lookup.ts --list        # List all sessions
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import path from 'path';

// Claude Code stores projects with path separators replaced by dashes
const projectPath = process.cwd().replace(/\//g, '-');
const SESSIONS_DIR = path.join(
  process.env.HOME || '',
  '.claude/projects',
  projectPath
);

interface SessionMeta {
  id: string;
  name?: string;
  firstMessage?: string;
  lastActivity?: string;
  messageCount?: number;
}

function findSessions(): SessionMeta[] {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const sessions: SessionMeta[] = [];

  try {
    const entries = readdirSync(SESSIONS_DIR);

    for (const entry of entries) {
      // Sessions are stored as {uuid}.jsonl files
      if (!entry.endsWith('.jsonl')) continue;

      const sessionId = entry.replace('.jsonl', '');
      const sessionPath = path.join(SESSIONS_DIR, entry);

      try {
        const stat = statSync(sessionPath);
        let meta: SessionMeta = {
          id: sessionId,
          lastActivity: stat.mtime.toISOString(),
        };

        // Read first few lines to get context
        const content = readFileSync(sessionPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim());
        meta.messageCount = lines.length;

        // Try to extract first user message for context
        for (const line of lines.slice(0, 10)) {
          try {
            const msg = JSON.parse(line);
            if (msg.role === 'user' && msg.content) {
              const text = typeof msg.content === 'string'
                ? msg.content
                : msg.content[0]?.text || '';
              meta.firstMessage = text.substring(0, 80).replace(/\n/g, ' ');
              break;
            }
          } catch {}
        }

        sessions.push(meta);
      } catch {}
    }
  } catch (error) {
    console.error('Error reading sessions:', error);
  }

  // Sort by last activity (most recent first)
  return sessions.sort((a, b) => {
    const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bTime - aTime;
  });
}

function formatSession(session: SessionMeta, verbose = false): string {
  const parts = [session.id.substring(0, 8)];
  if (session.messageCount) parts.push(`(${session.messageCount} msgs)`);
  if (session.lastActivity) {
    const date = new Date(session.lastActivity);
    parts.push(`@ ${date.toLocaleString()}`);
  }
  let result = parts.join(' ');
  if (verbose && session.firstMessage) {
    result += `\n       "${session.firstMessage}..."`;
  }
  return result;
}

// Main
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help') {
  console.log('Usage: bun .claude/scripts/session-lookup.ts <name-or-pattern>');
  console.log('');
  console.log('Options:');
  console.log('  main, latest    Find the most recent session');
  console.log('  --list, -l      List all sessions');
  console.log('  --verbose, -v   Show first message preview');
  console.log('  <pattern>       Find sessions matching pattern');
  console.log('');
  console.log('Output: Session ID (for use with --resume)');
  process.exit(0);
}

const sessions = findSessions();

if (sessions.length === 0) {
  console.error('No sessions found in:', SESSIONS_DIR);
  process.exit(1);
}

const query = args[0].toLowerCase();
const verbose = args.includes('--verbose') || args.includes('-v');

if (query === '--list' || query === '-l') {
  console.log(`Sessions (${sessions.length} total, most recent first):`);
  for (const session of sessions.slice(0, 20)) {
    console.log(`  ${formatSession(session, verbose)}`);
  }
  if (sessions.length > 20) {
    console.log(`  ... and ${sessions.length - 20} more`);
  }
  process.exit(0);
}

if (query === 'main' || query === 'latest' || query === 'last') {
  // Return the most recent session
  console.log(sessions[0].id);
  process.exit(0);
}

// Search by pattern in ID or first message
const matches = sessions.filter(s =>
  s.id.toLowerCase().includes(query) ||
  (s.firstMessage && s.firstMessage.toLowerCase().includes(query))
);

if (matches.length === 0) {
  console.error(`No sessions matching "${query}"`);
  console.error('Recent sessions:');
  for (const session of sessions.slice(0, 5)) {
    console.error(`  ${formatSession(session, true)}`);
  }
  process.exit(1);
}

if (matches.length === 1) {
  console.log(matches[0].id);
  process.exit(0);
}

// Multiple matches - show them
console.error(`Multiple sessions match "${query}":`);
for (const session of matches.slice(0, 10)) {
  console.error(`  ${formatSession(session, true)}`);
}
console.error('');
console.error('Be more specific or use the full ID.');
process.exit(1);
