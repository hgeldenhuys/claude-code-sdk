/**
 * Status Command Template
 *
 * Performs health check (curl), log tail, uptime, and pm2 process info
 * as separate steps with structured JSON output per field.
 */

import type {
  CommandTemplate,
  StatusParams,
  StepResult,
  StructuredCommandResult,
} from './types';
import { runStep } from './types';

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

  async executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult> {
    this.validateParams(params);
    const p = params as unknown as StatusParams;
    const port = p.port ?? 3000;
    const logPath = p.logPath ?? '/var/log/app.log';
    const logLines = p.logLines ?? 50;
    const startedAt = new Date().toISOString();

    const steps: StepResult[] = [];
    const data: Record<string, unknown> = { app: p.app };

    // Step 1: Health check
    const health = await runStep(
      'health-check',
      `curl -sf http://localhost:${port}/health`
    );
    steps.push(health);
    data.healthCheck = {
      status: health.status === 'success' ? 'healthy' : 'unhealthy',
      port,
      response: health.output || null,
    };

    // Step 2: Log tail
    const logs = await runStep('log-tail', `tail -n ${logLines} ${logPath}`);
    steps.push(logs);
    data.logs = {
      path: logPath,
      lines: logs.status === 'success' ? logs.output.split('\n') : [],
      linesRequested: logLines,
      error: logs.error,
    };

    // Step 3: System uptime
    const uptime = await runStep('uptime', 'uptime');
    steps.push(uptime);
    data.uptime = uptime.output || null;

    // Step 4: PM2 process info
    const pm2Info = await runStep('pm2-info', `pm2 jlist`);
    steps.push(pm2Info);

    if (pm2Info.status === 'success') {
      try {
        const allProcesses = JSON.parse(pm2Info.output);
        // Find the specific app in pm2 process list
        let appProcess = null;
        if (Array.isArray(allProcesses)) {
          for (let i = 0; i < allProcesses.length; i++) {
            if (allProcesses[i]?.name === p.app) {
              appProcess = allProcesses[i];
              break;
            }
          }
        }
        data.pm2Info = appProcess ?? { raw: pm2Info.output };
      } catch {
        data.pm2Info = { raw: pm2Info.output };
      }
    } else {
      data.pm2Info = { error: pm2Info.error };
    }

    // Overall success: at least health check succeeded
    const overallSuccess = health.status === 'success';

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
      error: overallSuccess ? null : 'Health check failed',
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
