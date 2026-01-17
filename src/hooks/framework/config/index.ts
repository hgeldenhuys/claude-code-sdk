/**
 * Hook Framework Configuration
 *
 * YAML-based configuration system for the hook framework.
 *
 * @example
 * ```typescript
 * import { loadConfig, loadResolvedConfig } from 'claude-code-sdk/hooks/framework/config';
 *
 * // Load and validate config
 * const config = loadConfig('./hooks.yaml');
 *
 * // Load with all defaults applied
 * const resolved = loadResolvedConfig('./hooks.yaml');
 * ```
 */

// Types
export type {
  YamlConfig,
  HandlerConfig,
  BuiltinsConfig,
  CustomHandlerConfig,
  FrameworkSettings,
  BuiltinHandlerType,
  SessionNamingOptions,
  DangerousCommandGuardOptions,
  ContextInjectionOptions,
  ToolLoggerOptions,
  BuiltinHandlerOptions,
  ValidationError,
  ValidationResult,
  ResolvedConfig,
  ResolvedHandlerConfig,
  BuiltinHandlerFactory,
} from './types';

// Loader
export {
  loadConfig,
  loadConfigFile,
  loadResolvedConfig,
  resolveConfig,
  configExists,
  getConfigPath,
  createDefaultConfig,
} from './loader';

// Validator
export { validateConfig, formatValidationErrors, isValidConfig } from './validator';

// Type alias for backward compatibility with tests
export type { YamlConfig as HookConfig } from './types';

// Re-export createFrameworkFromConfig
export { createFrameworkFromConfig } from './framework-factory';
