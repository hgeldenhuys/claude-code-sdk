#!/usr/bin/env bun
/**
 * COMMS Demo Script
 *
 * Interactive demonstration of Tapestry COMMS capabilities.
 *
 * Usage:
 *   comms-demo agents      Watch agents come online/offline in real-time
 *   comms-demo chat        Interactive chat between two simulated agents
 *   comms-demo broadcast   Broadcast message to all agents
 *   comms-demo memos       Send and receive memos
 *   comms-demo pastes      Create and share ephemeral content
 *   comms-demo full        Full demo of all capabilities
 */

import { SignalDBClient } from '../src/comms/client/signaldb';
import {
  loadTapestryConfig,
  getEnvironmentConfig,
  type TapestryEnvironment,
} from '../src/comms/config/environments';
import type { Agent, Channel, Message, Paste } from '../src/comms/protocol/types';
import { derivePresence } from '../src/comms/protocol/presence';

// ============================================================================
// Colors
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
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

function magenta(s: string): string {
  return `${colors.magenta}${s}${colors.reset}`;
}

function dim(s: string): string {
  return `${colors.dim}${s}${colors.reset}`;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(): string {
  return new Date().toLocaleTimeString();
}

function getFlag(args: string[], flag: string): boolean {
  return args.includes(`--${flag}`) || args.includes(`-${flag.charAt(0)}`);
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.findIndex(a => a === `--${flag}` || a === `-${flag.charAt(0)}`);
  if (index !== -1 && index < args.length - 1) {
    return args[index + 1];
  }
  return undefined;
}

function getEnv(args: string[]): TapestryEnvironment {
  const env = getFlagValue(args, 'env');
  if (env && ['dev', 'test', 'live'].includes(env)) {
    return env as TapestryEnvironment;
  }
  return 'dev';
}

// ============================================================================
// Demo Context
// ============================================================================

interface DemoContext {
  client: SignalDBClient;
  env: TapestryEnvironment;
  agents: Agent[];
  channels: Channel[];
  cleanup: () => Promise<void>;
}

async function createDemoContext(env: TapestryEnvironment): Promise<DemoContext> {
  const envConfig = getEnvironmentConfig(env);
  const client = new SignalDBClient({
    apiUrl: envConfig.apiUrl,
    projectKey: envConfig.projectKey,
  });

  const agents: Agent[] = [];
  const channels: Channel[] = [];

  const cleanup = async () => {
    console.log(dim('\nCleaning up demo resources...'));
    for (const agent of agents) {
      try {
        await client.agents.deregister(agent.id);
      } catch {
        // Ignore cleanup errors
      }
    }
    console.log(green('Cleanup complete.\n'));
  };

  return { client, env, agents, channels, cleanup };
}

// ============================================================================
// Demo: Agents
// ============================================================================

async function demoAgents(ctx: DemoContext): Promise<void> {
  console.log(bold('\n=== Agent Discovery Demo ===\n'));

  // Register some demo agents
  console.log(cyan('Registering demo agents...'));

  const agentNames = ['alpha', 'beta', 'gamma'];

  for (const name of agentNames) {
    const agent = await ctx.client.agents.register({
      machineId: `demo-machine`,
      sessionId: `demo-${name}-${Date.now()}`,
      sessionName: `demo-${name}`,
      projectPath: `/demo/${name}`,
      capabilities: { demo: true, role: name },
    });
    ctx.agents.push(agent);
    console.log(`  ${green('+')} Agent ${cyan(name)} registered (${dim(agent.id.slice(0, 8))}...)`);
    await sleep(500);
  }

  // List all agents
  console.log(cyan('\nDiscovering agents...'));
  const allAgents = await ctx.client.agents.list({ status: 'active' });

  console.log(bold('\nActive Agents:'));
  console.log('─'.repeat(60));

  for (const agent of allAgents) {
    const presence = derivePresence(agent.heartbeatAt);
    const presenceIcon = presence === 'active' ? green('●') : presence === 'idle' ? yellow('●') : red('○');
    const name = agent.sessionName || 'unnamed';
    console.log(`  ${presenceIcon} ${name.padEnd(15)} ${dim(agent.machineId.padEnd(15))} ${dim(agent.projectPath || '')}`);
  }

  console.log('─'.repeat(60));
  console.log(`  Total: ${allAgents.length} agent(s)\n`);

  // Simulate heartbeats
  console.log(cyan('Simulating heartbeats...'));
  for (let i = 0; i < 3; i++) {
    for (const agent of ctx.agents) {
      await ctx.client.agents.heartbeat(agent.id);
    }
    console.log(`  ${formatTime()} ${green('♥')} Heartbeats sent`);
    await sleep(1000);
  }
}

// ============================================================================
// Demo: Chat
// ============================================================================

async function demoChat(ctx: DemoContext): Promise<void> {
  console.log(bold('\n=== Chat Demo ===\n'));

  // Register two agents
  const alice = await ctx.client.agents.register({
    machineId: 'demo-machine',
    sessionId: `demo-alice-${Date.now()}`,
    sessionName: 'alice',
    projectPath: '/demo/alice',
    capabilities: { chat: true },
  });
  ctx.agents.push(alice);
  console.log(`  ${green('+')} ${cyan('Alice')} joined`);

  const bob = await ctx.client.agents.register({
    machineId: 'demo-machine',
    sessionId: `demo-bob-${Date.now()}`,
    sessionName: 'bob',
    projectPath: '/demo/bob',
    capabilities: { chat: true },
  });
  ctx.agents.push(bob);
  console.log(`  ${green('+')} ${cyan('Bob')} joined`);

  // Create a channel
  const channel = await ctx.client.channels.create({
    name: `demo-chat-${Date.now()}`,
    type: 'project',
    createdBy: alice.id,
  });
  ctx.channels.push(channel);
  console.log(`  ${green('+')} Channel ${cyan(channel.name)} created`);

  // Both join the channel
  await ctx.client.channels.addMember(channel.id, alice.id);
  await ctx.client.channels.addMember(channel.id, bob.id);

  // Simulate a conversation
  console.log(bold('\nConversation:'));
  console.log('─'.repeat(60));

  const messages = [
    { sender: alice, name: 'Alice', text: 'Hey Bob! How are you?' },
    { sender: bob, name: 'Bob', text: "Hi Alice! I'm doing great, thanks!" },
    { sender: alice, name: 'Alice', text: "That's wonderful. Did you finish the project?" },
    { sender: bob, name: 'Bob', text: 'Yes! Just pushed the final commit.' },
    { sender: alice, name: 'Alice', text: 'Awesome! Let me take a look.' },
  ];

  for (const msg of messages) {
    await ctx.client.messages.send({
      channelId: channel.id,
      senderId: msg.sender.id,
      targetType: 'channel',
      targetAddress: `broadcast://${channel.name}`,
      messageType: 'chat',
      content: msg.text,
    });

    const senderColor = msg.name === 'Alice' ? magenta : cyan;
    console.log(`  ${dim(formatTime())} ${senderColor(msg.name.padEnd(8))} ${msg.text}`);
    await sleep(1000);
  }

  console.log('─'.repeat(60));
  console.log(dim(`  ${messages.length} messages sent\n`));
}

// ============================================================================
// Demo: Broadcast
// ============================================================================

async function demoBroadcast(ctx: DemoContext): Promise<void> {
  console.log(bold('\n=== Broadcast Demo ===\n'));

  // Create several agents
  const agents: Agent[] = [];
  const agentNames = ['node-1', 'node-2', 'node-3', 'node-4'];

  console.log(cyan('Setting up broadcast nodes...'));
  for (const name of agentNames) {
    const agent = await ctx.client.agents.register({
      machineId: 'demo-machine',
      sessionId: `demo-${name}-${Date.now()}`,
      sessionName: name,
      projectPath: `/demo/${name}`,
      capabilities: { broadcast: true },
    });
    agents.push(agent);
    ctx.agents.push(agent);
    console.log(`  ${green('+')} ${cyan(name)} online`);
  }

  // Create broadcast channel
  const firstAgent = agents[0];
  if (!firstAgent) {
    throw new Error('No agents created');
  }

  const channel = await ctx.client.channels.create({
    name: `demo-broadcast-${Date.now()}`,
    type: 'broadcast',
    createdBy: firstAgent.id,
  });
  ctx.channels.push(channel);

  // All agents join
  for (const agent of agents) {
    await ctx.client.channels.addMember(channel.id, agent.id);
  }

  console.log(cyan(`\nBroadcast channel: ${channel.name}`));
  console.log(dim(`Members: ${agents.map(a => a.sessionName).join(', ')}\n`));

  // Send broadcast messages
  console.log(bold('Broadcasting messages:'));
  console.log('─'.repeat(60));

  const announcements = [
    'System update scheduled for 10:00 PM',
    'New feature deployed: Real-time notifications',
    'Weekly report available in shared drive',
  ];

  for (const announcement of announcements) {
    await ctx.client.messages.send({
      channelId: channel.id,
      senderId: firstAgent.id,
      targetType: 'channel',
      targetAddress: `broadcast://${channel.name}`,
      messageType: 'chat',
      content: announcement,
    });

    console.log(`  ${dim(formatTime())} ${yellow('BROADCAST')} ${announcement}`);
    console.log(dim(`                  Delivered to: ${agents.map(a => a.sessionName).join(', ')}`));
    await sleep(1500);
  }

  console.log('─'.repeat(60));
}

// ============================================================================
// Demo: Memos
// ============================================================================

async function demoMemos(ctx: DemoContext): Promise<void> {
  console.log(bold('\n=== Memo Demo ===\n'));

  // Create sender and recipient
  const sender = await ctx.client.agents.register({
    machineId: 'demo-machine',
    sessionId: `demo-memo-sender-${Date.now()}`,
    sessionName: 'project-lead',
    projectPath: '/demo/lead',
    capabilities: { memo: true },
  });
  ctx.agents.push(sender);

  const recipient = await ctx.client.agents.register({
    machineId: 'demo-machine',
    sessionId: `demo-memo-recipient-${Date.now()}`,
    sessionName: 'developer',
    projectPath: '/demo/dev',
    capabilities: { memo: true },
  });
  ctx.agents.push(recipient);

  console.log(`  ${cyan('project-lead')} -> ${cyan('developer')}`);

  // Send a memo
  console.log(bold('\nComposing memo...'));

  const memoContent = {
    subject: 'Code Review Request',
    body: 'Please review the authentication module changes in PR #42. Key areas to focus on: security, performance, and error handling.',
    category: 'action-item',
    priority: 'P1',
  };

  const memo = await ctx.client.messages.send({
    channelId: null as unknown as string,
    senderId: sender.id,
    targetType: 'agent',
    targetAddress: `agent://demo-machine/${recipient.sessionId}`,
    messageType: 'memo',
    content: JSON.stringify(memoContent),
    metadata: {
      memoSubject: memoContent.subject,
      memoCategory: memoContent.category,
      memoPriority: memoContent.priority,
    },
  });

  console.log(`
┌─────────────────────────────────────────────────────────────┐
│ ${bold('MEMO')}                                                       │
├─────────────────────────────────────────────────────────────┤
│ From: ${cyan('project-lead')}                                         │
│ To:   ${cyan('developer')}                                            │
│ Priority: ${red('P1')} (High)                                         │
├─────────────────────────────────────────────────────────────┤
│ Subject: ${bold(memoContent.subject)}                              │
├─────────────────────────────────────────────────────────────┤
│ ${memoContent.body.substring(0, 59)} │
│ ${memoContent.body.substring(59, 118) || ''}${' '.repeat(Math.max(0, 60 - (memoContent.body.substring(59, 118) || '').length))}│
└─────────────────────────────────────────────────────────────┘
`);

  // Claim the memo
  await sleep(1000);
  console.log(cyan('Developer claims memo...'));
  await ctx.client.messages.claim(memo.id, recipient.id);
  console.log(`  ${green('✓')} Memo claimed by developer`);

  // Update status
  await sleep(500);
  await ctx.client.messages.updateStatus(memo.id, 'delivered');
  console.log(`  ${green('✓')} Status: delivered`);

  await sleep(500);
  await ctx.client.messages.updateStatus(memo.id, 'read');
  console.log(`  ${green('✓')} Status: read`);
}

// ============================================================================
// Demo: Pastes
// ============================================================================

async function demoPastes(ctx: DemoContext): Promise<void> {
  console.log(bold('\n=== Ephemeral Pastes Demo ===\n'));

  // Create agent
  const agent = await ctx.client.agents.register({
    machineId: 'demo-machine',
    sessionId: `demo-paste-${Date.now()}`,
    sessionName: 'paste-demo',
    projectPath: '/demo/paste',
    capabilities: { paste: true },
  });
  ctx.agents.push(agent);

  // Create TTL paste
  console.log(cyan('Creating TTL paste (expires in 30s)...'));

  const ttlPaste = await ctx.client.pastes.create({
    creatorId: agent.id,
    content: `# API Key
sk-demo-12345-abcde-67890

Note: This key expires in 30 seconds!`,
    contentType: 'text/markdown',
    accessType: 'ttl',
    ttlSeconds: 30,
  });

  console.log(`
  ${bold('TTL Paste Created')}
  ID: ${dim(ttlPaste.id.slice(0, 16))}...
  Expires: ${yellow('30 seconds')}
  Content type: text/markdown
`);

  // Create read-once paste
  console.log(cyan('Creating read-once paste...'));

  const readOncePaste = await ctx.client.pastes.create({
    creatorId: agent.id,
    content: `Temporary password: xK9#mP2$nQ7@

This paste will self-destruct after reading!`,
    contentType: 'text/plain',
    accessType: 'read_once',
  });

  console.log(`
  ${bold('Read-Once Paste Created')}
  ID: ${dim(readOncePaste.id.slice(0, 16))}...
  Access: ${red('Single read only')}
  Content type: text/plain
`);

  // Read the read-once paste
  console.log(cyan('Reading read-once paste...'));
  const read = await ctx.client.pastes.read(readOncePaste.id, agent.id);
  console.log(`  ${green('✓')} Content retrieved`);
  console.log(`  ${red('✗')} Paste is now destroyed\n`);

  // Try to read again (should fail)
  console.log(cyan('Attempting to read again...'));
  try {
    await ctx.client.pastes.read(readOncePaste.id, agent.id);
    console.log(`  ${yellow('?')} Paste still accessible (server may not enforce)`);
  } catch {
    console.log(`  ${green('✓')} Correctly rejected - paste no longer exists\n`);
  }
}

// ============================================================================
// Demo: Full
// ============================================================================

async function demoFull(ctx: DemoContext): Promise<void> {
  console.log(bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(bold('║          TAPESTRY COMMS - FULL DEMONSTRATION                 ║'));
  console.log(bold('╚══════════════════════════════════════════════════════════════╝\n'));

  console.log(dim('Tapestry is the flagship identity for AI orchestration:'));
  console.log(dim('  - Loom:    Workflow threads (story management)'));
  console.log(dim('  - Weave:   Knowledge fabric (institutional memory)'));
  console.log(dim('  - COMMS:   Signal threads (agent communication)'));
  console.log(dim('  - Tapestry: The complete strategic picture (CIO-AI)\n'));

  console.log(`Environment: ${cyan(ctx.env)}`);
  console.log(dim('Press Ctrl+C to stop the demo at any time.\n'));

  await sleep(2000);

  // Run all demos
  await demoAgents(ctx);
  await sleep(1000);

  await demoChat(ctx);
  await sleep(1000);

  await demoBroadcast(ctx);
  await sleep(1000);

  await demoMemos(ctx);
  await sleep(1000);

  await demoPastes(ctx);

  console.log(bold('\n╔══════════════════════════════════════════════════════════════╗'));
  console.log(bold('║                  DEMONSTRATION COMPLETE                      ║'));
  console.log(bold('╚══════════════════════════════════════════════════════════════╝\n'));

  console.log('For more information:');
  console.log(`  - Run ${cyan('comms-uat run all')} to execute UAT scenarios`);
  console.log(`  - Run ${cyan('comms-dashboard')} to monitor in real-time`);
  console.log(`  - Check ${cyan('.env.tapestry')} for environment configuration\n`);
}

// ============================================================================
// Help
// ============================================================================

function showHelp(): void {
  console.log(`
${bold('COMMS Demo')} - Interactive Tapestry Demonstration

${bold('Usage:')}
  comms-demo <mode> [--env <env>]

${bold('Modes:')}
  ${cyan('agents')}      Watch agents come online/offline
  ${cyan('chat')}        Interactive chat between two agents
  ${cyan('broadcast')}   Broadcast messages to all agents
  ${cyan('memos')}       Send and receive async memos
  ${cyan('pastes')}      Create and share ephemeral content
  ${cyan('full')}        Full demo of all capabilities

${bold('Options:')}
  --env <env>   Target environment: ${cyan('dev')} | ${cyan('test')} | ${cyan('live')} (default: dev)
  --help, -h    Show this help message

${bold('Examples:')}
  comms-demo full --env dev
  comms-demo chat --env test
  comms-demo agents
`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.find(a => !a.startsWith('-'));

  if (getFlag(args, 'help') || getFlag(args, 'h') || !mode) {
    showHelp();
    return;
  }

  const env = getEnv(args);

  let ctx: DemoContext;
  try {
    ctx = await createDemoContext(env);
  } catch (error) {
    console.log(red(`\nError: Cannot connect to ${env} environment.`));
    console.log(dim('Make sure .env.tapestry is configured with valid credentials.\n'));
    process.exit(1);
  }

  // Handle cleanup on exit
  const handleExit = async () => {
    await ctx.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);

  try {
    switch (mode) {
      case 'agents':
        await demoAgents(ctx);
        break;
      case 'chat':
        await demoChat(ctx);
        break;
      case 'broadcast':
        await demoBroadcast(ctx);
        break;
      case 'memos':
        await demoMemos(ctx);
        break;
      case 'pastes':
        await demoPastes(ctx);
        break;
      case 'full':
        await demoFull(ctx);
        break;
      default:
        console.log(red(`Unknown mode: ${mode}`));
        showHelp();
        process.exit(1);
    }
  } finally {
    await ctx.cleanup();
  }
}

main().catch(error => {
  console.error(red(`Fatal error: ${error}`));
  process.exit(1);
});
