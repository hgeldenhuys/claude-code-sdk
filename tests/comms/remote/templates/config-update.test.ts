/**
 * Tests for Config Update Command Template
 *
 * Covers:
 * - Success path: executeCommand reads .env, computes diff, writes updated file
 * - Validation error: key=value format validation, shell injection rejection
 * - Failure: File read/write failures, optional restart failure
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepResult } from '../../../../src/comms/remote/templates/types';

// Mock runStep for the restart step (file ops are real)
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

import { ConfigTemplate } from '../../../../src/comms/remote/templates/config-update';

describe('ConfigTemplate - executeCommand', () => {
  let template: ConfigTemplate;
  let testDir: string;
  let testEnvFile: string;

  beforeEach(() => {
    template = new ConfigTemplate();
    mockRunStep.mockClear();

    // Create a unique temp directory for each test
    testDir = join(tmpdir(), `config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testEnvFile = join(testDir, '.env');
  });

  afterEach(() => {
    // Clean up test .env file
    try {
      if (existsSync(testEnvFile)) {
        unlinkSync(testEnvFile);
      }
    } catch {
      // ignore cleanup errors
    }
  });

  // ==========================================================================
  // Success Path
  // ==========================================================================

  describe('success path', () => {
    test('creates new .env file when none exists', async () => {
      const result = await template.executeCommand({
        envVars: { NODE_ENV: 'production', PORT: '3000' },
        envFile: testEnvFile,
      });

      expect(result.success).toBe(true);
      expect(result.templateName).toBe('config-update');

      // Verify file was written
      const content = readFileSync(testEnvFile, 'utf-8');
      expect(content).toContain('NODE_ENV=production');
      expect(content).toContain('PORT=3000');
    });

    test('updates existing .env file preserving untouched entries', async () => {
      // Create an initial .env
      writeFileSync(testEnvFile, 'NODE_ENV=development\nPORT=3000\nDB_HOST=localhost\n', 'utf-8');

      const result = await template.executeCommand({
        envVars: { NODE_ENV: 'production' },
        envFile: testEnvFile,
      });

      expect(result.success).toBe(true);

      const content = readFileSync(testEnvFile, 'utf-8');
      expect(content).toContain('NODE_ENV=production');
      expect(content).toContain('PORT=3000');
      expect(content).toContain('DB_HOST=localhost');
    });

    test('preserves comments in .env file', async () => {
      writeFileSync(testEnvFile, '# Database settings\nDB_HOST=localhost\n# App config\nPORT=3000\n', 'utf-8');

      await template.executeCommand({
        envVars: { PORT: '8080' },
        envFile: testEnvFile,
      });

      const content = readFileSync(testEnvFile, 'utf-8');
      expect(content).toContain('# Database settings');
      expect(content).toContain('# App config');
      expect(content).toContain('PORT=8080');
    });

    test('has correct steps: read-env, compute-diff, write-env', async () => {
      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
      });

      expect(result.steps.length).toBe(3);
      const stepNames = [];
      for (let i = 0; i < result.steps.length; i++) {
        stepNames.push(result.steps[i]!.stepName);
      }
      expect(stepNames).toEqual(['read-env', 'compute-diff', 'write-env']);
    });

    test('diff shows old and new values', async () => {
      writeFileSync(testEnvFile, 'NODE_ENV=development\n', 'utf-8');

      const result = await template.executeCommand({
        envVars: { NODE_ENV: 'production' },
        envFile: testEnvFile,
      });

      const diff = result.data.diff as Record<string, { old: string | null; new: string }>;
      expect(diff.NODE_ENV).toBeDefined();
      expect(diff.NODE_ENV!.old).toBe('development');
      expect(diff.NODE_ENV!.new).toBe('production');
    });

    test('diff shows null for new keys', async () => {
      writeFileSync(testEnvFile, 'EXISTING=value\n', 'utf-8');

      const result = await template.executeCommand({
        envVars: { NEW_KEY: 'new_value' },
        envFile: testEnvFile,
      });

      const diff = result.data.diff as Record<string, { old: string | null; new: string }>;
      expect(diff.NEW_KEY).toBeDefined();
      expect(diff.NEW_KEY!.old).toBeNull();
      expect(diff.NEW_KEY!.new).toBe('new_value');
    });

    test('diff excludes unchanged values', async () => {
      writeFileSync(testEnvFile, 'KEY=value\n', 'utf-8');

      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
      });

      const diff = result.data.diff as Record<string, unknown>;
      expect(Object.keys(diff).length).toBe(0);
      expect(result.data.changedCount).toBe(0);
    });

    test('data contains keysUpdated list', async () => {
      const result = await template.executeCommand({
        envVars: { A: '1', B: '2', C: '3' },
        envFile: testEnvFile,
      });

      const keysUpdated = result.data.keysUpdated as string[];
      expect(keysUpdated).toContain('A');
      expect(keysUpdated).toContain('B');
      expect(keysUpdated).toContain('C');
    });

    test('data.restarted is false when restart not requested', async () => {
      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
      });

      expect(result.data.restarted).toBe(false);
    });

    test('optional restart adds restart-app step', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'success',
          output: 'restarted',
          stderr: '',
          exitCode: 0,
          durationMs: 5,
          error: null,
        })
      );

      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
        app: 'my-api',
        restart: true,
      });

      expect(result.steps.length).toBe(4); // read-env, compute-diff, write-env, restart-app
      expect(result.steps[3]!.stepName).toBe('restart-app');
      expect(result.data.restarted).toBe(true);

      // Verify restart command
      expect(mockRunStep.mock.calls[0]![1]).toBe('pm2 restart my-api');
    });

    test('handles .env with quoted values', async () => {
      writeFileSync(testEnvFile, 'KEY="old_value"\nKEY2=\'single_quoted\'\n', 'utf-8');

      const result = await template.executeCommand({
        envVars: { KEY: 'new_value' },
        envFile: testEnvFile,
      });

      const diff = result.data.diff as Record<string, { old: string | null; new: string }>;
      expect(diff.KEY!.old).toBe('old_value');
      expect(diff.KEY!.new).toBe('new_value');
    });

    test('totalDurationMs is sum of all step durations', async () => {
      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
      });

      let expectedTotal = 0;
      for (let i = 0; i < result.steps.length; i++) {
        expectedTotal += result.steps[i]!.durationMs;
      }
      expect(result.totalDurationMs).toBe(expectedTotal);
    });
  });

  // ==========================================================================
  // Validation Errors
  // ==========================================================================

  describe('validation errors', () => {
    test('rejects missing envVars parameter', async () => {
      await expect(template.executeCommand({})).rejects.toThrow(
        '"envVars" parameter is required'
      );
    });

    test('rejects non-object envVars', async () => {
      await expect(
        template.executeCommand({ envVars: 'not-an-object' })
      ).rejects.toThrow('"envVars" parameter is required');
    });

    test('rejects empty envVars object', async () => {
      await expect(
        template.executeCommand({ envVars: {} })
      ).rejects.toThrow('must contain at least one entry');
    });

    test('rejects key with spaces', async () => {
      await expect(
        template.executeCommand({ envVars: { 'MY KEY': 'value' } })
      ).rejects.toThrow('must be alphanumeric with underscores');
    });

    test('rejects key with leading number', async () => {
      await expect(
        template.executeCommand({ envVars: { '1KEY': 'value' } })
      ).rejects.toThrow('must be alphanumeric with underscores');
    });

    test('rejects key with special characters', async () => {
      await expect(
        template.executeCommand({ envVars: { 'KEY-NAME': 'value' } })
      ).rejects.toThrow('must be alphanumeric with underscores');
    });

    test('allows valid key format with underscores', async () => {
      // Should not throw
      await expect(
        template.executeCommand({
          envVars: { MY_KEY_123: 'value', _PRIVATE: 'val' },
          envFile: testEnvFile,
        })
      ).resolves.toBeTruthy();
    });

    test('rejects shell injection in key with semicolon', async () => {
      await expect(
        template.executeCommand({ envVars: { 'KEY;rm': 'value' } })
      ).rejects.toThrow('must be alphanumeric with underscores');
    });

    test('rejects shell injection in value with $( )', async () => {
      await expect(
        template.executeCommand({ envVars: { KEY: '$(whoami)' } })
      ).rejects.toThrow('shell injection characters');
    });

    test('rejects shell injection in value with backtick', async () => {
      await expect(
        template.executeCommand({ envVars: { KEY: '`whoami`' } })
      ).rejects.toThrow('shell injection characters');
    });

    test('rejects shell injection in value with pipe', async () => {
      await expect(
        template.executeCommand({ envVars: { KEY: 'value|malicious' } })
      ).rejects.toThrow('shell injection characters');
    });

    test('rejects shell injection in value with ampersand', async () => {
      await expect(
        template.executeCommand({ envVars: { KEY: 'value&echo bad' } })
      ).rejects.toThrow('shell injection characters');
    });

    test('rejects shell injection in value with ${...}', async () => {
      await expect(
        template.executeCommand({ envVars: { KEY: '${HOME}' } })
      ).rejects.toThrow('shell injection characters');
    });

    test('does not call runStep or modify files when validation fails', async () => {
      try {
        await template.executeCommand({});
      } catch {
        // expected
      }
      expect(mockRunStep).not.toHaveBeenCalled();
      expect(existsSync(testEnvFile)).toBe(false);
    });
  });

  // ==========================================================================
  // Failure Scenarios
  // ==========================================================================

  describe('failure scenarios', () => {
    test('restart failure marks result as failed', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'pm2 not found',
          exitCode: 127,
          durationMs: 5,
          error: 'Step "restart-app" failed with exit code 127',
        })
      );

      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: testEnvFile,
        app: 'my-api',
        restart: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('App restart failed');
      expect(result.data.restarted).toBe(false);
    });

    test('file is still updated even when restart fails', async () => {
      mockRunStep.mockImplementation(
        async (stepName: string): Promise<StepResult> => ({
          stepName,
          status: 'failure',
          output: '',
          stderr: 'pm2 error',
          exitCode: 1,
          durationMs: 5,
          error: 'restart failed',
        })
      );

      await template.executeCommand({
        envVars: { IMPORTANT: 'update' },
        envFile: testEnvFile,
        app: 'my-api',
        restart: true,
      });

      // File should still have been written before restart step
      const content = readFileSync(testEnvFile, 'utf-8');
      expect(content).toContain('IMPORTANT=update');
    });

    test('read failure on unreadable path returns failure result', async () => {
      // Point to a path that exists but is a directory (cannot be read as file normally)
      const badPath = join(testDir, 'nonexistent-dir', 'deeply', 'nested', '.env');

      const result = await template.executeCommand({
        envVars: { KEY: 'value' },
        envFile: badPath,
      });

      // The write step will fail since directory doesn't exist
      expect(result.success).toBe(false);
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
    });
  });
});
