#!/usr/bin/env bun
/**
 * COMMS Doctor - Health Check
 *
 * Validates all 4 COMMS subsystems:
 * 1. Remote Templates - instantiation, param validation, buildCommand
 * 2. Security - SecurityManager, JWT, RateLimiter, RLSFilter
 * 3. Discord Bridge - Gateway, SlashCommandManager, MessageBridge
 * 4. E2E Connectivity - SignalDB API, agent list, config loading
 *
 * Usage:
 *   bun bin/comms-doctor.ts
 *   bun bin/comms-doctor.ts --json
 *   bun bin/comms-doctor.ts --verbose
 *   bun bin/comms-doctor.ts --help
 */

// ============================================================================
// Imports
// ============================================================================

// Remote templates
import {
  DeployTemplate,
  StatusTemplate,
  ConfigTemplate,
  DiagnosticTemplate,
  RestartTemplate,
} from '../src/comms/remote/templates/index';

// Security
import {
  SecurityManager,
  JWTManager,
  RateLimiter,
  RLSFilter,
  createDefaultSecurityConfig,
} from '../src/comms/security/index';
import { SignalDBClient } from '../src/comms/client/signaldb';

// Discord bridge
import { DiscordGateway } from '../src/comms/bridges/discord/gateway';
import { SlashCommandManager } from '../src/comms/bridges/discord/commands';
import { MessageBridge } from '../src/comms/bridges/discord/message-bridge';

// Config
import { loadTapestryConfig, listConfiguredEnvironments } from '../src/comms/config/environments';

// Protocol types
import type { Message } from '../src/comms/protocol/types';

// ============================================================================
// Types
// ============================================================================

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  detail?: string;
  durationMs: number;
}

interface SubsystemResult {
  name: string;
  checks: CheckResult[];
  passed: number;
  failed: number;
}

interface DoctorReport {
  subsystems: SubsystemResult[];
  totalChecks: number;
  totalPassed: number;
  totalFailed: number;
  durationMs: number;
  timestamp: string;
}

// ============================================================================
// CLI Parsing
// ============================================================================

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const verboseMode = args.includes('--verbose');
const helpMode = args.includes('--help') || args.includes('-h');

if (helpMode) {
  console.log(`
COMMS Doctor - Health Check

Validates all 4 COMMS subsystems: Remote Templates, Security,
Discord Bridge, and E2E Connectivity.

Usage:
  bun bin/comms-doctor.ts [options]

Options:
  --json      Output structured JSON report
  --verbose   Show detailed diagnostic information
  --help, -h  Show this help message

Examples:
  bun bin/comms-doctor.ts
  bun bin/comms-doctor.ts --json
  bun bin/comms-doctor.ts --verbose
`);
  process.exit(0);
}

// ============================================================================
// Colors (for terminal output)
// ============================================================================

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ============================================================================
// Check Runner
// ============================================================================

async function runCheck(
  name: string,
  fn: () => void | Promise<void>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await fn();
    return {
      name,
      passed: true,
      message: name,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      name,
      passed: false,
      message: name,
      detail: errorMsg,
      durationMs: Date.now() - start,
    };
  }
}

function collectSubsystem(name: string, checks: CheckResult[]): SubsystemResult {
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < checks.length; i++) {
    if (checks[i]!.passed) {
      passed++;
    } else {
      failed++;
    }
  }
  return { name, checks, passed, failed };
}

// ============================================================================
// 1. Remote Template Health Checks
// ============================================================================

async function checkRemoteTemplates(): Promise<SubsystemResult> {
  const checks: CheckResult[] = [];

  // Check 1-5: Template instantiation
  const templateClasses = [
    { name: 'DeployTemplate', Ctor: DeployTemplate },
    { name: 'StatusTemplate', Ctor: StatusTemplate },
    { name: 'DiagnosticTemplate', Ctor: DiagnosticTemplate },
    { name: 'ConfigTemplate', Ctor: ConfigTemplate },
    { name: 'RestartTemplate', Ctor: RestartTemplate },
  ];

  for (let i = 0; i < templateClasses.length; i++) {
    const { name, Ctor } = templateClasses[i]!;
    checks.push(await runCheck(`${name} instantiation`, () => {
      const template = new Ctor();
      if (!template.name || typeof template.name !== 'string') {
        throw new Error(`${name} has no name property`);
      }
      if (!template.description || typeof template.description !== 'string') {
        throw new Error(`${name} has no description property`);
      }
    }));
  }

  // Check 6: All templates validate params
  checks.push(await runCheck('All templates validate params', () => {
    const deploy = new DeployTemplate();
    deploy.validateParams({ app: 'test-app' });

    const status = new StatusTemplate();
    status.validateParams({ app: 'test-app' });

    const diag = new DiagnosticTemplate();
    diag.validateParams({ checks: ['disk'] });

    const config = new ConfigTemplate();
    config.validateParams({ envVars: { FOO: 'bar' } });

    const restart = new RestartTemplate();
    restart.validateParams({ app: 'test-app', manager: 'pm2' });
  }));

  // Check 7: buildCommand returns non-empty
  checks.push(await runCheck('All templates build commands', () => {
    const deploy = new DeployTemplate();
    const cmd1 = deploy.buildCommand({ app: 'test-app' });
    if (!cmd1 || cmd1.length === 0) {
      throw new Error('DeployTemplate.buildCommand returned empty');
    }

    const status = new StatusTemplate();
    const cmd2 = status.buildCommand({ app: 'test-app' });
    if (!cmd2 || cmd2.length === 0) {
      throw new Error('StatusTemplate.buildCommand returned empty');
    }

    const diag = new DiagnosticTemplate();
    const cmd3 = diag.buildCommand({ checks: ['disk', 'memory'] });
    if (!cmd3 || cmd3.length === 0) {
      throw new Error('DiagnosticTemplate.buildCommand returned empty');
    }

    const configTpl = new ConfigTemplate();
    const cmd4 = configTpl.buildCommand({ envVars: { KEY: 'value' } });
    if (!cmd4 || cmd4.length === 0) {
      throw new Error('ConfigTemplate.buildCommand returned empty');
    }

    const restart = new RestartTemplate();
    const cmd5 = restart.buildCommand({ app: 'test-app', manager: 'pm2' });
    if (!cmd5 || cmd5.length === 0) {
      throw new Error('RestartTemplate.buildCommand returned empty');
    }
  }));

  return collectSubsystem('Remote Templates', checks);
}

// ============================================================================
// 2. Security Health Checks
// ============================================================================

async function checkSecurity(): Promise<SubsystemResult> {
  const checks: CheckResult[] = [];

  // Check 1: SecurityManager creation
  checks.push(await runCheck('SecurityManager creation', () => {
    const dummyClient = new SignalDBClient({
      apiUrl: 'http://localhost:9999',
      projectKey: 'sk_test_dummy',
    });
    const config = createDefaultSecurityConfig('test-secret-key-for-doctor', ['/tmp']);
    const manager = new SecurityManager(config, dummyClient);
    if (!manager.directory) throw new Error('SecurityManager missing directory guard');
    if (!manager.jwt) throw new Error('SecurityManager missing JWT manager');
    if (!manager.rateLimiter) throw new Error('SecurityManager missing rate limiter');
    if (!manager.validator) throw new Error('SecurityManager missing validator');
  }));

  // Check 2: JWT token creation
  checks.push(await runCheck('JWT token creation', () => {
    const jwt = new JWTManager({
      secret: 'test-jwt-secret-for-doctor-check',
      expiryMs: 86_400_000,
      rotationIntervalMs: 43_200_000,
      revocationListTTL: 172_800_000,
    });

    const token = jwt.createToken('agent-doctor', 'machine-doctor', ['read', 'write']);
    if (!token || typeof token !== 'string') {
      throw new Error('JWT createToken returned invalid value');
    }

    // Validate the token we just created
    const payload = jwt.validateToken(token);
    if (!payload) {
      throw new Error('JWT validateToken failed for freshly created token');
    }
    if (payload.agentId !== 'agent-doctor') {
      throw new Error(`JWT payload.agentId mismatch: ${payload.agentId}`);
    }
  }));

  // Check 3: Rate limiter within bounds
  checks.push(await runCheck('Rate limiter within bounds', () => {
    const limiter = new RateLimiter({
      messagesPerMinute: 60,
      channelCreatesPerHour: 10,
      pasteCreatesPerHour: 100,
    });

    const result = limiter.checkLimit('doctor-agent', 'message');
    if (!result.allowed) {
      throw new Error('Fresh rate limiter rejected first message');
    }
    if (result.remaining < 0) {
      throw new Error(`Remaining count negative: ${result.remaining}`);
    }

    // Record an action and verify still within bounds
    limiter.recordAction('doctor-agent', 'message');
    const result2 = limiter.checkLimit('doctor-agent', 'message');
    if (!result2.allowed) {
      throw new Error('Rate limiter rejected second message (should allow up to 60/min)');
    }
  }));

  // Check 4: RLS filter broadcast delivery
  checks.push(await runCheck('RLS filter broadcast delivery', () => {
    const filter = new RLSFilter(
      'doctor-agent',
      'doctor-machine',
      new Set(['ch-general']),
    );

    // Test broadcast delivery
    const broadcastMsg: Message = {
      id: 'msg-broadcast-test',
      channelId: '',
      senderId: 'other-agent',
      targetType: 'broadcast',
      targetAddress: '',
      messageType: 'chat',
      content: 'broadcast test',
      metadata: { deliveryMode: 'broadcast' },
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    if (!filter.shouldDeliver(broadcastMsg)) {
      throw new Error('RLS filter rejected broadcast message');
    }

    // Test direct message delivery
    const directMsg: Message = {
      id: 'msg-direct-test',
      channelId: '',
      senderId: 'other-agent',
      targetType: 'agent',
      targetAddress: 'agent://doctor-machine/doctor-agent',
      messageType: 'chat',
      content: 'direct test',
      metadata: {},
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    if (!filter.shouldDeliver(directMsg)) {
      throw new Error('RLS filter rejected direct message addressed to this agent');
    }

    // Test channel membership delivery
    const channelMsg: Message = {
      id: 'msg-channel-test',
      channelId: 'ch-general',
      senderId: 'other-agent',
      targetType: 'channel',
      targetAddress: '',
      messageType: 'chat',
      content: 'channel test',
      metadata: {},
      status: 'pending',
      claimedBy: null,
      claimedAt: null,
      threadId: null,
      createdAt: new Date().toISOString(),
      expiresAt: null,
    };

    if (!filter.shouldDeliver(channelMsg)) {
      throw new Error('RLS filter rejected channel message for member channel');
    }
  }));

  return collectSubsystem('Security', checks);
}

// ============================================================================
// 3. Discord Bridge Health Checks
// ============================================================================

async function checkDiscordBridge(): Promise<SubsystemResult> {
  const checks: CheckResult[] = [];

  const dummyConfig = {
    discordToken: 'dummy-token-for-doctor',
    guildId: 'dummy-guild-id',
    apiUrl: 'http://localhost:9999',
    projectKey: 'sk_test_dummy',
    agentId: 'doctor-agent',
  };

  // Check 1: Gateway instantiation
  checks.push(await runCheck('Gateway instantiation', () => {
    const gateway = new DiscordGateway(dummyConfig);
    if (!gateway) throw new Error('DiscordGateway constructor returned falsy');
    const status = gateway.isConnected();
    if (typeof status.discord !== 'boolean') {
      throw new Error('Gateway status.discord is not boolean');
    }
    if (typeof status.signaldb !== 'boolean') {
      throw new Error('Gateway status.signaldb is not boolean');
    }
    // Verify health status method exists and works
    const health = gateway.getHealthStatus();
    if (typeof health.reconnectCount !== 'number') {
      throw new Error('Gateway health.reconnectCount is not number');
    }
  }));

  // Check 2: 5 slash commands registered
  checks.push(await runCheck('5 slash commands registered', () => {
    const manager = new SlashCommandManager(dummyConfig);
    const defs = manager.getCommandDefinitions();
    if (!Array.isArray(defs)) {
      throw new Error('getCommandDefinitions did not return array');
    }
    if (defs.length !== 5) {
      throw new Error(`Expected 5 commands, got ${defs.length}`);
    }

    const expectedNames = ['agents', 'channels', 'send', 'memo', 'paste'];
    for (let i = 0; i < expectedNames.length; i++) {
      const expected = expectedNames[i]!;
      let found = false;
      for (let j = 0; j < defs.length; j++) {
        if (defs[j]!.name === expected) {
          found = true;
          break;
        }
      }
      if (!found) {
        throw new Error(`Missing command: ${expected}`);
      }
    }
  }));

  // Check 3: Message bridge creation
  checks.push(await runCheck('Message bridge creation', () => {
    // MessageBridge requires several dependencies; we verify it can
    // be instantiated with dummy values (constructor-only, no connect)
    const gateway = new DiscordGateway(dummyConfig);

    // Create a minimal mock for the dependencies that MessageBridge needs
    const dummyChannelClient = {
      publish: async () => {},
    } as any;

    const dummyThreadMapper = {
      mapDiscordToSignalDB: () => undefined,
      mapSignalDBToDiscord: () => undefined,
      getOrCreateDiscordThread: async () => 'thread-id',
      getMappingCount: () => 0,
    } as any;

    const dummyFormatter = {
      formatForSignalDB: () => '',
      formatForDiscord: async () => '',
    } as any;

    const dummyRateLimiter = {
      checkLimit: () => ({ allowed: true, remaining: 10 }),
      recordMessage: () => {},
    } as any;

    const bridge = new MessageBridge(
      dummyConfig,
      gateway,
      dummyChannelClient,
      dummyThreadMapper,
      dummyFormatter,
      dummyRateLimiter,
    );

    if (!bridge) throw new Error('MessageBridge constructor returned falsy');
    const stats = bridge.getStats();
    if (typeof stats.messagesFromDiscord !== 'number') {
      throw new Error('MessageBridge stats invalid');
    }
  }));

  return collectSubsystem('Discord Bridge', checks);
}

// ============================================================================
// 4. E2E Connectivity Health Checks
// ============================================================================

async function checkE2EConnectivity(): Promise<SubsystemResult> {
  const checks: CheckResult[] = [];

  // Check 1: Config loads
  checks.push(await runCheck('Config loads', () => {
    const config = loadTapestryConfig();
    if (!config) {
      throw new Error('loadTapestryConfig returned falsy');
    }
    if (!config.current) {
      throw new Error('Config has no current environment set');
    }
    const envs = listConfiguredEnvironments(config);
    if (!Array.isArray(envs)) {
      throw new Error('listConfiguredEnvironments did not return array');
    }
  }));

  // Check 2: SignalDB API reachable
  checks.push(await runCheck('SignalDB API reachable', async () => {
    const config = loadTapestryConfig();
    const envConfig = config[config.current];

    if (!envConfig) {
      throw new Error(
        `No configuration for environment "${config.current}". ` +
        'Set TAPESTRY_<ENV>_API_URL and TAPESTRY_<ENV>_PROJECT_KEY in .env.tapestry',
      );
    }

    const url = `${envConfig.apiUrl}/v1/agents?limit=1`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${envConfig.projectKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${envConfig.apiUrl}`);
    }
  }));

  // Check 3: Agent list valid
  checks.push(await runCheck('Agent list valid', async () => {
    const config = loadTapestryConfig();
    const envConfig = config[config.current];

    if (!envConfig) {
      throw new Error(
        `No configuration for environment "${config.current}". Skipped.`,
      );
    }

    const client = new SignalDBClient({
      apiUrl: envConfig.apiUrl,
      projectKey: envConfig.projectKey,
    });

    const agents = await client.agents.list();
    if (!Array.isArray(agents)) {
      throw new Error('Agent list did not return array');
    }
  }));

  return collectSubsystem('E2E Connectivity', checks);
}

// ============================================================================
// Report Output
// ============================================================================

function printReport(report: DoctorReport): void {
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log(`${BLUE}COMMS Doctor - Health Check${RESET}`);
  console.log('==========================');

  for (let i = 0; i < report.subsystems.length; i++) {
    const sub = report.subsystems[i]!;
    console.log('');
    console.log(`${sub.name}:`);

    for (let j = 0; j < sub.checks.length; j++) {
      const check = sub.checks[j]!;
      const icon = check.passed ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
      const timing = verboseMode ? ` ${DIM}(${check.durationMs}ms)${RESET}` : '';
      console.log(`  ${icon} ${check.message}${timing}`);

      if (!check.passed && check.detail) {
        console.log(`    ${RED}${check.detail}${RESET}`);
      }

      if (verboseMode && check.detail && check.passed) {
        console.log(`    ${DIM}${check.detail}${RESET}`);
      }
    }
  }

  console.log('');
  const summaryColor = report.totalFailed === 0 ? GREEN : RED;
  console.log(
    `${summaryColor}Summary: ${report.totalPassed}/${report.totalChecks} checks passed${RESET}` +
    (verboseMode ? ` ${DIM}(${report.durationMs}ms total)${RESET}` : ''),
  );

  if (report.totalFailed > 0) {
    console.log(`${YELLOW}${report.totalFailed} check(s) failed.${RESET}`);
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startTime = Date.now();

  // Run all 4 subsystem checks
  const subsystems: SubsystemResult[] = [];

  subsystems.push(await checkRemoteTemplates());
  subsystems.push(await checkSecurity());
  subsystems.push(await checkDiscordBridge());
  subsystems.push(await checkE2EConnectivity());

  // Aggregate totals
  let totalChecks = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (let i = 0; i < subsystems.length; i++) {
    const sub = subsystems[i]!;
    totalChecks += sub.checks.length;
    totalPassed += sub.passed;
    totalFailed += sub.failed;
  }

  const report: DoctorReport = {
    subsystems,
    totalChecks,
    totalPassed,
    totalFailed,
    durationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };

  printReport(report);

  // Exit with non-zero if any checks failed
  if (totalFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('COMMS Doctor failed:', err);
  process.exit(2);
});
