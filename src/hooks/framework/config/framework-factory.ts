/**
 * Framework Factory
 *
 * Creates a HookFramework instance from a YAML configuration.
 * This is the main integration point between config and framework.
 */

import { createFramework, type HookFramework, type HookEventType } from '../framework';
import type { YamlConfig, ResolvedConfig } from './types';
import { loadResolvedConfig, resolveConfig } from './loader';
import {
  createHandlerFromConfig,
  isBuiltinHandler,
  getDefaultEvents,
} from '../handlers';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a HookFramework from a YAML config file
 *
 * @param configPath - Path to the YAML config file
 * @returns Configured HookFramework instance
 */
export function createFrameworkFromConfig(configPath?: string): HookFramework {
  const config = loadResolvedConfig(configPath);
  return createFrameworkFromResolvedConfig(config);
}

/**
 * Create a HookFramework from a parsed config object
 *
 * @param config - Parsed YAML config
 * @returns Configured HookFramework instance
 */
export function createFrameworkFromYamlConfig(config: YamlConfig): HookFramework {
  const resolved = resolveConfig(config);
  return createFrameworkFromResolvedConfig(resolved);
}

/**
 * Create a HookFramework from a resolved config
 *
 * @param config - Resolved config with defaults applied
 * @returns Configured HookFramework instance
 */
export function createFrameworkFromResolvedConfig(config: ResolvedConfig): HookFramework {
  const framework = createFramework({
    debug: config.settings.debug,
    defaultTimeoutMs: config.settings.defaultTimeoutMs,
    defaultErrorStrategy: config.settings.defaultErrorStrategy,
  });

  // Register handlers from config
  for (const handlerConfig of config.handlers) {
    if (!handlerConfig.enabled) {
      continue;
    }

    // Create handler from config
    const handler = createHandlerFromConfig(handlerConfig);
    if (!handler) {
      continue;
    }

    // Register handler for each configured event
    const events = handlerConfig.events.length > 0
      ? handlerConfig.events
      : (isBuiltinHandler(handlerConfig.type)
        ? getDefaultEvents(handlerConfig.type)
        : []);

    for (const event of events) {
      framework.on(event as HookEventType, {
        ...handler,
        id: `${handlerConfig.id}-${event}`, // Unique ID per event type
      });
    }
  }

  return framework;
}
