#!/usr/bin/env bun
/**
 * COMMS E2E Test
 *
 * Tests cross-agent communication by:
 * 1. Registering this session as an agent
 * 2. Sending a command to a target session
 * 3. Waiting for response
 * 4. Verifying the result
 *
 * Usage:
 *   comms-e2e-test <target-session>        Send test command to session
 *   comms-e2e-test --self                   Test self-communication
 *   comms-e2e-test --list                   List available sessions
 *   comms-e2e-test --help                   Show help
 *
 * Examples:
 *   comms-e2e-test tender-mongoose
 *   comms-e2e-test abc-123-def-456
 *   comms-e2e-test --self
 */

import { SignalDBClient } from '../src/comms/client/signaldb';
import {
  getCurrentEnvironmentConfig,
  loadTapestryConfig,
} from '../src/comms/config/environments';
import {
  getSessionStore,
  listSessions,
} from '../src/hooks/sessions/store';

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
// Argument Parsing
// ============================================================================

interface CLIArgs {
  targetSession: string | null;
  selfTest: boolean;
  list: boolean;
  env: 'dev' | 'test' | 'live';
  timeout: number;
  verbose: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {
    targetSession: null,
    selfTest: false,
    list: false,
    env: 'dev',
    timeout: 60_000,
    verbose: false,
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
      case '-h':
      case '--help':
        args.help = true;
        break;
      default:
        if (!arg.startsWith('-') && !args.targetSession) {
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
${bold('COMMS E2E Test')} - Cross-agent communication testing

${bold('Usage:')}
  comms-e2e-test <target-session> [options]
  comms-e2e-test --self [options]
  comms-e2e-test --list

${bold('Commands:')}
  <target-session>     Send test command to specified session (name or ID)
  --self               Test self-communication (send to this session)
  --list               List available local sessions

${bold('Options:')}
  --env <env>          Target environment: ${cyan('dev')} | ${cyan('test')} | ${cyan('live')} (default: dev)
  --timeout <secs>     Response timeout in seconds (default: 60)
  --verbose, -v        Verbose output
  --help, -h           Show this help

${bold('Examples:')}
  ${cyan('comms-e2e-test tender-mongoose')}       Send test to session by name
  ${cyan('comms-e2e-test abc-123')}               Send test to session by ID prefix
  ${cyan('comms-e2e-test --self')}                Test self-communication
  ${cyan('comms-e2e-test --list')}                List available sessions

${bold('Test Workflow:')}
  1. Register this session as an agent on SignalDB
  2. Send a command message to the target session
  3. Wait for the response message (via polling)
  4. Verify the response content

${bold('Requirements:')}
  - Tapestry config at ${cyan('.env.tapestry')} with valid credentials
  - Target session must be active (daemon running)
  - Or use ${cyan('--self')} for self-testing
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
// E2E Test
// ============================================================================

interface TestResult {
  success: boolean;
  messageId?: string;
  responseId?: string;
  responseContent?: string;
  duration?: number;
  error?: string;
}

async function runE2ETest(
  targetSession: string,
  args: CLIArgs
): Promise<TestResult> {
  const startTime = Date.now();
  const verbose = args.verbose;

  // Load config
  const config = loadTapestryConfig(args.env);
  const envConfig = getCurrentEnvironmentConfig(config);

  if (verbose) {
    console.log(dim(`  Environment: ${envConfig.name}`));
    console.log(dim(`  API URL: ${envConfig.apiUrl}`));
    console.log(dim(`  Machine ID: ${envConfig.machineId}`));
  }

  // Create SignalDB client
  const client = new SignalDBClient({
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  });

  // Get session info
  const store = getSessionStore({ skipMachineRegistration: true });
  const thisSessionId = process.env.CLAUDE_SESSION_ID;
  const thisSessionName = thisSessionId ? store.getName(thisSessionId) : undefined;

  if (verbose) {
    console.log(dim(`  This session: ${thisSessionName ?? thisSessionId ?? 'unknown'}`));
  }

  // Resolve target session ID
  let targetSessionId: string;
  const targetInfo = store.getByName(targetSession);
  if (targetInfo) {
    targetSessionId = targetInfo.sessionId;
    if (verbose) {
      console.log(dim(`  Target session: ${targetSession} -> ${targetSessionId.slice(0, 8)}`));
    }
  } else if (store.getBySessionId(targetSession)) {
    targetSessionId = targetSession;
    if (verbose) {
      console.log(dim(`  Target session: ${targetSessionId.slice(0, 8)}`));
    }
  } else {
    // Try partial match
    const sessions = listSessions();
    const match = sessions.find(
      (s) =>
        s.sessionId?.startsWith(targetSession) ||
        s.name.includes(targetSession)
    );
    if (match) {
      targetSessionId = match.sessionId;
      if (verbose) {
        console.log(dim(`  Target session: ${match.name} -> ${targetSessionId.slice(0, 8)}`));
      }
    } else {
      return {
        success: false,
        error: `Session not found: ${targetSession}`,
      };
    }
  }

  // 1. Register this session as an agent
  console.log(dim('  Registering as agent...'));
  let thisAgent;
  try {
    thisAgent = await client.agents.register({
      machineId: envConfig.machineId,
      sessionId: thisSessionId ?? `e2e-test-${Date.now()}`,
      sessionName: thisSessionName ?? 'e2e-test',
      projectPath: process.cwd(),
      capabilities: { test: true },
    });
    if (verbose) {
      console.log(dim(`  Registered agent: ${thisAgent.id.slice(0, 8)}`));
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to register agent: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Create or get a channel for this test
  console.log(dim('  Setting up test channel...'));
  let channel;
  try {
    const channels = await client.channels.list({ type: 'project' });
    channel = channels.find((c) => c.name === 'e2e-test');
    if (!channel) {
      channel = await client.channels.create({
        name: 'e2e-test',
        type: 'project',
        createdBy: thisAgent.id,
      });
      if (verbose) {
        console.log(dim(`  Created channel: ${channel.id.slice(0, 8)}`));
      }
    } else if (verbose) {
      console.log(dim(`  Using existing channel: ${channel.id.slice(0, 8)}`));
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to setup channel: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Send test command to target session
  console.log(dim('  Sending test command...'));
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
    console.log(green(`  Sent message: ${message.id.slice(0, 8)}`));
  } catch (err) {
    return {
      success: false,
      error: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Poll for response
  console.log(dim(`  Waiting for response (timeout: ${args.timeout / 1000}s)...`));
  const pollInterval = 2_000;
  const pollStart = Date.now();

  while (Date.now() - pollStart < args.timeout) {
    try {
      // List all messages and filter for responses in our thread
      const messages = await client.messages.list();
      const responses = messages.filter(
        (m) =>
          m.threadId === message.id &&
          m.messageType === 'response'
      );

      if (responses.length > 0) {
        const response = responses[0]!;
        const duration = Date.now() - startTime;

        console.log(green(`  Response received!`));
        if (verbose) {
          console.log(dim(`  Response ID: ${response.id.slice(0, 8)}`));
          console.log(dim(`  Content: ${response.content?.slice(0, 100)}...`));
        }

        return {
          success: true,
          messageId: message.id,
          responseId: response.id,
          responseContent: response.content,
          duration,
        };
      }

      // Show progress dot
      process.stdout.write(dim('.'));

      await Bun.sleep(pollInterval);
    } catch (err) {
      if (verbose) {
        console.log(yellow(`  Poll error: ${err}`));
      }
    }
  }

  // Timeout
  const duration = Date.now() - startTime;
  console.log('');
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

  // Determine target
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
    console.log(red('Error: Please specify a target session'));
    console.log('Usage: comms-e2e-test <target-session>');
    console.log('       comms-e2e-test --self');
    console.log('       comms-e2e-test --list');
    process.exit(1);
  }

  // Run test
  const result = await runE2ETest(target, args);

  // Report results
  console.log('');
  if (result.success) {
    console.log(green(bold('✓ E2E Test PASSED')));
    console.log(`  Message ID:  ${result.messageId?.slice(0, 8)}`);
    console.log(`  Response ID: ${result.responseId?.slice(0, 8)}`);
    console.log(`  Duration:    ${result.duration}ms`);
    if (args.verbose && result.responseContent) {
      console.log(`  Response:\n${dim(result.responseContent)}`);
    }
  } else {
    console.log(red(bold('✗ E2E Test FAILED')));
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

main().catch((err) => {
  console.error(red(`Fatal error: ${err}`));
  process.exit(1);
});
