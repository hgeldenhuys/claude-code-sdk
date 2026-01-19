/**
 * Transcript Adapters Module
 *
 * Pluggable adapter architecture for the transcript daemon.
 * Allows multiple data sources to be indexed into SQLite.
 *
 * Built-in adapters:
 * - transcript-lines: Indexes ~/.claude/projects/**\/transcript.jsonl
 * - hook-events: Indexes ~/.claude/hooks/**\/*.hooks.jsonl
 *
 * Usage:
 * ```ts
 * import {
 *   AdapterRegistry,
 *   BaseAdapter,
 *   registerBuiltinAdapters,
 *   TranscriptLinesAdapter,
 *   HookEventsAdapter,
 * } from 'claude-code-sdk/transcripts/adapters';
 *
 * // Get registry and register built-in adapters
 * const registry = AdapterRegistry.getInstance();
 * registerBuiltinAdapters(registry, db);
 *
 * // Get an adapter
 * const transcriptAdapter = registry.get('transcript-lines');
 *
 * // Create a custom adapter
 * class MyAdapter extends BaseAdapter {
 *   readonly name = 'my-adapter';
 *   // ...
 * }
 * registry.register(new MyAdapter());
 * ```
 */

// Export types
export type {
  AdapterCursor,
  AdapterMetrics,
  AdapterRegistrationOptions,
  DaemonConfig,
  DaemonState,
  EntryContext,
  ProcessEntryResult,
  ProcessFileOptions,
  ProcessFileResult,
  RegisteredAdapter,
  TranscriptAdapter,
  WatchPath,
} from './types';

// Export base class
export { BaseAdapter, initCursorSchema } from './base';

// Export registry
export { AdapterRegistry, getAdapterRegistry } from './registry';

// Export built-in adapters
export {
  TranscriptLinesAdapter,
  createTranscriptLinesAdapter,
} from './transcript-lines';

export {
  HookEventsAdapter,
  createHookEventsAdapter,
} from './hook-events';

// Export daemon
export {
  AdapterDaemon,
  createDaemon,
  runDaemonForeground,
} from './daemon';

// Export discovery
export {
  ADAPTERS_DIR,
  discoverAdapterFiles,
  ensureAdaptersDir,
  loadAdapterFromFile,
  loadExternalAdapters,
  type AdapterLoadResult,
} from './discovery';

// Import for registration function
import type { Database } from 'bun:sqlite';
import { HookEventsAdapter } from './hook-events';
import { AdapterRegistry } from './registry';
import { TranscriptLinesAdapter } from './transcript-lines';

/**
 * Register all built-in adapters with the registry
 *
 * @param registry - The adapter registry instance
 * @param db - Optional database for schema initialization
 */
export function registerBuiltinAdapters(
  registry: AdapterRegistry = AdapterRegistry.getInstance(),
  db?: Database
): void {
  // Set database if provided
  if (db) {
    registry.setDatabase(db);
  }

  // Register transcript lines adapter
  if (!registry.has('transcript-lines')) {
    registry.register(new TranscriptLinesAdapter(), {
      initSchema: !!db,
      enabled: true,
    });
  }

  // Register hook events adapter
  if (!registry.has('hook-events')) {
    registry.register(new HookEventsAdapter(), {
      initSchema: !!db,
      enabled: true,
    });
  }
}

/**
 * Unregister all built-in adapters
 */
export function unregisterBuiltinAdapters(
  registry: AdapterRegistry = AdapterRegistry.getInstance()
): void {
  registry.unregister('transcript-lines');
  registry.unregister('hook-events');
}

/**
 * Get adapter names for built-in adapters
 */
export const BUILTIN_ADAPTER_NAMES = ['transcript-lines', 'hook-events'] as const;

/**
 * Type for built-in adapter names
 */
export type BuiltinAdapterName = (typeof BUILTIN_ADAPTER_NAMES)[number];
