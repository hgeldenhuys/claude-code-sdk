/**
 * Fluent Handler Builder
 *
 * Provides a clean API for defining handlers:
 *
 * ```typescript
 * const handler = handler<MyState>()
 *   .id('log-tool-use')
 *   .name('Log Tool Use')
 *   .priority(10)
 *   .after('validate-input')
 *   .when(ctx => ctx.event.tool_name === 'Bash')
 *   .timeout(5000)
 *   .onError('continue')
 *   .handle(async (ctx) => {
 *     console.log(`Tool: ${ctx.event.tool_name}`);
 *     return { success: true, durationMs: 0 };
 *   });
 * ```
 */

import type { HandlerDefinition, HandlerFn, ConditionFn, ErrorStrategy } from './types';

export class HandlerBuilder<TState = Record<string, unknown>> {
  private definition: Partial<HandlerDefinition<TState>> = {
    priority: 100,
    enabled: true,
    dependsOn: [],
    tags: [],
  };

  /**
   * Set handler ID (required)
   */
  id(id: string): this {
    this.definition.id = id;
    return this;
  }

  /**
   * Set handler name
   */
  name(name: string): this {
    this.definition.name = name;
    return this;
  }

  /**
   * Set handler description
   */
  description(desc: string): this {
    this.definition.description = desc;
    return this;
  }

  /**
   * Set execution priority (lower = earlier)
   */
  priority(priority: number): this {
    this.definition.priority = priority;
    return this;
  }

  /**
   * Add dependency on other handlers (must complete before this one)
   */
  after(...handlerIds: string[]): this {
    this.definition.dependsOn = [...(this.definition.dependsOn ?? []), ...handlerIds];
    return this;
  }

  /**
   * Alias for after()
   */
  dependsOn(...handlerIds: string[]): this {
    return this.after(...handlerIds);
  }

  /**
   * Add condition for execution
   */
  when(condition: ConditionFn<TState>): this {
    this.definition.condition = condition;
    return this;
  }

  /**
   * Condition: only run for specific tool names
   */
  forTools(...toolNames: string[]): this {
    const toolSet = new Set(toolNames);
    return this.when((ctx) => {
      const eventData = ctx.event as unknown as Record<string, unknown>;
      const toolName = eventData.tool_name as string;
      return toolSet.has(toolName);
    });
  }

  /**
   * Condition: only run if previous handler succeeded
   */
  ifSucceeded(handlerId: string): this {
    return this.when((ctx) => {
      const result = ctx.results.get(handlerId);
      return result?.success === true;
    });
  }

  /**
   * Condition: only run if previous handler failed
   */
  ifFailed(handlerId: string): this {
    return this.when((ctx) => {
      const result = ctx.results.get(handlerId);
      return result?.success === false;
    });
  }

  /**
   * Set error handling strategy
   */
  onError(strategy: ErrorStrategy): this {
    this.definition.onError = strategy;
    return this;
  }

  /**
   * Set timeout in milliseconds
   */
  timeout(ms: number): this {
    this.definition.timeoutMs = ms;
    return this;
  }

  /**
   * Set max retry attempts (requires onError('retry'))
   */
  maxRetries(attempts: number): this {
    this.definition.maxRetries = attempts;
    return this;
  }

  /**
   * Add tags for filtering/grouping
   */
  tags(...tags: string[]): this {
    this.definition.tags = [...(this.definition.tags ?? []), ...tags];
    return this;
  }

  /**
   * Enable or disable handler
   */
  enabled(enabled: boolean): this {
    this.definition.enabled = enabled;
    return this;
  }

  /**
   * Set the handler function and return the definition
   */
  handle(fn: HandlerFn<TState>): HandlerDefinition<TState> {
    if (!this.definition.id) {
      throw new Error('Handler ID is required. Call .id() before .handle()');
    }

    return {
      ...this.definition,
      id: this.definition.id,
      handler: fn,
    } as HandlerDefinition<TState>;
  }
}

/**
 * Create a new handler builder
 */
export function handler<TState = Record<string, unknown>>(): HandlerBuilder<TState> {
  return new HandlerBuilder<TState>();
}

// ============================================================================
// Common Handler Factories
// ============================================================================

/**
 * Create a logging handler
 */
export function logHandler<TState = Record<string, unknown>>(
  id: string,
  logFn: (ctx: import('./types').PipelineContext<TState>) => string
): HandlerDefinition<TState> {
  return handler<TState>()
    .id(id)
    .name(`Log: ${id}`)
    .priority(1) // Logging usually runs first
    .handle((ctx) => {
      console.log(logFn(ctx));
      return { success: true, durationMs: 0 };
    });
}

/**
 * Create a validation handler that can block
 */
export function validateHandler<TState = Record<string, unknown>>(
  id: string,
  validateFn: (ctx: import('./types').PipelineContext<TState>) => { valid: boolean; reason?: string }
): HandlerDefinition<TState> {
  return handler<TState>()
    .id(id)
    .name(`Validate: ${id}`)
    .priority(10) // Validation runs early
    .handle((ctx) => {
      const { valid, reason } = validateFn(ctx);
      if (!valid) {
        return { success: true, durationMs: 0, block: true, blockReason: reason };
      }
      return { success: true, durationMs: 0 };
    });
}

/**
 * Create a context injection handler
 */
export function contextHandler<TState = Record<string, unknown>>(
  id: string,
  contextFn: (ctx: import('./types').PipelineContext<TState>) => string | null
): HandlerDefinition<TState> {
  return handler<TState>()
    .id(id)
    .name(`Context: ${id}`)
    .handle((ctx) => {
      const context = contextFn(ctx);
      if (context) {
        return { success: true, durationMs: 0, contextToInject: context };
      }
      return { success: true, durationMs: 0 };
    });
}

/**
 * Create a state mutation handler
 */
export function mutateHandler<TState = Record<string, unknown>>(
  id: string,
  mutateFn: (state: TState, ctx: import('./types').PipelineContext<TState>) => void
): HandlerDefinition<TState> {
  return handler<TState>()
    .id(id)
    .name(`Mutate: ${id}`)
    .handle((ctx) => {
      mutateFn(ctx.state, ctx);
      return { success: true, durationMs: 0 };
    });
}
