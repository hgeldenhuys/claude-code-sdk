/**
 * Status Command Template
 *
 * Generates health check, log tail, uptime, and process info commands.
 */

import type { CommandTemplate, StatusParams } from './types';

export class StatusTemplate implements CommandTemplate {
  readonly name = 'status';
  readonly description = 'Check application status: health, logs, uptime, and process info';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as StatusParams;
    const port = p.port ?? 3000;
    const logPath = p.logPath ?? '/var/log/app.log';
    const logLines = p.logLines ?? 50;

    const commands = [
      `curl -sf http://localhost:${port}/health`,
      `tail -n ${logLines} ${logPath}`,
      'uptime',
      `pm2 describe ${p.app}`,
    ];

    return commands.join(' && ');
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as StatusParams;
    if (!p.app || typeof p.app !== 'string') {
      throw new Error('StatusTemplate: "app" parameter is required and must be a string');
    }
  }
}
