/**
 * Tests for COMMS Doctor Health Check
 *
 * Validates that the comms-doctor CLI runs correctly and
 * produces the expected output format for all modes.
 */

import { describe, test, expect } from 'bun:test';
import { spawn } from 'bun';

const DOCTOR_SCRIPT = 'bin/comms-doctor.ts';
const CWD = import.meta.dir.replace('/tests/comms', '');

async function runDoctor(args: string[] = []): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const proc = spawn(['bun', DOCTOR_SCRIPT, ...args], {
    cwd: CWD,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let stdout = '';
  let stderr = '';

  if (proc.stdout) {
    const reader = proc.stdout.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      if (result.done) {
        done = true;
      } else {
        chunks.push(result.value);
      }
    }
    stdout = new TextDecoder().decode(Buffer.concat(chunks));
  }

  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const result = await reader.read();
      if (result.done) {
        done = true;
      } else {
        chunks.push(result.value);
      }
    }
    stderr = new TextDecoder().decode(Buffer.concat(chunks));
  }

  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('COMMS Doctor', () => {
  test('--help shows usage info', async () => {
    const { stdout, exitCode } = await runDoctor(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('COMMS Doctor');
    expect(stdout).toContain('--json');
    expect(stdout).toContain('--verbose');
    expect(stdout).toContain('Usage');
  });

  test('default mode shows subsystem headers', async () => {
    const { stdout, exitCode } = await runDoctor();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Remote Templates:');
    expect(stdout).toContain('Security:');
    expect(stdout).toContain('Discord Bridge:');
    expect(stdout).toContain('E2E Connectivity:');
    expect(stdout).toContain('Summary:');
  });

  test('default mode reports check counts', async () => {
    const { stdout, exitCode } = await runDoctor();
    expect(exitCode).toBe(0);
    // Should have at least 13 checks (E2E may fail without config)
    const match = stdout.match(/(\d+)\/(\d+) checks passed/);
    expect(match).not.toBeNull();
    if (match) {
      const passed = parseInt(match[1]!, 10);
      const total = parseInt(match[2]!, 10);
      expect(total).toBeGreaterThanOrEqual(13);
      expect(passed).toBeGreaterThanOrEqual(13);
    }
  });

  test('--json outputs valid JSON', async () => {
    const { stdout, exitCode } = await runDoctor(['--json']);
    // Exit code may be 0 or 1 depending on E2E config
    expect([0, 1]).toContain(exitCode);

    const report = JSON.parse(stdout);
    expect(report).toHaveProperty('subsystems');
    expect(report).toHaveProperty('totalChecks');
    expect(report).toHaveProperty('totalPassed');
    expect(report).toHaveProperty('totalFailed');
    expect(report).toHaveProperty('durationMs');
    expect(report).toHaveProperty('timestamp');

    expect(Array.isArray(report.subsystems)).toBe(true);
    expect(report.subsystems.length).toBe(4);
  });

  test('--json subsystem structure is correct', async () => {
    const { stdout } = await runDoctor(['--json']);
    const report = JSON.parse(stdout);

    const names = report.subsystems.map((s: any) => s.name);
    expect(names).toContain('Remote Templates');
    expect(names).toContain('Security');
    expect(names).toContain('Discord Bridge');
    expect(names).toContain('E2E Connectivity');

    for (let i = 0; i < report.subsystems.length; i++) {
      const sub = report.subsystems[i];
      expect(sub).toHaveProperty('name');
      expect(sub).toHaveProperty('checks');
      expect(sub).toHaveProperty('passed');
      expect(sub).toHaveProperty('failed');
      expect(Array.isArray(sub.checks)).toBe(true);

      for (let j = 0; j < sub.checks.length; j++) {
        const check = sub.checks[j];
        expect(check).toHaveProperty('name');
        expect(check).toHaveProperty('passed');
        expect(check).toHaveProperty('message');
        expect(check).toHaveProperty('durationMs');
        expect(typeof check.passed).toBe('boolean');
        expect(typeof check.durationMs).toBe('number');
      }
    }
  });

  test('--json Remote Templates has 7 checks all passing', async () => {
    const { stdout } = await runDoctor(['--json']);
    const report = JSON.parse(stdout);

    const remoteSub = report.subsystems.find((s: any) => s.name === 'Remote Templates');
    expect(remoteSub).toBeDefined();
    expect(remoteSub.checks.length).toBe(7);
    expect(remoteSub.passed).toBe(7);
    expect(remoteSub.failed).toBe(0);
  });

  test('--json Security has 4 checks all passing', async () => {
    const { stdout } = await runDoctor(['--json']);
    const report = JSON.parse(stdout);

    const secSub = report.subsystems.find((s: any) => s.name === 'Security');
    expect(secSub).toBeDefined();
    expect(secSub.checks.length).toBe(4);
    expect(secSub.passed).toBe(4);
    expect(secSub.failed).toBe(0);
  });

  test('--json Discord Bridge has 3 checks all passing', async () => {
    const { stdout } = await runDoctor(['--json']);
    const report = JSON.parse(stdout);

    const discordSub = report.subsystems.find((s: any) => s.name === 'Discord Bridge');
    expect(discordSub).toBeDefined();
    expect(discordSub.checks.length).toBe(3);
    expect(discordSub.passed).toBe(3);
    expect(discordSub.failed).toBe(0);
  });

  test('--verbose shows timing info', async () => {
    const { stdout, exitCode } = await runDoctor(['--verbose']);
    expect(exitCode).toBe(0);
    // Verbose mode adds (Xms) after each check
    expect(stdout).toContain('ms)');
    expect(stdout).toContain('total)');
  });

  test('total checks equals sum of subsystem checks', async () => {
    const { stdout } = await runDoctor(['--json']);
    const report = JSON.parse(stdout);

    let sumChecks = 0;
    let sumPassed = 0;
    let sumFailed = 0;
    for (let i = 0; i < report.subsystems.length; i++) {
      sumChecks += report.subsystems[i].checks.length;
      sumPassed += report.subsystems[i].passed;
      sumFailed += report.subsystems[i].failed;
    }

    expect(report.totalChecks).toBe(sumChecks);
    expect(report.totalPassed).toBe(sumPassed);
    expect(report.totalFailed).toBe(sumFailed);
  });
});
