// Adapter Discovery - Auto-discovers and loads external adapters from:
// - ~/.claude-code-sdk/adapters/*.ts
// - ~/.claude-code-sdk/adapters/*/index.ts
// External adapters must export a class extending BaseAdapter or an instance of BaseAdapter.

import type { Database } from 'bun:sqlite';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptAdapter } from './types';
import { AdapterRegistry } from './registry';
import { BaseAdapter } from './base';

/**
 * Default directory for external adapters
 */
export const ADAPTERS_DIR = join(homedir(), '.claude-code-sdk', 'adapters');

/**
 * Result of loading an external adapter
 */
export interface AdapterLoadResult {
  path: string;
  name: string;
  success: boolean;
  error?: string;
}

/**
 * Check if a value is an adapter instance
 */
function isAdapterInstance(value: unknown): value is TranscriptAdapter {
  return (
    value !== null &&
    typeof value === 'object' &&
    'name' in value &&
    'description' in value &&
    'fileExtensions' in value &&
    typeof (value as TranscriptAdapter).name === 'string'
  );
}

/**
 * Check if a value is an adapter class (constructor)
 */
function isAdapterClass(value: unknown): value is new () => TranscriptAdapter {
  return (
    typeof value === 'function' &&
    value.prototype instanceof BaseAdapter
  );
}

/**
 * Load a single adapter from a file path
 */
export async function loadAdapterFromFile(
  filePath: string,
  db?: Database
): Promise<AdapterLoadResult> {
  const fileName = filePath.split('/').pop() || filePath;

  try {
    // Dynamic import
    const module = await import(filePath);

    // Look for adapter in exports
    let adapter: TranscriptAdapter | undefined;

    // Check default export first
    if (module.default) {
      if (isAdapterInstance(module.default)) {
        adapter = module.default;
      } else if (isAdapterClass(module.default)) {
        adapter = new module.default();
      }
    }

    // Check named exports
    if (!adapter) {
      for (const [key, value] of Object.entries(module)) {
        if (key === 'default') continue;

        if (isAdapterInstance(value)) {
          adapter = value;
          break;
        }

        if (isAdapterClass(value)) {
          adapter = new value();
          break;
        }
      }
    }

    if (!adapter) {
      return {
        path: filePath,
        name: fileName,
        success: false,
        error: 'No adapter export found (must export BaseAdapter class or instance)',
      };
    }

    // Initialize schema if db provided
    if (db && adapter.initSchema) {
      adapter.initSchema(db);
    }

    return {
      path: filePath,
      name: adapter.name,
      success: true,
    };
  } catch (error) {
    return {
      path: filePath,
      name: fileName,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Discover adapter files in a directory
 */
export function discoverAdapterFiles(dir: string = ADAPTERS_DIR): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files: string[] = [];

  try {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isFile() && entry.endsWith('.ts')) {
        // Direct .ts file
        files.push(fullPath);
      } else if (stat.isDirectory()) {
        // Check for index.ts in subdirectory
        const indexPath = join(fullPath, 'index.ts');
        if (existsSync(indexPath)) {
          files.push(indexPath);
        }
      }
    }
  } catch (error) {
    console.error(`[adapter-discovery] Error scanning ${dir}: ${error}`);
  }

  return files;
}

/**
 * Load and register all external adapters
 */
export async function loadExternalAdapters(
  registry: AdapterRegistry = AdapterRegistry.getInstance(),
  db?: Database,
  dir: string = ADAPTERS_DIR
): Promise<AdapterLoadResult[]> {
  const results: AdapterLoadResult[] = [];
  const files = discoverAdapterFiles(dir);

  if (files.length === 0) {
    return results;
  }

  console.log(`[adapter-discovery] Found ${files.length} adapter file(s) in ${dir}`);

  for (const file of files) {
    const result = await loadAdapterFromFile(file, db);
    results.push(result);

    if (result.success) {
      // Get the adapter from the module again for registration
      try {
        const module = await import(file);
        let adapter: TranscriptAdapter | undefined;

        if (module.default) {
          if (isAdapterInstance(module.default)) {
            adapter = module.default;
          } else if (isAdapterClass(module.default)) {
            adapter = new module.default();
          }
        }

        if (!adapter) {
          for (const value of Object.values(module)) {
            if (isAdapterInstance(value)) {
              adapter = value as TranscriptAdapter;
              break;
            }
            if (isAdapterClass(value)) {
              adapter = new (value as new () => TranscriptAdapter)();
              break;
            }
          }
        }

        if (adapter && !registry.has(adapter.name)) {
          registry.register(adapter, { initSchema: !!db, enabled: true });
          console.log(`[adapter-discovery] Registered: ${adapter.name}`);
        }
      } catch (error) {
        console.error(`[adapter-discovery] Failed to register ${file}: ${error}`);
      }
    } else {
      console.warn(`[adapter-discovery] Failed to load ${file}: ${result.error}`);
    }
  }

  return results;
}

/**
 * Ensure the adapters directory exists
 */
export function ensureAdaptersDir(dir: string = ADAPTERS_DIR): void {
  if (!existsSync(dir)) {
    const { mkdirSync } = require('node:fs');
    mkdirSync(dir, { recursive: true });
  }
}
