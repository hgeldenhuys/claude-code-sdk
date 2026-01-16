/**
 * Transcript Parser
 * Parse JSONL transcript files from Claude Code sessions
 */

import type { ContentBlock, RawTranscriptEntry, TranscriptLine } from './types';

/**
 * Parse a transcript JSONL content string into structured lines
 * @param content - Raw JSONL content
 * @returns Array of parsed transcript lines
 */
export function parseTranscript(content: string): TranscriptLine[] {
  const lines = content.split('\n');
  const results: TranscriptLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine) continue;
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as RawTranscriptEntry;
      const transcriptLine = normalizeTranscriptLine(parsed, i + 1, line);
      if (transcriptLine) {
        results.push(transcriptLine);
      }
    } catch {
      // Skip malformed JSON lines gracefully
      console.warn(`Skipping malformed JSON at line ${i + 1}`);
    }
  }

  return results;
}

/**
 * Parse a transcript file from disk
 * @param filePath - Path to the JSONL file
 * @returns Array of parsed transcript lines
 */
export async function parseTranscriptFile(filePath: string): Promise<TranscriptLine[]> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    throw new Error(`Transcript file not found: ${filePath}`);
  }

  const content = await file.text();
  return parseTranscript(content);
}

/**
 * Get a specific line from a transcript file
 * @param filePath - Path to the JSONL file
 * @param lineNumber - 1-based line number
 * @returns The transcript line or null if not found
 */
export async function getTranscriptLine(
  filePath: string,
  lineNumber: number
): Promise<TranscriptLine | null> {
  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return null;
  }

  const content = await file.text();
  const lines = content.split('\n');

  if (lineNumber < 1 || lineNumber > lines.length) {
    return null;
  }

  const rawLine = lines[lineNumber - 1];
  if (!rawLine) return null;
  const line = rawLine.trim();
  if (!line) return null;

  try {
    const parsed = JSON.parse(line) as RawTranscriptEntry;
    return normalizeTranscriptLine(parsed, lineNumber, line);
  } catch {
    return null;
  }
}

/**
 * Extract text content from a transcript line
 * @param line - The transcript line
 * @returns Extracted text or null if no text content
 */
export function extractTextContent(line: TranscriptLine): string | null {
  if (!line.message) return null;

  const { content } = line.message;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const textParts: string[] = [];

    for (const block of content) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'tool_use' && block.name) {
        textParts.push(`[Tool: ${block.name}]`);
      } else if (block.type === 'tool_result' && block.text) {
        textParts.push(block.text);
      }
    }

    return textParts.length > 0 ? textParts.join('\n') : null;
  }

  return null;
}

/**
 * Normalize a raw transcript entry into a structured TranscriptLine
 */
function normalizeTranscriptLine(
  raw: RawTranscriptEntry,
  lineNumber: number,
  rawString: string
): TranscriptLine | null {
  // Determine the type
  let type: TranscriptLine['type'] = 'system';

  if (raw.type) {
    const rawType = raw.type.toLowerCase();
    if (
      rawType === 'user' ||
      rawType === 'assistant' ||
      rawType === 'file-history-snapshot' ||
      rawType === 'system' ||
      rawType === 'summary' ||
      rawType === 'progress'
    ) {
      type = rawType as TranscriptLine['type'];
    }
  } else if (raw.message?.role) {
    type = raw.message.role as TranscriptLine['type'];
  }

  // Ensure required fields have defaults
  const uuid = raw.uuid || `line-${lineNumber}`;
  const sessionId = raw.sessionId || 'unknown';
  const timestamp = raw.timestamp || new Date().toISOString();
  const cwd = raw.cwd || '';

  return {
    lineNumber,
    type,
    uuid,
    parentUuid: raw.parentUuid ?? null,
    sessionId,
    timestamp,
    cwd,
    version: raw.version,
    gitBranch: raw.gitBranch,
    slug: raw.slug,
    message: raw.message,
    toolUseResult: raw.toolUseResult,
    raw: rawString,
    // Additional fields for system/progress messages
    subtype: raw.subtype,
    data: raw.data as Record<string, unknown> | undefined,
    summary: raw.summary,
    hookInfos: raw.hookInfos as Array<{ command: string }> | undefined,
    hookErrors: raw.hookErrors,
    hookCount: raw.hookCount,
  };
}

/**
 * Extract all tool uses from a transcript
 * @param lines - Parsed transcript lines
 * @returns Array of tool use information
 */
export function extractToolUses(lines: TranscriptLine[]): Array<{
  lineNumber: number;
  toolName: string;
  input: Record<string, unknown>;
}> {
  const toolUses: Array<{
    lineNumber: number;
    toolName: string;
    input: Record<string, unknown>;
  }> = [];

  for (const line of lines) {
    if (!line.message?.content || typeof line.message.content === 'string') {
      continue;
    }

    for (const block of line.message.content as ContentBlock[]) {
      if (block.type === 'tool_use' && block.name) {
        toolUses.push({
          lineNumber: line.lineNumber,
          toolName: block.name,
          input: block.input || {},
        });
      }
    }
  }

  return toolUses;
}

/**
 * Get conversation thread from a specific line (following parentUuid chain)
 * @param lines - All transcript lines
 * @param targetUuid - UUID of the line to get thread for
 * @returns Array of lines in the conversation thread
 */
export function getConversationThread(
  lines: TranscriptLine[],
  targetUuid: string
): TranscriptLine[] {
  const uuidToLine = new Map<string, TranscriptLine>();

  for (const line of lines) {
    uuidToLine.set(line.uuid, line);
  }

  const thread: TranscriptLine[] = [];
  let current = uuidToLine.get(targetUuid);

  while (current) {
    thread.unshift(current);
    if (current.parentUuid) {
      current = uuidToLine.get(current.parentUuid);
    } else {
      break;
    }
  }

  return thread;
}
