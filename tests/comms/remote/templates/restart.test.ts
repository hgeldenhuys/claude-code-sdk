/**
 * Tests for Restart Command Template
 *
 * Covers:
 * - Success path: pm2 restart with PID verification
 * - Success path: launchd restart with PID verification
 * - Validation error: Invalid params rejected before execution
 * - Failure: pm2 restart failure, launchd fallback to user domain
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { StepResult } from '../../../../src/comms/remote/templates/types';

const mockRunStep = mock<(stepName: string, command: string, options?: { cwd?: string }) => Promise<StepResult>>(
  async (stepName: string): Promise<StepResult> => ({
    stepName,
    status: 'success',
    output: `mock output for ${stepName}`,
    stderr: '',
    exitCode: 0,
    durationMs: 10,
    error: null,
  })
);

mock.module('../../../../src/comms/remote/templates/types', () => {
  const actual = require('../../../../src/comms/remote/templates/types');
  return {
    ...actual,
    runStep: mockRunStep,
  };
});

import { RestartTemplate } from '../../../../src/comms/remote/templates/restart';

describe('RestartTemplate - executeCommand', () => {
  let template: RestartTemplate;

  beforeEach(() => {
    template = new RestartTemplate();
    mockRunStep.mockClear();
  });

  // ==========================================================================
  // PM2 Success Path
  // ==========================================================================

  describe('pm2 success path', () => {
    beforeEach(() => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (stepName === 'pm2-restart') {
            return {
              stepName,
              status: 'success',
              output: '[PM2] Applying action restartProcessId on app [my-api](ids: 0)',
              stderr: '',
              exitCode: 0,
              durationMs: 200,
              error: null,
            };
          }
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'success',
              output: JSON.stringify([
                {
                  name: 'my-api',
                  pid: 42567,
                  pm2_env: {
                    status: 'online',
                    pm_uptime: Date.now() - 5000,
                    restart_time: 3,
                  },
                  monit: { memory: 67108864, cpu: 2.5 },
                },
              ]),
              stderr: '',
              exitCode: 0,
              durationMs: 50,
              error: null,
            };
          }
          return {
            stepName,
            status: 'success',
            output: 'ok',
            stderr: '',
            exitCode: 0,
            durationMs: 10,
            error: null,
          };
        }
      );
    });

    test('returns success with structured result', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('restart');
      expect(result.error).toBeNull();
    });

    test('has pm2-restart and verify-process steps', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toContain('pm2-restart');
      expect(stepNames).toContain('verify-process');
    });

    test('data contains PID after restart', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.data.pid).toBe(42567);
    });

    test('data contains process status, uptime, restarts, memory, cpu', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.data.status).toBe('online');
      expect(result.data.restarts).toBe(3);
      expect(result.data.memory).toBe(67108864);
      expect(result.data.cpu).toBe(2.5);
      expect(result.data.uptime).toBeTruthy();
    });

    test('data contains app and manager', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.data.app).toBe('my-api');
      expect(result.data.manager).toBe('pm2');
    });

    test('passes correct commands to runStep', async () => {
      await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      // pm2-restart
      expect(mockRunStep.mock.calls[0]![0]).toBe('pm2-restart');
      expect(mockRunStep.mock.calls[0]![1]).toBe('pm2 restart my-api');

      // verify-process
      expect(mockRunStep.mock.calls[1]![0]).toBe('verify-process');
      expect(mockRunStep.mock.calls[1]![1]).toBe('pm2 jlist');
    });

    test('verify returns raw output when JSON parse fails', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'success',
              output: 'not json',
              stderr: '',
              exitCode: 0,
              durationMs: 5,
              error: null,
            };
          }
          return {
            stepName,
            status: 'success',
            output: 'ok',
            stderr: '',
            exitCode: 0,
            durationMs: 10,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      // pid is null because parse failed
      expect(result.data.pid).toBeNull();
      expect(result.data.rawOutput).toBe('not json');
      // No PID means process not found
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found after restart');
    });

    test('process not found in pm2 list fails', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'success',
              output: JSON.stringify([
                { name: 'other-app', pid: 999 },
              ]),
              stderr: '',
              exitCode: 0,
              durationMs: 5,
              error: null,
            };
          }
          return {
            stepName,
            status: 'success',
            output: 'ok',
            stderr: '',
            exitCode: 0,
            durationMs: 10,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('"my-api" not found after restart');
    });
  });

  // ==========================================================================
  // Launchd Success Path
  // ==========================================================================

  describe('launchd success path', () => {
    beforeEach(() => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          switch (stepName) {
            case 'launchd-stop':
              return {
                stepName,
                status: 'success',
                output: '',
                stderr: '',
                exitCode: 0,
                durationMs: 50,
                error: null,
              };
            case 'launchd-start':
              return {
                stepName,
                status: 'success',
                output: '',
                stderr: '',
                exitCode: 0,
                durationMs: 100,
                error: null,
              };
            case 'verify-process':
              return {
                stepName,
                status: 'success',
                output: 'com.my-api\npid = 54321\nstate = running\n',
                stderr: '',
                exitCode: 0,
                durationMs: 30,
                error: null,
              };
            default:
              return {
                stepName,
                status: 'success',
                output: 'ok',
                stderr: '',
                exitCode: 0,
                durationMs: 5,
                error: null,
              };
          }
        }
      );
    });

    test('returns success with structured result', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('restart');
    });

    test('has launchd-stop, launchd-start, verify-process steps', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toContain('launchd-stop');
      expect(stepNames).toContain('launchd-start');
      expect(stepNames).toContain('verify-process');
    });

    test('data contains PID parsed from launchctl print output', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.data.pid).toBe(54321);
    });

    test('data contains status parsed from launchctl print output', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.data.status).toBe('running');
    });

    test('passes correct launchd commands', async () => {
      await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      // launchd-stop
      expect(mockRunStep.mock.calls[0]![0]).toBe('launchd-stop');
      expect(mockRunStep.mock.calls[0]![1]).toContain('launchctl bootout system/my-api');

      // launchd-start
      expect(mockRunStep.mock.calls[1]![0]).toBe('launchd-start');
      expect(mockRunStep.mock.calls[1]![1]).toContain('launchctl bootstrap system /Library/LaunchDaemons/my-api.plist');
    });

    test('data.manager is set to launchd', async () => {
      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });
      expect(result.data.manager).toBe('launchd');
    });

    test('falls back to pgrep when verify-process has no pid', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'success',
              output: 'com.my-api\nstate = running\n', // no pid line
              stderr: '',
              exitCode: 0,
              durationMs: 10,
              error: null,
            };
          }
          if (stepName === 'pgrep-check') {
            return {
              stepName,
              status: 'success',
              output: '77777\n',
              stderr: '',
              exitCode: 0,
              durationMs: 5,
              error: null,
            };
          }
          return {
            stepName,
            status: 'success',
            output: '',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.data.pid).toBe(77777);
      expect(result.success).toBe(true);
    });

    test('falls back to user domain when system bootstrap fails', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'launchd-start') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'Could not find specified service',
              exitCode: 113,
              durationMs: 10,
              error: 'Step "launchd-start" failed with exit code 113',
            };
          }
          if (stepName === 'launchd-start-user') {
            return {
              stepName,
              status: 'success',
              output: '',
              stderr: '',
              exitCode: 0,
              durationMs: 50,
              error: null,
            };
          }
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'success',
              output: 'pid = 88888\nstate = running',
              stderr: '',
              exitCode: 0,
              durationMs: 10,
              error: null,
            };
          }
          return {
            stepName,
            status: 'success',
            output: '',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      // Should succeed because user domain fallback worked
      expect(result.data.pid).toBe(88888);
      expect(result.success).toBe(true);

      // Should have launchd-start-user step
      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toContain('launchd-start-user');
    });
  });

  // ==========================================================================
  // Validation Errors
  // ==========================================================================

  describe('validation errors', () => {
    test('rejects missing app parameter', async () => {
      await expect(
        template.executeCommand({ manager: 'pm2' })
      ).rejects.toThrow('"app" parameter is required');
    });

    test('rejects non-string app parameter', async () => {
      await expect(
        template.executeCommand({ app: 42, manager: 'pm2' })
      ).rejects.toThrow('"app" parameter is required');
    });

    test('rejects empty string app parameter', async () => {
      await expect(
        template.executeCommand({ app: '', manager: 'pm2' })
      ).rejects.toThrow('"app" parameter is required');
    });

    test('rejects missing manager parameter', async () => {
      await expect(
        template.executeCommand({ app: 'my-api' })
      ).rejects.toThrow('"manager" parameter is required');
    });

    test('rejects invalid manager value', async () => {
      await expect(
        template.executeCommand({ app: 'my-api', manager: 'docker' })
      ).rejects.toThrow('"manager" parameter is required and must be "pm2" or "launchd"');
    });

    test('rejects systemd as manager (must be pm2 or launchd)', async () => {
      await expect(
        template.executeCommand({ app: 'my-api', manager: 'systemd' })
      ).rejects.toThrow('"manager" parameter is required and must be "pm2" or "launchd"');
    });

    test('does not call runStep when validation fails', async () => {
      try {
        await template.executeCommand({});
      } catch {
        // expected
      }
      expect(mockRunStep).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // Failure Scenarios
  // ==========================================================================

  describe('failure scenarios', () => {
    test('pm2 restart failure returns early', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'pm2: command not found',
          exitCode: 127,
          durationMs: 5,
          error: `Step "${stepName}" failed with exit code 127`,
        })
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('PM2 restart failed');
      expect(result.steps.length).toBe(1); // Only pm2-restart, no verify
    });

    test('launchd both domain restarts fail', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'launchd-stop') {
            return {
              stepName,
              status: 'success',
              output: '',
              stderr: '',
              exitCode: 0,
              durationMs: 5,
              error: null,
            };
          }
          // Both launchd-start and launchd-start-user fail
          return {
            stepName,
            status: 'failure',
            output: '',
            stderr: 'service not found',
            exitCode: 113,
            durationMs: 5,
            error: `Step "${stepName}" failed with exit code 113`,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('launchd restart failed');
    });

    test('pm2 verify fails and pid not found', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'pm2-restart') {
            return {
              stepName,
              status: 'success',
              output: 'restarted',
              stderr: '',
              exitCode: 0,
              durationMs: 100,
              error: null,
            };
          }
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'pm2 jlist failed',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "verify-process" failed with exit code 1',
            };
          }
          return {
            stepName,
            status: 'success',
            output: '',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found after restart');
    });

    test('launchd verify and pgrep both fail results in no pid', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'verify-process') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'service not loaded',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "verify-process" failed',
            };
          }
          if (stepName === 'pgrep-check') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: '',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "pgrep-check" failed',
            };
          }
          return {
            stepName,
            status: 'success',
            output: '',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'launchd' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found after restart');
    });

    test('totalDurationMs sums all step durations even on failure', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'error',
          exitCode: 1,
          durationMs: 15,
          error: `Step "${stepName}" failed`,
        })
      );

      const result = await template.executeCommand({ app: 'my-api', manager: 'pm2' });

      let expectedTotal = 0;
      for (let i = 0; i < result.steps.length; i++) {
        expectedTotal += result.steps[i]!.durationMs;
      }
      expect(result.totalDurationMs).toBe(expectedTotal);
    });
  });
});
