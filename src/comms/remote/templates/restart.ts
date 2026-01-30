/**
 * Restart Command Template
 *
 * Restarts an application via pm2 or launchd (macOS).
 * After restart, confirms the process is running and returns the new PID and uptime.
 */

import type {
  CommandTemplate,
  RestartParams,
  StepResult,
  StructuredCommandResult,
} from './types';
import { runStep } from './types';

export class RestartTemplate implements CommandTemplate {
  readonly name = 'restart';
  readonly description = 'Restart application via pm2 or launchd (macOS)';

  buildCommand(params: Record<string, unknown>): string {
    const p = params as unknown as RestartParams;

    if (p.manager === 'pm2') {
      return `pm2 restart ${p.app}`;
    }
    // launchd (macOS)
    return `launchctl kickstart -k system/${p.app}`;
  }

  validateParams(params: Record<string, unknown>): void {
    const p = params as unknown as RestartParams;

    if (!p.app || typeof p.app !== 'string') {
      throw new Error('RestartTemplate: "app" parameter is required and must be a string');
    }

    if (!p.manager || (p.manager !== 'pm2' && p.manager !== 'launchd')) {
      throw new Error(
        'RestartTemplate: "manager" parameter is required and must be "pm2" or "launchd"'
      );
    }
  }

  async executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult> {
    this.validateParams(params);
    const p = params as unknown as RestartParams;
    const startedAt = new Date().toISOString();

    const steps: StepResult[] = [];
    const data: Record<string, unknown> = {
      app: p.app,
      manager: p.manager,
    };
    let overallSuccess = true;
    let overallError: string | null = null;

    if (p.manager === 'pm2') {
      // Step 1: pm2 restart
      const restart = await runStep('pm2-restart', `pm2 restart ${p.app}`);
      steps.push(restart);

      if (restart.status === 'failure') {
        overallSuccess = false;
        overallError = `PM2 restart failed: ${restart.error}`;
        return this.buildResult(steps, overallSuccess, overallError, startedAt, data);
      }

      // Step 2: Wait briefly for process to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Step 3: Verify process is running and get PID
      const verify = await runStep('verify-process', `pm2 jlist`);
      steps.push(verify);

      if (verify.status === 'success') {
        try {
          const allProcesses = JSON.parse(verify.output);
          if (Array.isArray(allProcesses)) {
            for (let i = 0; i < allProcesses.length; i++) {
              const proc = allProcesses[i];
              if (proc?.name === p.app) {
                data.pid = proc.pid ?? null;
                data.status = proc.pm2_env?.status ?? 'unknown';
                data.uptime = proc.pm2_env?.pm_uptime
                  ? Date.now() - proc.pm2_env.pm_uptime
                  : null;
                data.restarts = proc.pm2_env?.restart_time ?? null;
                data.memory = proc.monit?.memory ?? null;
                data.cpu = proc.monit?.cpu ?? null;
                break;
              }
            }
          }
        } catch {
          data.pid = null;
          data.rawOutput = verify.output;
        }
      }

      // Verify the process is actually running
      if (!data.pid) {
        overallSuccess = false;
        overallError = `Process "${p.app}" not found after restart`;
      }
    } else {
      // launchd (macOS)

      // Step 1: Stop the service
      const stop = await runStep(
        'launchd-stop',
        `launchctl bootout system/${p.app} 2>/dev/null; true`
      );
      steps.push(stop);

      // Step 2: Start the service
      const start = await runStep(
        'launchd-start',
        `launchctl bootstrap system /Library/LaunchDaemons/${p.app}.plist`
      );
      steps.push(start);

      if (start.status === 'failure') {
        // Try user domain as fallback
        const userStart = await runStep(
          'launchd-start-user',
          `launchctl kickstart -k gui/$(id -u)/${p.app}`
        );
        steps.push(userStart);

        if (userStart.status === 'failure') {
          overallSuccess = false;
          overallError = `launchd restart failed: ${userStart.error}`;
          return this.buildResult(steps, overallSuccess, overallError, startedAt, data);
        }
      }

      // Step 3: Wait briefly for process to stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Step 4: Verify process is running
      const verify = await runStep(
        'verify-process',
        `launchctl print system/${p.app} 2>/dev/null || launchctl print gui/$(id -u)/${p.app} 2>/dev/null`
      );
      steps.push(verify);

      if (verify.status === 'success') {
        // Parse PID from launchctl print output
        const pidMatch = verify.output.match(/pid\s*=\s*(\d+)/i);
        data.pid = pidMatch ? parseInt(pidMatch[1]!, 10) : null;

        const stateMatch = verify.output.match(/state\s*=\s*(\w+)/i);
        data.status = stateMatch ? stateMatch[1] : 'unknown';
      }

      // Also try pgrep as fallback for PID
      if (!data.pid) {
        const pgrep = await runStep('pgrep-check', `pgrep -f "${p.app}"`);
        steps.push(pgrep);
        if (pgrep.status === 'success' && pgrep.output.trim()) {
          const firstPid = pgrep.output.trim().split('\n')[0];
          data.pid = firstPid ? parseInt(firstPid, 10) : null;
        }
      }

      if (!data.pid) {
        overallSuccess = false;
        overallError = `Process "${p.app}" not found after restart`;
      }
    }

    return this.buildResult(steps, overallSuccess, overallError, startedAt, data);
  }

  private buildResult(
    steps: StepResult[],
    success: boolean,
    error: string | null,
    startedAt: string,
    data: Record<string, unknown>,
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
      data,
      error,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
