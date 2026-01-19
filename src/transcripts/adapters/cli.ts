/**
 * Adapter CLI Commands
 *
 * CLI commands for managing transcript adapters:
 * - adapter list: List registered adapters
 * - adapter status: Show adapter status and metrics
 * - adapter process: Process files with a specific adapter
 * - adapter replay: Replay (re-index) all files for an adapter
 * - adapter daemon: Run adapter daemon for live indexing
 */

import type { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { loadExternalAdapters } from './discovery';
import { getAdapterRegistry, registerBuiltinAdapters, runDaemonForeground } from './index';
import type { TranscriptAdapter } from './types';

/**
 * Format bytes for display
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format duration in milliseconds
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export interface AdapterListArgs {
  enabledOnly?: boolean;
  json?: boolean;
}

/**
 * List all registered adapters
 */
export async function cmdAdapterList(db: Database, args: AdapterListArgs = {}): Promise<number> {
  const registry = getAdapterRegistry();
  registry.setDatabase(db);
  registerBuiltinAdapters(registry, db);
  await loadExternalAdapters(registry, db);

  const status = registry.getStatus();

  if (args.json) {
    console.log(JSON.stringify(status, null, 2));
    return 0;
  }

  console.log('Registered Adapters\n');
  console.log(`Total: ${status.totalAdapters} (${status.enabledAdapters} enabled)\n`);

  for (const adapter of status.adapterDetails) {
    if (args.enabledOnly && !adapter.enabled) continue;

    const statusIcon = adapter.enabled ? '\x1b[32m[on]\x1b[0m' : '\x1b[90m[off]\x1b[0m';
    console.log(`${statusIcon} ${adapter.name}`);
    console.log(`      ${adapter.description}`);
    console.log(`      Extensions: ${adapter.fileExtensions.join(', ')}`);
    console.log('');
  }

  return 0;
}

export interface AdapterStatusArgs {
  adapterName?: string;
  json?: boolean;
}

/**
 * Show adapter status and metrics
 */
export async function cmdAdapterStatus(
  db: Database,
  args: AdapterStatusArgs = {}
): Promise<number> {
  const registry = getAdapterRegistry();
  registry.setDatabase(db);
  registerBuiltinAdapters(registry, db);
  await loadExternalAdapters(registry, db);

  if (args.adapterName) {
    // Show status for specific adapter
    const adapter = registry.get(args.adapterName);
    if (!adapter) {
      console.error(`Adapter '${args.adapterName}' not found`);
      return 1;
    }

    const metrics = adapter.getMetrics();
    const registered = registry.getRegistered(args.adapterName);

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            name: adapter.name,
            description: adapter.description,
            enabled: registered?.enabled ?? false,
            metrics,
          },
          null,
          2
        )
      );
      return 0;
    }

    console.log(`Adapter: ${adapter.name}\n`);
    console.log(`Description:  ${adapter.description}`);
    console.log(`Enabled:      ${registered?.enabled ? 'yes' : 'no'}`);
    console.log(`Extensions:   ${adapter.fileExtensions.join(', ')}`);
    console.log('');
    console.log('Metrics:');
    console.log(`  Entries processed: ${metrics.entriesProcessed.toLocaleString()}`);
    console.log(`  Entries failed:    ${metrics.entriesFailed.toLocaleString()}`);
    console.log(`  Bytes processed:   ${formatBytes(metrics.bytesProcessed)}`);
    console.log(`  Files processed:   ${metrics.filesProcessed}`);

    if (Object.keys(metrics.entriesByType).length > 0) {
      console.log('\nBy type:');
      for (const [type, count] of Object.entries(metrics.entriesByType)) {
        console.log(`  ${type}: ${count.toLocaleString()}`);
      }
    }

    return 0;
  }

  // Show status for all adapters
  const adapters = registry.getAll();
  const results: Array<{
    name: string;
    enabled: boolean;
    metrics: ReturnType<TranscriptAdapter['getMetrics']>;
  }> = [];

  for (const adapter of adapters) {
    const registered = registry.getRegistered(adapter.name);
    results.push({
      name: adapter.name,
      enabled: registered?.enabled ?? false,
      metrics: adapter.getMetrics(),
    });
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    return 0;
  }

  console.log('Adapter Status\n');

  for (const result of results) {
    const statusIcon = result.enabled ? '\x1b[32m[on]\x1b[0m' : '\x1b[90m[off]\x1b[0m';
    console.log(`${statusIcon} ${result.name}`);
    console.log(
      `      Processed: ${result.metrics.entriesProcessed.toLocaleString()} entries, ${result.metrics.filesProcessed} files`
    );
    if (result.metrics.entriesFailed > 0) {
      console.log(`      Failed: ${result.metrics.entriesFailed.toLocaleString()} entries`);
    }
    console.log('');
  }

  return 0;
}

export interface AdapterProcessArgs {
  adapterName: string;
  filePath?: string;
  delta?: boolean;
  verbose?: boolean;
}

/**
 * Process files with a specific adapter
 */
export async function cmdAdapterProcess(db: Database, args: AdapterProcessArgs): Promise<number> {
  const registry = getAdapterRegistry();
  registry.setDatabase(db);
  registerBuiltinAdapters(registry, db);
  await loadExternalAdapters(registry, db);

  const adapter = registry.get(args.adapterName);
  if (!adapter) {
    console.error(`Adapter '${args.adapterName}' not found`);
    console.log('\nAvailable adapters:');
    for (const name of registry.list()) {
      console.log(`  ${name}`);
    }
    return 1;
  }

  // Reset metrics for this run
  adapter.resetMetrics();

  const startTime = Date.now();

  if (args.filePath) {
    // Process single file
    if (!existsSync(args.filePath)) {
      console.error(`File not found: ${args.filePath}`);
      return 1;
    }

    console.log(`Processing ${args.filePath} with ${adapter.name}...`);

    const result = adapter.processFile
      ? adapter.processFile(args.filePath, db, {
          fromByteOffset: args.delta ? undefined : 0,
        })
      : {
          entriesIndexed: 0,
          byteOffset: 0,
          sessionId: '',
          firstTimestamp: null,
          lastTimestamp: null,
          entriesByType: {},
        };

    console.log(`  Entries indexed: ${result.entriesIndexed}`);
    if (args.verbose && Object.keys(result.entriesByType).length > 0) {
      console.log('  By type:');
      for (const [type, count] of Object.entries(result.entriesByType)) {
        console.log(`    ${type}: ${count}`);
      }
    }
  } else {
    // Process all files for this adapter
    console.log(`Processing all files for ${adapter.name}...\n`);

    const files = await adapter.resolveWatchPaths();
    console.log(`Found ${files.length} files\n`);

    let totalEntries = 0;
    let processedFiles = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const fileName = file.split('/').pop() || file;
      const shortName = fileName.length > 40 ? `${fileName.slice(0, 37)}...` : fileName;

      if (adapter.processFile) {
        const result = adapter.processFile(file, db, {
          fromByteOffset: args.delta ? undefined : 0,
        });

        if (result.entriesIndexed > 0 || args.verbose) {
          console.log(
            `  [${i + 1}/${files.length}] ${shortName}: ${result.entriesIndexed} entries`
          );
        }

        totalEntries += result.entriesIndexed;
        processedFiles++;
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `\nProcessed ${processedFiles} files, ${totalEntries.toLocaleString()} entries in ${formatDuration(elapsed)}`
    );
  }

  return 0;
}

export interface AdapterReplayArgs {
  adapterName: string;
  verbose?: boolean;
}

/**
 * Replay (re-index) all files for an adapter
 * This clears existing data and re-processes all files
 */
export async function cmdAdapterReplay(db: Database, args: AdapterReplayArgs): Promise<number> {
  const registry = getAdapterRegistry();
  registry.setDatabase(db);
  registerBuiltinAdapters(registry, db);
  await loadExternalAdapters(registry, db);

  const adapter = registry.get(args.adapterName);
  if (!adapter) {
    console.error(`Adapter '${args.adapterName}' not found`);
    return 1;
  }

  console.log(`Replaying all files for ${adapter.name}...`);
  console.log('\x1b[33mWarning: This will clear and rebuild data for this adapter.\x1b[0m\n');

  // Clear adapter cursors
  db.run('DELETE FROM adapter_cursors WHERE adapter_name = ?', [adapter.name]);

  // Reset metrics
  adapter.resetMetrics();

  const startTime = Date.now();

  // Process all files from scratch
  const files = await adapter.resolveWatchPaths();
  console.log(`Found ${files.length} files\n`);

  let totalEntries = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const fileName = file.split('/').pop() || file;
    const shortName = fileName.length > 40 ? `${fileName.slice(0, 37)}...` : fileName;

    if (adapter.processFile) {
      const result = adapter.processFile(file, db, { fromByteOffset: 0 });

      if (result.entriesIndexed > 0 || args.verbose) {
        process.stdout.write(
          `\r  [${i + 1}/${files.length}] ${shortName.padEnd(40)} (${result.entriesIndexed} entries)`
        );
      }

      totalEntries += result.entriesIndexed;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `\n\nReplayed ${files.length} files, ${totalEntries.toLocaleString()} entries in ${formatDuration(elapsed)}`
  );

  return 0;
}

export interface AdapterDaemonArgs {
  adapterNames?: string[];
  verbose?: boolean;
}

/**
 * Run the adapter daemon in foreground
 */
export async function cmdAdapterDaemon(
  db: Database,
  args: AdapterDaemonArgs = {}
): Promise<number> {
  try {
    await runDaemonForeground(db, {
      adapterNames: args.adapterNames,
    });
    return 0;
  } catch (error) {
    console.error(`Daemon error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Print adapter command help
 */
export function printAdapterHelp(): void {
  console.log(`Adapter Commands

Usage:
  transcript adapter list [options]              List registered adapters
  transcript adapter status [name] [options]     Show adapter status and metrics
  transcript adapter process <name> [options]    Process files with adapter
  transcript adapter replay <name> [options]     Replay (re-index) all files
  transcript adapter daemon [options]            Run adapter daemon in foreground

Options:
  --enabled-only        Only list enabled adapters
  --json                Output as JSON
  --file <path>         Process a specific file
  --delta               Only process new content (delta mode)
  --verbose, -v         Show verbose output

Examples:
  # List all adapters
  transcript adapter list

  # Show status for transcript-lines adapter
  transcript adapter status transcript-lines

  # Process all transcript files
  transcript adapter process transcript-lines

  # Process a single file
  transcript adapter process hook-events --file ~/.claude/hooks/myproject/hooks.jsonl

  # Re-index all hook events
  transcript adapter replay hook-events

  # Run daemon for all adapters (foreground)
  transcript adapter daemon
`);
}
