/**
 * Tests for Remote Administration Module
 *
 * Covers: types, templates, receipt-tracker, response-formatter,
 * command-executor, command-handler, remote-client facade
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';

import { DeployTemplate } from '../../src/comms/remote/templates/deploy';
import { StatusTemplate } from '../../src/comms/remote/templates/status';
import { ConfigTemplate } from '../../src/comms/remote/templates/config-update';
import { DiagnosticTemplate } from '../../src/comms/remote/templates/diagnostic';
import { RestartTemplate } from '../../src/comms/remote/templates/restart';
import { getTemplate } from '../../src/comms/remote/templates/index';
import { ReceiptTracker } from '../../src/comms/remote/receipt-tracker';
import { ResponseFormatter } from '../../src/comms/remote/response-formatter';
import { CommandExecutor } from '../../src/comms/remote/command-executor';
import { CommandHandler } from '../../src/comms/remote/command-handler';
import type { ExecutionReceipt, CommandResult, RemoteConfig } from '../../src/comms/remote/types';
import type { ChannelClient } from '../../src/comms/channels/channel-client';
import type { SecurityMiddleware } from '../../src/comms/security/middleware';
import type { Message } from '../../src/comms/protocol/types';

// ============================================================================
// Deploy Template
// ============================================================================

describe('DeployTemplate', () => {
  let template: DeployTemplate;

  beforeEach(() => {
    template = new DeployTemplate();
  });

  test('has correct name and description', () => {
    expect(template.name).toBe('deploy');
    expect(template.description).toBeTruthy();
  });

  test('builds command with defaults', () => {
    const cmd = template.buildCommand({ app: 'my-api' });
    expect(cmd).toBe('cd . && git pull origin main && bun install && bun run build && pm2 restart my-api');
  });

  test('builds command with custom parameters', () => {
    const cmd = template.buildCommand({
      app: 'my-api',
      branch: 'release/v2',
      buildCmd: 'npm ci && npm run build',
      deployDir: '/opt/services',
    });
    expect(cmd).toContain('cd /opt/services');
    expect(cmd).toContain('git pull origin release/v2');
    expect(cmd).toContain('npm ci && npm run build');
    expect(cmd).toContain('pm2 restart my-api');
  });

  test('validates requires app', () => {
    expect(() => template.validateParams({})).toThrow('"app" parameter is required');
  });

  test('validates app must be string', () => {
    expect(() => template.validateParams({ app: 123 })).toThrow('"app" parameter is required');
  });

  test('passes validation with valid params', () => {
    expect(() => template.validateParams({ app: 'my-api' })).not.toThrow();
  });
});

// ============================================================================
// Status Template
// ============================================================================

describe('StatusTemplate', () => {
  let template: StatusTemplate;

  beforeEach(() => {
    template = new StatusTemplate();
  });

  test('builds command with defaults', () => {
    const cmd = template.buildCommand({ app: 'my-api' });
    expect(cmd).toContain('curl -sf http://localhost:3000/health');
    expect(cmd).toContain('tail -n 50 /var/log/app.log');
    expect(cmd).toContain('uptime');
    expect(cmd).toContain('pm2 describe my-api');
  });

  test('builds command with custom parameters', () => {
    const cmd = template.buildCommand({
      app: 'my-api',
      port: 8080,
      logPath: '/var/log/custom.log',
      logLines: 100,
    });
    expect(cmd).toContain('localhost:8080/health');
    expect(cmd).toContain('tail -n 100 /var/log/custom.log');
  });

  test('validates requires app', () => {
    expect(() => template.validateParams({})).toThrow('"app" parameter is required');
  });
});

// ============================================================================
// Config Template
// ============================================================================

describe('ConfigTemplate', () => {
  let template: ConfigTemplate;

  beforeEach(() => {
    template = new ConfigTemplate();
  });

  test('builds export commands', () => {
    const cmd = template.buildCommand({
      envVars: { NODE_ENV: 'production', PORT: '3000' },
    });
    expect(cmd).toContain('export NODE_ENV=production');
    expect(cmd).toContain('export PORT=3000');
  });

  test('appends restart when configured', () => {
    const cmd = template.buildCommand({
      envVars: { NODE_ENV: 'production' },
      app: 'my-api',
      restart: true,
    });
    expect(cmd).toContain('pm2 restart my-api');
  });

  test('does not restart without flag', () => {
    const cmd = template.buildCommand({
      envVars: { NODE_ENV: 'production' },
      app: 'my-api',
    });
    expect(cmd).not.toContain('pm2 restart');
  });

  test('validates requires envVars', () => {
    expect(() => template.validateParams({})).toThrow('"envVars" parameter is required');
  });

  test('validates envVars must have entries', () => {
    expect(() => template.validateParams({ envVars: {} })).toThrow('must contain at least one entry');
  });

  test('rejects shell injection in keys', () => {
    expect(() => template.validateParams({
      envVars: { 'KEY;rm -rf /': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('rejects shell injection in values', () => {
    expect(() => template.validateParams({
      envVars: { KEY: '$(whoami)' },
    })).toThrow('shell injection characters');
  });

  test('rejects pipe in values', () => {
    expect(() => template.validateParams({
      envVars: { KEY: 'value|malicious' },
    })).toThrow('shell injection characters');
  });

  test('rejects ampersand in keys', () => {
    expect(() => template.validateParams({
      envVars: { 'KEY&echo bad': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('rejects backtick in values', () => {
    expect(() => template.validateParams({
      envVars: { KEY: '`whoami`' },
    })).toThrow('shell injection characters');
  });

  test('passes validation with clean values', () => {
    expect(() => template.validateParams({
      envVars: { NODE_ENV: 'production', PORT: '3000' },
    })).not.toThrow();
  });
});

// ============================================================================
// Diagnostic Template
// ============================================================================

describe('DiagnosticTemplate', () => {
  let template: DiagnosticTemplate;

  beforeEach(() => {
    template = new DiagnosticTemplate();
  });

  test('builds disk check command', () => {
    const cmd = template.buildCommand({ checks: ['disk'] });
    expect(cmd).toBe('df -h');
  });

  test('builds memory check command', () => {
    const cmd = template.buildCommand({ checks: ['memory'] });
    // Platform-specific: macOS uses vm_stat, Linux uses free -m
    const expected = process.platform === 'darwin' ? 'vm_stat' : 'free -m';
    expect(cmd).toBe(expected);
  });

  test('builds processes check command', () => {
    const cmd = template.buildCommand({ checks: ['processes'] });
    expect(cmd).toContain('ps aux');
  });

  test('builds storage check with paths', () => {
    const cmd = template.buildCommand({
      checks: ['storage'],
      paths: ['/var', '/tmp'],
    });
    expect(cmd).toContain('du -sh /var /tmp');
  });

  test('builds storage check with default path', () => {
    const cmd = template.buildCommand({
      checks: ['storage'],
    });
    expect(cmd).toContain('du -sh /');
  });

  test('combines multiple checks', () => {
    const cmd = template.buildCommand({
      checks: ['disk', 'memory'],
    });
    const memCmd = process.platform === 'darwin' ? 'vm_stat' : 'free -m';
    expect(cmd).toBe(`df -h && ${memCmd}`);
  });

  test('validates requires checks', () => {
    expect(() => template.validateParams({})).toThrow('"checks" parameter is required');
  });

  test('validates checks must have entries', () => {
    expect(() => template.validateParams({ checks: [] })).toThrow('must contain at least one entry');
  });

  test('validates check type', () => {
    expect(() => template.validateParams({
      checks: ['invalid'],
    })).toThrow('invalid check "invalid"');
  });
});

// ============================================================================
// Restart Template
// ============================================================================

describe('RestartTemplate', () => {
  let template: RestartTemplate;

  beforeEach(() => {
    template = new RestartTemplate();
  });

  test('builds pm2 restart command', () => {
    const cmd = template.buildCommand({ app: 'my-api', manager: 'pm2' });
    expect(cmd).toBe('pm2 restart my-api');
  });

  test('builds launchd restart command', () => {
    const cmd = template.buildCommand({ app: 'my-api', manager: 'launchd' });
    expect(cmd).toBe('launchctl kickstart -k system/my-api');
  });

  test('validates requires app', () => {
    expect(() => template.validateParams({ manager: 'pm2' })).toThrow('"app" parameter is required');
  });

  test('validates requires manager', () => {
    expect(() => template.validateParams({ app: 'my-api' })).toThrow('"manager" parameter is required');
  });

  test('validates manager must be pm2 or launchd', () => {
    expect(() => template.validateParams({
      app: 'my-api',
      manager: 'docker',
    })).toThrow('"manager" parameter is required and must be "pm2" or "launchd"');
  });
});

// ============================================================================
// getTemplate Factory
// ============================================================================

describe('getTemplate', () => {
  test('returns DeployTemplate for deploy', () => {
    const template = getTemplate('deploy');
    expect(template.name).toBe('deploy');
  });

  test('returns StatusTemplate for status', () => {
    const template = getTemplate('status');
    expect(template.name).toBe('status');
  });

  test('returns ConfigTemplate for config-update', () => {
    const template = getTemplate('config-update');
    expect(template.name).toBe('config-update');
  });

  test('returns DiagnosticTemplate for diagnostic', () => {
    const template = getTemplate('diagnostic');
    expect(template.name).toBe('diagnostic');
  });

  test('returns RestartTemplate for restart', () => {
    const template = getTemplate('restart');
    expect(template.name).toBe('restart');
  });

  test('throws for unknown type', () => {
    expect(() => getTemplate('raw')).toThrow('No template found');
  });
});

// ============================================================================
// Receipt Tracker
// ============================================================================

describe('ReceiptTracker', () => {
  let tracker: ReceiptTracker;

  beforeEach(() => {
    tracker = new ReceiptTracker();
  });

  test('creates a receipt with command_sent status', () => {
    const receipt = tracker.create('cmd-1', 'agent-002', 'deploy');
    expect(receipt.commandId).toBe('cmd-1');
    expect(receipt.targetAgent).toBe('agent-002');
    expect(receipt.status).toBe('command_sent');
    expect(receipt.templateName).toBe('deploy');
    expect(receipt.sentAt).toBeTruthy();
    expect(receipt.acknowledgedAt).toBeNull();
    expect(receipt.executingAt).toBeNull();
    expect(receipt.completedAt).toBeNull();
    expect(receipt.failedAt).toBeNull();
    expect(receipt.output).toBeNull();
    expect(receipt.error).toBeNull();
  });

  test('creates receipt without template name', () => {
    const receipt = tracker.create('cmd-1', 'agent-002');
    expect(receipt.templateName).toBeNull();
  });

  test('acknowledges a receipt', () => {
    tracker.create('cmd-1', 'agent-002');
    const receipt = tracker.acknowledge('cmd-1');
    expect(receipt.status).toBe('acknowledged');
    expect(receipt.acknowledgedAt).toBeTruthy();
  });

  test('transitions to executing', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    const receipt = tracker.executing('cmd-1');
    expect(receipt.status).toBe('executing');
    expect(receipt.executingAt).toBeTruthy();
  });

  test('transitions to completed', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');

    const result: CommandResult = {
      success: true,
      output: 'done',
      stderr: '',
      exitCode: 0,
      durationMs: 100,
      error: null,
    };

    const receipt = tracker.complete('cmd-1', result);
    expect(receipt.status).toBe('completed');
    expect(receipt.completedAt).toBeTruthy();
    expect(receipt.output).toBe('done');
    expect(receipt.exitCode).toBe(0);
  });

  test('transitions to failed from command_sent', () => {
    tracker.create('cmd-1', 'agent-002');
    const receipt = tracker.fail('cmd-1', 'Network error');
    expect(receipt.status).toBe('failed');
    expect(receipt.failedAt).toBeTruthy();
    expect(receipt.error).toBe('Network error');
  });

  test('transitions to failed from acknowledged', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    const receipt = tracker.fail('cmd-1', 'Security violation');
    expect(receipt.status).toBe('failed');
  });

  test('transitions to failed from executing', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    const receipt = tracker.fail('cmd-1', 'Command timed out');
    expect(receipt.status).toBe('failed');
  });

  test('rejects invalid transition: command_sent -> executing', () => {
    tracker.create('cmd-1', 'agent-002');
    expect(() => tracker.executing('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('rejects invalid transition: command_sent -> completed', () => {
    tracker.create('cmd-1', 'agent-002');
    const result: CommandResult = {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    };
    expect(() => tracker.complete('cmd-1', result)).toThrow('Invalid receipt transition');
  });

  test('rejects transition from completed', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });
    expect(() => tracker.fail('cmd-1', 'too late')).toThrow('Invalid receipt transition');
  });

  test('rejects transition from failed', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.fail('cmd-1', 'error');
    expect(() => tracker.acknowledge('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('throws for unknown command id', () => {
    expect(() => tracker.get('nonexistent')).toThrow('Receipt not found');
  });

  test('gets receipt by command id', () => {
    tracker.create('cmd-1', 'agent-002', 'deploy');
    const receipt = tracker.get('cmd-1');
    expect(receipt.commandId).toBe('cmd-1');
  });

  test('lists all receipts without filter', () => {
    tracker.create('cmd-1', 'agent-001');
    tracker.create('cmd-2', 'agent-002');
    tracker.create('cmd-3', 'agent-001');

    const all = tracker.list();
    expect(all.length).toBe(3);
  });

  test('filters by status', () => {
    tracker.create('cmd-1', 'agent-001');
    tracker.create('cmd-2', 'agent-002');
    tracker.acknowledge('cmd-2');

    const sent = tracker.list({ status: 'command_sent' });
    expect(sent.length).toBe(1);
    expect(sent[0]!.commandId).toBe('cmd-1');
  });

  test('filters by targetAgent', () => {
    tracker.create('cmd-1', 'agent-001');
    tracker.create('cmd-2', 'agent-002');
    tracker.create('cmd-3', 'agent-001');

    const filtered = tracker.list({ targetAgent: 'agent-001' });
    expect(filtered.length).toBe(2);
  });

  test('filters by templateName', () => {
    tracker.create('cmd-1', 'agent-001', 'deploy');
    tracker.create('cmd-2', 'agent-001', 'status');
    tracker.create('cmd-3', 'agent-001', 'deploy');

    const filtered = tracker.list({ templateName: 'deploy' });
    expect(filtered.length).toBe(2);
  });

  test('fires onTransition callback', () => {
    const transitions: string[] = [];
    tracker.onTransition = (receipt) => {
      transitions.push(receipt.status);
    };

    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });

    expect(transitions).toEqual(['command_sent', 'acknowledged', 'executing', 'completed']);
  });
});

// ============================================================================
// Response Formatter
// ============================================================================

describe('ResponseFormatter', () => {
  const makeCompletedReceipt = (): ExecutionReceipt => ({
    commandId: 'cmd-1',
    targetAgent: 'agent-002',
    status: 'completed',
    sentAt: '2026-01-27T10:00:00.000Z',
    acknowledgedAt: '2026-01-27T10:00:00.100Z',
    executingAt: '2026-01-27T10:00:00.200Z',
    completedAt: '2026-01-27T10:00:01.200Z',
    failedAt: null,
    output: 'Deployment successful',
    stderr: '',
    exitCode: 0,
    error: null,
    templateName: 'deploy',
    metadata: {},
  });

  const makeFailedReceipt = (): ExecutionReceipt => ({
    commandId: 'cmd-2',
    targetAgent: 'agent-002',
    status: 'failed',
    sentAt: '2026-01-27T10:00:00.000Z',
    acknowledgedAt: '2026-01-27T10:00:00.100Z',
    executingAt: '2026-01-27T10:00:00.200Z',
    completedAt: null,
    failedAt: '2026-01-27T10:00:00.500Z',
    output: null,
    stderr: 'Permission denied',
    exitCode: 1,
    error: 'Process exited with code 1',
    templateName: 'deploy',
    metadata: {},
  });

  test('formats completed receipt', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    expect(response.success).toBe(true);
    expect(response.status).toBe('completed');
    expect(response.commandId).toBe('cmd-1');
    expect(response.templateName).toBe('deploy');
    expect(response.timing.totalDurationMs).toBe(1200);
    expect(response.timing.executionDurationMs).toBe(1000);
    expect(response.output).toBe('Deployment successful');
    expect(response.exitCode).toBe(0);
  });

  test('formats failed receipt', () => {
    const response = ResponseFormatter.format(makeFailedReceipt());
    expect(response.success).toBe(false);
    expect(response.status).toBe('failed');
    expect(response.error).toBe('Process exited with code 1');
    expect(response.timing.totalDurationMs).toBe(500);
    expect(response.timing.executionDurationMs).toBe(300);
  });

  test('formats batch of receipts', () => {
    const responses = ResponseFormatter.formatBatch([
      makeCompletedReceipt(),
      makeFailedReceipt(),
    ]);
    expect(responses.length).toBe(2);
    expect(responses[0]!.success).toBe(true);
    expect(responses[1]!.success).toBe(false);
  });

  test('truncates long text', () => {
    const longText = 'a'.repeat(600);
    const truncated = ResponseFormatter.truncate(longText);
    expect(truncated).not.toBeNull();
    expect(truncated!.length).toBeLessThan(600);
    expect(truncated).toContain('...[truncated]');
  });

  test('does not truncate short text', () => {
    const result = ResponseFormatter.truncate('short text');
    expect(result).toBe('short text');
  });

  test('handles null text', () => {
    expect(ResponseFormatter.truncate(null)).toBeNull();
  });

  test('truncates at custom length', () => {
    const result = ResponseFormatter.truncate('hello world', 5);
    expect(result).toBe('hello...[truncated]');
  });

  test('toJSON produces valid JSON', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    const json = ResponseFormatter.toJSON(response);
    const parsed = JSON.parse(json);
    expect(parsed.commandId).toBe('cmd-1');
    expect(parsed.success).toBe(true);
  });

  test('toTable produces readable output', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    const table = ResponseFormatter.toTable(response);
    expect(table).toContain('Command:    cmd-1');
    expect(table).toContain('Template:   deploy');
    expect(table).toContain('completed (success)');
    expect(table).toContain('1200ms');
    expect(table).toContain('exec: 1000ms');
    expect(table).toContain('Exit Code:  0');
    expect(table).toContain('Output:     Deployment successful');
  });

  test('toTable shows error for failed receipt', () => {
    const response = ResponseFormatter.format(makeFailedReceipt());
    const table = ResponseFormatter.toTable(response);
    expect(table).toContain('failed (failure)');
    expect(table).toContain('Error:');
  });

  test('toTable handles null duration', () => {
    const receipt: ExecutionReceipt = {
      commandId: 'cmd-3',
      targetAgent: 'agent-002',
      status: 'command_sent' as const,
      sentAt: '2026-01-27T10:00:00.000Z',
      acknowledgedAt: null,
      executingAt: null,
      completedAt: null,
      failedAt: null,
      output: null,
      stderr: null,
      exitCode: null,
      error: null,
      templateName: null,
      metadata: {},
    };
    const response = ResponseFormatter.format(receipt);
    const table = ResponseFormatter.toTable(response);
    expect(table).toContain('Duration:   N/A');
    expect(table).toContain('Template:   raw');
  });
});

// ============================================================================
// EXTENDED TESTS: DeployTemplate (additional coverage)
// ============================================================================

describe('DeployTemplate (extended)', () => {
  let template: DeployTemplate;

  beforeEach(() => {
    template = new DeployTemplate();
  });

  test('uses default branch main when not specified', () => {
    const cmd = template.buildCommand({ app: 'svc' });
    expect(cmd).toContain('git pull origin main');
  });

  test('uses default deployDir "." when not specified', () => {
    const cmd = template.buildCommand({ app: 'svc' });
    expect(cmd).toContain('cd .');
  });

  test('uses default buildCmd bun install && bun run build', () => {
    const cmd = template.buildCommand({ app: 'svc' });
    expect(cmd).toContain('bun install && bun run build');
  });

  test('overrides only branch, keeps other defaults', () => {
    const cmd = template.buildCommand({ app: 'svc', branch: 'develop' });
    expect(cmd).toContain('cd .');
    expect(cmd).toContain('git pull origin develop');
    expect(cmd).toContain('bun install && bun run build');
    expect(cmd).toContain('pm2 restart svc');
  });

  test('overrides only deployDir, keeps other defaults', () => {
    const cmd = template.buildCommand({ app: 'svc', deployDir: '/srv/app' });
    expect(cmd).toContain('cd /srv/app');
    expect(cmd).toContain('git pull origin main');
  });

  test('overrides only buildCmd, keeps other defaults', () => {
    const cmd = template.buildCommand({ app: 'svc', buildCmd: 'make all' });
    expect(cmd).toContain('cd .');
    expect(cmd).toContain('make all');
    expect(cmd).not.toContain('bun install');
  });

  test('validates empty string app fails', () => {
    expect(() => template.validateParams({ app: '' })).toThrow('"app" parameter is required');
  });

  test('validates null app fails', () => {
    expect(() => template.validateParams({ app: null })).toThrow('"app" parameter is required');
  });

  test('validates undefined app fails', () => {
    expect(() => template.validateParams({ app: undefined })).toThrow('"app" parameter is required');
  });

  test('description is non-empty string', () => {
    expect(typeof template.description).toBe('string');
    expect(template.description.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// EXTENDED TESTS: StatusTemplate (additional coverage)
// ============================================================================

describe('StatusTemplate (extended)', () => {
  let template: StatusTemplate;

  beforeEach(() => {
    template = new StatusTemplate();
  });

  test('has correct name', () => {
    expect(template.name).toBe('status');
  });

  test('has non-empty description', () => {
    expect(template.description).toBeTruthy();
    expect(typeof template.description).toBe('string');
  });

  test('uses default port 3000', () => {
    const cmd = template.buildCommand({ app: 'api' });
    expect(cmd).toContain('localhost:3000/health');
  });

  test('uses default log path /var/log/app.log', () => {
    const cmd = template.buildCommand({ app: 'api' });
    expect(cmd).toContain('/var/log/app.log');
  });

  test('uses default logLines 50', () => {
    const cmd = template.buildCommand({ app: 'api' });
    expect(cmd).toContain('tail -n 50');
  });

  test('overrides port only', () => {
    const cmd = template.buildCommand({ app: 'api', port: 9090 });
    expect(cmd).toContain('localhost:9090/health');
    expect(cmd).toContain('/var/log/app.log');
  });

  test('overrides logPath only', () => {
    const cmd = template.buildCommand({ app: 'api', logPath: '/tmp/test.log' });
    expect(cmd).toContain('/tmp/test.log');
    expect(cmd).toContain('localhost:3000/health');
  });

  test('overrides logLines only', () => {
    const cmd = template.buildCommand({ app: 'api', logLines: 200 });
    expect(cmd).toContain('tail -n 200');
  });

  test('joins commands with && separator', () => {
    const cmd = template.buildCommand({ app: 'api' });
    const parts = cmd.split(' && ');
    expect(parts.length).toBe(4);
  });

  test('validates empty string app', () => {
    expect(() => template.validateParams({ app: '' })).toThrow('"app" parameter is required');
  });

  test('validates numeric app type', () => {
    expect(() => template.validateParams({ app: 42 })).toThrow('"app" parameter is required');
  });
});

// ============================================================================
// EXTENDED TESTS: ConfigTemplate (shell injection)
// ============================================================================

describe('ConfigTemplate (extended shell injection)', () => {
  let template: ConfigTemplate;

  beforeEach(() => {
    template = new ConfigTemplate();
  });

  test('rejects ${ in key', () => {
    expect(() => template.validateParams({
      envVars: { '${PATH}': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('rejects ${ in value', () => {
    expect(() => template.validateParams({
      envVars: { KEY: '${HOME}/evil' },
    })).toThrow('shell injection characters');
  });

  test('rejects $( in key', () => {
    expect(() => template.validateParams({
      envVars: { '$(id)': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('rejects semicolon in value', () => {
    expect(() => template.validateParams({
      envVars: { KEY: 'value;rm -rf /' },
    })).toThrow('shell injection characters');
  });

  test('rejects ampersand in value', () => {
    expect(() => template.validateParams({
      envVars: { KEY: 'value&bg-process' },
    })).toThrow('shell injection characters');
  });

  test('rejects pipe in key', () => {
    expect(() => template.validateParams({
      envVars: { 'KEY|tee': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('rejects backtick in key', () => {
    expect(() => template.validateParams({
      envVars: { '`id`': 'value' },
    })).toThrow('must be alphanumeric with underscores');
  });

  test('accepts safe special characters in values (dash, underscore, dot, slash, colon)', () => {
    expect(() => template.validateParams({
      envVars: {
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
        APP_NAME: 'my-app_v1.2',
      },
    })).not.toThrow();
  });

  test('validates envVars must be object', () => {
    expect(() => template.validateParams({ envVars: 'not-an-object' })).toThrow('"envVars" parameter is required');
  });

  test('validates envVars null fails', () => {
    expect(() => template.validateParams({ envVars: null })).toThrow('"envVars" parameter is required');
  });

  test('builds single env var command', () => {
    const cmd = template.buildCommand({ envVars: { KEY: 'value' } });
    expect(cmd).toBe('export KEY=value');
  });

  test('builds multiple env vars joined with &&', () => {
    const cmd = template.buildCommand({ envVars: { A: '1', B: '2' } });
    expect(cmd).toContain('export A=1');
    expect(cmd).toContain('export B=2');
    expect(cmd).toContain('&&');
  });

  test('does not restart without app even with restart true', () => {
    const cmd = template.buildCommand({
      envVars: { KEY: 'value' },
      restart: true,
    });
    expect(cmd).not.toContain('pm2 restart');
  });

  test('has correct name', () => {
    expect(template.name).toBe('config-update');
  });
});

// ============================================================================
// EXTENDED TESTS: DiagnosticTemplate (additional checks)
// ============================================================================

describe('DiagnosticTemplate (extended)', () => {
  let template: DiagnosticTemplate;

  beforeEach(() => {
    template = new DiagnosticTemplate();
  });

  test('builds all four checks combined', () => {
    const cmd = template.buildCommand({
      checks: ['disk', 'memory', 'processes', 'storage'],
    });
    expect(cmd).toContain('df -h');
    // Platform-specific: macOS uses vm_stat, Linux uses free -m
    const memCmd = process.platform === 'darwin' ? 'vm_stat' : 'free -m';
    expect(cmd).toContain(memCmd);
    expect(cmd).toContain('ps aux');
    expect(cmd).toContain('du -sh');
  });

  test('builds storage with single path', () => {
    const cmd = template.buildCommand({
      checks: ['storage'],
      paths: ['/home'],
    });
    expect(cmd).toBe('du -sh /home');
  });

  test('builds storage with multiple paths concatenated', () => {
    const cmd = template.buildCommand({
      checks: ['storage'],
      paths: ['/var', '/tmp', '/home'],
    });
    expect(cmd).toBe('du -sh /var /tmp /home');
  });

  test('builds storage with empty paths array defaults to root', () => {
    const cmd = template.buildCommand({
      checks: ['storage'],
      paths: [],
    });
    expect(cmd).toBe('du -sh /');
  });

  test('processes check includes head -20', () => {
    const cmd = template.buildCommand({ checks: ['processes'] });
    expect(cmd).toContain('head -20');
  });

  test('processes check sorts by memory', () => {
    const cmd = template.buildCommand({ checks: ['processes'] });
    // Platform-specific: macOS uses -m flag, Linux uses --sort=-%mem
    if (process.platform === 'darwin') {
      expect(cmd).toContain('ps aux -m');
    } else {
      expect(cmd).toContain('--sort=-%mem');
    }
  });

  test('validates multiple invalid checks', () => {
    expect(() => template.validateParams({
      checks: ['disk', 'invalid_check'],
    })).toThrow('invalid check "invalid_check"');
  });

  test('validates checks is not a string', () => {
    expect(() => template.validateParams({
      checks: 'disk',
    })).toThrow('"checks" parameter is required');
  });

  test('has correct name', () => {
    expect(template.name).toBe('diagnostic');
  });

  test('has non-empty description', () => {
    expect(template.description.length).toBeGreaterThan(0);
  });

  test('three checks combined correctly', () => {
    const cmd = template.buildCommand({
      checks: ['disk', 'memory', 'processes'],
    });
    const parts = cmd.split(' && ');
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('df -h');
    const memCmd = process.platform === 'darwin' ? 'vm_stat' : 'free -m';
    expect(parts[1]).toBe(memCmd);
    expect(parts[2]).toContain('ps aux');
  });
});

// ============================================================================
// EXTENDED TESTS: RestartTemplate (additional coverage)
// ============================================================================

describe('RestartTemplate (extended)', () => {
  let template: RestartTemplate;

  beforeEach(() => {
    template = new RestartTemplate();
  });

  test('has correct name', () => {
    expect(template.name).toBe('restart');
  });

  test('has non-empty description', () => {
    expect(template.description.length).toBeGreaterThan(0);
  });

  test('validates empty app string', () => {
    expect(() => template.validateParams({ app: '', manager: 'pm2' })).toThrow('"app" parameter is required');
  });

  test('validates null app', () => {
    expect(() => template.validateParams({ app: null, manager: 'pm2' })).toThrow('"app" parameter is required');
  });

  test('validates numeric app type', () => {
    expect(() => template.validateParams({ app: 123, manager: 'pm2' })).toThrow('"app" parameter is required');
  });

  test('validates empty params', () => {
    expect(() => template.validateParams({})).toThrow();
  });

  test('builds correct pm2 command with different app name', () => {
    const cmd = template.buildCommand({ app: 'worker-process', manager: 'pm2' });
    expect(cmd).toBe('pm2 restart worker-process');
  });

  test('builds correct launchd command with different app name', () => {
    const cmd = template.buildCommand({ app: 'nginx', manager: 'launchd' });
    expect(cmd).toBe('launchctl kickstart -k system/nginx');
  });
});

// ============================================================================
// EXTENDED TESTS: ReceiptTracker (additional state machine tests)
// ============================================================================

describe('ReceiptTracker (extended)', () => {
  let tracker: ReceiptTracker;

  beforeEach(() => {
    tracker = new ReceiptTracker();
  });

  test('full lifecycle: command_sent -> acknowledged -> executing -> completed', () => {
    tracker.create('cmd-full', 'agent-002', 'deploy');
    const r1 = tracker.get('cmd-full');
    expect(r1.status).toBe('command_sent');
    expect(r1.sentAt).toBeTruthy();

    tracker.acknowledge('cmd-full');
    const r2 = tracker.get('cmd-full');
    expect(r2.status).toBe('acknowledged');
    expect(r2.acknowledgedAt).toBeTruthy();

    tracker.executing('cmd-full');
    const r3 = tracker.get('cmd-full');
    expect(r3.status).toBe('executing');
    expect(r3.executingAt).toBeTruthy();

    const result: CommandResult = {
      success: true,
      output: 'all good',
      stderr: '',
      exitCode: 0,
      durationMs: 250,
      error: null,
    };
    tracker.complete('cmd-full', result);
    const r4 = tracker.get('cmd-full');
    expect(r4.status).toBe('completed');
    expect(r4.completedAt).toBeTruthy();
    expect(r4.output).toBe('all good');
    expect(r4.exitCode).toBe(0);
    expect(r4.error).toBeNull();
  });

  test('full lifecycle: command_sent -> acknowledged -> executing -> failed', () => {
    tracker.create('cmd-fail', 'agent-002', 'deploy');
    tracker.acknowledge('cmd-fail');
    tracker.executing('cmd-fail');

    const receipt = tracker.fail('cmd-fail', 'Process crashed');
    expect(receipt.status).toBe('failed');
    expect(receipt.failedAt).toBeTruthy();
    expect(receipt.error).toBe('Process crashed');
    expect(receipt.completedAt).toBeNull();
  });

  test('rejects acknowledged -> completed (skipping executing)', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    const result: CommandResult = {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    };
    expect(() => tracker.complete('cmd-1', result)).toThrow('Invalid receipt transition');
  });

  test('rejects executing -> acknowledged (reverse)', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    expect(() => tracker.acknowledge('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('rejects completed -> acknowledged', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });
    expect(() => tracker.acknowledge('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('rejects completed -> executing', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });
    expect(() => tracker.executing('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('rejects completed -> completed', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });
    expect(() => tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    })).toThrow('Invalid receipt transition');
  });

  test('rejects failed -> executing', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.fail('cmd-1', 'err');
    expect(() => tracker.executing('cmd-1')).toThrow('Invalid receipt transition');
  });

  test('rejects failed -> completed', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.fail('cmd-1', 'err');
    expect(() => tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    })).toThrow('Invalid receipt transition');
  });

  test('rejects failed -> failed (double failure)', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.fail('cmd-1', 'first error');
    expect(() => tracker.fail('cmd-1', 'second error')).toThrow('Invalid receipt transition');
  });

  test('acknowledge throws for unknown command', () => {
    expect(() => tracker.acknowledge('nonexistent')).toThrow('Receipt not found');
  });

  test('executing throws for unknown command', () => {
    expect(() => tracker.executing('nonexistent')).toThrow('Receipt not found');
  });

  test('complete throws for unknown command', () => {
    expect(() => tracker.complete('nonexistent', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    })).toThrow('Receipt not found');
  });

  test('fail throws for unknown command', () => {
    expect(() => tracker.fail('nonexistent', 'err')).toThrow('Receipt not found');
  });

  test('creates receipt with metadata defaults', () => {
    const receipt = tracker.create('cmd-meta', 'agent-002');
    expect(receipt.metadata).toEqual({});
    expect(receipt.stderr).toBeNull();
    expect(receipt.exitCode).toBeNull();
  });

  test('complete populates stderr from result', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    const receipt = tracker.complete('cmd-1', {
      success: true,
      output: 'out',
      stderr: 'some warning',
      exitCode: 0,
      durationMs: 10,
      error: null,
    });
    expect(receipt.stderr).toBe('some warning');
  });

  test('complete populates error from result', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    const receipt = tracker.complete('cmd-1', {
      success: false,
      output: '',
      stderr: 'exit code 1',
      exitCode: 1,
      durationMs: 10,
      error: 'command not found',
    });
    expect(receipt.error).toBe('command not found');
    expect(receipt.exitCode).toBe(1);
  });

  test('list with empty tracker returns empty array', () => {
    const result = tracker.list();
    expect(result).toEqual([]);
  });

  test('list filter with no matches returns empty array', () => {
    tracker.create('cmd-1', 'agent-001');
    const result = tracker.list({ targetAgent: 'agent-999' });
    expect(result).toEqual([]);
  });

  test('list with combined filters: status + targetAgent', () => {
    tracker.create('cmd-1', 'agent-001', 'deploy');
    tracker.create('cmd-2', 'agent-002', 'deploy');
    tracker.create('cmd-3', 'agent-001', 'status');
    tracker.acknowledge('cmd-1');

    const result = tracker.list({ status: 'command_sent', targetAgent: 'agent-001' });
    expect(result.length).toBe(1);
    expect(result[0]!.commandId).toBe('cmd-3');
  });

  test('list with combined filters: status + templateName', () => {
    tracker.create('cmd-1', 'agent-001', 'deploy');
    tracker.create('cmd-2', 'agent-001', 'status');
    tracker.create('cmd-3', 'agent-001', 'deploy');
    tracker.acknowledge('cmd-3');

    const result = tracker.list({ status: 'command_sent', templateName: 'deploy' });
    expect(result.length).toBe(1);
    expect(result[0]!.commandId).toBe('cmd-1');
  });

  test('onTransition fires on failure lifecycle', () => {
    const transitions: string[] = [];
    tracker.onTransition = (receipt) => {
      transitions.push(receipt.status);
    };

    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.fail('cmd-1', 'error');

    expect(transitions).toEqual(['command_sent', 'acknowledged', 'failed']);
  });

  test('onTransition receives correct commandId each time', () => {
    const ids: string[] = [];
    tracker.onTransition = (receipt) => {
      ids.push(receipt.commandId);
    };

    tracker.create('cmd-X', 'agent-002');
    tracker.acknowledge('cmd-X');

    expect(ids).toEqual(['cmd-X', 'cmd-X']);
  });

  test('sentAt is a valid ISO string', () => {
    const receipt = tracker.create('cmd-1', 'agent-002');
    const parsed = new Date(receipt.sentAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test('acknowledgedAt is a valid ISO string', () => {
    tracker.create('cmd-1', 'agent-002');
    const receipt = tracker.acknowledge('cmd-1');
    const parsed = new Date(receipt.acknowledgedAt!);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test('executingAt is a valid ISO string', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    const receipt = tracker.executing('cmd-1');
    const parsed = new Date(receipt.executingAt!);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test('completedAt is a valid ISO string', () => {
    tracker.create('cmd-1', 'agent-002');
    tracker.acknowledge('cmd-1');
    tracker.executing('cmd-1');
    const receipt = tracker.complete('cmd-1', {
      success: true, output: '', stderr: '', exitCode: 0, durationMs: 0, error: null,
    });
    const parsed = new Date(receipt.completedAt!);
    expect(parsed.getTime()).not.toBeNaN();
  });

  test('failedAt is a valid ISO string', () => {
    tracker.create('cmd-1', 'agent-002');
    const receipt = tracker.fail('cmd-1', 'err');
    const parsed = new Date(receipt.failedAt!);
    expect(parsed.getTime()).not.toBeNaN();
  });
});

// ============================================================================
// EXTENDED TESTS: ResponseFormatter (additional coverage)
// ============================================================================

describe('ResponseFormatter (extended)', () => {
  const makeCompletedReceipt = (): ExecutionReceipt => ({
    commandId: 'cmd-1',
    targetAgent: 'agent-002',
    status: 'completed',
    sentAt: '2026-01-27T10:00:00.000Z',
    acknowledgedAt: '2026-01-27T10:00:00.100Z',
    executingAt: '2026-01-27T10:00:00.200Z',
    completedAt: '2026-01-27T10:00:01.200Z',
    failedAt: null,
    output: 'Deployment successful',
    stderr: '',
    exitCode: 0,
    error: null,
    templateName: 'deploy',
    metadata: {},
  });

  const makeFailedReceipt = (): ExecutionReceipt => ({
    commandId: 'cmd-2',
    targetAgent: 'agent-002',
    status: 'failed',
    sentAt: '2026-01-27T10:00:00.000Z',
    acknowledgedAt: '2026-01-27T10:00:00.100Z',
    executingAt: '2026-01-27T10:00:00.200Z',
    completedAt: null,
    failedAt: '2026-01-27T10:00:00.500Z',
    output: null,
    stderr: 'Permission denied',
    exitCode: 1,
    error: 'Process exited with code 1',
    templateName: 'deploy',
    metadata: {},
  });

  test('truncate at exact boundary (499 chars - no truncation)', () => {
    const text = 'x'.repeat(499);
    const result = ResponseFormatter.truncate(text);
    expect(result).toBe(text);
    expect(result!.length).toBe(499);
  });

  test('truncate at exact boundary (500 chars - no truncation)', () => {
    const text = 'x'.repeat(500);
    const result = ResponseFormatter.truncate(text);
    expect(result).toBe(text);
    expect(result!.length).toBe(500);
  });

  test('truncate at exact boundary (501 chars - truncated)', () => {
    const text = 'x'.repeat(501);
    const result = ResponseFormatter.truncate(text);
    expect(result).not.toBe(text);
    expect(result!.length).toBe(500 + '...[truncated]'.length);
    expect(result).toContain('...[truncated]');
  });

  test('truncate with empty string returns empty string', () => {
    const result = ResponseFormatter.truncate('');
    expect(result).toBe('');
  });

  test('formatBatch with empty array', () => {
    const result = ResponseFormatter.formatBatch([]);
    expect(result).toEqual([]);
    expect(result.length).toBe(0);
  });

  test('formatBatch preserves order', () => {
    const batch = ResponseFormatter.formatBatch([
      makeCompletedReceipt(),
      makeFailedReceipt(),
    ]);
    expect(batch[0]!.commandId).toBe('cmd-1');
    expect(batch[1]!.commandId).toBe('cmd-2');
  });

  test('format populates timing.sentAt', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    expect(response.timing.sentAt).toBe('2026-01-27T10:00:00.000Z');
  });

  test('format populates timing.acknowledgedAt', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    expect(response.timing.acknowledgedAt).toBe('2026-01-27T10:00:00.100Z');
  });

  test('format populates timing.executingAt', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    expect(response.timing.executingAt).toBe('2026-01-27T10:00:00.200Z');
  });

  test('format populates timing.completedAt for completed receipt', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    expect(response.timing.completedAt).toBe('2026-01-27T10:00:01.200Z');
  });

  test('format sets timing.completedAt null for failed receipt', () => {
    const response = ResponseFormatter.format(makeFailedReceipt());
    expect(response.timing.completedAt).toBeNull();
  });

  test('format truncates long output', () => {
    const receipt = makeCompletedReceipt();
    receipt.output = 'z'.repeat(600);
    const response = ResponseFormatter.format(receipt);
    expect(response.output!.length).toBeLessThan(600);
    expect(response.output).toContain('...[truncated]');
  });

  test('format truncates long stderr', () => {
    const receipt = makeFailedReceipt();
    receipt.stderr = 'e'.repeat(600);
    const response = ResponseFormatter.format(receipt);
    expect(response.stderr!.length).toBeLessThan(600);
    expect(response.stderr).toContain('...[truncated]');
  });

  test('format with null output passes null through', () => {
    const receipt = makeFailedReceipt();
    receipt.output = null;
    const response = ResponseFormatter.format(receipt);
    expect(response.output).toBeNull();
  });

  test('format with null stderr passes null through', () => {
    const receipt = makeCompletedReceipt();
    receipt.stderr = null;
    const response = ResponseFormatter.format(receipt);
    expect(response.stderr).toBeNull();
  });

  test('format preserves exitCode', () => {
    const receipt = makeFailedReceipt();
    receipt.exitCode = 127;
    const response = ResponseFormatter.format(receipt);
    expect(response.exitCode).toBe(127);
  });

  test('toJSON includes all top-level fields', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    const json = ResponseFormatter.toJSON(response);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty('success');
    expect(parsed).toHaveProperty('status');
    expect(parsed).toHaveProperty('commandId');
    expect(parsed).toHaveProperty('templateName');
    expect(parsed).toHaveProperty('timing');
    expect(parsed).toHaveProperty('output');
    expect(parsed).toHaveProperty('stderr');
    expect(parsed).toHaveProperty('exitCode');
    expect(parsed).toHaveProperty('error');
  });

  test('toJSON timing sub-object includes all fields', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    const json = ResponseFormatter.toJSON(response);
    const parsed = JSON.parse(json);
    expect(parsed.timing).toHaveProperty('sentAt');
    expect(parsed.timing).toHaveProperty('acknowledgedAt');
    expect(parsed.timing).toHaveProperty('executingAt');
    expect(parsed.timing).toHaveProperty('completedAt');
    expect(parsed.timing).toHaveProperty('totalDurationMs');
    expect(parsed.timing).toHaveProperty('executionDurationMs');
  });

  test('toTable contains newline-separated lines', () => {
    const response = ResponseFormatter.format(makeCompletedReceipt());
    const table = ResponseFormatter.toTable(response);
    const lines = table.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  test('toTable includes stderr when present', () => {
    const receipt = makeFailedReceipt();
    const response = ResponseFormatter.format(receipt);
    const table = ResponseFormatter.toTable(response);
    expect(table).toContain('Stderr:');
  });

  test('toTable does not include output line when output is null', () => {
    const receipt: ExecutionReceipt = {
      commandId: 'cmd-null',
      targetAgent: 'agent-002',
      status: 'completed',
      sentAt: '2026-01-27T10:00:00.000Z',
      acknowledgedAt: '2026-01-27T10:00:00.100Z',
      executingAt: '2026-01-27T10:00:00.200Z',
      completedAt: '2026-01-27T10:00:01.000Z',
      failedAt: null,
      output: null,
      stderr: null,
      exitCode: 0,
      error: null,
      templateName: 'status',
      metadata: {},
    };
    const response = ResponseFormatter.format(receipt);
    const table = ResponseFormatter.toTable(response);
    expect(table).not.toContain('Output:');
  });

  test('format with no executingAt produces null executionDurationMs', () => {
    const receipt: ExecutionReceipt = {
      commandId: 'cmd-x',
      targetAgent: 'agent-002',
      status: 'failed',
      sentAt: '2026-01-27T10:00:00.000Z',
      acknowledgedAt: '2026-01-27T10:00:00.100Z',
      executingAt: null,
      completedAt: null,
      failedAt: '2026-01-27T10:00:00.500Z',
      output: null,
      stderr: null,
      exitCode: null,
      error: 'Timeout',
      templateName: null,
      metadata: {},
    };
    const response = ResponseFormatter.format(receipt);
    expect(response.timing.executionDurationMs).toBeNull();
    expect(response.timing.totalDurationMs).toBe(500);
  });
});

// ============================================================================
// CommandExecutor Tests
// ============================================================================

describe('CommandExecutor', () => {
  let executor: CommandExecutor;
  let tracker: ReceiptTracker;
  let mockPublish: ReturnType<typeof mock>;
  let mockChannelClient: any;
  let config: RemoteConfig;

  beforeEach(() => {
    tracker = new ReceiptTracker();
    mockPublish = mock(() => Promise.resolve({
      id: 'msg-1',
      channelId: 'ch-1',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command' as const,
      content: '',
      metadata: {},
      status: 'pending' as const,
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    }));

    mockChannelClient = {
      publish: mockPublish,
      subscribe: mock(() => ({ channelId: 'ch-1', callback: () => {}, unsubscribe: () => {} })),
      disconnect: mock(() => {}),
    };

    config = {
      apiUrl: 'https://test.signaldb.live',
      projectKey: 'sk_test_123',
      agentId: 'agent-001',
      channelId: 'ch-commands',
      defaultTimeout: 30000,
    };

    executor = new CommandExecutor(
      config,
      mockChannelClient as unknown as ChannelClient,
      tracker,
    );
  });

  test('execute() validates params before building command', async () => {
    const template = new DeployTemplate();
    await expect(
      executor.execute(template, {}, 'agent-002'),
    ).rejects.toThrow('"app" parameter is required');
  });

  test('execute() creates receipt in tracker', async () => {
    const template = new DeployTemplate();
    const receipt = await executor.execute(template, { app: 'my-api' }, 'agent-002');
    expect(receipt.commandId).toBeTruthy();
    expect(receipt.targetAgent).toBe('agent-002');
    expect(receipt.templateName).toBe('deploy');
    expect(receipt.status).toBe('command_sent');
  });

  test('execute() publishes command to channel', async () => {
    const template = new DeployTemplate();
    await executor.execute(template, { app: 'my-api' }, 'agent-002');
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const callArgs = mockPublish.mock.calls[0];
    expect(callArgs[0]).toBe('ch-commands');
    expect(callArgs[1]).toContain('pm2 restart my-api');
  });

  test('execute() metadata contains commandId and templateName', async () => {
    const template = new DeployTemplate();
    const receipt = await executor.execute(template, { app: 'my-api' }, 'agent-002');
    const callArgs = mockPublish.mock.calls[0];
    const options = callArgs[2];
    expect(options.metadata.commandId).toBe(receipt.commandId);
    expect(options.metadata.templateName).toBe('deploy');
    expect(options.metadata.timeout).toBe(30000);
  });

  test('execute() metadata uses default timeout when not configured', async () => {
    const noTimeoutConfig = { ...config, defaultTimeout: undefined };
    const exec2 = new CommandExecutor(noTimeoutConfig, mockChannelClient as unknown as ChannelClient, tracker);
    const template = new DeployTemplate();
    await exec2.execute(template, { app: 'x' }, 'agent-002');
    const callArgs = mockPublish.mock.calls[0];
    expect(callArgs[2].metadata.timeout).toBe(300000);
  });

  test('executeRaw() publishes raw command', async () => {
    const receipt = await executor.executeRaw('ls -la /app', 'agent-002');
    expect(receipt.templateName).toBe('raw');
    expect(receipt.status).toBe('command_sent');
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const callArgs = mockPublish.mock.calls[0];
    expect(callArgs[1]).toBe('ls -la /app');
    expect(callArgs[2].metadata.templateName).toBe('raw');
  });

  test('executeRaw() creates receipt with unique id', async () => {
    const r1 = await executor.executeRaw('echo 1', 'agent-002');
    const r2 = await executor.executeRaw('echo 2', 'agent-002');
    expect(r1.commandId).not.toBe(r2.commandId);
  });

  test('waitForReceipt() resolves on completed', async () => {
    const receipt = await executor.executeRaw('echo ok', 'agent-002');
    // Simulate receipt progressing to completed
    tracker.acknowledge(receipt.commandId);
    tracker.executing(receipt.commandId);
    tracker.complete(receipt.commandId, {
      success: true, output: 'ok', stderr: '', exitCode: 0, durationMs: 10, error: null,
    });

    const result = await executor.waitForReceipt(receipt.commandId, 5000);
    expect(result.status).toBe('completed');
    expect(result.output).toBe('ok');
  });

  test('waitForReceipt() resolves on failed', async () => {
    const receipt = await executor.executeRaw('bad-cmd', 'agent-002');
    tracker.fail(receipt.commandId, 'command not found');

    const result = await executor.waitForReceipt(receipt.commandId, 5000);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('command not found');
  });

  test('waitForReceipt() rejects on timeout', async () => {
    const receipt = await executor.executeRaw('slow-cmd', 'agent-002');
    // Receipt stays in command_sent, never transitions
    await expect(
      executor.waitForReceipt(receipt.commandId, 100),
    ).rejects.toThrow('Timeout');
  });

  test('execute() publishes with messageType command', async () => {
    const template = new StatusTemplate();
    await executor.execute(template, { app: 'api' }, 'agent-002');
    const callArgs = mockPublish.mock.calls[0];
    expect(callArgs[2].messageType).toBe('command');
  });
});

// ============================================================================
// CommandHandler Tests
// ============================================================================

describe('CommandHandler', () => {
  let handler: CommandHandler;
  let tracker: ReceiptTracker;
  let mockPublish: ReturnType<typeof mock>;
  let mockSubscribe: ReturnType<typeof mock>;
  let subscribeCallback: ((msg: Message) => void) | null;
  let mockChannelClient: any;
  let mockSecurity: any;
  let config: RemoteConfig;

  beforeEach(() => {
    tracker = new ReceiptTracker();
    subscribeCallback = null;

    mockPublish = mock(() => Promise.resolve({
      id: 'msg-resp',
      channelId: 'ch-1',
      senderId: 'agent-002',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'response' as const,
      content: '',
      metadata: {},
      status: 'pending' as const,
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    }));

    mockSubscribe = mock((channelId: string, callback: (msg: Message) => void) => {
      subscribeCallback = callback;
      return {
        channelId,
        callback,
        unsubscribe: mock(() => { subscribeCallback = null; }),
      };
    });

    mockChannelClient = {
      publish: mockPublish,
      subscribe: mockSubscribe,
      disconnect: mock(() => {}),
    };

    mockSecurity = {
      enforceDirectory: mock(() => {}),
      validateAndSanitize: mock((content: string) => content),
      audit: mock(() => Promise.resolve()),
      checkAndRecord: mock(() => {}),
    };

    config = {
      apiUrl: 'https://test.signaldb.live',
      projectKey: 'sk_test_123',
      agentId: 'agent-002',
      channelId: 'ch-commands',
    };

    handler = new CommandHandler(
      config,
      mockChannelClient as unknown as ChannelClient,
      tracker,
      mockSecurity as unknown as SecurityMiddleware,
    );
  });

  test('start() subscribes to channel', () => {
    handler.start();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSubscribe.mock.calls[0][0]).toBe('ch-commands');
  });

  test('start() is idempotent (calling twice does not create second subscription)', () => {
    handler.start();
    handler.start();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  test('stop() unsubscribes', () => {
    handler.start();
    handler.stop();
    // After stop, subscription is null, calling stop again is safe
    handler.stop();
    expect(subscribeCallback).toBeNull();
  });

  test('stop() is safe when not started', () => {
    expect(() => handler.stop()).not.toThrow();
  });

  test('registerHandler() stores custom handler', async () => {
    const customResult: CommandResult = {
      success: true,
      output: 'custom deploy done',
      stderr: '',
      exitCode: 0,
      durationMs: 50,
      error: null,
    };
    const customHandler = mock(() => Promise.resolve(customResult));
    handler.registerHandler('deploy', customHandler);

    handler.start();

    const msg: Message = {
      id: 'msg-1',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command',
      content: 'cd /app && git pull',
      metadata: { commandId: 'cmd-custom', templateName: 'deploy' },
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);

    // Allow async processing
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(customHandler).toHaveBeenCalledTimes(1);
    const receipt = tracker.get('cmd-custom');
    expect(receipt.status).toBe('completed');
    expect(receipt.output).toBe('custom deploy done');
  });

  test('handleCommand skips non-command messages', async () => {
    handler.start();

    const msg: Message = {
      id: 'msg-1',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'chat',
      content: 'hello',
      metadata: {},
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);
    await new Promise(resolve => setTimeout(resolve, 50));

    // No receipt should be created since it was not a command message
    expect(tracker.list().length).toBe(0);
  });

  test('handleCommand with security violation fails receipt', async () => {
    mockSecurity.enforceDirectory = mock(() => {
      throw new Error('Directory guard blocked access');
    });

    handler.start();

    const msg: Message = {
      id: 'msg-sec',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command',
      content: 'cat /etc/shadow',
      metadata: { commandId: 'cmd-sec', templateName: 'raw' },
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);
    await new Promise(resolve => setTimeout(resolve, 50));

    const receipt = tracker.get('cmd-sec');
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toContain('Directory guard blocked access');
  });

  test('handleCommand publishes error response on failure', async () => {
    mockSecurity.enforceDirectory = mock(() => {
      throw new Error('Blocked');
    });

    handler.start();

    const msg: Message = {
      id: 'msg-err',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command',
      content: 'rm -rf /',
      metadata: { commandId: 'cmd-err', templateName: 'raw' },
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);
    await new Promise(resolve => setTimeout(resolve, 50));

    // Verify error response was published
    const publishCalls = mockPublish.mock.calls;
    const lastCall = publishCalls[publishCalls.length - 1];
    expect(lastCall[2].messageType).toBe('response');
    const body = JSON.parse(lastCall[1]);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Blocked');
  });

  test('handleCommand ignores messages without commandId in metadata', async () => {
    handler.start();

    const msg: Message = {
      id: 'msg-no-id',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command',
      content: 'echo hello',
      metadata: {},  // no commandId
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);
    await new Promise(resolve => setTimeout(resolve, 50));

    // No receipt should be created
    expect(tracker.list().length).toBe(0);
    // No publish should be called
    expect(mockPublish).not.toHaveBeenCalled();
  });

  test('handleCommand calls audit on security failure', async () => {
    mockSecurity.enforceDirectory = mock(() => {
      throw new Error('Blocked path');
    });

    handler.start();

    const msg: Message = {
      id: 'msg-audit',
      channelId: 'ch-commands',
      senderId: 'agent-001',
      targetType: 'broadcast',
      targetAddress: 'broadcast://commands',
      messageType: 'command',
      content: 'cat /etc/passwd',
      metadata: { commandId: 'cmd-audit', templateName: 'raw' },
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    subscribeCallback!(msg);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(mockSecurity.audit).toHaveBeenCalled();
    const auditCall = mockSecurity.audit.mock.calls[0][0];
    expect(auditCall.result).toBe('failure');
    expect(auditCall.command).toContain('remote:execute:raw');
  });
});
