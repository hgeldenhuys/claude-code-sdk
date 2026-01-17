/**
 * Hook Framework
 *
 * A flexible hook orchestration system for Claude Code that provides:
 * - Sequential/parallel execution control
 * - Dependency chains between handlers
 * - Conditional execution
 * - Shared context/state
 * - Error handling strategies
 *
 * @example
 * ```typescript
 * import { createFramework, handler, handlerResult, blockResult } from 'claude-code-sdk/hooks/framework';
 *
 * // Create framework
 * const framework = createFramework({ debug: true });
 *
 * // Register handlers with dependencies
 * framework.onPreToolUse(
 *   handler()
 *     .id('validate-bash')
 *     .forTools('Bash')
 *     .priority(10)
 *     .handle(ctx => {
 *       const input = ctx.event.tool_input as { command?: string };
 *       if (input.command?.includes('rm -rf')) {
 *         return blockResult('Dangerous command blocked');
 *       }
 *       return handlerResult();
 *     })
 * );
 *
 * framework.onPreToolUse(
 *   handler()
 *     .id('log-after-validate')
 *     .after('validate-bash')
 *     .handle(ctx => {
 *       console.log('Validation passed, logging...');
 *       return handlerResult();
 *     })
 * );
 *
 * // Run as CLI hook
 * await framework.run();
 * ```
 */

// Types
export type {
  PipelineContext,
  HandlerResult,
  HandlerFn,
  ConditionFn,
  ErrorStrategy,
  HandlerDefinition,
  PipelineConfig,
  PipelineResult,
  HookOutput,
  HandlerRegistry,
  HandlerBuilder as IHandlerBuilder,
  PreToolUseContext,
  PostToolUseContext,
  SessionStartContext,
  StopContext,
} from './types';

// Pipeline
export { HookPipeline, createPipeline, handlerResult, blockResult, injectResult } from './pipeline';

// Builder
export {
  HandlerBuilder,
  handler,
  logHandler,
  validateHandler,
  contextHandler,
  mutateHandler,
} from './builder';

// Framework
export type { HookEventType, FrameworkConfig } from './framework';
export { HookFramework, createFramework, runFramework } from './framework';

// Config
export * from './config';

// Built-in Handlers
export * from './handlers';

// Command Executor (for custom handlers)
export {
  executeCommand,
  createCommandHandler,
  buildFrameworkEnv,
  parseCommandOutput,
} from './command-executor';
export type {
  FrameworkEnvVars,
  CommandExecutionOptions,
  CommandExecutionResult,
} from './command-executor';

// Backward compatibility alias
export * from './builtins';
