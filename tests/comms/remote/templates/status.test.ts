/**
 * Tests for Status Command Template
 *
 * Covers:
 * - Success path: executeCommand returns structured output with health/logs/uptime/pm2Info
 * - Validation error: Invalid params rejected before execution
 * - Failure: Health check failure marks overall result as failed
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { StepResult } from '../../../../src/comms/remote/templates/types';

// Mock runStep
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

import { StatusTemplate } from '../../../../src/comms/remote/templates/status';

describe('StatusTemplate - executeCommand', () => {
  let template: StatusTemplate;

  beforeEach(() => {
    template = new StatusTemplate();
    mockRunStep.mockClear();
  });

  // ==========================================================================
  // Success Path
  // ==========================================================================

  describe('success path', () => {
    beforeEach(() => {
      // Set up per-step mock responses
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          switch (stepName) {
            case 'health-check':
              return {
                stepName,
                status: 'success',
                output: '{"status":"ok"}',
                stderr: '',
                exitCode: 0,
                durationMs: 15,
                error: null,
              };
            case 'log-tail':
              return {
                stepName,
                status: 'success',
                output: 'line1\nline2\nline3',
                stderr: '',
                exitCode: 0,
                durationMs: 8,
                error: null,
              };
            case 'uptime':
              return {
                stepName,
                status: 'success',
                output: '14:30  up 5 days, 3:20, 2 users',
                stderr: '',
                exitCode: 0,
                durationMs: 3,
                error: null,
              };
            case 'pm2-info':
              return {
                stepName,
                status: 'success',
                output: JSON.stringify([
                  {
                    name: 'my-api',
                    pid: 12345,
                    pm2_env: { status: 'online', pm_uptime: Date.now() - 60000 },
                    monit: { memory: 52428800, cpu: 1.5 },
                  },
                ]),
                stderr: '',
                exitCode: 0,
                durationMs: 12,
                error: null,
              };
            default:
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
        }
      );
    });

    test('returns structured result with 4 steps', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('status');
      expect(result.steps.length).toBe(4);
      expect(result.error).toBeNull();

      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toEqual(['health-check', 'log-tail', 'uptime', 'pm2-info']);
    });

    test('data.healthCheck contains status and port', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      const healthCheck = result.data.healthCheck as Record<string, unknown>;
      expect(healthCheck.status).toBe('healthy');
      expect(healthCheck.port).toBe(3000);
      expect(healthCheck.response).toBe('{"status":"ok"}');
    });

    test('data.logs contains parsed log lines', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      const logs = result.data.logs as Record<string, unknown>;
      expect(logs.path).toBe('/var/log/app.log');
      expect(logs.linesRequested).toBe(50);
      const lines = logs.lines as string[];
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('line1');
    });

    test('data.uptime contains system uptime string', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.data.uptime).toContain('up 5 days');
    });

    test('data.pm2Info contains parsed process info for matching app', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      const pm2Info = result.data.pm2Info as Record<string, unknown>;
      expect(pm2Info.name).toBe('my-api');
      expect(pm2Info.pid).toBe(12345);
    });

    test('uses custom port, logPath, and logLines', async () => {
      await template.executeCommand({
        app: 'my-api',
        port: 8080,
        logPath: '/var/log/custom.log',
        logLines: 100,
      });

      // health-check
      expect(mockRunStep.mock.calls[0]![1]).toContain('localhost:8080/health');
      // log-tail
      expect(mockRunStep.mock.calls[1]![1]).toContain('tail -n 100 /var/log/custom.log');
    });

    test('data.app is set correctly', async () => {
      const result = await template.executeCommand({ app: 'my-service' });
      expect(result.data.app).toBe('my-service');
    });

    test('totalDurationMs is sum of all step durations', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      let expectedTotal = 0;
      for (let i = 0; i < result.steps.length; i++) {
        expectedTotal += result.steps[i]!.durationMs;
      }
      expect(result.totalDurationMs).toBe(expectedTotal);
    });

    test('pm2Info falls back to raw output when app not found in list', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'pm2-info') {
            return {
              stepName,
              status: 'success',
              output: JSON.stringify([{ name: 'other-app', pid: 999 }]),
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
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api' });
      const pm2Info = result.data.pm2Info as Record<string, unknown>;
      expect(pm2Info.raw).toBeTruthy(); // fallback to raw output
    });

    test('pm2Info falls back to raw when JSON parse fails', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'pm2-info') {
            return {
              stepName,
              status: 'success',
              output: 'not valid json',
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
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({ app: 'my-api' });
      const pm2Info = result.data.pm2Info as Record<string, unknown>;
      expect(pm2Info.raw).toBe('not valid json');
    });
  });

  // ==========================================================================
  // Validation Errors
  // ==========================================================================

  describe('validation errors', () => {
    test('rejects missing app parameter', async () => {
      await expect(template.executeCommand({})).rejects.toThrow('"app" parameter is required');
    });

    test('rejects non-string app parameter', async () => {
      await expect(template.executeCommand({ app: 42 })).rejects.toThrow(
        '"app" parameter is required'
      );
    });

    test('rejects empty string app parameter', async () => {
      await expect(template.executeCommand({ app: '' })).rejects.toThrow(
        '"app" parameter is required'
      );
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
    test('health check failure marks overall result as failed', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'health-check') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'Connection refused',
              exitCode: 7,
              durationMs: 5,
              error: 'Step "health-check" failed with exit code 7',
            };
          }
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
      );

      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Health check failed');
      // All 4 steps still execute (status checks everything regardless)
      expect(result.steps.length).toBe(4);
    });

    test('health check failure sets healthCheck.status to unhealthy', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'health-check') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'Connection refused',
              exitCode: 7,
              durationMs: 5,
              error: 'Step "health-check" failed with exit code 7',
            };
          }
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
      );

      const result = await template.executeCommand({ app: 'my-api' });
      const healthCheck = result.data.healthCheck as Record<string, unknown>;
      expect(healthCheck.status).toBe('unhealthy');
    });

    test('log-tail failure still populates logs.error', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'log-tail') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'No such file or directory',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "log-tail" failed with exit code 1',
            };
          }
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
      );

      const result = await template.executeCommand({ app: 'my-api' });
      const logs = result.data.logs as Record<string, unknown>;
      expect(logs.error).toBeTruthy();
      expect((logs.lines as string[]).length).toBe(0);
    });

    test('pm2-info failure sets pm2Info.error', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'pm2-info') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'pm2 not found',
              exitCode: 127,
              durationMs: 5,
              error: 'Step "pm2-info" failed with exit code 127',
            };
          }
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
      );

      const result = await template.executeCommand({ app: 'my-api' });
      const pm2Info = result.data.pm2Info as Record<string, unknown>;
      expect(pm2Info.error).toBeTruthy();
    });
  });
});
