/**
 * Hook Framework
 *
 * Central orchestrator for managing hook pipelines across all event types.
 * Provides a single entry point for hook execution with:
 *
 * - Multiple pipelines per event type
 * - Global handlers that run for all events
 * - Configuration loading from files
 * - Event filtering and routing
 *
 * Usage:
 * ```typescript
 * const framework = new HookFramework();
 *
 * // Register handlers
 * framework.on('PostToolUse', handler()
 *   .id('log-tool')
 *   .handle(ctx => {
 *     console.log(`Tool: ${ctx.event.tool_name}`);
 *     return handlerResult();
 *   })
 * );
 *
 * // Run as hook
 * await framework.run();
 * ```
 */

import * as fs from 'node:fs';
import type { HookEvent } from '../types';
import { type HookPipeline, createPipeline } from './pipeline';
import type { HandlerDefinition, HookOutput, PipelineConfig, PipelineResult } from './types';

// ============================================================================
// Hook Event Types
// ============================================================================

export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'SessionStart'
  | 'SessionEnd'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'Setup';

// ============================================================================
// Framework Configuration
// ============================================================================

export interface FrameworkConfig<TState = Record<string, unknown>> {
  /** Enable debug logging */
  debug?: boolean;

  /** Default timeout for all handlers */
  defaultTimeoutMs?: number;

  /** Default error strategy */
  defaultErrorStrategy?: 'continue' | 'stop' | 'retry';

  /** Initial state factory */
  initialState?: () => TState;

  /** Global handlers that run for ALL events */
  globalHandlers?: HandlerDefinition<TState>[];

  /** Configuration file path */
  configPath?: string;
}

// ============================================================================
// Hook Framework
// ============================================================================

export class HookFramework<TState = Record<string, unknown>> {
  private pipelines: Map<HookEventType, HookPipeline<TState>> = new Map();
  private globalHandlers: HandlerDefinition<TState>[] = [];
  private config: FrameworkConfig<TState>;

  constructor(config: FrameworkConfig<TState> = {}) {
    this.config = {
      debug: false,
      defaultTimeoutMs: 30000,
      defaultErrorStrategy: 'continue',
      ...config,
    };

    if (config.globalHandlers) {
      this.globalHandlers = [...config.globalHandlers];
    }

    // Initialize pipelines for all event types
    for (const eventType of this.getAllEventTypes()) {
      this.pipelines.set(
        eventType,
        createPipeline({
          id: `${eventType}-pipeline`,
          eventType,
          handlers: [],
          defaultTimeoutMs: this.config.defaultTimeoutMs,
          defaultErrorStrategy: this.config.defaultErrorStrategy,
          initialState: this.config.initialState,
        })
      );
    }
  }

  /**
   * Register a handler for a specific event type
   */
  on(eventType: HookEventType, handler: HandlerDefinition<TState>): this {
    const pipeline = this.pipelines.get(eventType);
    if (!pipeline) {
      throw new Error(`Unknown event type: ${eventType}`);
    }
    pipeline.addHandler(handler);
    return this;
  }

  /**
   * Register a handler for multiple event types
   */
  onMany(eventTypes: HookEventType[], handler: HandlerDefinition<TState>): this {
    for (const eventType of eventTypes) {
      this.on(eventType, { ...handler, id: `${handler.id}-${eventType}` });
    }
    return this;
  }

  /**
   * Register a global handler that runs for ALL events
   */
  onAll(handler: HandlerDefinition<TState>): this {
    this.globalHandlers.push(handler);
    // Add to all existing pipelines
    for (const pipeline of this.pipelines.values()) {
      pipeline.addHandler({ ...handler, id: `global-${handler.id}` });
    }
    return this;
  }

  /**
   * Register handlers for PreToolUse event
   */
  onPreToolUse(handler: HandlerDefinition<TState>): this {
    return this.on('PreToolUse', handler);
  }

  /**
   * Register handlers for PostToolUse event
   */
  onPostToolUse(handler: HandlerDefinition<TState>): this {
    return this.on('PostToolUse', handler);
  }

  /**
   * Register handlers for SessionStart event
   */
  onSessionStart(handler: HandlerDefinition<TState>): this {
    return this.on('SessionStart', handler);
  }

  /**
   * Register handlers for SessionEnd event
   */
  onSessionEnd(handler: HandlerDefinition<TState>): this {
    return this.on('SessionEnd', handler);
  }

  /**
   * Register handlers for Stop event
   */
  onStop(handler: HandlerDefinition<TState>): this {
    return this.on('Stop', handler);
  }

  /**
   * Register handlers for tool-specific events
   */
  onTool(toolName: string, handler: HandlerDefinition<TState>): this {
    // Add condition to check tool name
    const wrappedHandler: HandlerDefinition<TState> = {
      ...handler,
      id: `${handler.id}-${toolName}`,
      condition: (ctx) => {
        const eventData = ctx.event as unknown as Record<string, unknown>;
        return eventData.tool_name === toolName;
      },
    };
    return this.on('PreToolUse', wrappedHandler).on('PostToolUse', { ...wrappedHandler });
  }

  /**
   * Execute pipeline for a specific event
   */
  async execute(eventType: HookEventType, event: HookEvent): Promise<PipelineResult<TState>> {
    const pipeline = this.pipelines.get(eventType);
    if (!pipeline) {
      throw new Error(`Unknown event type: ${eventType}`);
    }

    if (this.config.debug) {
      console.error(`[HookFramework] Executing ${eventType} pipeline`);
    }

    const result = await pipeline.execute(event);

    if (this.config.debug) {
      console.error(`[HookFramework] ${eventType} completed in ${result.durationMs}ms`);
      console.error(`[HookFramework] Executed: ${result.executedHandlers.join(', ') || 'none'}`);
      if (result.failedHandlers.length > 0) {
        console.error(`[HookFramework] Failed: ${result.failedHandlers.join(', ')}`);
      }
    }

    return result;
  }

  /**
   * Run the framework as a CLI hook (reads from stdin, writes to stdout)
   */
  async run(): Promise<void> {
    try {
      // Read event from stdin
      const input = await this.readStdin();
      const event = JSON.parse(input) as HookEvent & { hook_event_name?: string };

      // Determine event type
      const eventType = this.detectEventType(event);

      if (this.config.debug) {
        console.error(`[HookFramework] Detected event type: ${eventType}`);
      }

      // Execute pipeline
      const result = await this.execute(eventType, event);

      // Output result
      this.writeOutput(result.hookOutput);
    } catch (error) {
      if (this.config.debug) {
        console.error(`[HookFramework] Error: ${error}`);
      }
      // Output empty result on error (don't block)
      this.writeOutput({});
    }
  }

  /**
   * Read from stdin
   */
  private async readStdin(): Promise<string> {
    const chunks: Uint8Array[] = [];

    return new Promise((resolve, reject) => {
      process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
      process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      process.stdin.on('error', reject);
    });
  }

  /**
   * Detect event type from event data
   */
  private detectEventType(event: HookEvent & { hook_event_name?: string }): HookEventType {
    // Check for explicit event name
    if (event.hook_event_name) {
      return event.hook_event_name as HookEventType;
    }

    // Infer from event structure
    const e = event as unknown as Record<string, unknown>;

    if (e.tool_name !== undefined && e.tool_input !== undefined && e.tool_result === undefined) {
      return 'PreToolUse';
    }
    if (e.tool_name !== undefined && e.tool_result !== undefined) {
      return 'PostToolUse';
    }
    if (e.session_id !== undefined && e.is_resume !== undefined) {
      return 'SessionStart';
    }
    if (e.stop_reason !== undefined) {
      return 'Stop';
    }
    if (e.type === 'compact') {
      return 'PreCompact';
    }
    if (e.message !== undefined && e.title !== undefined) {
      return 'Notification';
    }
    if (e.prompt !== undefined) {
      return 'UserPromptSubmit';
    }
    if (e.type === 'setup') {
      return 'Setup';
    }

    // Default to PostToolUse for unknown events
    return 'PostToolUse';
  }

  /**
   * Write output to stdout
   */
  private writeOutput(output: HookOutput): void {
    // Format for Claude Code
    if (output.decision === 'block') {
      console.log(JSON.stringify({ decision: 'block', reason: output.reason }));
    } else if (output.context) {
      console.log(output.context);
    } else {
      // Empty output means approve/continue
      console.log('');
    }
  }

  /**
   * Get all supported event types
   */
  private getAllEventTypes(): HookEventType[] {
    return [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'SubagentStop',
      'PreCompact',
      'Notification',
      'UserPromptSubmit',
      'Setup',
    ];
  }

  /**
   * Load configuration from file
   */
  loadConfig(configPath: string): this {
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as {
      debug?: boolean;
      defaultTimeoutMs?: number;
      handlers?: Array<{
        id: string;
        events: HookEventType[];
        priority?: number;
        dependsOn?: string[];
        command?: string;
      }>;
    };

    if (config.debug !== undefined) {
      this.config.debug = config.debug;
    }
    if (config.defaultTimeoutMs !== undefined) {
      this.config.defaultTimeoutMs = config.defaultTimeoutMs;
    }

    // Note: Command-based handlers would need a different executor
    // This is a placeholder for future extension

    return this;
  }

  /**
   * Get pipeline for event type
   */
  getPipeline(eventType: HookEventType): HookPipeline<TState> | undefined {
    return this.pipelines.get(eventType);
  }

  /**
   * Get all registered handlers for an event type
   */
  getHandlers(eventType: HookEventType): HandlerDefinition<TState>[] {
    const pipeline = this.pipelines.get(eventType);
    return pipeline ? pipeline.getHandlers() : [];
  }

  /**
   * Remove a handler by ID from a specific event
   */
  removeHandler(eventType: HookEventType, handlerId: string): boolean {
    const pipeline = this.pipelines.get(eventType);
    return pipeline ? pipeline.removeHandler(handlerId) : false;
  }

  /**
   * Clear all handlers for an event type
   */
  clearHandlers(eventType: HookEventType): this {
    const pipeline = this.pipelines.get(eventType);
    if (pipeline) {
      for (const handler of pipeline.getHandlers()) {
        pipeline.removeHandler(handler.id);
      }
    }
    return this;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new hook framework
 */
export function createFramework<TState = Record<string, unknown>>(
  config?: FrameworkConfig<TState>
): HookFramework<TState> {
  return new HookFramework(config);
}

/**
 * Create and run a framework (convenience function)
 */
export async function runFramework<TState = Record<string, unknown>>(
  setup: (framework: HookFramework<TState>) => void,
  config?: FrameworkConfig<TState>
): Promise<void> {
  const framework = createFramework(config);
  setup(framework);
  await framework.run();
}
