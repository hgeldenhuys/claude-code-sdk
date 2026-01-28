/**
 * Restart Command Template
 *
 * Generates application restart commands for pm2 or systemd.
 */

import type { CommandTemplate, RestartParams } from './types';

export class RestartTemplate implements CommandTemplate {
  readonly name = 'restart';
  readonly description = 'Restart application via pm2 or systemd';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as RestartParams;

    if (p.manager === 'pm2') {
      return `pm2 restart ${p.app}`;
    }
    return `systemctl restart ${p.app}`;
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as RestartParams;

    if (!p.app || typeof p.app !== 'string') {
      throw new Error('RestartTemplate: "app" parameter is required and must be a string');
    }

    if (!p.manager || (p.manager !== 'pm2' && p.manager !== 'systemd')) {
      throw new Error(
        'RestartTemplate: "manager" parameter is required and must be "pm2" or "systemd"'
      );
    }
  }
}
