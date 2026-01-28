/**
 * Deploy Command Template
 *
 * Generates git pull + build + restart commands for application deployment.
 */

import type { CommandTemplate, DeployParams } from './types';

export class DeployTemplate implements CommandTemplate {
  readonly name = 'deploy';
  readonly description = 'Deploy application: git pull, build, and restart';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as DeployParams;
    const deployDir = p.deployDir ?? '/app';
    const branch = p.branch ?? 'main';
    const buildCmd = p.buildCmd ?? 'bun install && bun run build';

    return `cd ${deployDir} && git pull origin ${branch} && ${buildCmd} && pm2 restart ${p.app}`;
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as DeployParams;
    if (!p.app || typeof p.app !== 'string') {
      throw new Error('DeployTemplate: "app" parameter is required and must be a string');
    }
  }
}
