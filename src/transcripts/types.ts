/**
 * Transcript Types
 * Type definitions for parsing and searching Claude Code session transcripts
 */

/**
 * Content block types that can appear in messages
 */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Token usage statistics for a message
 */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Message structure within a transcript line
 */
export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
  model?: string;
  usage?: TokenUsage;
}

/**
 * A single line from a transcript JSONL file
 */
export interface TranscriptLine {
  lineNumber: number;
  type: 'user' | 'assistant' | 'file-history-snapshot' | 'system' | 'summary' | 'progress';
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  cwd: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  message?: TranscriptMessage;
  toolUseResult?: Record<string, unknown>;
  raw: string;
  // Additional fields for system/progress messages
  subtype?: string;
  data?: Record<string, unknown>;
  summary?: string;
  // Hook-related fields that appear at top level
  hookInfos?: Array<{ command: string }>;
  hookErrors?: string[];
  hookCount?: number;
  // Turn tracking fields (from SQLite v5 schema)
  turnId?: string | null;
  turnSequence?: number | null;
  sessionName?: string | null;
}

/**
 * Search result with context
 */
export interface SearchResult {
  file: string;
  sessionId: string;
  line: TranscriptLine;
  context: TranscriptLine[]; // Lines before/after
  score: number;
  matchedText: string;
}

/**
 * Options for searching transcripts
 */
export interface SearchOptions {
  query: string;
  limit?: number;
  contextLines?: number;
  types?: TranscriptLine['type'][];
  projectPath?: string;
  /** Filter to specific session IDs */
  sessionIds?: string[];
  /** Filter to sessions matching a session name (resolves via sesh) */
  sessionName?: string;
  /** Use SQLite index for faster search (auto-detected if available) */
  useIndex?: boolean;
}

/**
 * Index of all transcript files
 */
export interface TranscriptIndex {
  version: string;
  createdAt: string;
  files: IndexedFile[];
}

/**
 * Information about an indexed transcript file
 */
export interface IndexedFile {
  path: string;
  sessionId: string;
  slug?: string;
  lineCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  messageTypes: Record<string, number>;
}

/**
 * Raw JSON structure from transcript files
 */
export interface RawTranscriptEntry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  message?: TranscriptMessage;
  toolUseResult?: Record<string, unknown>;
  // Additional fields for system/progress messages
  subtype?: string;
  data?: unknown;
  summary?: string;
  hookInfos?: unknown[];
  hookErrors?: string[];
  hookCount?: number;
  [key: string]: unknown;
}
