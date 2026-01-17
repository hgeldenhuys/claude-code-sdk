/**
 * Hook Framework Configuration Types
 *
 * TypeScript interfaces for YAML-based hook configuration.
 * Supports both built-in handlers and custom handler definitions.
 */

import type { HookEventType } from '../framework';
import type { ErrorStrategy } from '../types';

// ============================================================================
// Built-in Handler Types
// ============================================================================

/**
 * Available built-in handler types
 */
export type BuiltinHandlerType =
  | 'session-naming'
  | 'dangerous-command-guard'
  | 'context-injection'
  | 'tool-logger'
  | 'turn-tracker'
  | 'debug-logger'
  | 'metrics'
  | 'event-logger';

/**
 * Options for session-naming handler
 */
export interface SessionNamingOptions {
  /** Name format: 'adjective-animal' (default), 'timestamp', 'uuid' */
  format?: 'adjective-animal' | 'timestamp' | 'uuid';
  /** Custom separator between words (default: '-') */
  separator?: string;
  /** Include timestamp suffix on collision */
  includeTimestamp?: boolean;
}

/**
 * Options for dangerous-command-guard handler
 */
export interface DangerousCommandGuardOptions {
  /** Additional patterns to block (regex strings) */
  blockedPatterns?: string[];
  /** Patterns to allow even if they match blocked patterns */
  allowedPatterns?: string[];
  /** Enable strict mode - blocks all potentially dangerous commands */
  strict?: boolean;
  /** Custom message format for blocked commands */
  messageTemplate?: string;
}

/**
 * Options for context-injection handler
 */
export interface ContextInjectionOptions {
  /** Template string for injected context (supports {{sessionId}}, {{sessionName}}, {{cwd}}) */
  template?: string;
  /** Inject on SessionStart */
  onSessionStart?: boolean;
  /** Inject on PreCompact (preserved in summary) */
  onPreCompact?: boolean;
  /** Additional key-value pairs to inject */
  variables?: Record<string, string>;
}

/**
 * Options for tool-logger handler
 */
export interface ToolLoggerOptions {
  /** Log level: 'debug', 'info', 'warn', 'error' */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Output path for log file (default: stderr) */
  outputPath?: string;
  /** Include tool input in logs */
  includeInput?: boolean;
  /** Include tool output in logs */
  includeOutput?: boolean;
  /** Tools to log (default: all) */
  tools?: string[];
  /** Format: 'json' | 'text' */
  format?: 'json' | 'text';
}

/**
 * Options for turn-tracker handler
 */
export interface TurnTrackerOptions {
  /** Directory to store turn state files (default: ~/.claude/turns) */
  turnsDir?: string;
  /** Preserve turn state when resuming a session (default: true) */
  preserveOnResume?: boolean;
  /** Inject turn context on SessionStart (default: false) */
  injectContext?: boolean;
}

/**
 * Options for debug-logger handler
 */
export interface DebugLoggerOptions {
  /** Output path for log file (default: stderr) */
  outputPath?: string;
  /** Include full event payload (default: true) */
  includePayload?: boolean;
  /** Include results from other handlers (default: true) */
  includeHandlerResults?: boolean;
  /** Include framework env vars that custom handlers receive (default: true) */
  includeFrameworkEnv?: boolean;
  /** Pretty print JSON output (default: true) */
  prettyPrint?: boolean;
  /** Event types to log (default: all) */
  events?: string[];
}

/**
 * Options for metrics handler
 */
export interface MetricsOptions {
  /** Log timing to stderr (default: true) */
  logToStderr?: boolean;
  /** Path to log file for detailed metrics (optional) */
  logFile?: string;
  /** Include detailed breakdown (memory, pid, etc.) */
  detailed?: boolean;
  /** Threshold in ms to warn about slow execution (default: 100) */
  warnThresholdMs?: number;
  /** Collect aggregate stats to ~/.claude/hook-metrics.json (default: true) */
  collectStats?: boolean;
}

/**
 * Options for event-logger handler
 */
export interface EventLoggerOptions {
  /** Base directory for hook logs (default: ~/.claude/hooks) */
  outputDir?: string;
  /** Include full hook input payload (default: true) */
  includeInput?: boolean;
  /** Include hook context (transcript_path, cwd, etc.) (default: true) */
  includeContext?: boolean;
  /** Include results from other handlers (default: true) */
  includeHandlerResults?: boolean;
  /** Event types to log (default: all) */
  events?: string[];
}

/**
 * Map of built-in handler types to their options
 */
export interface BuiltinHandlerOptions {
  'session-naming': SessionNamingOptions;
  'dangerous-command-guard': DangerousCommandGuardOptions;
  'context-injection': ContextInjectionOptions;
  'tool-logger': ToolLoggerOptions;
  'turn-tracker': TurnTrackerOptions;
  'debug-logger': DebugLoggerOptions;
  'metrics': MetricsOptions;
  'event-logger': EventLoggerOptions;
}

// ============================================================================
// Handler Configuration
// ============================================================================

/**
 * Configuration for a single handler (built-in or custom)
 */
export interface HandlerConfig<T extends BuiltinHandlerType = BuiltinHandlerType> {
  /** Whether this handler is enabled (default: true) */
  enabled?: boolean;
  /** Execution priority (lower = earlier, default: 100) */
  priority?: number;
  /** Handler-specific options */
  options?: T extends keyof BuiltinHandlerOptions
    ? BuiltinHandlerOptions[T]
    : Record<string, unknown>;
  /** Event types this handler responds to (default: depends on handler) */
  events?: HookEventType[];
  /** Handler IDs that must run before this one */
  after?: string[];
  /** Error handling strategy */
  onError?: ErrorStrategy;
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Built-in handlers configuration block
 */
export interface BuiltinsConfig {
  'session-naming'?: HandlerConfig<'session-naming'>;
  'dangerous-command-guard'?: HandlerConfig<'dangerous-command-guard'>;
  'context-injection'?: HandlerConfig<'context-injection'>;
  'tool-logger'?: HandlerConfig<'tool-logger'>;
  'turn-tracker'?: HandlerConfig<'turn-tracker'>;
  'debug-logger'?: HandlerConfig<'debug-logger'>;
  'metrics'?: HandlerConfig<'metrics'>;
  'event-logger'?: HandlerConfig<'event-logger'>;
}

/**
 * Custom handler configuration
 */
export interface CustomHandlerConfig extends HandlerConfig {
  /** Path to handler script (for external handlers) */
  command?: string;
  /** Inline handler function (for TypeScript configs) */
  handler?: string;
}

// ============================================================================
// Root Configuration
// ============================================================================

/**
 * Global settings for the hook framework
 */
export interface FrameworkSettings {
  /** Enable debug logging */
  debug?: boolean;
  /** Enable parallel execution where dependencies allow */
  parallelExecution?: boolean;
  /** Default timeout for all handlers (ms) */
  defaultTimeoutMs?: number;
  /** Default error strategy for all handlers */
  defaultErrorStrategy?: ErrorStrategy;
}

/**
 * Root YAML configuration structure
 */
export interface YamlConfig {
  /** Configuration version (currently: 1) */
  version: number;
  /** Global framework settings */
  settings?: FrameworkSettings;
  /** Built-in handler configurations */
  builtins?: BuiltinsConfig;
  /** Custom handler configurations */
  handlers?: Record<string, CustomHandlerConfig>;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation error details
 */
export interface ValidationError {
  /** Path to the field with error (e.g., 'builtins.session-naming.options.format') */
  path: string;
  /** Error message */
  message: string;
  /** Expected type or value */
  expected?: string;
  /** Actual value received */
  actual?: unknown;
}

/**
 * Validation result
 */
export interface ValidationResult {
  /** Whether the config is valid */
  valid: boolean;
  /** List of validation errors (empty if valid) */
  errors: ValidationError[];
  /** Warnings that don't prevent loading */
  warnings: ValidationError[];
}

// ============================================================================
// Resolved Configuration
// ============================================================================

/**
 * Fully resolved handler configuration (with defaults applied)
 */
export interface ResolvedHandlerConfig {
  id: string;
  type: BuiltinHandlerType | 'custom';
  enabled: boolean;
  priority: number;
  events: HookEventType[];
  after: string[];
  onError: ErrorStrategy;
  timeoutMs: number;
  options: Record<string, unknown>;
  /** Command to execute for custom handlers */
  command?: string;
}

/**
 * Fully resolved configuration (with all defaults applied)
 */
export interface ResolvedConfig {
  version: number;
  settings: Required<FrameworkSettings>;
  handlers: ResolvedHandlerConfig[];
}

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Factory function for creating built-in handlers
 */
export type BuiltinHandlerFactory<T extends BuiltinHandlerType = BuiltinHandlerType> = (
  options: T extends keyof BuiltinHandlerOptions
    ? BuiltinHandlerOptions[T]
    : Record<string, unknown>
) => import('../types').HandlerDefinition;
