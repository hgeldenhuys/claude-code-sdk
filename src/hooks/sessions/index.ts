/**
 * Session Management Module
 *
 * Human-friendly names for Claude Code sessions.
 * Names are stable across compact/clear operations.
 */

// Types
export type {
  SessionRecord,
  NamedSession,
  SessionDatabase,
  SessionStoreConfig,
  NameGeneratorConfig,
  SessionInfo,
  SessionListFilter,
  TrackingResult,
} from './types';

// Store
export {
  SessionStore,
  getSessionStore,
  trackSession,
  getSessionName,
  getSessionId,
  renameSession,
  listSessions,
} from './store';

// Name Generator
export {
  NameGenerator,
  getNameGenerator,
  generateName,
  generateUniqueName,
} from './namer';

// CLI
export {
  runCLI,
  cmdGetId,
  cmdGetName,
  cmdList,
  cmdRename,
  cmdDelete,
  cmdInfo,
  cmdHistory,
  cmdDescribe,
  cmdCleanup,
  type CLIResult,
} from './cli';
