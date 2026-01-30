/**
 * Diagnostic Command Template
 *
 * Runs system diagnostics for disk, memory, processes, and storage.
 * Detects OS at runtime via process.platform for macOS vs Linux differences:
 * - macOS: vm_stat for memory, ps aux sorted by mem
 * - Linux: free -m for memory, ps aux --sort=-%mem
 */

import type {
  CommandTemplate,
  DiagnosticParams,
  StepResult,
  StructuredCommandResult,
} from './types';
import { runStep } from './types';

/** Returns the appropriate memory command for the current platform */
function getMemoryCommand(): string {
  if (process.platform === 'darwin') {
    return 'vm_stat';
  }
  return 'free -m';
}

/** Returns the appropriate process listing command for the current platform */
function getProcessCommand(): string {
  if (process.platform === 'darwin') {
    // macOS ps does not support --sort flag
    return 'ps aux -m | head -20';
  }
  return 'ps aux --sort=-%mem | head -20';
}

/** Maps diagnostic check types to their shell commands (legacy buildCommand) */
function getCheckCommand(check: string, paths?: string[]): string {
  switch (check) {
    case 'disk':
      return 'df -h';
    case 'memory':
      return getMemoryCommand();
    case 'processes':
      return getProcessCommand();
    case 'storage': {
      const targetPaths = paths && paths.length > 0 ? paths.join(' ') : '/';
      return `du -sh ${targetPaths}`;
    }
    default:
      return `echo "Unknown check: ${check}"`;
  }
}

/** Parse vm_stat output into structured memory data (macOS) */
function parseVmStat(output: string): Record<string, unknown> {
  const result: Record<string, number> = {};
  const lines = output.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(/^(.+?):\s+(\d+)/);
    if (match) {
      const key = match[1]!.trim().replace(/\s+/g, '_').replace(/"/g, '').toLowerCase();
      const pages = parseInt(match[2]!, 10);
      // macOS page size is 16384 bytes on ARM, 4096 on Intel
      // We report raw pages; consumer can multiply by page size
      result[key] = pages;
    }
  }
  return {
    platform: 'darwin',
    ...result,
  };
}

/** Parse free -m output into structured memory data (Linux) */
function parseFreeMem(output: string): Record<string, unknown> {
  const lines = output.split('\n');
  const result: Record<string, unknown> = { platform: 'linux' };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('Mem:')) {
      const parts = line.split(/\s+/);
      result.totalMb = parseInt(parts[1] ?? '0', 10);
      result.usedMb = parseInt(parts[2] ?? '0', 10);
      result.freeMb = parseInt(parts[3] ?? '0', 10);
      result.availableMb = parseInt(parts[6] ?? '0', 10);
    }
  }
  return result;
}

/** Parse df -h output into structured disk data */
function parseDfOutput(output: string): Record<string, unknown>[] {
  const lines = output.split('\n');
  const entries: Record<string, unknown>[] = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length >= 6) {
      entries.push({
        filesystem: parts[0],
        size: parts[1],
        used: parts[2],
        available: parts[3],
        usePercent: parts[4],
        mountedOn: parts[5],
      });
    }
  }
  return entries;
}

export class DiagnosticTemplate implements CommandTemplate {
  readonly name = 'diagnostic';
  readonly description = 'Run system diagnostics: disk, memory, processes, storage';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as DiagnosticParams;
    const commands: string[] = [];

    for (let i = 0; i < p.checks.length; i++) {
      const check = p.checks[i]!;
      commands.push(getCheckCommand(check, p.paths));
    }

    return commands.join(' && ');
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as DiagnosticParams;

    if (!p.checks || !Array.isArray(p.checks)) {
      throw new Error('DiagnosticTemplate: "checks" parameter is required and must be an array');
    }

    if (p.checks.length === 0) {
      throw new Error('DiagnosticTemplate: "checks" must contain at least one entry');
    }

    const validChecks = new Set(['disk', 'memory', 'processes', 'storage']);
    for (let i = 0; i < p.checks.length; i++) {
      if (!validChecks.has(p.checks[i]!)) {
        throw new Error(
          `DiagnosticTemplate: invalid check "${p.checks[i]}". Valid: disk, memory, processes, storage`
        );
      }
    }
  }

  async executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult> {
    this.validateParams(params);
    const p = params as unknown as DiagnosticParams;
    const startedAt = new Date().toISOString();

    const steps: StepResult[] = [];
    const data: Record<string, unknown> = {
      platform: process.platform,
    };

    for (let i = 0; i < p.checks.length; i++) {
      const check = p.checks[i]!;

      switch (check) {
        case 'disk': {
          const diskStep = await runStep('disk', 'df -h');
          steps.push(diskStep);
          data.disk = diskStep.status === 'success'
            ? parseDfOutput(diskStep.output)
            : { error: diskStep.error };
          break;
        }

        case 'memory': {
          const memCmd = getMemoryCommand();
          const memStep = await runStep('memory', memCmd);
          steps.push(memStep);
          if (memStep.status === 'success') {
            data.memory = process.platform === 'darwin'
              ? parseVmStat(memStep.output)
              : parseFreeMem(memStep.output);
          } else {
            data.memory = { error: memStep.error };
          }
          break;
        }

        case 'processes': {
          const procCmd = getProcessCommand();
          const procStep = await runStep('processes', procCmd);
          steps.push(procStep);
          if (procStep.status === 'success') {
            const lines = procStep.output.split('\n');
            const processes: Record<string, unknown>[] = [];
            // First line is header, skip it
            for (let j = 1; j < lines.length; j++) {
              const line = lines[j]!.trim();
              if (!line) continue;
              const parts = line.split(/\s+/);
              if (parts.length >= 11) {
                processes.push({
                  user: parts[0],
                  pid: parts[1],
                  cpu: parts[2],
                  mem: parts[3],
                  command: parts.slice(10).join(' '),
                });
              }
            }
            data.processes = processes;
          } else {
            data.processes = { error: procStep.error };
          }
          break;
        }

        case 'storage': {
          const targetPaths = p.paths && p.paths.length > 0 ? p.paths.join(' ') : '/';
          const storageStep = await runStep('storage', `du -sh ${targetPaths}`);
          steps.push(storageStep);
          if (storageStep.status === 'success') {
            const entries: Record<string, string>[] = [];
            const lines = storageStep.output.split('\n');
            for (let j = 0; j < lines.length; j++) {
              const line = lines[j]!.trim();
              if (!line) continue;
              const parts = line.split(/\t/);
              if (parts.length >= 2) {
                entries.push({ size: parts[0]!, path: parts[1]! });
              }
            }
            data.storage = entries;
          } else {
            data.storage = { error: storageStep.error };
          }
          break;
        }
      }
    }

    const overallSuccess = steps.every((s) => s.status === 'success');

    let totalDurationMs = 0;
    for (let i = 0; i < steps.length; i++) {
      totalDurationMs += steps[i]!.durationMs;
    }

    return {
      success: overallSuccess,
      templateName: this.name,
      totalDurationMs,
      steps,
      data,
      error: overallSuccess ? null : 'One or more diagnostic checks failed',
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
