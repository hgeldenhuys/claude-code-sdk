/**
 * Tests for Deploy Command Template
 *
 * Covers:
 * - Success path: executeCommand returns structured output with 4 steps (git-pull, install, build, pm2-restart)
 * - Validation error: Invalid params rejected before execution
 * - Failure/rollback: Build failure triggers rollback step
 */

import { describe, test, expect, beforeEach, mock, afterEach } from 'bun:test';
import type { StepResult, StructuredCommandResult } from '../../../../src/comms/remote/templates/types';

// We mock runStep at the module level so templates use our mock
const mockRunStep = mock<(stepName: string, command: string, options?: { cwd?: string }) => Promise<StepResult>>(
  async (stepName: string, _command: string, _options?: { cwd?: string }): Promise<StepResult> => ({
    stepName,
    status: 'success',
    output: `mock output for ${stepName}`,
    stderr: '',
    exitCode: 0,
    durationMs: 10,
    error: null,
  })
);

// Mock the types module to intercept runStep
mock.module('../../../../src/comms/remote/templates/types', () => {
  const actual = require('../../../../src/comms/remote/templates/types');
  return {
    ...actual,
    runStep: mockRunStep,
  };
});

// Import template AFTER mocking
import { DeployTemplate } from '../../../../src/comms/remote/templates/deploy';

describe('DeployTemplate - executeCommand', () => {
  let template: DeployTemplate;

  beforeEach(() => {
    template = new DeployTemplate();
    mockRunStep.mockClear();
    // Reset to default success behavior
    mockRunStep.mockImplementation(
      async (stepName: string, _command: string, _options?: { cwd?: string }): Promise<StepResult> => ({
        stepName,
        status: 'success',
        output: `mock output for ${stepName}`,
        stderr: '',
        exitCode: 0,
        durationMs: 10,
        error: null,
      })
    );
  });

  // ==========================================================================
  // Success Path
  // ==========================================================================

  describe('success path', () => {
    test('returns structured result with all 4 steps on success', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('deploy');
      expect(result.steps.length).toBe(4);
      expect(result.error).toBeNull();

      // Verify step names in order
      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toEqual(['git-pull', 'install', 'build', 'pm2-restart']);
    });

    test('each step has success status', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      for (let i = 0; i < result.steps.length; i++) {
        expect(result.steps[i]!.status).toBe('success');
      }
    });

    test('has valid timestamps', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.startedAt).toBeTruthy();
      expect(result.completedAt).toBeTruthy();
      // startedAt should be before or equal to completedAt
      expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(result.completedAt).getTime()
      );
    });

    test('totalDurationMs is sum of step durations', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      let expectedTotal = 0;
      for (let i = 0; i < result.steps.length; i++) {
        expectedTotal += result.steps[i]!.durationMs;
      }
      expect(result.totalDurationMs).toBe(expectedTotal);
    });

    test('data contains app, branch, deployDir, and step counts', async () => {
      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.data.app).toBe('my-api');
      expect(result.data.branch).toBe('main');
      expect(result.data.deployDir).toBe('.');
      expect(result.data.stepsCompleted).toBe(4);
      expect(result.data.stepsTotal).toBe(4);
    });

    test('uses custom branch and deployDir', async () => {
      const result = await template.executeCommand({
        app: 'my-api',
        branch: 'release/v2',
        deployDir: '/opt/services',
      });

      expect(result.data.branch).toBe('release/v2');
      expect(result.data.deployDir).toBe('/opt/services');
    });

    test('passes correct commands to runStep', async () => {
      await template.executeCommand({
        app: 'my-api',
        branch: 'develop',
        deployDir: '/app',
        buildCmd: 'npm run build',
      });

      // Verify the commands passed to runStep
      expect(mockRunStep).toHaveBeenCalledTimes(4);

      // git-pull
      expect(mockRunStep.mock.calls[0]![0]).toBe('git-pull');
      expect(mockRunStep.mock.calls[0]![1]).toBe('git pull origin develop');
      expect(mockRunStep.mock.calls[0]![2]).toEqual({ cwd: '/app' });

      // install
      expect(mockRunStep.mock.calls[1]![0]).toBe('install');
      expect(mockRunStep.mock.calls[1]![1]).toBe('bun install');

      // build
      expect(mockRunStep.mock.calls[2]![0]).toBe('build');
      expect(mockRunStep.mock.calls[2]![1]).toBe('npm run build');

      // pm2-restart
      expect(mockRunStep.mock.calls[3]![0]).toBe('pm2-restart');
      expect(mockRunStep.mock.calls[3]![1]).toBe('pm2 restart my-api');
    });

    test('uses default buildCmd (bun run build) when not specified', async () => {
      await template.executeCommand({ app: 'my-api' });

      // build step should use default
      expect(mockRunStep.mock.calls[2]![1]).toBe('bun run build');
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
      await expect(template.executeCommand({ app: 123 })).rejects.toThrow(
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
  // Failure and Rollback
  // ==========================================================================

  describe('failure and rollback', () => {
    test('stops at git-pull failure without proceeding', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'fatal: not a git repository',
          exitCode: 128,
          durationMs: 5,
          error: `Step "${stepName}" failed with exit code 128`,
        })
      );

      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(1); // Only git-pull
      expect(result.steps[0]!.stepName).toBe('git-pull');
      expect(result.error).toContain('git-pull');
      expect(mockRunStep).toHaveBeenCalledTimes(1);
    });

    test('stops at install failure', async () => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (callCount === 2) {
            // install step fails
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'install failed',
              exitCode: 1,
              durationMs: 5,
              error: `Step "${stepName}" failed with exit code 1`,
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

      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(2); // git-pull + install
      expect(result.error).toContain('install');
      expect(mockRunStep).toHaveBeenCalledTimes(2);
    });

    test('triggers rollback on build failure', async () => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (callCount === 3) {
            // build step fails
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'Build error: missing module',
              exitCode: 1,
              durationMs: 15,
              error: `Step "${stepName}" failed with exit code 1`,
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

      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(4); // git-pull, install, build, rollback

      // Verify rollback step was added
      expect(result.steps[3]!.stepName).toBe('rollback');
      expect(result.error).toContain('Build failed, rolled back');

      // Verify rollback called git checkout
      expect(mockRunStep.mock.calls[3]![0]).toBe('rollback');
      expect(mockRunStep.mock.calls[3]![1]).toBe('git checkout HEAD~1');
    });

    test('rollback step appears in data.stepsCompleted count', async () => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (callCount === 3) {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'build error',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "build" failed with exit code 1',
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

      const result = await template.executeCommand({ app: 'my-api' });

      // git-pull succeeded, install succeeded, build failed, rollback succeeded = 3 successful
      expect(result.data.stepsCompleted).toBe(3);
      expect(result.data.stepsTotal).toBe(4);
    });

    test('pm2-restart failure returns failure result', async () => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (callCount === 4) {
            // pm2-restart fails
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'pm2 not found',
              exitCode: 127,
              durationMs: 5,
              error: `Step "${stepName}" failed with exit code 127`,
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

      const result = await template.executeCommand({ app: 'my-api' });

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(4); // No rollback for pm2 failure
      expect(result.error).toContain('PM2 restart failed');
    });
  });
});
