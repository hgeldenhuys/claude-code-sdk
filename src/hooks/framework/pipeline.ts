/**
 * Hook Pipeline Executor
 *
 * Executes handlers in dependency order with support for:
 * - Parallel execution where dependencies allow
 * - Conditional execution
 * - Error handling and retries
 * - Shared context/state
 */

import type { HookEvent } from '../types';
import type {
  HandlerDefinition,
  HandlerResult,
  HookOutput,
  PipelineConfig,
  PipelineContext,
  PipelineResult,
} from './types';

// ============================================================================
// Pipeline Executor
// ============================================================================

export class HookPipeline<TState = Record<string, unknown>> {
  private config: PipelineConfig<TState>;
  private sortedHandlers: HandlerDefinition<TState>[] | null = null;

  constructor(config: PipelineConfig<TState>) {
    this.config = {
      defaultErrorStrategy: 'continue',
      defaultTimeoutMs: 30000,
      parallelExecution: true,
      ...config,
    };
  }

  /**
   * Execute the pipeline with the given event
   */
  async execute(event: HookEvent): Promise<PipelineResult<TState>> {
    const startTime = Date.now();

    // Initialize context
    const eventData = event as unknown as Record<string, unknown>;
    const context: PipelineContext<TState> = {
      event,
      eventType: this.config.eventType,
      state: this.config.initialState?.() ?? ({} as TState),
      results: new Map(),
      startedAt: new Date(),
      sessionId: eventData.session_id as string | undefined,
      cwd: (eventData.cwd as string) || process.cwd(),
    };

    const executedHandlers: string[] = [];
    const skippedHandlers: string[] = [];
    const failedHandlers: string[] = [];

    try {
      // Call onStart hook
      await this.config.onStart?.(context);

      // Get sorted handlers (topological sort based on dependencies)
      const handlers = this.getSortedHandlers();

      if (this.config.parallelExecution) {
        // Execute with parallel optimization
        await this.executeParallel(
          handlers,
          context,
          executedHandlers,
          skippedHandlers,
          failedHandlers
        );
      } else {
        // Execute sequentially
        await this.executeSequential(
          handlers,
          context,
          executedHandlers,
          skippedHandlers,
          failedHandlers
        );
      }

      // Call onComplete hook
      await this.config.onComplete?.(context);
    } catch (error) {
      // Pipeline-level error
      console.error(`[HookPipeline] Pipeline error: ${error}`);
    }

    const durationMs = Date.now() - startTime;

    return {
      success: failedHandlers.length === 0,
      context,
      executedHandlers,
      skippedHandlers,
      failedHandlers,
      durationMs,
      hookOutput: this.buildHookOutput(context),
    };
  }

  /**
   * Execute handlers sequentially
   */
  private async executeSequential(
    handlers: HandlerDefinition<TState>[],
    context: PipelineContext<TState>,
    executedHandlers: string[],
    skippedHandlers: string[],
    failedHandlers: string[]
  ): Promise<void> {
    for (const handler of handlers) {
      if (!this.isHandlerEnabled(handler)) {
        skippedHandlers.push(handler.id);
        continue;
      }

      const shouldRun = await this.checkCondition(handler, context);
      if (!shouldRun) {
        skippedHandlers.push(handler.id);
        continue;
      }

      const result = await this.executeHandler(handler, context);
      context.results.set(handler.id, result);

      if (result.success) {
        executedHandlers.push(handler.id);
      } else {
        failedHandlers.push(handler.id);
        await this.config.onError?.(result.error!, handler.id, context);

        const strategy = handler.onError ?? this.config.defaultErrorStrategy;
        if (strategy === 'stop') {
          break;
        }
      }
    }
  }

  /**
   * Execute handlers in parallel where dependencies allow
   */
  private async executeParallel(
    handlers: HandlerDefinition<TState>[],
    context: PipelineContext<TState>,
    executedHandlers: string[],
    skippedHandlers: string[],
    failedHandlers: string[]
  ): Promise<void> {
    const completed = new Set<string>();
    const pending = new Set(handlers.map((h) => h.id));
    const handlerMap = new Map(handlers.map((h) => [h.id, h]));

    while (pending.size > 0) {
      // Find handlers that can run (all dependencies satisfied)
      const ready: HandlerDefinition<TState>[] = [];

      for (const id of pending) {
        const handler = handlerMap.get(id)!;
        const deps = handler.dependsOn ?? [];
        const allDepsSatisfied = deps.every((dep) => completed.has(dep));

        if (allDepsSatisfied) {
          ready.push(handler);
        }
      }

      if (ready.length === 0 && pending.size > 0) {
        // Circular dependency or missing dependency
        console.error(
          `[HookPipeline] Circular or missing dependency detected. Pending: ${[...pending].join(', ')}`
        );
        for (const id of pending) {
          failedHandlers.push(id);
        }
        break;
      }

      // Execute ready handlers in parallel
      const results = await Promise.all(
        ready.map(async (handler) => {
          pending.delete(handler.id);

          if (!this.isHandlerEnabled(handler)) {
            skippedHandlers.push(handler.id);
            completed.add(handler.id);
            return { handler, result: null, skipped: true };
          }

          const shouldRun = await this.checkCondition(handler, context);
          if (!shouldRun) {
            skippedHandlers.push(handler.id);
            completed.add(handler.id);
            return { handler, result: null, skipped: true };
          }

          const result = await this.executeHandler(handler, context);
          return { handler, result, skipped: false };
        })
      );

      // Process results
      let shouldStop = false;
      for (const { handler, result, skipped } of results) {
        if (skipped || !result) {
          continue;
        }

        context.results.set(handler.id, result);
        completed.add(handler.id);

        if (result.success) {
          executedHandlers.push(handler.id);
        } else {
          failedHandlers.push(handler.id);
          await this.config.onError?.(result.error!, handler.id, context);

          const strategy = handler.onError ?? this.config.defaultErrorStrategy;
          if (strategy === 'stop') {
            shouldStop = true;
          }
        }
      }

      if (shouldStop) {
        // Mark remaining as skipped
        for (const id of pending) {
          skippedHandlers.push(id);
        }
        break;
      }
    }
  }

  /**
   * Execute a single handler with timeout and retry support
   */
  private async executeHandler(
    handler: HandlerDefinition<TState>,
    context: PipelineContext<TState>
  ): Promise<HandlerResult> {
    const timeoutMs = handler.timeoutMs ?? this.config.defaultTimeoutMs ?? 30000;
    const maxRetries = handler.maxRetries ?? 3;
    const strategy = handler.onError ?? this.config.defaultErrorStrategy;

    let lastError: Error | undefined;
    let attempts = 0;

    while (attempts < (strategy === 'retry' ? maxRetries : 1)) {
      attempts++;
      const startTime = Date.now();

      try {
        const result = await this.executeWithTimeout(handler.handler(context), timeoutMs);
        return {
          ...result,
          success: true,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (strategy !== 'retry' || attempts >= maxRetries) {
          return {
            success: false,
            error: lastError,
            durationMs: Date.now() - startTime,
          };
        }

        // Exponential backoff for retry
        const backoffMs = Math.min(1000 * 2 ** (attempts - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    return {
      success: false,
      error: lastError ?? new Error('Unknown error'),
      durationMs: 0,
    };
  }

  /**
   * Execute a promise with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
    if (!(promise instanceof Promise)) {
      return promise;
    }

    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  /**
   * Check if handler condition is met
   */
  private async checkCondition(
    handler: HandlerDefinition<TState>,
    context: PipelineContext<TState>
  ): Promise<boolean> {
    if (!handler.condition) {
      return true;
    }

    try {
      return await handler.condition(context);
    } catch (error) {
      console.error(`[HookPipeline] Condition error for ${handler.id}: ${error}`);
      return false;
    }
  }

  /**
   * Check if handler is enabled
   */
  private isHandlerEnabled(handler: HandlerDefinition<TState>): boolean {
    return handler.enabled !== false;
  }

  /**
   * Get handlers sorted by priority and dependencies (topological sort)
   */
  private getSortedHandlers(): HandlerDefinition<TState>[] {
    if (this.sortedHandlers) {
      return this.sortedHandlers;
    }

    const handlers = [...this.config.handlers];

    // Sort by priority first
    handlers.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    // Topological sort for dependencies
    const sorted: HandlerDefinition<TState>[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const handlerMap = new Map(handlers.map((h) => [h.id, h]));

    const visit = (handler: HandlerDefinition<TState>) => {
      if (visited.has(handler.id)) return;
      if (visiting.has(handler.id)) {
        throw new Error(`Circular dependency detected: ${handler.id}`);
      }

      visiting.add(handler.id);

      for (const depId of handler.dependsOn ?? []) {
        const dep = handlerMap.get(depId);
        if (dep) {
          visit(dep);
        }
      }

      visiting.delete(handler.id);
      visited.add(handler.id);
      sorted.push(handler);
    };

    for (const handler of handlers) {
      visit(handler);
    }

    this.sortedHandlers = sorted;
    return sorted;
  }

  /**
   * Build the hook output from context
   */
  private buildHookOutput(context: PipelineContext<TState>): HookOutput {
    const output: HookOutput = {};

    // Check for any blocking results
    for (const [, result] of context.results) {
      if (result.block) {
        output.decision = 'block';
        output.reason = result.blockReason;
        break;
      }
    }

    // Collect context to inject
    const contextParts: string[] = [];
    for (const [, result] of context.results) {
      if (result.contextToInject) {
        contextParts.push(result.contextToInject);
      }
    }
    if (contextParts.length > 0) {
      output.context = contextParts.join('\n\n');
    }

    return output;
  }

  /**
   * Add a handler to the pipeline
   */
  addHandler(handler: HandlerDefinition<TState>): this {
    this.config.handlers.push(handler);
    this.sortedHandlers = null; // Reset cache
    return this;
  }

  /**
   * Remove a handler by ID
   */
  removeHandler(id: string): boolean {
    const index = this.config.handlers.findIndex((h) => h.id === id);
    if (index >= 0) {
      this.config.handlers.splice(index, 1);
      this.sortedHandlers = null;
      return true;
    }
    return false;
  }

  /**
   * Get handler by ID
   */
  getHandler(id: string): HandlerDefinition<TState> | undefined {
    return this.config.handlers.find((h) => h.id === id);
  }

  /**
   * Get all handlers
   */
  getHandlers(): HandlerDefinition<TState>[] {
    return [...this.config.handlers];
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new pipeline
 */
export function createPipeline<TState = Record<string, unknown>>(
  config: PipelineConfig<TState>
): HookPipeline<TState> {
  return new HookPipeline(config);
}

/**
 * Create a simple handler result
 */
export function handlerResult(data?: unknown): HandlerResult {
  return { success: true, durationMs: 0, data };
}

/**
 * Create a blocking result (for PreToolUse)
 */
export function blockResult(reason: string): HandlerResult {
  return { success: true, durationMs: 0, block: true, blockReason: reason };
}

/**
 * Create a context injection result (for SessionStart, PreCompact)
 */
export function injectResult(context: string): HandlerResult {
  return { success: true, durationMs: 0, contextToInject: context };
}
