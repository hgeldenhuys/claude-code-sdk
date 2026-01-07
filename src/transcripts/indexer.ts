/**
 * Transcript Indexer
 * Build and manage searchable index of Claude Code transcripts
 */

import { dirname, join } from 'node:path';
import { Glob } from 'bun';
import { parseTranscriptFile } from './parser';
import type { IndexedFile, TranscriptIndex, TranscriptLine } from './types';

const INDEX_VERSION = '1.0.0';

/**
 * Build an index of all transcript files
 * @param projectsDir - Directory containing Claude projects
 * @returns TranscriptIndex with all indexed files
 */
export async function indexTranscripts(projectsDir?: string): Promise<TranscriptIndex> {
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');

  const files = await findTranscriptFiles(dir);
  const indexedFiles: IndexedFile[] = [];

  for (const file of files) {
    try {
      const info = await getSessionInfo(file);
      indexedFiles.push(info);
    } catch (error) {
      console.warn(`Failed to index file ${file}:`, error);
    }
  }

  // Sort by last timestamp descending (most recent first)
  indexedFiles.sort((a, b) => {
    const timeA = new Date(a.lastTimestamp).getTime();
    const timeB = new Date(b.lastTimestamp).getTime();
    return timeB - timeA;
  });

  return {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    files: indexedFiles,
  };
}

/**
 * Find all transcript JSONL files in the projects directory
 * @param projectsDir - Directory to search
 * @returns Array of file paths
 */
export async function findTranscriptFiles(projectsDir?: string): Promise<string[]> {
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');

  const files: string[] = [];

  try {
    // Check if directory exists
    const dirFile = Bun.file(dir);
    // Use a different check since Bun.file doesn't have stat for directories
    const glob = new Glob('**/*.jsonl');

    for await (const file of glob.scan({ cwd: dir, absolute: true })) {
      files.push(file);
    }
  } catch (error) {
    // Directory may not exist or be inaccessible
    console.warn(`Could not scan directory ${dir}:`, error);
  }

  return files;
}

/**
 * Get session information from a transcript file
 * @param filePath - Path to the transcript file
 * @returns IndexedFile with session metadata
 */
export async function getSessionInfo(filePath: string): Promise<IndexedFile> {
  const lines = await parseTranscriptFile(filePath);

  if (lines.length === 0) {
    return {
      path: filePath,
      sessionId: extractSessionIdFromPath(filePath),
      lineCount: 0,
      firstTimestamp: '',
      lastTimestamp: '',
      messageTypes: {},
    };
  }

  // Count message types
  const messageTypes: Record<string, number> = {};
  let sessionId = '';
  let slug: string | undefined;

  for (const line of lines) {
    messageTypes[line.type] = (messageTypes[line.type] || 0) + 1;

    if (!sessionId && line.sessionId && line.sessionId !== 'unknown') {
      sessionId = line.sessionId;
    }

    if (!slug && line.slug) {
      slug = line.slug;
    }
  }

  // Get first and last timestamps
  const firstLine = lines[0]!;
  const lastLine = lines[lines.length - 1]!;

  return {
    path: filePath,
    sessionId: sessionId || extractSessionIdFromPath(filePath),
    slug,
    lineCount: lines.length,
    firstTimestamp: firstLine.timestamp,
    lastTimestamp: lastLine.timestamp,
    messageTypes,
  };
}

/**
 * Extract session ID from file path (fallback)
 */
function extractSessionIdFromPath(filePath: string): string {
  // Typical path: ~/.claude/projects/{project-hash}/sessions/{session-id}.jsonl
  const match = filePath.match(/sessions\/([^/]+)\.jsonl$/);
  return match?.[1] ?? 'unknown';
}

/**
 * Save index to disk
 * @param index - The index to save
 * @param outputPath - Where to save the index
 */
export async function saveIndex(index: TranscriptIndex, outputPath: string): Promise<void> {
  const content = JSON.stringify(index, null, 2);
  await Bun.write(outputPath, content);
}

/**
 * Load index from disk
 * @param indexPath - Path to the index file
 * @returns The loaded index or null if not found
 */
export async function loadIndex(indexPath: string): Promise<TranscriptIndex | null> {
  const file = Bun.file(indexPath);
  const exists = await file.exists();

  if (!exists) {
    return null;
  }

  try {
    const content = await file.text();
    return JSON.parse(content) as TranscriptIndex;
  } catch {
    return null;
  }
}

/**
 * Get statistics about the transcript index
 */
export function getIndexStats(index: TranscriptIndex): {
  totalFiles: number;
  totalLines: number;
  messageTypeCounts: Record<string, number>;
  dateRange: { earliest: string; latest: string } | null;
} {
  let totalLines = 0;
  const messageTypeCounts: Record<string, number> = {};
  let earliest = '';
  let latest = '';

  for (const file of index.files) {
    totalLines += file.lineCount;

    for (const [type, count] of Object.entries(file.messageTypes)) {
      messageTypeCounts[type] = (messageTypeCounts[type] || 0) + count;
    }

    if (file.firstTimestamp) {
      if (!earliest || file.firstTimestamp < earliest) {
        earliest = file.firstTimestamp;
      }
    }

    if (file.lastTimestamp) {
      if (!latest || file.lastTimestamp > latest) {
        latest = file.lastTimestamp;
      }
    }
  }

  return {
    totalFiles: index.files.length,
    totalLines,
    messageTypeCounts,
    dateRange: earliest && latest ? { earliest, latest } : null,
  };
}

/**
 * Find sessions matching criteria
 */
export function findSessions(
  index: TranscriptIndex,
  criteria: {
    slug?: string;
    afterDate?: Date;
    beforeDate?: Date;
    minLines?: number;
  }
): IndexedFile[] {
  return index.files.filter((file) => {
    if (criteria.slug && file.slug !== criteria.slug) {
      return false;
    }

    if (criteria.afterDate && file.lastTimestamp) {
      const fileDate = new Date(file.lastTimestamp);
      if (fileDate < criteria.afterDate) {
        return false;
      }
    }

    if (criteria.beforeDate && file.firstTimestamp) {
      const fileDate = new Date(file.firstTimestamp);
      if (fileDate > criteria.beforeDate) {
        return false;
      }
    }

    if (criteria.minLines && file.lineCount < criteria.minLines) {
      return false;
    }

    return true;
  });
}

/**
 * Get project directories from transcripts
 */
export async function getProjectDirectories(projectsDir?: string): Promise<string[]> {
  const dir = projectsDir || join(process.env.HOME || '~', '.claude', 'projects');

  const projects = new Set<string>();

  try {
    const glob = new Glob('*/');

    for await (const projectDir of glob.scan({ cwd: dir, absolute: true })) {
      projects.add(projectDir);
    }
  } catch {
    // Directory may not exist
  }

  return Array.from(projects);
}

/**
 * Get recent sessions (last N days)
 */
export function getRecentSessions(index: TranscriptIndex, days = 7): IndexedFile[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  return findSessions(index, { afterDate: cutoff });
}
