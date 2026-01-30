#!/usr/bin/env bun
/**
 * COMMS E2E Test Runner
 *
 * Cross-machine end-to-end communication testing with structured results.
 *
 * Tests:
 * 1. Cross-machine message routing: m4 <-> studio round-trip
 * 2. Thread continuation: --continue <threadId> resumes cross-machine threads
 *
 * Usage:
 *   comms-e2e-test --target <machine> [options]   Cross-machine E2E test suite
 *   comms-e2e-test <target-session> [options]      Send test to local session
 *   comms-e2e-test --self [options]                Test self-communication
 *   comms-e2e-test --list                          List available sessions
 *   comms-e2e-test --help                          Show help
 *
 * Examples:
 *   comms-e2e-test --target studio --verbose
 *   comms-e2e-test --target studio --json
 *   comms-e2e-test tender-mongoose --verbose
 *   comms-e2e-test --self
 */

import { SignalDBClient } from '../src/comms/client/signaldb';
import {
  getCurrentEnvironmentConfig,
  loadTapestryConfig,
} from '../src/comms/config/environments';
import type { EnvironmentConfig } from '../src/comms/config/environments';
import {
  getSessionStore,
  listSessions,
} from '../src/hooks/sessions/store';
import type { Agent, Message } from '../src/comms/protocol/types';

// ============================================================================
// Colors (simple ANSI)
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function bold(s: string): string {
  return `${colors.bold}${s}${colors.reset}`;
}

function red(s: string): string {
  return `${colors.red}${s}${colors.reset}`;
}

function green(s: string): string {
  return `${colors.green}${s}${colors.reset}`;
}

function yellow(s: string): string {
  return `${colors.yellow}${s}${colors.reset}`;
}

function cyan(s: string): string {
  return `${colors.cyan}${s}${colors.reset}`;
}

function dim(s: string): string {
  return `${colors.dim}${s}${colors.reset}`;
}

// ============================================================================
// Verbose Logging with Timestamps
// ============================================================================

/** Epoch for relative timestamps (set when tests start) */
let verboseEpoch = 0;

/**
 * Format a relative timestamp from the epoch.
 * Output: [MM:SS.mmm]
 */
function formatTimestamp(): string {
  const elapsed = Date.now() - verboseEpoch;
  const minutes = Math.floor(elapsed / 60_000);
  const seconds = Math.floor((elapsed % 60_000) / 1000);
  const millis = elapsed % 1000;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const ms = String(millis).padStart(3, '0');
  return `[${mm}:${ss}.${ms}]`;
}

/**
 * Log a verbose step with timestamp.
 * Only outputs when verbose mode is enabled.
 */
function verboseLog(message: string, isVerbose: boolean): void {
  if (isVerbose) {
    console.log(`${dim(formatTimestamp())} ${message}`);
  }
}

// ============================================================================
// Argument Parsing
// ============================================================================

interface CLIArgs {
  targetSession: string | null;
  targetMachine: string | null;
  selfTest: boolean;
  list: boolean;
  env: 'dev' | 'test' | 'live';
  timeout: number;
  verbose: boolean;
  json: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    targetSession: null,
    targetMachine: null,
    selfTest: false,
    list: false,
    env: 'dev',
    timeout: 60_000,
    verbose: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--self':
        args.selfTest = true;
        break;
      case '--list':
        args.list = true;
        break;
      case '--target': {
        const val = argv[++i];
        if (val) {
          args.targetMachine = val;
        }
        break;
      }
      case '--env': {
        const val = argv[++i];
        if (val && ['dev', 'test', 'live'].includes(val)) {
          args.env = val as 'dev' | 'test' | 'live';
        }
        break;
      }
      case '--timeout': {
        const val = argv[++i];
        if (val) {
          const parsed = Number.parseInt(val, 10);
          if (!Number.isNaN(parsed) && parsed > 0) {
            args.timeout = parsed * 1000; // Convert to ms
          }
        }
        break;
      }
      case '-v':
      case '--verbose':
        args.verbose = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        if (arg && !arg.startsWith('-') && !args.targetSession) {
          args.targetSession = arg;
        }
    }
  }

  return args;
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`
${bold('COMMS E2E Test Runner')} - Cross-machine communication testing

${bold('Usage:')}
  comms-e2e-test --target <machine> [options]   Run cross-machine test suite
  comms-e2e-test <target-session> [options]      Send test to local session
  comms-e2e-test --self [options]                Test self-communication
  comms-e2e-test --list                          List available local sessions

${bold('Cross-Machine Testing:')}
  --target <machine>   Target machine name (e.g., ${cyan('studio')}, ${cyan('m4')})
                       Discovers agents on the remote machine and runs:
                       1. Cross-machine message routing test
                       2. Thread continuation test

${bold('Options:')}
  --env <env>          Target environment: ${cyan('dev')} | ${cyan('test')} | ${cyan('live')} (default: dev)
  --timeout <secs>     Response timeout in seconds (default: 60)
  --verbose, -v        Show each step with timestamps
  --json               Output structured JSON results
  --help, -h           Show this help

${bold('Examples:')}
  ${cyan('comms-e2e-test --target studio --verbose')}    Cross-machine test with step output
  ${cyan('comms-e2e-test --target studio --json')}       Cross-machine test with JSON output
  ${cyan('comms-e2e-test tender-mongoose')}              Send test to session by name
  ${cyan('comms-e2e-test --self')}                       Test self-communication

${bold('Test Suite (--target):')}
  1. ${bold('cross-machine-routing')}  Send message to remote, verify response within 60s
  2. ${bold('thread-continuation')}    Send follow-up with threadId, verify same thread

${bold('Verbose Output:')}
  ${dim('[00:00.000]')} Registering local agent...
  ${dim('[00:00.123]')} Agent registered: test-agent-m4
  ${dim('[00:00.124]')} Sending message to agent://studio/...
  ${dim('[00:01.500]')} Response received from studio
  ${dim('[00:01.501]')} ${green('PASS')} Cross-machine routing

${bold('JSON Output:')}
  {
    "tests": [
      { "name": "cross-machine-routing", "status": "pass", "durationMs": 1500 },
      { "name": "thread-continuation", "status": "pass", "durationMs": 2300 }
    ],
    "summary": { "total": 2, "passed": 2, "failed": 0 }
  }

${bold('Requirements:')}
  - Tapestry config at ${cyan('.env.tapestry')} with valid credentials
  - Target machine must have an active agent daemon
  - Both machines must share the same SignalDB project
`);
}

// ============================================================================
// List Sessions
// ============================================================================

function cmdList(): void {
  const store = getSessionStore({ skipMachineRegistration: true });
  const sessions = listSessions({ limit: 20, sortBy: 'lastAccessed', sortDir: 'desc' });

  if (sessions.length === 0) {
    console.log(yellow('\nNo sessions found.\n'));
    console.log('Sessions are tracked when Claude Code runs with the session-namer hook.');
    return;
  }

  console.log(bold('\nAvailable Sessions:\n'));
  console.log(`${'NAME'.padEnd(20)} ${'SESSION ID'.padEnd(12)} ${'LAST ACCESSED'.padEnd(20)} ${'CWD'}`);
  console.log('-'.repeat(80));

  for (const session of sessions) {
    const name = session.name.padEnd(20);
    const id = (session.sessionId?.slice(0, 8) ?? 'unknown').padEnd(12);
    const lastAccessed = new Date(session.lastAccessed).toLocaleString().padEnd(20);
    const cwd = session.cwd ? session.cwd.split('/').slice(-2).join('/') : '-';

    console.log(`${cyan(name)} ${dim(id)} ${lastAccessed} ${cwd}`);
  }

  console.log(`\nUse ${cyan('comms-e2e-test <name>')} to send a test message.`);
}

// ============================================================================
// Structured Test Result Types
// ============================================================================

interface IndividualTestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface TestSuiteResult {
  tests: IndividualTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  environment: string;
  localMachine: string;
  targetMachine: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
}

// ============================================================================
// Cross-Machine Test: Discover Remote Agent
// ============================================================================

/**
 * Find an active agent on the target machine.
 * Prefers active agents, then idle.
 */
async function findRemoteAgent(
  client: SignalDBClient,
  targetMachine: string,
  verbose: boolean,
): Promise<Agent | null> {
  verboseLog('Discovering agents on remote machine...', verbose);

  const agents = await client.agents.list();
  const remoteAgents: Agent[] = [];

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i]!;
    if (agent.machineId === targetMachine) {
      remoteAgents.push(agent);
    }
  }

  if (remoteAgents.length === 0) {
    verboseLog(red(`No agents found on machine: ${targetMachine}`), verbose);
    return null;
  }

  verboseLog(`Found ${remoteAgents.length} agent(s) on ${targetMachine}`, verbose);

  // Sort by: named sessions first (more likely alive), then status priority
  const statusOrder: Record<string, number> = { active: 0, idle: 1, offline: 2 };
  remoteAgents.sort((a, b) => {
    // Prefer agents with session names (indicates active naming system)
    const aHasName = a.sessionName ? 0 : 1;
    const bHasName = b.sessionName ? 0 : 1;
    if (aHasName !== bHasName) return aHasName - bHasName;
    // Then by status
    return (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
  });

  const best = remoteAgents[0]!;
  verboseLog(
    `Selected agent: ${best.sessionName ?? best.id.slice(0, 8)} (${best.status})`,
    verbose,
  );

  return best;
}

// ============================================================================
// Cross-Machine Test: Message Routing
// ============================================================================

/**
 * Test 1: Cross-machine message routing.
 *
 * Sends a message from the local machine to a remote agent and waits
 * for a response within the configured timeout.
 *
 * Covers AC-001: m4 and mac-studio exchange messages within 60 seconds.
 * Covers AC-002: comms chat round-trip delivers request and receives response.
 */
async function testCrossMachineRouting(
  client: SignalDBClient,
  envConfig: EnvironmentConfig,
  localAgent: Agent,
  remoteAgent: Agent,
  channel: { id: string },
  timeout: number,
  verbose: boolean,
): Promise<IndividualTestResult> {
  const testStart = Date.now();
  const testName = 'cross-machine-routing';

  try {
    // Build target address for remote agent
    const targetAddress = `agent://${remoteAgent.machineId}/${remoteAgent.sessionName ?? remoteAgent.sessionId ?? remoteAgent.id}`;

    verboseLog(`Sending message to ${targetAddress}`, verbose);

    const testNonce = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const testContent = `[E2E Test] Echo back nonce: ${testNonce}`;

    // Send the message
    const sent = await client.messages.send({
      channelId: channel.id,
      senderId: localAgent.id,
      targetType: 'agent',
      targetAddress,
      messageType: 'command',
      content: testContent,
    });

    verboseLog(`Message sent: ${sent.id.slice(0, 8)}`, verbose);
    verboseLog(`Waiting for response (timeout: ${timeout / 1000}s)...`, verbose);

    // Poll for response
    const pollInterval = 2_000;
    const pollDeadline = Date.now() + timeout;

    while (Date.now() < pollDeadline) {
      const messages = await client.messages.list();

      // Look for response in the thread started by our message
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.threadId === sent.id && msg.messageType === 'response') {
          const duration = Date.now() - testStart;
          verboseLog(
            `Response received from ${remoteAgent.machineId} in ${duration}ms`,
            verbose,
          );
          verboseLog(green(`PASS ${testName}`), verbose);

          return {
            name: testName,
            status: 'pass',
            durationMs: duration,
            details: {
              messageId: sent.id,
              responseId: msg.id,
              threadId: sent.id,
              nonce: testNonce,
              targetMachine: remoteAgent.machineId,
              responseContentPreview: msg.content?.slice(0, 100),
            },
          };
        }
      }

      await Bun.sleep(pollInterval);

      if (verbose) {
        const elapsed = Date.now() - testStart;
        const remaining = Math.max(0, Math.round((pollDeadline - Date.now()) / 1000));
        process.stdout.write(
          `\r${dim(formatTimestamp())} Polling... (${remaining}s remaining)`,
        );
      }
    }

    // Timeout
    if (verbose) {
      process.stdout.write('\n');
    }
    const duration = Date.now() - testStart;
    verboseLog(red(`FAIL ${testName}: timeout after ${duration}ms`), verbose);

    return {
      name: testName,
      status: 'fail',
      durationMs: duration,
      error: `Timeout waiting for response after ${timeout / 1000}s`,
      details: {
        messageId: sent.id,
        targetMachine: remoteAgent.machineId,
        targetAddress,
      },
    };
  } catch (err) {
    const duration = Date.now() - testStart;
    const errorMsg = err instanceof Error ? err.message : String(err);
    verboseLog(red(`FAIL ${testName}: ${errorMsg}`), verbose);

    return {
      name: testName,
      status: 'fail',
      durationMs: duration,
      error: errorMsg,
    };
  }
}

// ============================================================================
// Cross-Machine Test: Thread Continuation
// ============================================================================

/**
 * Test 2: Thread continuation across machines.
 *
 * Sends an initial message, captures the threadId from the response,
 * then sends a follow-up message with that threadId set. Verifies both
 * messages share the same thread.
 *
 * Covers AC-003: --continue <threadId> resumes thread across machines.
 */
async function testThreadContinuation(
  client: SignalDBClient,
  envConfig: EnvironmentConfig,
  localAgent: Agent,
  remoteAgent: Agent,
  channel: { id: string },
  timeout: number,
  verbose: boolean,
): Promise<IndividualTestResult> {
  const testStart = Date.now();
  const testName = 'thread-continuation';

  try {
    // Step 1: Send initial message (starts a new thread)
    const targetAddress = `agent://${remoteAgent.machineId}/${remoteAgent.sessionName ?? remoteAgent.sessionId ?? remoteAgent.id}`;

    const initialNonce = `thread-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialContent = `[E2E Thread Test] Initial message, nonce: ${initialNonce}`;

    verboseLog('Sending initial thread message...', verbose);

    const initialSent = await client.messages.send({
      channelId: channel.id,
      senderId: localAgent.id,
      targetType: 'agent',
      targetAddress,
      messageType: 'command',
      content: initialContent,
    });

    verboseLog(`Initial message sent: ${initialSent.id.slice(0, 8)}`, verbose);

    // Wait for initial response
    const threadId = initialSent.id; // thread is anchored to the first message ID
    let initialResponse: Message | null = null;
    const pollInterval = 2_000;
    const halfTimeout = Math.floor(timeout / 2);
    const initialDeadline = Date.now() + halfTimeout;

    verboseLog(`Waiting for initial response (timeout: ${halfTimeout / 1000}s)...`, verbose);

    while (Date.now() < initialDeadline) {
      const messages = await client.messages.list();

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        if (msg.threadId === threadId && msg.messageType === 'response') {
          initialResponse = msg;
          break;
        }
      }

      if (initialResponse) break;
      await Bun.sleep(pollInterval);
    }

    if (!initialResponse) {
      const duration = Date.now() - testStart;
      verboseLog(
        red(`FAIL ${testName}: no response to initial message after ${halfTimeout / 1000}s`),
        verbose,
      );
      return {
        name: testName,
        status: 'fail',
        durationMs: duration,
        error: `Timeout waiting for initial thread response after ${halfTimeout / 1000}s`,
        details: { messageId: initialSent.id, threadId },
      };
    }

    verboseLog(`Initial response received: ${initialResponse.id.slice(0, 8)}`, verbose);

    // Step 2: Send follow-up message in the same thread
    const followUpNonce = `thread-follow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const followUpContent = `[E2E Thread Test] Follow-up in thread ${threadId.slice(0, 8)}, nonce: ${followUpNonce}`;

    verboseLog(`Sending follow-up with threadId: ${threadId.slice(0, 8)}...`, verbose);

    const followUpSent = await client.messages.send({
      channelId: channel.id,
      senderId: localAgent.id,
      targetType: 'agent',
      targetAddress,
      messageType: 'command',
      content: followUpContent,
      threadId,
    });

    verboseLog(`Follow-up sent: ${followUpSent.id.slice(0, 8)}`, verbose);

    // Verify the follow-up message was sent with the correct threadId
    if (followUpSent.threadId !== threadId) {
      const duration = Date.now() - testStart;
      verboseLog(
        red(`FAIL ${testName}: follow-up threadId mismatch`),
        verbose,
      );
      return {
        name: testName,
        status: 'fail',
        durationMs: duration,
        error: `Follow-up threadId mismatch: expected ${threadId}, got ${followUpSent.threadId}`,
        details: {
          expectedThreadId: threadId,
          actualThreadId: followUpSent.threadId,
        },
      };
    }

    // Wait for follow-up response
    let followUpResponse: Message | null = null;
    const followUpDeadline = Date.now() + halfTimeout;

    verboseLog(`Waiting for follow-up response (timeout: ${halfTimeout / 1000}s)...`, verbose);

    while (Date.now() < followUpDeadline) {
      const messages = await client.messages.list();

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]!;
        // Find a response in the same thread that is newer than our follow-up
        if (
          msg.threadId === threadId &&
          msg.messageType === 'response' &&
          msg.id !== initialResponse.id &&
          msg.createdAt > followUpSent.createdAt
        ) {
          followUpResponse = msg;
          break;
        }
      }

      if (followUpResponse) break;
      await Bun.sleep(pollInterval);
    }

    if (!followUpResponse) {
      const duration = Date.now() - testStart;
      verboseLog(
        red(`FAIL ${testName}: no response to follow-up after ${halfTimeout / 1000}s`),
        verbose,
      );
      return {
        name: testName,
        status: 'fail',
        durationMs: duration,
        error: `Timeout waiting for follow-up response after ${halfTimeout / 1000}s`,
        details: {
          threadId,
          initialMessageId: initialSent.id,
          followUpMessageId: followUpSent.id,
        },
      };
    }

    // Verify thread integrity: all messages share the same threadId
    const threadMessages = await client.messages.listByThread(threadId);
    let allInThread = true;
    for (let i = 0; i < threadMessages.length; i++) {
      if (threadMessages[i]!.threadId !== threadId) {
        allInThread = false;
        break;
      }
    }

    if (!allInThread) {
      const duration = Date.now() - testStart;
      verboseLog(red(`FAIL ${testName}: thread integrity broken`), verbose);
      return {
        name: testName,
        status: 'fail',
        durationMs: duration,
        error: 'Thread integrity broken: not all messages share the same threadId',
        details: {
          threadId,
          threadMessageCount: threadMessages.length,
        },
      };
    }

    const duration = Date.now() - testStart;
    verboseLog(
      `Thread verified: ${threadMessages.length} messages in thread ${threadId.slice(0, 8)}`,
      verbose,
    );
    verboseLog(green(`PASS ${testName}`), verbose);

    return {
      name: testName,
      status: 'pass',
      durationMs: duration,
      details: {
        threadId,
        initialMessageId: initialSent.id,
        initialResponseId: initialResponse.id,
        followUpMessageId: followUpSent.id,
        followUpResponseId: followUpResponse.id,
        threadMessageCount: threadMessages.length,
      },
    };
  } catch (err) {
    const duration = Date.now() - testStart;
    const errorMsg = err instanceof Error ? err.message : String(err);
    verboseLog(red(`FAIL ${testName}: ${errorMsg}`), verbose);

    return {
      name: testName,
      status: 'fail',
      durationMs: duration,
      error: errorMsg,
    };
  }
}

// ============================================================================
// Cross-Machine Test Suite Runner
// ============================================================================

/**
 * Run the full cross-machine E2E test suite.
 *
 * 1. Registers a local test agent
 * 2. Discovers a remote agent on the target machine
 * 3. Runs cross-machine routing test
 * 4. Runs thread continuation test
 * 5. Reports structured results
 */
async function runCrossMachineTests(args: CLIArgs): Promise<TestSuiteResult> {
  const suiteStart = Date.now();
  const verbose = args.verbose;
  const targetMachine = args.targetMachine!;

  verboseEpoch = suiteStart;

  // Load config
  verboseLog('Loading Tapestry configuration...', verbose);
  const config = loadTapestryConfig(args.env);
  const envConfig = getCurrentEnvironmentConfig(config);

  verboseLog(`Environment: ${envConfig.name}`, verbose);
  verboseLog(`API URL: ${envConfig.apiUrl}`, verbose);
  verboseLog(`Local machine: ${envConfig.machineId}`, verbose);
  verboseLog(`Target machine: ${targetMachine}`, verbose);

  const results: IndividualTestResult[] = [];

  // Create SignalDB client
  const client = new SignalDBClient({
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  });

  // Register local test agent
  verboseLog('Registering local test agent...', verbose);
  let localAgent: Agent;
  try {
    localAgent = await client.agents.register({
      machineId: envConfig.machineId,
      sessionId: `e2e-test-${Date.now()}`,
      sessionName: `e2e-test-${envConfig.machineId}`,
      projectPath: process.cwd(),
      capabilities: { test: true, e2e: true },
    });
    verboseLog(`Agent registered: ${localAgent.sessionName ?? localAgent.id.slice(0, 8)}`, verbose);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    verboseLog(red(`Failed to register agent: ${errorMsg}`), verbose);

    return {
      tests: [{
        name: 'setup',
        status: 'fail',
        durationMs: Date.now() - suiteStart,
        error: `Failed to register local agent: ${errorMsg}`,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      environment: envConfig.name,
      localMachine: envConfig.machineId,
      targetMachine,
      startedAt: new Date(suiteStart).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - suiteStart,
    };
  }

  // Find remote agent on target machine
  const remoteAgent = await findRemoteAgent(client, targetMachine, verbose);
  if (!remoteAgent) {
    const duration = Date.now() - suiteStart;
    verboseLog(
      red(`No active agents found on ${targetMachine}. Is the daemon running?`),
      verbose,
    );

    return {
      tests: [{
        name: 'setup',
        status: 'fail',
        durationMs: duration,
        error: `No active agents found on machine: ${targetMachine}`,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      environment: envConfig.name,
      localMachine: envConfig.machineId,
      targetMachine,
      startedAt: new Date(suiteStart).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: duration,
    };
  }

  // Set up e2e-test channel
  verboseLog('Setting up test channel...', verbose);
  let channel: { id: string };
  try {
    const channels = await client.channels.list({ type: 'project' });
    let existing = null;
    for (let i = 0; i < channels.length; i++) {
      if (channels[i]!.name === 'e2e-test') {
        existing = channels[i]!;
        break;
      }
    }

    if (existing) {
      channel = existing;
      verboseLog(`Using existing channel: ${channel.id.slice(0, 8)}`, verbose);
    } else {
      channel = await client.channels.create({
        name: 'e2e-test',
        type: 'project',
        createdBy: localAgent.id,
      });
      verboseLog(`Created channel: ${channel.id.slice(0, 8)}`, verbose);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    verboseLog(red(`Failed to setup channel: ${errorMsg}`), verbose);

    return {
      tests: [{
        name: 'setup',
        status: 'fail',
        durationMs: Date.now() - suiteStart,
        error: `Failed to setup test channel: ${errorMsg}`,
      }],
      summary: { total: 1, passed: 0, failed: 1, skipped: 0 },
      environment: envConfig.name,
      localMachine: envConfig.machineId,
      targetMachine,
      startedAt: new Date(suiteStart).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - suiteStart,
    };
  }

  // ---- Test 1: Cross-machine routing ----
  if (!args.json) {
    console.log('');
    console.log(bold('Test 1: Cross-Machine Message Routing'));
  }
  const routingResult = await testCrossMachineRouting(
    client, envConfig, localAgent, remoteAgent, channel, args.timeout, verbose,
  );
  results.push(routingResult);

  if (!args.json) {
    const icon = routingResult.status === 'pass' ? green('PASS') : red('FAIL');
    console.log(`  ${icon} ${routingResult.name} (${routingResult.durationMs}ms)`);
    if (routingResult.error) {
      console.log(`  ${red('Error:')} ${routingResult.error}`);
    }
  }

  // ---- Test 2: Thread continuation ----
  if (!args.json) {
    console.log('');
    console.log(bold('Test 2: Thread Continuation'));
  }

  // Only run if routing test passed (thread continuation depends on cross-machine messaging)
  if (routingResult.status === 'pass') {
    const threadResult = await testThreadContinuation(
      client, envConfig, localAgent, remoteAgent, channel, args.timeout, verbose,
    );
    results.push(threadResult);

    if (!args.json) {
      const icon = threadResult.status === 'pass' ? green('PASS') : red('FAIL');
      console.log(`  ${icon} ${threadResult.name} (${threadResult.durationMs}ms)`);
      if (threadResult.error) {
        console.log(`  ${red('Error:')} ${threadResult.error}`);
      }
    }
  } else {
    results.push({
      name: 'thread-continuation',
      status: 'skip',
      durationMs: 0,
      error: 'Skipped: cross-machine-routing test failed',
    });

    if (!args.json) {
      console.log(`  ${yellow('SKIP')} thread-continuation (routing test failed)`);
    }
  }

  // Cleanup: deregister test agent
  verboseLog('Cleaning up test agent...', verbose);
  try {
    await client.agents.deregister(localAgent.id);
    verboseLog('Test agent deregistered', verbose);
  } catch (_) {
    // Best effort cleanup
  }

  // Build summary
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === 'pass') passed++;
    else if (r.status === 'fail') failed++;
    else if (r.status === 'skip') skipped++;
  }

  return {
    tests: results,
    summary: { total: results.length, passed, failed, skipped },
    environment: envConfig.name,
    localMachine: envConfig.machineId,
    targetMachine,
    startedAt: new Date(suiteStart).toISOString(),
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - suiteStart,
  };
}

// ============================================================================
// Legacy Single-Session E2E Test
// ============================================================================

interface LegacyTestResult {
  success: boolean;
  messageId?: string;
  responseId?: string;
  responseContent?: string;
  duration?: number;
  error?: string;
}

async function runLegacyE2ETest(
  targetSession: string,
  args: CLIArgs,
): Promise<LegacyTestResult> {
  const startTime = Date.now();
  const verbose = args.verbose;

  verboseEpoch = startTime;

  // Load config
  const config = loadTapestryConfig(args.env);
  const envConfig = getCurrentEnvironmentConfig(config);

  verboseLog(`Environment: ${envConfig.name}`, verbose);
  verboseLog(`API URL: ${envConfig.apiUrl}`, verbose);
  verboseLog(`Machine ID: ${envConfig.machineId}`, verbose);

  // Create SignalDB client
  const client = new SignalDBClient({
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  });

  // Get session info
  const store = getSessionStore({ skipMachineRegistration: true });
  const thisSessionId = process.env.CLAUDE_SESSION_ID;
  const thisSessionName = thisSessionId ? store.getName(thisSessionId) : undefined;

  verboseLog(`This session: ${thisSessionName ?? thisSessionId ?? 'unknown'}`, verbose);

  // Resolve target session ID
  let targetSessionId: string;
  const targetInfo = store.getByName(targetSession);
  if (targetInfo) {
    targetSessionId = targetInfo.sessionId;
    verboseLog(`Target session: ${targetSession} -> ${targetSessionId.slice(0, 8)}`, verbose);
  } else if (store.getBySessionId(targetSession)) {
    targetSessionId = targetSession;
    verboseLog(`Target session: ${targetSessionId.slice(0, 8)}`, verbose);
  } else {
    // Try partial match
    const sessions = listSessions();
    let match = null;
    for (let i = 0; i < sessions.length; i++) {
      const s = sessions[i]!;
      if (s.sessionId?.startsWith(targetSession) || s.name.includes(targetSession)) {
        match = s;
        break;
      }
    }
    if (match) {
      targetSessionId = match.sessionId;
      verboseLog(`Target session: ${match.name} -> ${targetSessionId.slice(0, 8)}`, verbose);
    } else {
      return {
        success: false,
        error: `Session not found: ${targetSession}`,
      };
    }
  }

  // 1. Register this session as an agent
  verboseLog('Registering as agent...', verbose);
  let thisAgent;
  try {
    thisAgent = await client.agents.register({
      machineId: envConfig.machineId,
      sessionId: thisSessionId ?? `e2e-test-${Date.now()}`,
      sessionName: thisSessionName ?? 'e2e-test',
      projectPath: process.cwd(),
      capabilities: { test: true },
    });
    verboseLog(`Registered agent: ${thisAgent.id.slice(0, 8)}`, verbose);
  } catch (err) {
    return {
      success: false,
      error: `Failed to register agent: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Create or get a channel for this test
  verboseLog('Setting up test channel...', verbose);
  let channel;
  try {
    const channels = await client.channels.list({ type: 'project' });
    let existing = null;
    for (let i = 0; i < channels.length; i++) {
      if (channels[i]!.name === 'e2e-test') {
        existing = channels[i]!;
        break;
      }
    }

    if (existing) {
      channel = existing;
      verboseLog(`Using existing channel: ${channel.id.slice(0, 8)}`, verbose);
    } else {
      channel = await client.channels.create({
        name: 'e2e-test',
        type: 'project',
        createdBy: thisAgent.id,
      });
      verboseLog(`Created channel: ${channel.id.slice(0, 8)}`, verbose);
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to setup channel: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Send test command to target session
  verboseLog('Sending test command...', verbose);
  const testContent = `[E2E Test] Echo back this message with timestamp: ${new Date().toISOString()}`;
  let message;
  try {
    message = await client.messages.send({
      channelId: channel.id,
      senderId: thisAgent.id,
      targetType: 'agent',
      targetAddress: `agent://${envConfig.machineId}/${targetSession}`,
      messageType: 'command',
      content: testContent,
    });
    verboseLog(green(`Sent message: ${message.id.slice(0, 8)}`), verbose);
  } catch (err) {
    return {
      success: false,
      error: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Poll for response
  verboseLog(`Waiting for response (timeout: ${args.timeout / 1000}s)...`, verbose);
  const pollInterval = 2_000;
  const pollStart = Date.now();

  while (Date.now() - pollStart < args.timeout) {
    try {
      // List all messages and filter for responses in our thread
      const messages = await client.messages.list();
      const responses: Message[] = [];
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i]!;
        if (m.threadId === message.id && m.messageType === 'response') {
          responses.push(m);
        }
      }

      if (responses.length > 0) {
        const response = responses[0]!;
        const duration = Date.now() - startTime;

        verboseLog(green('Response received!'), verbose);
        verboseLog(`Response ID: ${response.id.slice(0, 8)}`, verbose);
        verboseLog(`Content: ${response.content?.slice(0, 100)}...`, verbose);

        return {
          success: true,
          messageId: message.id,
          responseId: response.id,
          responseContent: response.content,
          duration,
        };
      }

      // Show progress dot (only in non-verbose, non-json mode)
      if (!verbose && !args.json) {
        process.stdout.write(dim('.'));
      }

      await Bun.sleep(pollInterval);
    } catch (err) {
      verboseLog(yellow(`Poll error: ${err}`), verbose);
    }
  }

  // Timeout
  const duration = Date.now() - startTime;
  if (!verbose && !args.json) {
    console.log('');
  }
  return {
    success: false,
    messageId: message.id,
    duration,
    error: 'Timeout waiting for response',
  };
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    return;
  }

  if (args.list) {
    cmdList();
    return;
  }

  // ---- Cross-machine test suite mode (--target) ----
  if (args.targetMachine) {
    if (!args.json) {
      console.log('');
      console.log(bold('COMMS E2E Test Suite'));
      console.log(dim(`Target machine: ${args.targetMachine}`));
      console.log(dim(`Environment: ${args.env}`));
      console.log(dim(`Timeout: ${args.timeout / 1000}s`));
    }

    const result = await runCrossMachineTests(args);

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      // Print summary
      console.log('');
      console.log(bold('Summary'));
      console.log(`  Total:   ${result.summary.total}`);
      console.log(`  Passed:  ${green(String(result.summary.passed))}`);
      if (result.summary.failed > 0) {
        console.log(`  Failed:  ${red(String(result.summary.failed))}`);
      }
      if (result.summary.skipped > 0) {
        console.log(`  Skipped: ${yellow(String(result.summary.skipped))}`);
      }
      console.log(`  Duration: ${result.totalDurationMs}ms`);
      console.log('');

      if (result.summary.failed > 0) {
        console.log(red(bold('SOME TESTS FAILED')));
        process.exit(1);
      } else {
        console.log(green(bold('ALL TESTS PASSED')));
      }
    }

    // Exit with failure if any test failed
    if (result.summary.failed > 0) {
      process.exit(1);
    }
    return;
  }

  // ---- Legacy single-session mode ----
  let target: string;
  if (args.selfTest) {
    const sessionId = process.env.CLAUDE_SESSION_ID;
    if (!sessionId) {
      console.log(red('Error: CLAUDE_SESSION_ID not set'));
      console.log('Self-test requires running within a Claude Code session.');
      process.exit(1);
    }
    const store = getSessionStore({ skipMachineRegistration: true });
    target = store.getName(sessionId) ?? sessionId;
    console.log(bold(`\nE2E Self-Test: ${cyan(target)}\n`));
  } else if (args.targetSession) {
    target = args.targetSession;
    console.log(bold(`\nE2E Test: ${cyan(target)}\n`));
  } else {
    console.log(red('Error: Please specify a target'));
    console.log('Usage: comms-e2e-test --target <machine>     Cross-machine test suite');
    console.log('       comms-e2e-test <target-session>        Single session test');
    console.log('       comms-e2e-test --self                  Self-test');
    console.log('       comms-e2e-test --list                  List sessions');
    process.exit(1);
  }

  verboseEpoch = Date.now();

  // Run test
  const result = await runLegacyE2ETest(target, args);

  // Report results
  if (args.json) {
    console.log(JSON.stringify({
      tests: [{
        name: 'single-session-e2e',
        status: result.success ? 'pass' : 'fail',
        durationMs: result.duration ?? 0,
        error: result.error,
        details: {
          messageId: result.messageId,
          responseId: result.responseId,
        },
      }],
      summary: {
        total: 1,
        passed: result.success ? 1 : 0,
        failed: result.success ? 0 : 1,
        skipped: 0,
      },
    }, null, 2));
  } else {
    console.log('');
    if (result.success) {
      console.log(green(bold('PASS E2E Test')));
      console.log(`  Message ID:  ${result.messageId?.slice(0, 8)}`);
      console.log(`  Response ID: ${result.responseId?.slice(0, 8)}`);
      console.log(`  Duration:    ${result.duration}ms`);
      if (args.verbose && result.responseContent) {
        console.log(`  Response:\n${dim(result.responseContent)}`);
      }
    } else {
      console.log(red(bold('FAIL E2E Test')));
      console.log(`  Error: ${result.error}`);
      if (result.messageId) {
        console.log(`  Message ID: ${result.messageId.slice(0, 8)}`);
      }
      if (result.duration) {
        console.log(`  Duration: ${result.duration}ms`);
      }
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(red(`Fatal error: ${err}`));
  process.exit(1);
});
