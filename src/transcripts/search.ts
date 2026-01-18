/**
 * Transcript Search
 * Search across Claude Code session transcripts
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { getDatabase, isDatabaseReady, searchDb } from './db';
import { findTranscriptFiles } from './indexer';
import { extractTextContent, parseTranscriptFile } from './parser';
import type { SearchOptions, SearchResult, TranscriptLine } from './types';

/**
 * Resolve a session name to all its historical session IDs using sesh
 */
function resolveSessionNameToIds(sessionName: string): string[] {
  try {
    const seshPath = join(__dirname, '../../bin/sesh.ts');
    const result = spawnSync('bun', [seshPath, 'info', sessionName, '--json'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0 || !result.stdout) {
      return [sessionName];
    }

    const info = JSON.parse(result.stdout);
    const ids: string[] = [];

    if (info.sessionId) {
      ids.push(info.sessionId);
    }
    if (info.history && Array.isArray(info.history)) {
      for (const h of info.history) {
        if (h.sessionId) {
          ids.push(h.sessionId);
        }
      }
    }
    return ids.length > 0 ? ids : [sessionName];
  } catch {
    return [sessionName];
  }
}

/**
 * Search across transcripts for matching content
 * Uses SQLite index if available for faster search, otherwise falls back to file scanning
 * @param options - Search options
 * @returns Array of search results sorted by score
 */
export async function searchTranscripts(options: SearchOptions): Promise<SearchResult[]> {
  const {
    query,
    limit = 50,
    contextLines = 2,
    types,
    projectPath,
    sessionIds,
    sessionName,
    useIndex,
  } = options;

  if (!query.trim()) {
    return [];
  }

  // Resolve session filters
  let resolvedSessionIds: string[] | undefined;
  if (sessionIds && sessionIds.length > 0) {
    resolvedSessionIds = sessionIds;
  } else if (sessionName) {
    resolvedSessionIds = resolveSessionNameToIds(sessionName);
  }

  // Try SQLite search if index is available (auto-detect or explicit)
  const shouldUseIndex = useIndex !== false && isDatabaseReady();
  if (shouldUseIndex) {
    try {
      const db = getDatabase();
      const dbResults = searchDb(db, {
        query,
        limit,
        types: types as string[] | undefined,
        sessionIds: resolvedSessionIds,
      });
      db.close();

      // Convert DB results to SearchResult format
      return dbResults.map((r) => ({
        file: '', // File path not stored in simplified DB results
        sessionId: r.sessionId,
        line: {
          lineNumber: r.lineNumber,
          type: r.type as TranscriptLine['type'],
          uuid: '',
          parentUuid: null,
          sessionId: r.sessionId,
          timestamp: r.timestamp,
          cwd: '',
          slug: r.slug || undefined,
          raw: r.raw,
        },
        context: [],
        score: 10, // FTS provides its own ranking
        matchedText: r.matchedText.replace(/>>>>/g, '').replace(/<<<</g, ''),
      }));
    } catch (err) {
      // Fall back to file-based search on error
      console.warn('SQLite search failed, falling back to file scan:', err);
    }
  }

  // Fall back to file-based search
  const allowedSessionIds = resolvedSessionIds ? new Set(resolvedSessionIds) : null;
  const projectsDir = projectPath || join(process.env.HOME || '~', '.claude', 'projects');

  const files = await findTranscriptFiles(projectsDir);
  const results: SearchResult[] = [];
  const queryLower = query.toLowerCase();

  for (const file of files) {
    try {
      const lines = await parseTranscriptFile(file);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Filter by session IDs if specified
        if (allowedSessionIds && !allowedSessionIds.has(line.sessionId)) {
          continue;
        }

        // Filter by types if specified
        if (types && types.length > 0 && !types.includes(line.type)) {
          continue;
        }

        const text = extractTextContent(line);
        if (!text) continue;

        const score = scoreResult(line, query);
        if (score > 0) {
          const matchedText = findMatchedText(text, queryLower);

          results.push({
            file,
            sessionId: line.sessionId,
            line,
            context: getContext(lines, i, contextLines),
            score,
            matchedText,
          });
        }
      }
    } catch (error) {
      // Skip files that fail to parse
      console.warn(`Failed to search file ${file}:`, error);
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Apply limit
  return results.slice(0, limit);
}

/**
 * Score a transcript line against a search query
 * Scoring: exact match > word boundary > partial match
 * @param line - The transcript line to score
 * @param query - The search query
 * @returns Score (0 = no match, higher = better match)
 */
export function scoreResult(line: TranscriptLine, query: string): number {
  const text = extractTextContent(line);
  if (!text) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // No match
  if (!textLower.includes(queryLower)) {
    return 0;
  }

  let score = 1;

  // Exact case match bonus
  if (text.includes(query)) {
    score += 5;
  }

  // Word boundary match bonus
  const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(queryLower)}\\b`, 'i');
  if (wordBoundaryRegex.test(text)) {
    score += 10;
  }

  // Multiple occurrences bonus (capped)
  const occurrences = countOccurrences(textLower, queryLower);
  score += Math.min(occurrences - 1, 5);

  // Boost user/assistant messages over system/snapshot
  if (line.type === 'user' || line.type === 'assistant') {
    score += 3;
  }

  // Boost recent messages (based on timestamp)
  const timestamp = new Date(line.timestamp).getTime();
  const now = Date.now();
  const ageHours = (now - timestamp) / (1000 * 60 * 60);
  if (ageHours < 24) {
    score += 2;
  } else if (ageHours < 168) {
    // 1 week
    score += 1;
  }

  return score;
}

/**
 * Get context lines around a match
 * @param lines - All transcript lines
 * @param index - Index of the matched line
 * @param contextSize - Number of lines before/after to include
 * @returns Array of context lines
 */
export function getContext(
  lines: TranscriptLine[],
  index: number,
  contextSize: number
): TranscriptLine[] {
  const start = Math.max(0, index - contextSize);
  const end = Math.min(lines.length - 1, index + contextSize);

  const context: TranscriptLine[] = [];

  for (let i = start; i <= end; i++) {
    const contextLine = lines[i];
    if (i !== index && contextLine) {
      context.push(contextLine);
    }
  }

  return context;
}

/**
 * Find the matched text snippet for display
 */
function findMatchedText(text: string, queryLower: string): string {
  const textLower = text.toLowerCase();
  const matchIndex = textLower.indexOf(queryLower);

  if (matchIndex === -1) return '';

  // Extract surrounding context (up to 100 chars on each side)
  const contextStart = Math.max(0, matchIndex - 50);
  const contextEnd = Math.min(text.length, matchIndex + queryLower.length + 50);

  let snippet = text.slice(contextStart, contextEnd);

  // Add ellipsis if truncated
  if (contextStart > 0) {
    snippet = `...${snippet}`;
  }
  if (contextEnd < text.length) {
    snippet = `${snippet}...`;
  }

  return snippet;
}

/**
 * Escape special regex characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Count occurrences of a substring
 */
function countOccurrences(text: string, search: string): number {
  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(search, position);
    if (index === -1) break;
    count++;
    position = index + 1;
  }

  return count;
}

/**
 * Search within a single transcript file
 * @param filePath - Path to the transcript file
 * @param query - Search query
 * @param options - Additional options
 * @returns Array of search results
 */
export async function searchInFile(
  filePath: string,
  query: string,
  options: Omit<SearchOptions, 'query' | 'projectPath'> = {}
): Promise<SearchResult[]> {
  const { limit = 50, contextLines = 2, types } = options;
  const queryLower = query.toLowerCase();

  const lines = await parseTranscriptFile(filePath);
  const results: SearchResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (types && types.length > 0 && !types.includes(line.type)) {
      continue;
    }

    const text = extractTextContent(line);
    if (!text) continue;

    const score = scoreResult(line, query);
    if (score > 0) {
      const matchedText = findMatchedText(text, queryLower);

      results.push({
        file: filePath,
        sessionId: line.sessionId,
        line,
        context: getContext(lines, i, contextLines),
        score,
        matchedText,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Search for tool usage in transcripts
 * @param toolName - Name of the tool to search for
 * @param projectPath - Optional project path to search in
 * @returns Array of search results for tool usage
 */
export async function searchToolUsage(
  toolName: string,
  projectPath?: string
): Promise<SearchResult[]> {
  const projectsDir = projectPath || join(process.env.HOME || '~', '.claude', 'projects');

  const files = await findTranscriptFiles(projectsDir);
  const results: SearchResult[] = [];
  const toolNameLower = toolName.toLowerCase();

  for (const file of files) {
    try {
      const lines = await parseTranscriptFile(file);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        if (!line.message?.content || typeof line.message.content === 'string') {
          continue;
        }

        for (const block of line.message.content) {
          if (block.type === 'tool_use' && block.name?.toLowerCase().includes(toolNameLower)) {
            results.push({
              file,
              sessionId: line.sessionId,
              line,
              context: getContext(lines, i, 2),
              score: block.name?.toLowerCase() === toolNameLower ? 20 : 10,
              matchedText: `Tool: ${block.name}`,
            });
          }
        }
      }
    } catch {
      // Skip files that fail to parse
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
