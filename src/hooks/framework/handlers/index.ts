/**
 * Built-in Handlers Registry
 *
 * Central registry for all built-in handlers.
 * Provides factory functions and a lookup map.
 */

import type {
  BuiltinHandlerOptions,
  BuiltinHandlerType,
  ResolvedHandlerConfig,
} from '../config/types';
import type { HookEventType } from '../framework';
import type { HandlerDefinition } from '../types';

import { createContextInjectionHandler } from './context-injection';
import { createDangerousCommandGuardHandler } from './dangerous-command-guard';
// Handler factories
import { createSessionNamingHandler } from './session-naming';
import { createToolLoggerHandler } from './tool-logger';
import { createTurnTrackerHandler } from './turn-tracker';

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Factory function type for creating handlers
 */
export type HandlerFactory<T extends BuiltinHandlerType = BuiltinHandlerType> = (
  options?: T extends keyof BuiltinHandlerOptions
    ? BuiltinHandlerOptions[T]
    : Record<string, unknown>
) => HandlerDefinition;

/**
 * Handler metadata
 */
export interface HandlerMeta {
  id: BuiltinHandlerType;
  name: string;
  description: string;
  defaultEvents: HookEventType[];
  defaultPriority: number;
  factory: HandlerFactory;
}

// ============================================================================
// Registry
// ============================================================================

/**
 * Built-in handler metadata and factories
 */
export const builtinHandlers: Record<BuiltinHandlerType, HandlerMeta> = {
  'session-naming': {
    id: 'session-naming',
    name: 'Session Naming',
    description: 'Assigns human-friendly names to sessions',
    defaultEvents: ['SessionStart'],
    defaultPriority: 10,
    factory: createSessionNamingHandler as HandlerFactory,
  },
  'dangerous-command-guard': {
    id: 'dangerous-command-guard',
    name: 'Dangerous Command Guard',
    description: 'Blocks dangerous Bash commands',
    defaultEvents: ['PreToolUse'],
    defaultPriority: 20,
    factory: createDangerousCommandGuardHandler as HandlerFactory,
  },
  'context-injection': {
    id: 'context-injection',
    name: 'Context Injection',
    description: "Injects session context into Claude's context",
    defaultEvents: ['SessionStart', 'PreCompact'],
    defaultPriority: 30,
    factory: createContextInjectionHandler as HandlerFactory,
  },
  'tool-logger': {
    id: 'tool-logger',
    name: 'Tool Logger',
    description: 'Logs tool usage for debugging and auditing',
    defaultEvents: ['PostToolUse'],
    defaultPriority: 100,
    factory: createToolLoggerHandler as HandlerFactory,
  },
  'turn-tracker': {
    id: 'turn-tracker',
    name: 'Turn Tracker',
    description: 'Tracks turns within a session based on Stop events',
    defaultEvents: [
      'SessionStart',
      'Stop',
      'SubagentStop',
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
    ],
    defaultPriority: 5,
    factory: createTurnTrackerHandler as HandlerFactory,
  },
};

// ============================================================================
// Registry Functions
// ============================================================================

/**
 * Get all available built-in handler types
 */
export function getBuiltinHandlerTypes(): BuiltinHandlerType[] {
  return Object.keys(builtinHandlers) as BuiltinHandlerType[];
}

/**
 * Check if a handler type is a built-in
 */
export function isBuiltinHandler(type: string): type is BuiltinHandlerType {
  return type in builtinHandlers;
}

/**
 * Get handler metadata by type
 */
export function getHandlerMeta(type: BuiltinHandlerType): HandlerMeta | undefined {
  return builtinHandlers[type];
}

/**
 * Create a handler by type with options
 */
export function createBuiltinHandler(
  type: BuiltinHandlerType,
  options?: Record<string, unknown>
): HandlerDefinition {
  const meta = builtinHandlers[type];
  if (!meta) {
    throw new Error(`Unknown built-in handler type: ${type}`);
  }
  return meta.factory(options);
}

/**
 * Create a handler from resolved config
 */
export function createHandlerFromConfig(config: ResolvedHandlerConfig): HandlerDefinition | null {
  if (config.type === 'custom') {
    // Custom handlers require a command
    if (!config.command) {
      console.error(`[Handler] Custom handler '${config.id}' has no command defined`);
      return null;
    }

    // Import dynamically to avoid circular dependency
    const { createCommandHandler } = require('../command-executor');

    return {
      id: config.id,
      name: config.id,
      priority: config.priority,
      enabled: config.enabled,
      onError: config.onError,
      timeoutMs: config.timeoutMs,
      dependsOn: config.after,
      handler: createCommandHandler(config.command, config.timeoutMs),
    };
  }

  if (!isBuiltinHandler(config.type)) {
    return null;
  }

  const handler = createBuiltinHandler(config.type, config.options);

  // Apply config overrides
  return {
    ...handler,
    id: config.id,
    priority: config.priority,
    enabled: config.enabled,
    onError: config.onError,
    timeoutMs: config.timeoutMs,
    dependsOn: config.after,
  };
}

/**
 * Get default events for a handler type
 */
export function getDefaultEvents(type: BuiltinHandlerType): HookEventType[] {
  const meta = builtinHandlers[type];
  return meta?.defaultEvents ?? [];
}

/**
 * Get default priority for a handler type
 */
export function getDefaultPriority(type: BuiltinHandlerType): number {
  const meta = builtinHandlers[type];
  return meta?.defaultPriority ?? 100;
}

// ============================================================================
// Re-exports
// ============================================================================

// Session Naming
export { createSessionNamingHandler } from './session-naming';

// Dangerous Command Guard
export {
  createDangerousCommandGuardHandler,
  wouldBlock,
  getBlockedPatterns,
} from './dangerous-command-guard';

// Context Injection
export {
  createContextInjectionHandler,
  previewContext,
  getDefaultTemplate,
} from './context-injection';

// Tool Logger
export {
  createToolLoggerHandler,
  createLogEntry,
  formatLogEntry,
} from './tool-logger';

// Turn Tracker
export {
  createTurnTrackerHandler,
  loadTurnState,
  saveTurnState,
  getCurrentTurnId,
  getSubagentTurnId,
  DEFAULT_TURNS_DIR,
} from './turn-tracker';
export type { TurnState, TurnTrackerOptions } from './turn-tracker';

// Types for external factory usage
export type { BuiltinHandlerFactory, BuiltinHandlerMeta } from './turn-tracker';
