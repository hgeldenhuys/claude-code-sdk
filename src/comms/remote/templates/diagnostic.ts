/**
 * Diagnostic Command Template
 *
 * Generates system diagnostic commands for disk, memory, processes, and storage.
 */

import type { CommandTemplate, DiagnosticParams } from './types';

/** Maps diagnostic check types to their shell commands */
const CHECK_COMMANDS: Record<string, string | ((paths?: string[]) => string)> = {
  disk: 'df -h',
  memory: 'free -m',
  processes: 'ps aux --sort=-%mem | head -20',
  storage: (paths?: string[]) => {
    const targetPaths = paths && paths.length > 0 ? paths.join(' ') : '/';
    return `du -sh ${targetPaths}`;
  },
};

export class DiagnosticTemplate implements CommandTemplate {
  readonly name = 'diagnostic';
  readonly description = 'Run system diagnostics: disk, memory, processes, storage';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as DiagnosticParams;
    const commands: string[] = [];

    for (let i = 0; i < p.checks.length; i++) {
      const check = p.checks[i]!;
      const cmdOrFn = CHECK_COMMANDS[check];
      if (typeof cmdOrFn === 'function') {
        commands.push(cmdOrFn(p.paths));
      } else if (typeof cmdOrFn === 'string') {
        commands.push(cmdOrFn);
      }
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
}
