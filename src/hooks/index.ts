/**
 * Claude Code Hooks SDK
 *
 * Utilities and helpers for building Claude Code hooks.
 *
 * Features:
 * - Session naming: Human-friendly names for sessions
 * - I/O helpers: Read input, write output, exit codes
 * - Hook creators: Type-safe hook handlers with session tracking
 * - Common patterns: Block tools, inject context, etc.
 *
 * @example
 * ```typescript
 * import { createSessionStartHook, sessionStartContext } from 'claude-code-sdk/hooks';
 *
 * createSessionStartHook(({ sessionName, input }) => {
 *   return sessionStartContext(`Session: ${sessionName}`);
 * });
 * ```
 */

// Core hook types
export type {
  HookEventName,
  SessionSource,
  PermissionMode,
  BaseHookInput,
  SessionStartInput,
  SessionStartOutput,
  SessionEndInput,
  PreToolUseInput,
  PreToolUseOutput,
  PostToolUseInput,
  PostToolUseOutput,
  StopInput,
  StopOutput,
  SubagentStartInput,
  SubagentStopInput,
  UserPromptSubmitInput,
  UserPromptSubmitOutput,
  PreCompactInput,
  PreCompactOutput,
  PermissionRequestInput,
  PermissionRequestOutput,
  HookResult,
  HookEnvironment,
} from './types';

// Session management
export {
  // Store
  SessionStore,
  getSessionStore,
  trackSession,
  getSessionName,
  getSessionId,
  renameSession,
  listSessions,
  // Name generator
  NameGenerator,
  getNameGenerator,
  generateName,
  generateUniqueName,
  // CLI
  runCLI as runSessionCLI,
  cmdGetId,
  cmdGetName,
  cmdList,
  cmdRename,
  cmdDelete,
  cmdInfo,
  cmdHistory,
  cmdDescribe,
  cmdCleanup,
  // Types
  type SessionRecord,
  type NamedSession,
  type SessionDatabase,
  type SessionStoreConfig,
  type NameGeneratorConfig,
  type SessionInfo,
  type SessionListFilter,
  type TrackingResult,
  type CLIResult,
} from './sessions';

// Hook helpers
export {
  // I/O utilities
  readHookInput,
  readHookInputAsync,
  writeHookOutput,
  exitSuccess,
  exitError,
  // Hook creators (session-aware)
  createSessionStartHook,
  createPreToolUseHook,
  createPostToolUseHook,
  createStopHook,
  createUserPromptSubmitHook,
  createPreCompactHook,
  createSessionEndHook,
  createPermissionRequestHook,
  runHook,
  // Common patterns
  blockTool,
  approveTool,
  modifyToolInput,
  injectContext,
  blockPrompt,
  sessionStartContext,
  // Types
  type SessionAwareOptions,
  type HookContext,
} from './helpers';
