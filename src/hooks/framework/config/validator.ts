/**
 * Configuration Schema Validator
 *
 * Validates YAML configuration against the expected schema.
 * Returns detailed error messages with field paths.
 */

import type {
  YamlConfig,
  ValidationResult,
  ValidationError,
  BuiltinHandlerType,
  HandlerConfig,
  FrameworkSettings,
  BuiltinsConfig,
  CustomHandlerConfig,
} from './types';
import type { ErrorStrategy } from '../types';
import type { HookEventType } from '../framework';

// ============================================================================
// Constants
// ============================================================================

const VALID_BUILTIN_HANDLERS: BuiltinHandlerType[] = [
  'session-naming',
  'dangerous-command-guard',
  'context-injection',
  'tool-logger',
];

const VALID_ERROR_STRATEGIES: ErrorStrategy[] = ['continue', 'stop', 'retry'];

const VALID_EVENT_TYPES: HookEventType[] = [
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

const VALID_SESSION_NAMING_FORMATS = ['adjective-animal', 'timestamp', 'uuid'];
const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'];
const VALID_LOG_FORMATS = ['json', 'text'];

// ============================================================================
// Main Validator
// ============================================================================

/**
 * Validate a YAML configuration object
 *
 * @param config - The parsed YAML configuration
 * @returns Validation result with errors and warnings
 */
export function validateConfig(config: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Check if config is an object
  if (!config || typeof config !== 'object') {
    errors.push({
      path: '',
      message: 'Configuration must be an object',
      expected: 'object',
      actual: typeof config,
    });
    return { valid: false, errors, warnings };
  }

  const cfg = config as Record<string, unknown>;

  // Validate version (required)
  if (cfg.version === undefined) {
    errors.push({
      path: 'version',
      message: 'Missing required field: version',
      expected: 'number',
    });
  } else if (typeof cfg.version !== 'number') {
    errors.push({
      path: 'version',
      message: 'Version must be a number',
      expected: 'number',
      actual: typeof cfg.version,
    });
  } else if (cfg.version !== 1) {
    warnings.push({
      path: 'version',
      message: `Unknown config version: ${cfg.version}. Expected 1.`,
      expected: '1',
      actual: cfg.version,
    });
  }

  // Validate settings (optional)
  if (cfg.settings !== undefined) {
    validateSettings(cfg.settings, 'settings', errors, warnings);
  }

  // Validate builtins (optional)
  if (cfg.builtins !== undefined) {
    validateBuiltins(cfg.builtins, 'builtins', errors, warnings);
  }

  // Validate handlers (optional)
  if (cfg.handlers !== undefined) {
    validateCustomHandlers(cfg.handlers, 'handlers', errors, warnings);
  }

  // Check for unknown top-level fields
  const validTopLevel = ['version', 'settings', 'builtins', 'handlers'];
  for (const key of Object.keys(cfg)) {
    if (!validTopLevel.includes(key)) {
      warnings.push({
        path: key,
        message: `Unknown field: ${key}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Settings Validator
// ============================================================================

function validateSettings(
  settings: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof settings !== 'object' || settings === null) {
    errors.push({
      path,
      message: 'Settings must be an object',
      expected: 'object',
      actual: typeof settings,
    });
    return;
  }

  const s = settings as Record<string, unknown>;

  // Validate debug
  if (s.debug !== undefined && typeof s.debug !== 'boolean') {
    errors.push({
      path: `${path}.debug`,
      message: 'debug must be a boolean',
      expected: 'boolean',
      actual: typeof s.debug,
    });
  }

  // Validate parallelExecution
  if (s.parallelExecution !== undefined && typeof s.parallelExecution !== 'boolean') {
    errors.push({
      path: `${path}.parallelExecution`,
      message: 'parallelExecution must be a boolean',
      expected: 'boolean',
      actual: typeof s.parallelExecution,
    });
  }

  // Validate defaultTimeoutMs
  if (s.defaultTimeoutMs !== undefined) {
    if (typeof s.defaultTimeoutMs !== 'number') {
      errors.push({
        path: `${path}.defaultTimeoutMs`,
        message: 'defaultTimeoutMs must be a number',
        expected: 'number',
        actual: typeof s.defaultTimeoutMs,
      });
    } else if (s.defaultTimeoutMs < 0) {
      errors.push({
        path: `${path}.defaultTimeoutMs`,
        message: 'defaultTimeoutMs must be non-negative',
        expected: '>= 0',
        actual: s.defaultTimeoutMs,
      });
    }
  }

  // Validate defaultErrorStrategy
  if (s.defaultErrorStrategy !== undefined) {
    if (!VALID_ERROR_STRATEGIES.includes(s.defaultErrorStrategy as ErrorStrategy)) {
      errors.push({
        path: `${path}.defaultErrorStrategy`,
        message: `Invalid error strategy: ${s.defaultErrorStrategy}`,
        expected: VALID_ERROR_STRATEGIES.join(' | '),
        actual: s.defaultErrorStrategy,
      });
    }
  }

  // Check for unknown settings fields
  const validSettings = ['debug', 'parallelExecution', 'defaultTimeoutMs', 'defaultErrorStrategy'];
  for (const key of Object.keys(s)) {
    if (!validSettings.includes(key)) {
      warnings.push({
        path: `${path}.${key}`,
        message: `Unknown setting: ${key}`,
      });
    }
  }
}

// ============================================================================
// Builtins Validator
// ============================================================================

function validateBuiltins(
  builtins: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof builtins !== 'object' || builtins === null) {
    errors.push({
      path,
      message: 'Builtins must be an object',
      expected: 'object',
      actual: typeof builtins,
    });
    return;
  }

  const b = builtins as Record<string, unknown>;

  for (const [name, config] of Object.entries(b)) {
    if (!VALID_BUILTIN_HANDLERS.includes(name as BuiltinHandlerType)) {
      errors.push({
        path: `${path}.${name}`,
        message: `Unknown built-in handler: ${name}`,
        expected: VALID_BUILTIN_HANDLERS.join(' | '),
        actual: name,
      });
      continue;
    }

    if (config !== undefined && config !== null) {
      validateHandlerConfig(config, `${path}.${name}`, errors, warnings);
      validateBuiltinOptions(name as BuiltinHandlerType, config, `${path}.${name}`, errors, warnings);
    }
  }
}

// ============================================================================
// Handler Config Validator
// ============================================================================

function validateHandlerConfig(
  config: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof config !== 'object' || config === null) {
    errors.push({
      path,
      message: 'Handler config must be an object',
      expected: 'object',
      actual: typeof config,
    });
    return;
  }

  const c = config as Record<string, unknown>;

  // Validate enabled
  if (c.enabled !== undefined && typeof c.enabled !== 'boolean') {
    errors.push({
      path: `${path}.enabled`,
      message: 'enabled must be a boolean',
      expected: 'boolean',
      actual: typeof c.enabled,
    });
  }

  // Validate priority
  if (c.priority !== undefined) {
    if (typeof c.priority !== 'number') {
      errors.push({
        path: `${path}.priority`,
        message: 'priority must be a number',
        expected: 'number',
        actual: typeof c.priority,
      });
    }
  }

  // Validate events
  if (c.events !== undefined) {
    if (!Array.isArray(c.events)) {
      errors.push({
        path: `${path}.events`,
        message: 'events must be an array',
        expected: 'array',
        actual: typeof c.events,
      });
    } else {
      for (let i = 0; i < c.events.length; i++) {
        const event = c.events[i];
        if (!VALID_EVENT_TYPES.includes(event as HookEventType)) {
          errors.push({
            path: `${path}.events[${i}]`,
            message: `Invalid event type: ${event}`,
            expected: VALID_EVENT_TYPES.join(' | '),
            actual: event,
          });
        }
      }
    }
  }

  // Validate after
  if (c.after !== undefined) {
    if (!Array.isArray(c.after)) {
      errors.push({
        path: `${path}.after`,
        message: 'after must be an array of handler IDs',
        expected: 'array',
        actual: typeof c.after,
      });
    } else {
      for (let i = 0; i < c.after.length; i++) {
        if (typeof c.after[i] !== 'string') {
          errors.push({
            path: `${path}.after[${i}]`,
            message: 'after entries must be strings',
            expected: 'string',
            actual: typeof c.after[i],
          });
        }
      }
    }
  }

  // Validate onError
  if (c.onError !== undefined) {
    if (!VALID_ERROR_STRATEGIES.includes(c.onError as ErrorStrategy)) {
      errors.push({
        path: `${path}.onError`,
        message: `Invalid error strategy: ${c.onError}`,
        expected: VALID_ERROR_STRATEGIES.join(' | '),
        actual: c.onError,
      });
    }
  }

  // Validate timeoutMs
  if (c.timeoutMs !== undefined) {
    if (typeof c.timeoutMs !== 'number') {
      errors.push({
        path: `${path}.timeoutMs`,
        message: 'timeoutMs must be a number',
        expected: 'number',
        actual: typeof c.timeoutMs,
      });
    } else if (c.timeoutMs < 0) {
      errors.push({
        path: `${path}.timeoutMs`,
        message: 'timeoutMs must be non-negative',
        expected: '>= 0',
        actual: c.timeoutMs,
      });
    }
  }

  // Validate options is an object if present
  if (c.options !== undefined && (typeof c.options !== 'object' || c.options === null)) {
    errors.push({
      path: `${path}.options`,
      message: 'options must be an object',
      expected: 'object',
      actual: typeof c.options,
    });
  }
}

// ============================================================================
// Built-in Options Validator
// ============================================================================

function validateBuiltinOptions(
  handlerType: BuiltinHandlerType,
  config: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  const c = config as Record<string, unknown>;
  const options = c.options as Record<string, unknown> | undefined;

  if (!options) return;

  switch (handlerType) {
    case 'session-naming':
      validateSessionNamingOptions(options, `${path}.options`, errors, warnings);
      break;
    case 'dangerous-command-guard':
      validateDangerousCommandGuardOptions(options, `${path}.options`, errors, warnings);
      break;
    case 'context-injection':
      validateContextInjectionOptions(options, `${path}.options`, errors, warnings);
      break;
    case 'tool-logger':
      validateToolLoggerOptions(options, `${path}.options`, errors, warnings);
      break;
  }
}

function validateSessionNamingOptions(
  options: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (options.format !== undefined && !VALID_SESSION_NAMING_FORMATS.includes(options.format as string)) {
    errors.push({
      path: `${path}.format`,
      message: `Invalid format: ${options.format}`,
      expected: VALID_SESSION_NAMING_FORMATS.join(' | '),
      actual: options.format,
    });
  }

  if (options.separator !== undefined && typeof options.separator !== 'string') {
    errors.push({
      path: `${path}.separator`,
      message: 'separator must be a string',
      expected: 'string',
      actual: typeof options.separator,
    });
  }

  if (options.includeTimestamp !== undefined && typeof options.includeTimestamp !== 'boolean') {
    errors.push({
      path: `${path}.includeTimestamp`,
      message: 'includeTimestamp must be a boolean',
      expected: 'boolean',
      actual: typeof options.includeTimestamp,
    });
  }
}

function validateDangerousCommandGuardOptions(
  options: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (options.blockedPatterns !== undefined) {
    if (!Array.isArray(options.blockedPatterns)) {
      errors.push({
        path: `${path}.blockedPatterns`,
        message: 'blockedPatterns must be an array of strings',
        expected: 'array',
        actual: typeof options.blockedPatterns,
      });
    } else {
      for (let i = 0; i < options.blockedPatterns.length; i++) {
        if (typeof options.blockedPatterns[i] !== 'string') {
          errors.push({
            path: `${path}.blockedPatterns[${i}]`,
            message: 'blockedPatterns entries must be strings (regex patterns)',
            expected: 'string',
            actual: typeof options.blockedPatterns[i],
          });
        }
      }
    }
  }

  if (options.allowedPatterns !== undefined) {
    if (!Array.isArray(options.allowedPatterns)) {
      errors.push({
        path: `${path}.allowedPatterns`,
        message: 'allowedPatterns must be an array of strings',
        expected: 'array',
        actual: typeof options.allowedPatterns,
      });
    }
  }

  if (options.strict !== undefined && typeof options.strict !== 'boolean') {
    errors.push({
      path: `${path}.strict`,
      message: 'strict must be a boolean',
      expected: 'boolean',
      actual: typeof options.strict,
    });
  }

  if (options.messageTemplate !== undefined && typeof options.messageTemplate !== 'string') {
    errors.push({
      path: `${path}.messageTemplate`,
      message: 'messageTemplate must be a string',
      expected: 'string',
      actual: typeof options.messageTemplate,
    });
  }
}

function validateContextInjectionOptions(
  options: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (options.template !== undefined && typeof options.template !== 'string') {
    errors.push({
      path: `${path}.template`,
      message: 'template must be a string',
      expected: 'string',
      actual: typeof options.template,
    });
  }

  if (options.onSessionStart !== undefined && typeof options.onSessionStart !== 'boolean') {
    errors.push({
      path: `${path}.onSessionStart`,
      message: 'onSessionStart must be a boolean',
      expected: 'boolean',
      actual: typeof options.onSessionStart,
    });
  }

  if (options.onPreCompact !== undefined && typeof options.onPreCompact !== 'boolean') {
    errors.push({
      path: `${path}.onPreCompact`,
      message: 'onPreCompact must be a boolean',
      expected: 'boolean',
      actual: typeof options.onPreCompact,
    });
  }

  if (options.variables !== undefined) {
    if (typeof options.variables !== 'object' || options.variables === null) {
      errors.push({
        path: `${path}.variables`,
        message: 'variables must be an object',
        expected: 'object',
        actual: typeof options.variables,
      });
    }
  }
}

function validateToolLoggerOptions(
  options: Record<string, unknown>,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (options.logLevel !== undefined && !VALID_LOG_LEVELS.includes(options.logLevel as string)) {
    errors.push({
      path: `${path}.logLevel`,
      message: `Invalid log level: ${options.logLevel}`,
      expected: VALID_LOG_LEVELS.join(' | '),
      actual: options.logLevel,
    });
  }

  if (options.outputPath !== undefined && typeof options.outputPath !== 'string') {
    errors.push({
      path: `${path}.outputPath`,
      message: 'outputPath must be a string',
      expected: 'string',
      actual: typeof options.outputPath,
    });
  }

  if (options.includeInput !== undefined && typeof options.includeInput !== 'boolean') {
    errors.push({
      path: `${path}.includeInput`,
      message: 'includeInput must be a boolean',
      expected: 'boolean',
      actual: typeof options.includeInput,
    });
  }

  if (options.includeOutput !== undefined && typeof options.includeOutput !== 'boolean') {
    errors.push({
      path: `${path}.includeOutput`,
      message: 'includeOutput must be a boolean',
      expected: 'boolean',
      actual: typeof options.includeOutput,
    });
  }

  if (options.tools !== undefined) {
    if (!Array.isArray(options.tools)) {
      errors.push({
        path: `${path}.tools`,
        message: 'tools must be an array of strings',
        expected: 'array',
        actual: typeof options.tools,
      });
    }
  }

  if (options.format !== undefined && !VALID_LOG_FORMATS.includes(options.format as string)) {
    errors.push({
      path: `${path}.format`,
      message: `Invalid format: ${options.format}`,
      expected: VALID_LOG_FORMATS.join(' | '),
      actual: options.format,
    });
  }
}

// ============================================================================
// Custom Handlers Validator
// ============================================================================

function validateCustomHandlers(
  handlers: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  if (typeof handlers !== 'object' || handlers === null) {
    errors.push({
      path,
      message: 'Handlers must be an object',
      expected: 'object',
      actual: typeof handlers,
    });
    return;
  }

  const h = handlers as Record<string, unknown>;

  for (const [name, config] of Object.entries(h)) {
    if (config !== undefined && config !== null) {
      validateHandlerConfig(config, `${path}.${name}`, errors, warnings);
      validateCustomHandlerConfig(config, `${path}.${name}`, errors, warnings);
    }
  }
}

function validateCustomHandlerConfig(
  config: unknown,
  path: string,
  errors: ValidationError[],
  warnings: ValidationError[]
): void {
  const c = config as Record<string, unknown>;

  // Custom handlers should have events defined
  if (!c.events || (Array.isArray(c.events) && c.events.length === 0)) {
    warnings.push({
      path: `${path}.events`,
      message: 'Custom handler has no events defined - it will never run',
    });
  }

  // Validate command if present
  if (c.command !== undefined && typeof c.command !== 'string') {
    errors.push({
      path: `${path}.command`,
      message: 'command must be a string',
      expected: 'string',
      actual: typeof c.command,
    });
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format validation errors as a human-readable string
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      let msg = `${e.path || '(root)'}: ${e.message}`;
      if (e.expected) {
        msg += ` (expected: ${e.expected})`;
      }
      if (e.actual !== undefined) {
        msg += ` (got: ${JSON.stringify(e.actual)})`;
      }
      return msg;
    })
    .join('\n');
}

/**
 * Check if a configuration is valid
 */
export function isValidConfig(config: unknown): config is YamlConfig {
  return validateConfig(config).valid;
}
