/**
 * Deploy Command Template
 *
 * Performs git pull, dependency install, build, and pm2 restart
 * with structured per-step output and rollback on build failure.
 */

import type {
  CommandTemplate,
  DeployParams,
  StepResult,
  StructuredCommandResult,
} from './types';
import { runStep } from './types';

export class DeployTemplate implements CommandTemplate {
  readonly name = 'deploy';
  readonly description = 'Deploy application: git pull, build, and restart';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as DeployParams;
    const deployDir = p.deployDir ?? '.';
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

  async executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult> {
    this.validateParams(params);
    const p = params as unknown as DeployParams;
    const deployDir = p.deployDir ?? '.';
    const branch = p.branch ?? 'main';
    const buildCmd = p.buildCmd ?? 'bun run build';
    const startedAt = new Date().toISOString();

    const steps: StepResult[] = [];
    let overallSuccess = true;
    let overallError: string | null = null;

    // Step 1: git pull
    const gitPull = await runStep('git-pull', `git pull origin ${branch}`, { cwd: deployDir });
    steps.push(gitPull);

    if (gitPull.status === 'failure') {
      overallSuccess = false;
      overallError = `Deployment failed at git-pull: ${gitPull.error}`;
      return this.buildResult(steps, overallSuccess, overallError, startedAt, p);
    }

    // Step 2: install dependencies
    const install = await runStep('install', 'bun install', { cwd: deployDir });
    steps.push(install);

    if (install.status === 'failure') {
      overallSuccess = false;
      overallError = `Deployment failed at install: ${install.error}`;
      return this.buildResult(steps, overallSuccess, overallError, startedAt, p);
    }

    // Step 3: build
    const build = await runStep('build', buildCmd, { cwd: deployDir });
    steps.push(build);

    if (build.status === 'failure') {
      // Rollback: reset to previous state
      const rollback = await runStep('rollback', 'git checkout HEAD~1', { cwd: deployDir });
      steps.push(rollback);
      overallSuccess = false;
      overallError = `Build failed, rolled back: ${build.error}`;
      return this.buildResult(steps, overallSuccess, overallError, startedAt, p);
    }

    // Step 4: pm2 restart
    const restart = await runStep('pm2-restart', `pm2 restart ${p.app}`, { cwd: deployDir });
    steps.push(restart);

    if (restart.status === 'failure') {
      overallSuccess = false;
      overallError = `PM2 restart failed: ${restart.error}`;
    }

    return this.buildResult(steps, overallSuccess, overallError, startedAt, p);
  }

  private buildResult(
    steps: StepResult[],
    success: boolean,
    error: string | null,
    startedAt: string,
    params: DeployParams,
  ): StructuredCommandResult {
    let totalDurationMs = 0;
    for (let i = 0; i < steps.length; i++) {
      totalDurationMs += steps[i]!.durationMs;
    }

    return {
      success,
      templateName: this.name,
      totalDurationMs,
      steps,
      data: {
        app: params.app,
        branch: params.branch ?? 'main',
        deployDir: params.deployDir ?? '.',
        stepsCompleted: steps.filter((s) => s.status === 'success').length,
        stepsTotal: steps.length,
      },
      error,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
