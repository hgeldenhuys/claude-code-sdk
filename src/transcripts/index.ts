/**
 * Transcript Module
 * Parse and search Claude Code session transcripts
 */

// Types
export type {
  TranscriptLine,
  TranscriptMessage,
  ContentBlock,
  TokenUsage,
  SearchResult,
  SearchOptions,
  TranscriptIndex,
  IndexedFile,
  RawTranscriptEntry,
} from './types';

// Parser functions
export {
  parseTranscript,
  parseTranscriptFile,
  getTranscriptLine,
  extractTextContent,
  extractToolUses,
  getConversationThread,
} from './parser';

// Search functions
export {
  searchTranscripts,
  scoreResult,
  getContext,
  searchInFile,
  searchToolUsage,
} from './search';

// Indexer functions
export {
  indexTranscripts,
  findTranscriptFiles,
  getSessionInfo,
  saveIndex,
  loadIndex,
  getIndexStats,
  findSessions,
  getProjectDirectories,
  getRecentSessions,
} from './indexer';
