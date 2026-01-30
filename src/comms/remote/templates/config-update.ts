/**
 * Config Update Command Template
 *
 * Validates key=value format, writes environment variables to a .env file,
 * returns a diff of changed values, and optionally restarts the app.
 * Includes shell injection validation for safety.
 */

import type {
  CommandTemplate,
  ConfigParams,
  StepResult,
  StructuredCommandResult,
} from './types';
import { INJECTION_CHARS, runStep } from './types';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * Parse a .env file into a key-value map.
 * Handles KEY=VALUE, KEY="VALUE", and KEY='VALUE' formats.
 * Skips blank lines and lines starting with #.
 */
function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result.set(key, value);
  }
  return result;
}

/**
 * Serialize a key-value map back to .env file content.
 * Preserves comments and blank lines from original content.
 */
function serializeEnvFile(
  originalContent: string,
  updates: Record<string, string>
): string {
  const lines = originalContent.split('\n');
  const updatedKeys = new Set<string>();
  const result: string[] = [];

  // Update existing lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      result.push(line);
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    if (key in updates) {
      result.push(`${key}=${updates[key]}`);
      updatedKeys.add(key);
    } else {
      result.push(line);
    }
  }

  // Append new keys not in original file
  const updateKeys = Object.keys(updates);
  for (let i = 0; i < updateKeys.length; i++) {
    const key = updateKeys[i]!;
    if (!updatedKeys.has(key)) {
      result.push(`${key}=${updates[key]}`);
    }
  }

  return result.join('\n');
}

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

      // Validate key format (alphanumeric + underscore only)
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(
          `ConfigTemplate: env var key "${key}" must be alphanumeric with underscores`
        );
      }

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

  async executeCommand(params: Record<string, unknown>): Promise<StructuredCommandResult> {
    this.validateParams(params);
    const p = params as unknown as ConfigParams;
    const envFile = p.envFile ?? '.env';
    const startedAt = new Date().toISOString();

    const steps: StepResult[] = [];
    const data: Record<string, unknown> = {
      envFile,
      keysUpdated: Object.keys(p.envVars),
    };
    let overallSuccess = true;
    let overallError: string | null = null;

    // Step 1: Read existing .env file
    const readStart = Date.now();
    let originalContent = '';
    let originalValues = new Map<string, string>();
    try {
      if (existsSync(envFile)) {
        originalContent = readFileSync(envFile, 'utf-8');
        originalValues = parseEnvFile(originalContent);
      }
      steps.push({
        stepName: 'read-env',
        status: 'success',
        output: `Read ${originalValues.size} existing entries from ${envFile}`,
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - readStart,
        error: null,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      steps.push({
        stepName: 'read-env',
        status: 'failure',
        output: '',
        stderr: errMsg,
        exitCode: null,
        durationMs: Date.now() - readStart,
        error: `Failed to read ${envFile}: ${errMsg}`,
      });
      overallSuccess = false;
      overallError = `Failed to read ${envFile}: ${errMsg}`;
      return this.buildResult(steps, overallSuccess, overallError, startedAt, data);
    }

    // Step 2: Compute diff
    const diffStart = Date.now();
    const diff: Record<string, { old: string | null; new: string }> = {};
    const updateKeys = Object.keys(p.envVars);
    for (let i = 0; i < updateKeys.length; i++) {
      const key = updateKeys[i]!;
      const newValue = p.envVars[key]!;
      const oldValue = originalValues.get(key) ?? null;
      if (oldValue !== newValue) {
        diff[key] = { old: oldValue, new: newValue };
      }
    }
    data.diff = diff;
    data.changedCount = Object.keys(diff).length;

    steps.push({
      stepName: 'compute-diff',
      status: 'success',
      output: `${Object.keys(diff).length} value(s) changed`,
      stderr: '',
      exitCode: 0,
      durationMs: Date.now() - diffStart,
      error: null,
    });

    // Step 3: Write updated .env file
    const writeStart = Date.now();
    try {
      const updatedContent = serializeEnvFile(originalContent, p.envVars);
      writeFileSync(envFile, updatedContent, 'utf-8');
      steps.push({
        stepName: 'write-env',
        status: 'success',
        output: `Wrote ${updateKeys.length} entries to ${envFile}`,
        stderr: '',
        exitCode: 0,
        durationMs: Date.now() - writeStart,
        error: null,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      steps.push({
        stepName: 'write-env',
        status: 'failure',
        output: '',
        stderr: errMsg,
        exitCode: null,
        durationMs: Date.now() - writeStart,
        error: `Failed to write ${envFile}: ${errMsg}`,
      });
      overallSuccess = false;
      overallError = `Failed to write ${envFile}: ${errMsg}`;
      return this.buildResult(steps, overallSuccess, overallError, startedAt, data);
    }

    // Step 4: Optional restart
    if (p.restart && p.app) {
      const restartStep = await runStep('restart-app', `pm2 restart ${p.app}`);
      steps.push(restartStep);
      if (restartStep.status === 'failure') {
        overallSuccess = false;
        overallError = `App restart failed: ${restartStep.error}`;
      }
      data.restarted = restartStep.status === 'success';
    } else {
      data.restarted = false;
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
