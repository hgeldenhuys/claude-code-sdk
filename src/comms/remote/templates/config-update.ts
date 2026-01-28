/**
 * Config Update Command Template
 *
 * Generates export commands for environment variables with optional app restart.
 * Includes shell injection validation for safety.
 */

import type { CommandTemplate, ConfigParams } from './types';

/** Characters that indicate potential shell injection */
const INJECTION_CHARS = /[;|&`]|\$\(|\$\{/;

export class ConfigTemplate implements CommandTemplate {
  readonly name = 'config-update';
  readonly description = 'Update environment variables with optional application restart';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as ConfigParams;
    const parts: string[] = [];

    const keys = Object.keys(p.envVars);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const value = p.envVars[key]!;
      parts.push(`export ${key}=${value}`);
    }

    if (p.restart && p.app) {
      parts.push(`pm2 restart ${p.app}`);
    }

    return parts.join(' && ');
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as ConfigParams;

    if (!p.envVars || typeof p.envVars !== 'object') {
      throw new Error('ConfigTemplate: "envVars" parameter is required and must be an object');
    }

    const keys = Object.keys(p.envVars);
    if (keys.length === 0) {
      throw new Error('ConfigTemplate: "envVars" must contain at least one entry');
    }

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      const value = p.envVars[key]!;

      if (INJECTION_CHARS.test(key)) {
        throw new Error(`ConfigTemplate: env var key "${key}" contains shell injection characters`);
      }
      if (INJECTION_CHARS.test(value)) {
        throw new Error(
          `ConfigTemplate: env var value for "${key}" contains shell injection characters`
        );
      }
    }
  }
}
