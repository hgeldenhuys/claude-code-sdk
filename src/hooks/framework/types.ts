/**
 * Hook Framework Types
 *
 * A flexible hook orchestration system that provides:
 * - Sequential/parallel execution control
 * - Dependency chains between handlers
 * - Conditional execution
 * - Shared context/state
 * - Error handling strategies
 */

import type { HookEvent } from '../types';

// ============================================================================
// Core Types
// ============================================================================

/**
 * Context passed through all handlers in a pipeline.
 * Handlers can read from and write to this shared state.
 */
export interface PipelineContext<T = Record<string, unknown>> {
  /** The original hook event data */
  event: HookEvent;

  /** The hook event type (e.g., 'PostToolUse', 'SessionStart') */
  eventType: string;

  /** Shared state that handlers can read/write */
  state: T;

  /** Results from completed handlers, keyed by handler ID */
  results: Map<string, HandlerResult>;

  /** Timestamp when pipeline started */
  startedAt: Date;

  /** Session ID if available */
  sessionId?: string;

  /** Project directory */
  cwd: string;
}

/**
 * Result returned by a handler
 */
export interface HandlerResult {
  /** Whether the handler succeeded */
  success: boolean;

  /** Output data from the handler */
  data?: unknown;

  /** Error if handler failed */
  error?: Error;

  /** Execution time in milliseconds */
  durationMs: number;

  /** Whether to block the tool (for PreToolUse) */
  block?: boolean;

  /** Reason for blocking */
  blockReason?: string;

  /** Context to inject (for SessionStart, PreCompact) */
  contextToInject?: string;
}

/**
 * Handler function signature
 */
export type HandlerFn<TState = Record<string, unknown>> = (
  ctx: PipelineContext<TState>
) => Promise<HandlerResult> | HandlerResult;

/**
 * Condition function to determine if handler should run
 */
export type ConditionFn<TState = Record<string, unknown>> = (
  ctx: PipelineContext<TState>
) => boolean | Promise<boolean>;

/**
 * Error handling strategy
 */
export type ErrorStrategy =
  | 'continue' // Continue with next handler
  | 'stop' // Stop pipeline execution
  | 'retry'; // Retry the handler (with backoff)

/**
 * Handler definition
 */
export interface HandlerDefinition<TState = Record<string, unknown>> {
  /** Unique identifier for this handler */
  id: string;

  /** Human-readable name */
  name?: string;

  /** Description of what this handler does */
  description?: string;

  /** The handler function */
  handler: HandlerFn<TState>;

  /** Execution priority (lower = earlier). Default: 100 */
  priority?: number;

  /** IDs of handlers that must complete before this one */
  dependsOn?: string[];

  /** Condition that must be true for handler to run */
  condition?: ConditionFn<TState>;

  /** Error handling strategy. Default: 'continue' */
  onError?: ErrorStrategy;

  /** Timeout in milliseconds. Default: 30000 */
  timeoutMs?: number;

  /** Maximum retry attempts (if onError is 'retry'). Default: 3 */
  maxRetries?: number;

  /** Whether this handler is enabled. Default: true */
  enabled?: boolean;

  /** Tags for filtering/grouping */
  tags?: string[];
}

// ============================================================================
// Pipeline Types
// ============================================================================

/**
 * Pipeline configuration
 */
export interface PipelineConfig<TState = Record<string, unknown>> {
  /** Pipeline identifier */
  id: string;

  /** Human-readable name */
  name?: string;

  /** Hook event type this pipeline handles */
  eventType: string;

  /** Handlers in this pipeline */
  handlers: HandlerDefinition<TState>[];

  /** Default error strategy for all handlers */
  defaultErrorStrategy?: ErrorStrategy;

  /** Default timeout for all handlers */
  defaultTimeoutMs?: number;

  /** Whether to run handlers in parallel where possible (respecting dependencies) */
  parallelExecution?: boolean;

  /** Initial state factory */
  initialState?: () => TState;

  /** Called before pipeline starts */
  onStart?: (ctx: PipelineContext<TState>) => void | Promise<void>;

  /** Called after pipeline completes */
  onComplete?: (ctx: PipelineContext<TState>) => void | Promise<void>;

  /** Called when any handler errors */
  onError?: (error: Error, handlerId: string, ctx: PipelineContext<TState>) => void | Promise<void>;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult<TState = Record<string, unknown>> {
  /** Whether all handlers succeeded */
  success: boolean;

  /** Final context state */
  context: PipelineContext<TState>;

  /** Handlers that executed */
  executedHandlers: string[];

  /** Handlers that were skipped (condition false) */
  skippedHandlers: string[];

  /** Handlers that failed */
  failedHandlers: string[];

  /** Total execution time in milliseconds */
  durationMs: number;

  /** Combined output for Claude Code hook response */
  hookOutput: HookOutput;
}

/**
 * Output format for Claude Code hooks
 */
export interface HookOutput {
  /** Whether to block the tool (PreToolUse only) */
  decision?: 'block' | 'approve';

  /** Reason for blocking */
  reason?: string;

  /** Context to inject */
  context?: string;

  /** Metadata for debugging */
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Handler registry for managing handlers across pipelines
 */
export interface HandlerRegistry<TState = Record<string, unknown>> {
  /** Register a handler */
  register(handler: HandlerDefinition<TState>): void;

  /** Unregister a handler by ID */
  unregister(id: string): boolean;

  /** Get a handler by ID */
  get(id: string): HandlerDefinition<TState> | undefined;

  /** Get all handlers */
  getAll(): HandlerDefinition<TState>[];

  /** Get handlers by tag */
  getByTag(tag: string): HandlerDefinition<TState>[];

  /** Get handlers for an event type */
  getForEvent(eventType: string): HandlerDefinition<TState>[];

  /** Clear all handlers */
  clear(): void;
}

// ============================================================================
// Builder Types
// ============================================================================

/**
 * Fluent builder for creating handlers
 */
export interface HandlerBuilder<TState = Record<string, unknown>> {
  /** Set handler ID */
  id(id: string): this;

  /** Set handler name */
  name(name: string): this;

  /** Set handler description */
  description(desc: string): this;

  /** Set execution priority */
  priority(priority: number): this;

  /** Add dependency on another handler */
  after(...handlerIds: string[]): this;

  /** Add condition for execution */
  when(condition: ConditionFn<TState>): this;

  /** Set error strategy */
  onError(strategy: ErrorStrategy): this;

  /** Set timeout */
  timeout(ms: number): this;

  /** Add tags */
  tags(...tags: string[]): this;

  /** Set the handler function */
  handle(fn: HandlerFn<TState>): HandlerDefinition<TState>;
}

// ============================================================================
// Event-Specific Types
// ============================================================================

/**
 * PreToolUse specific context additions
 */
export interface PreToolUseContext {
  toolName: string;
  toolInput: Record<string, unknown>;
}

/**
 * PostToolUse specific context additions
 */
export interface PostToolUseContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: unknown;
}

/**
 * SessionStart specific context additions
 */
export interface SessionStartContext {
  sessionId: string;
  isResume: boolean;
}

/**
 * Stop specific context additions
 */
export interface StopContext {
  stopReason: string;
  stats?: {
    messagesCount: number;
    toolUseCount: number;
    durationMs: number;
  };
}
