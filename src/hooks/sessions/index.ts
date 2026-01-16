/**
 * Session Management Module
 *
 * Human-friendly names for Claude Code sessions.
 * Names are stable across compact/clear operations.
 *
 * v3.0 features:
 * - Centralized storage at ~/.claude/global-sessions.json
 * - Machine namespacing for multi-machine support
 * - Directory-based session queries
 * - Migration from per-project sessions.json
 */

// Types
export type {
  SessionRecord,
  NamedSession,
  SessionDatabase,
  GlobalSessionDatabase,
  MachineInfo,
  SessionStoreConfig,
  NameGeneratorConfig,
  SessionInfo,
  SessionListFilter,
  TrackingResult,
  MigrationResult,
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

// Machine
export {
  getMachineId,
  getMachineAlias,
  setMachineAlias,
  clearMachineAlias,
  getMachineInfo,
  getMachineDisplayName,
  listMachines,
  getMachineById,
  isCurrentMachineRegistered,
  registerCurrentMachine,
} from './machine';

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
