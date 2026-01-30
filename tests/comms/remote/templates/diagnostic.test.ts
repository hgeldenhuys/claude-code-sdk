/**
 * Tests for Diagnostic Command Template
 *
 * Covers:
 * - Success path: executeCommand returns structured sections for each check
 * - Validation error: Invalid checks rejected before execution
 * - Failure: Step failures result in error data for that section
 * - macOS commands: vm_stat for memory, ps aux -m for processes
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

import { DiagnosticTemplate } from '../../../../src/comms/remote/templates/diagnostic';

describe('DiagnosticTemplate - executeCommand', () => {
  let template: DiagnosticTemplate;

  beforeEach(() => {
    template = new DiagnosticTemplate();
    mockRunStep.mockClear();
  });

  // ==========================================================================
  // Success Path
  // ==========================================================================

  describe('success path', () => {
    test('returns structured result for disk check', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/disk1s1    500G  200G  300G  40%  /',
          stderr: '',
          exitCode: 0,
          durationMs: 10,
          error: null,
        })
      );

      const result = await template.executeCommand({ checks: ['disk'] });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('diagnostic');
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.stepName).toBe('disk');

      // Verify parsed disk data
      const diskData = result.data.disk as Record<string, unknown>[];
      expect(Array.isArray(diskData)).toBe(true);
      expect(diskData.length).toBeGreaterThan(0);
      expect(diskData[0]!.filesystem).toBe('/dev/disk1s1');
      expect(diskData[0]!.mountedOn).toBe('/');
    });

    test('returns structured result for memory check (macOS)', async () => {
      // On macOS (darwin), vm_stat is used
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: [
            'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
            'Pages free:                               12345.',
            'Pages active:                             67890.',
            'Pages inactive:                           11111.',
            'Pages speculative:                        22222.',
          ].join('\n'),
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      const result = await template.executeCommand({ checks: ['memory'] });

      expect(result.success).toBe(true);
      expect(result.steps.length).toBe(1);
      expect(result.steps[0]!.stepName).toBe('memory');

      // On darwin, memory should be parsed via parseVmStat
      const memData = result.data.memory as Record<string, unknown>;
      // The platform field should be present
      if (process.platform === 'darwin') {
        expect(memData.platform).toBe('darwin');
        expect(memData.pages_free).toBe(12345);
        expect(memData.pages_active).toBe(67890);
      }
    });

    test('uses correct memory command for current platform', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'mock memory output',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      await template.executeCommand({ checks: ['memory'] });

      const command = mockRunStep.mock.calls[0]![1];
      if (process.platform === 'darwin') {
        expect(command).toBe('vm_stat');
      } else {
        expect(command).toBe('free -m');
      }
    });

    test('uses correct process command for current platform', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot         1  0.0  0.0   1234   567 ?        Ss   Jan01   0:00 /sbin/init',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      await template.executeCommand({ checks: ['processes'] });

      const command = mockRunStep.mock.calls[0]![1];
      if (process.platform === 'darwin') {
        expect(command).toBe('ps aux -m | head -20');
      } else {
        expect(command).toBe('ps aux --sort=-%mem | head -20');
      }
    });

    test('parses process list into structured data', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot         1  0.5  1.2  12340   5678 ?        Ss   Jan01   0:05 /sbin/init --mode=production',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      const result = await template.executeCommand({ checks: ['processes'] });

      const processes = result.data.processes as Record<string, unknown>[];
      expect(Array.isArray(processes)).toBe(true);
      expect(processes.length).toBe(1);
      expect(processes[0]!.user).toBe('root');
      expect(processes[0]!.pid).toBe('1');
      expect(processes[0]!.cpu).toBe('0.5');
      expect(processes[0]!.mem).toBe('1.2');
      expect(processes[0]!.command).toContain('/sbin/init');
    });

    test('handles storage check with custom paths', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: '50G\t/var/log\n120G\t/home',
          stderr: '',
          exitCode: 0,
          durationMs: 8,
          error: null,
        })
      );

      const result = await template.executeCommand({
        checks: ['storage'],
        paths: ['/var/log', '/home'],
      });

      expect(result.steps[0]!.stepName).toBe('storage');
      const storage = result.data.storage as Record<string, string>[];
      expect(storage.length).toBe(2);
      expect(storage[0]!.size).toBe('50G');
      expect(storage[0]!.path).toBe('/var/log');
      expect(storage[1]!.size).toBe('120G');
      expect(storage[1]!.path).toBe('/home');
    });

    test('storage check defaults to / when no paths specified', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: '500G\t/',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      await template.executeCommand({ checks: ['storage'] });

      const command = mockRunStep.mock.calls[0]![1];
      expect(command).toBe('du -sh /');
    });

    test('runs multiple checks in order', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'ok',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      const result = await template.executeCommand({
        checks: ['disk', 'memory', 'processes', 'storage'],
      });

      expect(result.steps.length).toBe(4);
      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toEqual(['disk', 'memory', 'processes', 'storage']);
    });

    test('data.platform is set to current platform', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'ok',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      const result = await template.executeCommand({ checks: ['disk'] });
      expect(result.data.platform).toBe(process.platform);
    });

    test('totalDurationMs is sum of all step durations', async () => {
      let callNum = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callNum++;
          return {
            stepName,
            status: 'success',
            output: 'ok',
            stderr: '',
            exitCode: 0,
            durationMs: callNum * 10,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({
        checks: ['disk', 'memory'],
      });

      expect(result.totalDurationMs).toBe(10 + 20);
    });
  });

  // ==========================================================================
  // Validation Errors
  // ==========================================================================

  describe('validation errors', () => {
    test('rejects missing checks parameter', async () => {
      await expect(template.executeCommand({})).rejects.toThrow(
        '"checks" parameter is required and must be an array'
      );
    });

    test('rejects non-array checks parameter', async () => {
      await expect(template.executeCommand({ checks: 'disk' })).rejects.toThrow(
        '"checks" parameter is required and must be an array'
      );
    });

    test('rejects empty checks array', async () => {
      await expect(template.executeCommand({ checks: [] })).rejects.toThrow(
        '"checks" must contain at least one entry'
      );
    });

    test('rejects invalid check type', async () => {
      await expect(
        template.executeCommand({ checks: ['disk', 'invalid'] })
      ).rejects.toThrow('invalid check "invalid"');
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
    test('step failure sets error data for that section', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'disk') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'df: Permission denied',
              exitCode: 1,
              durationMs: 5,
              error: 'Step "disk" failed with exit code 1',
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

      const result = await template.executeCommand({ checks: ['disk', 'memory'] });

      expect(result.success).toBe(false);
      expect(result.error).toBe('One or more diagnostic checks failed');

      const diskData = result.data.disk as Record<string, unknown>;
      expect(diskData.error).toBeTruthy();
      // memory should still succeed
      expect(result.steps.length).toBe(2);
    });

    test('memory failure sets error in data.memory', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          if (stepName === 'memory') {
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'vm_stat: command not found',
              exitCode: 127,
              durationMs: 3,
              error: 'Step "memory" failed with exit code 127',
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

      const result = await template.executeCommand({ checks: ['memory'] });

      expect(result.success).toBe(false);
      const memData = result.data.memory as Record<string, unknown>;
      expect(memData.error).toBeTruthy();
    });

    test('processes failure sets error in data.processes', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'ps: command not found',
          exitCode: 127,
          durationMs: 3,
          error: `Step "${stepName}" failed with exit code 127`,
        })
      );

      const result = await template.executeCommand({ checks: ['processes'] });

      expect(result.success).toBe(false);
      const procData = result.data.processes as Record<string, unknown>;
      expect(procData.error).toBeTruthy();
    });

    test('storage failure sets error in data.storage', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'du: /nonexistent: No such file or directory',
          exitCode: 1,
          durationMs: 3,
          error: `Step "${stepName}" failed with exit code 1`,
        })
      );

      const result = await template.executeCommand({
        checks: ['storage'],
        paths: ['/nonexistent'],
      });

      expect(result.success).toBe(false);
      const storageData = result.data.storage as Record<string, unknown>;
      expect(storageData.error).toBeTruthy();
    });

    test('partial failure: some checks pass, some fail', async () => {
      let callCount = 0;
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => {
          callCount++;
          if (callCount === 2) {
            // second check (memory) fails
            return {
              stepName,
              status: 'failure',
              output: '',
              stderr: 'error',
              exitCode: 1,
              durationMs: 5,
              error: `Step "${stepName}" failed`,
            };
          }
          return {
            stepName,
            status: 'success',
            output: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1    500G  200G  300G  40%  /',
            stderr: '',
            exitCode: 0,
            durationMs: 5,
            error: null,
          };
        }
      );

      const result = await template.executeCommand({
        checks: ['disk', 'memory'],
      });

      expect(result.success).toBe(false);
      expect(result.steps.length).toBe(2);
      expect(result.steps[0]!.status).toBe('success');
      expect(result.steps[1]!.status).toBe('failure');
    });
  });
});
