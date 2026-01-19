/**
 * Adapter Daemon
 *
 * File watching daemon that runs adapters in the background,
 * automatically indexing new content as files change.
 */

import type { Database } from 'bun:sqlite';
import { type FSWatcher, existsSync, watch } from 'node:fs';
import { join } from 'node:path';
import { loadExternalAdapters } from './discovery';
import { registerBuiltinAdapters } from './index';
import { AdapterRegistry, getAdapterRegistry } from './registry';
import type { DaemonConfig, DaemonState, TranscriptAdapter } from './types';

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_MAX_CONCURRENCY = 4;

/**
 * AdapterDaemon - Watches files and runs adapters on changes
 */
export class AdapterDaemon {
  private db: Database;
  private config: Required<DaemonConfig>;
  private state: DaemonState;
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private watchersByAdapter: Map<string, FSWatcher[]> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database, config: DaemonConfig = {}) {
    this.db = db;
    this.config = {
      debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      maxConcurrency: config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      adapterNames: config.adapterNames ?? [],
      onUpdate: config.onUpdate ?? (() => {}),
      onError: config.onError ?? (() => {}),
    };
    this.state = {
      running: false,
      startedAt: null,
      activeAdapters: [],
      watchers: new Map(),
      totalEntriesIndexed: 0,
      totalErrors: 0,
    };
  }

  /**
   * Start the daemon
   */
  async start(): Promise<void> {
    if (this.state.running) {
      throw new Error('Daemon is already running');
    }

    const registry = getAdapterRegistry();
    registry.setDatabase(this.db);
    registerBuiltinAdapters(registry, this.db);
    await loadExternalAdapters(registry, this.db);

    // Get adapters to run
    const adapterNames =
      this.config.adapterNames.length > 0 ? this.config.adapterNames : registry.list(true); // Only enabled adapters

    this.state.running = true;
    this.state.startedAt = new Date();
    this.state.activeAdapters = adapterNames;

    // Set up watchers for each adapter
    for (const name of adapterNames) {
      const adapter = registry.get(name);
      if (!adapter) {
        console.error(`Adapter '${name}' not found, skipping`);
        continue;
      }

      try {
        await this.setupWatcher(adapter);
      } catch (err) {
        console.error(`Error setting up watcher for ${name}:`, err);
        this.config.onError(name, err as Error);
      }
    }

    // Start polling interval for detecting new files
    this.pollInterval = setInterval(() => this.pollForChanges(), this.config.pollIntervalMs);
  }

  /**
   * Stop the daemon
   */
  stop(): void {
    if (!this.state.running) {
      return;
    }

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const [name, watchers] of this.watchersByAdapter) {
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // Ignore errors on close
        }
      }
    }
    this.watchersByAdapter.clear();
    this.state.watchers.clear();

    this.state.running = false;
  }

  /**
   * Get current daemon state
   */
  getState(): DaemonState {
    return { ...this.state };
  }

  /**
   * Set up file watcher for an adapter
   */
  private async setupWatcher(adapter: TranscriptAdapter): Promise<void> {
    const watchPath = adapter.watchPath;
    const watchers: FSWatcher[] = [];

    // Resolve watch paths
    let directories: string[];

    if (typeof watchPath === 'string') {
      // Single glob pattern - watch parent directory
      const dir = this.getWatchDirectory(watchPath);
      directories = dir ? [dir] : [];
    } else {
      // Function that returns paths - get unique parent directories
      const files = await (async () => {
        const result = watchPath();
        if (result instanceof Promise) {
          return result;
        }
        return result;
      })();

      const dirSet = new Set<string>();
      for (const file of files) {
        const dir = join(file, '..');
        if (existsSync(dir)) {
          // Get the top-level project directory to avoid watching too many directories
          const parts = dir.split('/');
          const claudeIdx = parts.findIndex((p) => p === '.claude');
          if (claudeIdx >= 0 && claudeIdx + 2 < parts.length) {
            // Watch ~/.claude/projects or ~/.claude/hooks directly
            dirSet.add(parts.slice(0, claudeIdx + 2).join('/'));
          } else {
            dirSet.add(dir);
          }
        }
      }
      directories = Array.from(dirSet);
    }

    // Set up watchers for each directory
    for (const dir of directories) {
      if (!existsSync(dir)) {
        continue;
      }

      try {
        const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          // Check if file matches adapter's extensions
          const matchesExtension = adapter.fileExtensions.some((ext) =>
            filename.endsWith(ext.startsWith('.') ? ext : `.${ext}`)
          );

          if (!matchesExtension) return;

          const filePath = join(dir, filename);
          this.handleFileChange(adapter, filePath);
        });

        watchers.push(watcher);
      } catch (err) {
        console.error(`Error watching directory ${dir}:`, err);
      }
    }

    this.watchersByAdapter.set(adapter.name, watchers);
    this.state.watchers.set(adapter.name, () => {
      for (const w of watchers) {
        w.close();
      }
    });
  }

  /**
   * Extract watch directory from a glob pattern
   */
  private getWatchDirectory(pattern: string): string | null {
    // Find the first part without wildcards
    const parts = pattern.split('/');
    const staticParts: string[] = [];

    for (const part of parts) {
      if (part.includes('*') || part.includes('?') || part.includes('[')) {
        break;
      }
      staticParts.push(part);
    }

    if (staticParts.length === 0) {
      return null;
    }

    const dir = staticParts.join('/');
    return dir.startsWith('~') ? dir.replace('~', process.env.HOME || '~') : dir;
  }

  /**
   * Handle a file change with debouncing
   */
  private handleFileChange(adapter: TranscriptAdapter, filePath: string): void {
    const key = `${adapter.name}:${filePath}`;

    // Clear existing timer
    const existingTimer = this.debounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced timer
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        this.processFile(adapter, filePath);
      }, this.config.debounceMs)
    );
  }

  /**
   * Process a single file with an adapter
   */
  private processFile(adapter: TranscriptAdapter, filePath: string): void {
    try {
      if (!existsSync(filePath)) {
        return;
      }

      // Use delta processing
      if (adapter.processFile) {
        // Get cursor for delta processing
        const cursor = adapter.getCursor?.(this.db, filePath);
        const fileSize = Bun.file(filePath).size;

        // Skip if file hasn't grown
        if (cursor && cursor.byteOffset >= fileSize) {
          return;
        }

        const fromOffset = cursor?.byteOffset || 0;
        const startLine = cursor ? cursor.entryCount + 1 : 1;

        const result = adapter.processFile(filePath, this.db, {
          fromByteOffset: fromOffset,
          startLineNumber: startLine,
        });

        if (result.entriesIndexed > 0) {
          this.state.totalEntriesIndexed += result.entriesIndexed;
          this.config.onUpdate(adapter.name, filePath, result.entriesIndexed);
        }
      }
    } catch (err) {
      this.state.totalErrors++;
      this.config.onError(adapter.name, err as Error);
    }
  }

  /**
   * Poll for changes in case watcher misses anything
   */
  private async pollForChanges(): Promise<void> {
    const registry = getAdapterRegistry();

    for (const name of this.state.activeAdapters) {
      const adapter = registry.get(name);
      if (!adapter) continue;

      try {
        const files = await adapter.resolveWatchPaths();

        for (const filePath of files) {
          // Check if file has grown since last indexed
          if (adapter.processFile) {
            const cursor = adapter.getCursor?.(this.db, filePath);
            if (!cursor) continue;

            const fileSize = Bun.file(filePath).size;
            if (fileSize > cursor.byteOffset) {
              this.handleFileChange(adapter, filePath);
            }
          }
        }
      } catch {
        // Ignore polling errors
      }
    }
  }
}

/**
 * Create and start an adapter daemon
 */
export function createDaemon(db: Database, config?: DaemonConfig): AdapterDaemon {
  return new AdapterDaemon(db, config);
}

/**
 * Run daemon in foreground (for CLI use)
 */
export async function runDaemonForeground(db: Database, config?: DaemonConfig): Promise<void> {
  const daemon = createDaemon(db, {
    ...config,
    onUpdate: (adapterName, filePath, entriesIndexed) => {
      const fileName = filePath.split('/').pop() || filePath;
      const shortName = fileName.length > 50 ? `${fileName.slice(0, 47)}...` : fileName;
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] [${adapterName}] ${shortName}: +${entriesIndexed} entries`);
      config?.onUpdate?.(adapterName, filePath, entriesIndexed);
    },
    onError: (adapterName, error) => {
      const time = new Date().toLocaleTimeString();
      console.error(`[${time}] [${adapterName}] Error: ${error.message}`);
      config?.onError?.(adapterName, error);
    },
  });

  await daemon.start();

  console.log('Adapter daemon started');
  console.log(`Watching: ${daemon.getState().activeAdapters.join(', ')}`);
  console.log('Press Ctrl+C to stop\n');

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nStopping daemon...');
    daemon.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process alive
  await new Promise(() => {});
}
