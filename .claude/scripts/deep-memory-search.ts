#!/usr/bin/env bun
/**
 * Deep Memory Search - Search Claude Code conversation transcripts (scrolls)
 *
 * Usage:
 *   bun .claude/scripts/deep-memory-search.ts "atomic writes"
 *   bun .claude/scripts/deep-memory-search.ts --session d0d5f5d4-488d-46e1 "SSE pattern"
 *   bun .claude/scripts/deep-memory-search.ts --session brave-elephant "campaign"
 *   bun .claude/scripts/deep-memory-search.ts --recent 7 "database error"
 *   bun .claude/scripts/deep-memory-search.ts --list
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Get the transcript directory for the current project
 * Claude Code stores transcripts in: ~/.claude/projects/{encoded-project-path}/
 * The project path is encoded by replacing / with - and prefixing with -
 */
function getTranscriptDir(): string {
  const cwd = process.cwd();
  const encodedPath = cwd.replace(/\//g, '-');
  return join(homedir(), '.claude', 'projects', encodedPath);
}

const TRANSCRIPTS_DIR = getTranscriptDir();

interface SearchOptions {
  sessionId?: string;
  sessionName?: string;
  recentDays?: number;
  contextLines?: number;
  includeThinking?: boolean;
  caseInsensitive?: boolean;
}

interface SearchResult {
  file: string;
  sessionId: string;
  lineNumber: number;
  match: any;
  context: any[];
}

function getSessionId(sessionName: string): string | null {
  const sessionsFile = join(process.cwd(), '.claude/sessions.json');
  if (!existsSync(sessionsFile)) return null;
  try {
    const sessions = JSON.parse(readFileSync(sessionsFile, 'utf-8'));
    for (const [sessionId, info] of Object.entries(sessions as Record<string, any>)) {
      if (info.name === sessionName) return sessionId;
    }
  } catch { }
  return null;
}

function extractSessionId(filename: string): string {
  const uuidMatch = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuidMatch ? uuidMatch[0] : filename.replace('.jsonl', '');
}

function listTranscripts(): void {
  if (!existsSync(TRANSCRIPTS_DIR)) {
    console.error(`Transcript directory not found: ${TRANSCRIPTS_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const fullPath = join(TRANSCRIPTS_DIR, f);
      const stats = statSync(fullPath);
      return { file: f, sessionId: extractSessionId(f), size: stats.size, modified: stats.mtime };
    })
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());

  console.log('\nTranscript Files:\n');
  for (const file of files) {
    console.log(`  ${file.file}`);
    console.log(`    Session ID: ${file.sessionId.slice(0, 8)}...`);
    console.log(`    Size: ${(file.size / 1024).toFixed(1)} KB`);
    console.log(`    Modified: ${file.modified.toLocaleString()}\n`);
  }
}

function searchScrolls(searchTerm: string, options: SearchOptions = {}): SearchResult[] {
  if (!existsSync(TRANSCRIPTS_DIR)) {
    console.error(`Transcript directory not found: ${TRANSCRIPTS_DIR}`);
    process.exit(1);
  }

  let files = readdirSync(TRANSCRIPTS_DIR).filter(f => f.endsWith('.jsonl')).map(f => join(TRANSCRIPTS_DIR, f));

  if (options.sessionId) {
    files = files.filter(f => extractSessionId(f).toLowerCase().startsWith(options.sessionId!.toLowerCase()));
  }
  if (options.sessionName) {
    const sessionId = getSessionId(options.sessionName);
    if (!sessionId) { console.error(`Session not found: ${options.sessionName}`); process.exit(1); }
    files = files.filter(f => extractSessionId(f) === sessionId);
  }
  if (options.recentDays) {
    const cutoff = Date.now() - options.recentDays * 24 * 60 * 60 * 1000;
    files = files.filter(f => statSync(f).mtime.getTime() > cutoff);
  }

  const results: SearchResult[] = [];
  const contextLines = options.contextLines ?? 2;

  for (const file of files) {
    const sessionId = extractSessionId(file);
    const lines = readFileSync(file, 'utf-8').split('\n').filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        const objStr = JSON.stringify(obj);
        const matches = options.caseInsensitive
          ? objStr.toLowerCase().includes(searchTerm.toLowerCase())
          : objStr.includes(searchTerm);

        if (matches) {
          if (!options.includeThinking && obj.type === 'thinking') continue;
          const contextStart = Math.max(0, i - contextLines);
          const contextEnd = Math.min(lines.length, i + contextLines + 1);
          const context = lines.slice(contextStart, contextEnd).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          results.push({ file, sessionId, lineNumber: i + 1, match: obj, context });
        }
      } catch { }
    }
  }
  return results;
}

function formatLine(obj: any): string {
  if (!obj) return '';
  if (obj.type === 'user') {
    const content = typeof obj.message?.content === 'string' ? obj.message.content : JSON.stringify(obj.message?.content);
    return `User: ${content.slice(0, 150)}`;
  }
  if (obj.type === 'assistant') {
    const textContent = obj.message?.content?.find((c: any) => c.type === 'text');
    if (textContent) return `Assistant: ${textContent.text.slice(0, 150)}`;
    const toolUse = obj.message?.content?.find((c: any) => c.type === 'tool_use');
    if (toolUse) return `Assistant: [${toolUse.name}] ${JSON.stringify(toolUse.input).slice(0, 100)}`;
    return `Assistant: [response]`;
  }
  if (obj.type === 'system') return `System: ${obj.content?.slice(0, 150) || '[system message]'}`;
  if (obj.type === 'thinking') return `Thinking: ${obj.thinking?.slice(0, 150) || '[thinking]'}`;
  if (obj.type === 'summary') return `Summary: ${obj.summary?.slice(0, 150)}`;
  return `${obj.type}: [content]`;
}

function displayResults(results: SearchResult[], searchTerm: string): void {
  if (results.length === 0) { console.log(`\nNo matches found for "${searchTerm}"`); return; }
  console.log(`\nFound ${results.length} matches for "${searchTerm}":\n`);

  const byFile = results.reduce((acc, r) => { if (!acc[r.file]) acc[r.file] = []; acc[r.file].push(r); return acc; }, {} as Record<string, SearchResult[]>);

  for (const [file, fileResults] of Object.entries(byFile)) {
    console.log(`${file.split('/').pop()} (session: ${fileResults[0].sessionId.slice(0, 8)}...)`);
    console.log('-'.repeat(80));
    for (const result of fileResults.slice(0, 3)) {
      console.log(`\n  Line ${result.lineNumber}:`);
      for (const line of result.context) { const f = formatLine(line); if (f) console.log(`    ${f}`); }
    }
    if (fileResults.length > 3) console.log(`\n  ... and ${fileResults.length - 3} more matches in this file`);
    console.log('');
  }
}

function main() {
  const args = process.argv.slice(2);
  const options: SearchOptions = { contextLines: 2, caseInsensitive: true };
  let searchTerm = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list' || arg === '-l') { listTranscripts(); return; }
    else if (arg === '--session' && i + 1 < args.length) {
      const sessionArg = args[++i];
      if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sessionArg) || (sessionArg.length >= 8 && /^[0-9a-f]+$/i.test(sessionArg)))
        options.sessionId = sessionArg;
      else options.sessionName = sessionArg;
    }
    else if (arg === '--recent' && i + 1 < args.length) options.recentDays = parseInt(args[++i]);
    else if (arg === '--context' && i + 1 < args.length) options.contextLines = parseInt(args[++i]);
    else if (arg === '--thinking') options.includeThinking = true;
    else if (arg === '--case-sensitive') options.caseInsensitive = false;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Deep Memory Search - Search Claude Code conversation transcripts

Usage: bun .claude/scripts/deep-memory-search.ts [options] <search-term>

Options:
  --list, -l                List all transcript files
  --session <id|name>       Search specific session
  --recent <days>           Search last N days
  --context <lines>         Context lines (default: 2)
  --thinking                Include thinking blocks
  --case-sensitive          Case-sensitive search
`);
      return;
    }
    else searchTerm = arg;
  }

  if (!searchTerm) { console.error('Search term required'); process.exit(1); }
  displayResults(searchScrolls(searchTerm, options), searchTerm);
}

main();
