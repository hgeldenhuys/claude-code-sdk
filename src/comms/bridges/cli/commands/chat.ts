/**
 * Chat Subcommand
 *
 * Send a message to an agent and wait for a response.
 * Resolves agents by name (session name, project name, or agent ID).
 *
 * Usage:
 *   comms chat <name-or-address> <message> [--timeout 60] [--json]
 *   comms chat --continue <handle> <message> [--timeout 60] [--json]
 *
 * Name resolution order:
 *   1. Exact session name match (e.g., "witty-bison")
 *   2. Project directory name match (e.g., "realtime-db")
 *   3. Agent ID prefix match (e.g., "3015d1b3")
 *   4. Full agent:// URI passthrough
 *
 * Thread continuation:
 *   --continue <handle>   Continue a previous conversation.
 *                          <handle> can be a threadId (UUID) or agent name.
 *
 * Examples:
 *   comms chat realtime-db "run ls -l"
 *   comms chat witty-bison "what tests are failing?"
 *   comms chat --continue abc-123-def "next question"
 *   comms chat --continue witty-bison "follow up"
 */

import { SignalDBClient } from '../../../client/signaldb';
import { resolveAgent } from '../../../protocol/agent-resolver';
import type { Agent, Message } from '../../../protocol/types';
import {
  bold,
  cyan,
  dim,
  exitWithError,
  getFlagValue,
  gray,
  green,
  hasJsonFlag,
  jsonOutput,
  parseEnvConfig,
  red,
  yellow,
} from '../utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout waiting for response (seconds) */
const DEFAULT_TIMEOUT_S = 60;

/** Poll interval when waiting for response (ms) */
const POLL_INTERVAL_MS = 2000;

/** UUID v4 pattern for detecting thread IDs */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================================
// Execute
// ============================================================================

export async function execute(args: string[]): Promise<void> {
  const isJson = hasJsonFlag(args);
  const timeoutStr = getFlagValue(args, '--timeout');
  const timeoutS = timeoutStr ? parseInt(timeoutStr, 10) : DEFAULT_TIMEOUT_S;
  const continueHandle = getFlagValue(args, '--continue');

  // Filter flags to get positional args
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--json') continue;
    if (arg === '--timeout') { i++; continue; }
    if (arg === '--continue') { i++; continue; }
    positional.push(arg);
  }

  const config = parseEnvConfig();
  const client = new SignalDBClient({
    apiUrl: config.apiUrl,
    projectKey: config.projectKey,
  });

  let agent: Agent;
  let threadId: string | undefined;
  let content: string;

  if (continueHandle) {
    // --continue mode: resolve handle to agent + threadId
    const messageParts = positional;
    if (messageParts.length === 0) {
      exitWithError('Usage: comms chat --continue <handle> <message> [--timeout 60] [--json]');
    }
    content = messageParts.join(' ');

    const resolved = await resolveFromHandle(client, continueHandle);
    if (!resolved) {
      exitWithError(`Could not resolve handle "${continueHandle}". Not a valid threadId or agent name.`);
    }
    agent = resolved.agent;
    threadId = resolved.threadId;
  } else {
    // Normal mode: first positional is the agent name
    const nameOrAddress = positional[0];
    if (!nameOrAddress) {
      exitWithError('Usage: comms chat <name-or-address> <message> [--timeout 60] [--json]');
    }

    const messageParts = positional.slice(1);
    if (messageParts.length === 0) {
      exitWithError('No message provided.');
    }
    content = messageParts.join(' ');

    const resolved = await resolveAgent(client, nameOrAddress);
    if (!resolved) {
      exitWithError(`No active agent found for "${nameOrAddress}". Run 'comms agents' to see available agents.`);
    }
    agent = resolved;
  }

  if (agent.status === 'offline') {
    console.error(yellow(`Warning: ${agent.sessionName ?? agent.id.slice(0, 8)} is offline. Message will be queued.`));
  }

  // Build target address
  const targetAddress = `agent://${agent.machineId}/${agent.sessionName ?? agent.sessionId ?? agent.id}`;

  if (!isJson) {
    console.error(dim(`Sending to ${agent.sessionName ?? agent.id.slice(0, 8)} (${agent.machineId})...`));
  }

  // Send the message (with threadId if continuing)
  const sent = await client.messages.send({
    channelId: '',
    senderId: config.agentId,
    targetType: 'agent',
    targetAddress,
    messageType: 'command',
    content,
    threadId,
  });

  if (!isJson) {
    console.error(dim(`Message sent (${sent.id.slice(0, 8)}). Waiting for response...`));
  }

  // Poll for response
  // When continuing, the threadId stays the same. For new conversations, threadId = sent.id
  const pollThreadId = threadId ?? sent.id;
  const deadline = Date.now() + timeoutS * 1000;

  let response: Message | null = null;

  while (Date.now() < deadline) {
    await Bun.sleep(POLL_INTERVAL_MS);

    const thread = await client.messages.listByThread(pollThreadId);
    // Find a response message newer than our sent message
    for (let i = 0; i < thread.length; i++) {
      const msg = thread[i]!;
      if (msg.id !== sent.id && msg.messageType === 'response') {
        // If continuing, only accept responses after our sent message
        if (msg.createdAt > sent.createdAt) {
          response = msg;
          break;
        }
        // For new threads, any response in the thread works
        if (!threadId) {
          response = msg;
          break;
        }
      }
    }

    if (response) break;
  }

  // Output result with enriched fields
  const responseThreadId = threadId ?? sent.id;

  if (!response) {
    if (isJson) {
      console.log(JSON.stringify({
        status: 'timeout',
        messageId: sent.id,
        threadId: responseThreadId,
        timeoutS,
      }));
    } else {
      console.error(red(`No response within ${timeoutS}s. The agent may still be processing.`));
      console.error(dim(`Message ID: ${sent.id}`));
      console.error(dim(`Thread: ${responseThreadId}`));
    }
    process.exit(1);
  }

  if (isJson) {
    console.log(JSON.stringify({
      status: 'ok',
      messageId: sent.id,
      responseId: response.id,
      threadId: responseThreadId,
      from: agent.sessionName ?? agent.id,
      sessionId: agent.sessionId ?? null,
      content: response.content,
    }, null, 2));
  } else {
    console.log('');
    console.log(bold(cyan(agent.sessionName ?? agent.id.slice(0, 8))) + dim(` (${agent.machineId})`));
    console.log(response.content);
    console.log('');
    console.log(dim(`Thread: ${responseThreadId} | Continue: comms chat --continue ${responseThreadId} "..."`));
  }

  process.exit(0);
}

// ============================================================================
// Handle Resolution (for --continue)
// ============================================================================

/**
 * Resolve a continuation handle to an agent and threadId.
 *
 * Resolution order:
 * 1. If handle is UUID-shaped -> treat as threadId, query thread messages to find remote agent
 * 2. Otherwise -> treat as agent name, resolve normally (new thread from that agent)
 */
async function resolveFromHandle(
  client: SignalDBClient,
  handle: string,
): Promise<{ agent: Agent; threadId: string } | null> {
  // 1. If UUID-shaped, treat as threadId
  if (UUID_PATTERN.test(handle)) {
    const thread = await client.messages.listByThread(handle);
    if (thread.length === 0) {
      // No messages found for this threadId -- maybe it's an agent ID or session ID
      return resolveByAgentIdentifier(client, handle);
    }

    // Find the responding agent from thread messages
    // Look for response messages first, then any message that isn't from the CLI sender
    const agents = await client.agents.list();

    for (let i = 0; i < thread.length; i++) {
      const msg = thread[i]!;
      if (msg.messageType === 'response') {
        // Find which agent sent this response
        const agent = findAgentBySenderId(agents, msg.senderId);
        if (agent) {
          return { agent, threadId: handle };
        }
      }
    }

    // Fallback: use the target address from the original command message
    for (let i = 0; i < thread.length; i++) {
      const msg = thread[i]!;
      if (msg.messageType === 'command' && msg.targetAddress) {
        const agent = findAgentByAddress(agents, msg.targetAddress);
        if (agent) {
          return { agent, threadId: handle };
        }
      }
    }

    return null;
  }

  // 2. Not a UUID -- treat as agent name and resolve normally
  return resolveByAgentIdentifier(client, handle);
}

/**
 * Resolve a non-UUID handle by looking up an agent by name/id.
 * Returns the agent with no threadId (starts a new thread).
 */
async function resolveByAgentIdentifier(
  client: SignalDBClient,
  handle: string,
): Promise<{ agent: Agent; threadId: string } | null> {
  const agent = await resolveAgent(client, handle);
  if (!agent) return null;

  // Look for the most recent thread with this agent to continue
  const messages = await client.messages.list();
  const query = handle.toLowerCase();

  // Find the latest thread involving this agent
  let latestThreadId: string | null = null;
  let latestTime = '';

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (!msg.threadId) continue;

    // Check if this message involves our target agent
    const involvesAgent =
      msg.targetAddress?.includes(agent.sessionName ?? '') ||
      msg.targetAddress?.includes(agent.sessionId ?? '') ||
      msg.targetAddress?.includes(agent.id) ||
      msg.senderId === agent.id;

    if (involvesAgent && msg.createdAt > latestTime) {
      latestTime = msg.createdAt;
      latestThreadId = msg.threadId;
    }
  }

  if (latestThreadId) {
    return { agent, threadId: latestThreadId };
  }

  // No existing thread found -- can't continue without a thread
  return null;
}

// ============================================================================
// Agent Resolution
// ============================================================================

/**
 * Find an agent by sender ID (which may be the agent's database ID).
 */
function findAgentBySenderId(agents: Agent[], senderId: string): Agent | null {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    if (a.id === senderId) return a;
  }
  return null;
}

/**
 * Find an agent by target address (e.g., "agent://m4.local/witty-bison").
 */
function findAgentByAddress(agents: Agent[], address: string): Agent | null {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i]!;
    if (a.sessionName && address.includes(a.sessionName)) return a;
    if (a.sessionId && address.includes(a.sessionId)) return a;
    if (address.includes(a.id)) return a;
  }
  return null;
}

// resolveAgent is now imported from '../../../protocol/agent-resolver'
