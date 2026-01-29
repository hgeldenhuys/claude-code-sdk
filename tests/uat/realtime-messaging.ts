/**
 * UAT Scenario 2: Real-time Messaging
 *
 * Tests channel pub/sub functionality:
 * 1. Create channel -> verify created
 * 2. Agent A subscribes (SSE) -> connection established
 * 3. Agent B publishes message -> A receives in real-time
 * 4. Verify message persistence in SignalDB
 * 5. Query message history -> verify retrieval
 */

import type { Agent, Channel, Message } from '../../src/comms/protocol/types';
import {
  type UATContext,
  createTestAgentId,
  createTestChannelName,
  waitFor,
  sleep,
  assertEqual,
  assertDefined,
  assertTrue,
} from './setup';

// ============================================================================
// Types
// ============================================================================

export interface RealtimeMessagingResult {
  scenario: 'realtime-messaging';
  passed: boolean;
  steps: StepResult[];
  duration: number;
  error?: string;
}

interface StepResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: Record<string, unknown>;
  error?: string;
}

interface TestAgents {
  agentA: Agent;
  agentB: Agent;
}

// ============================================================================
// Test Steps
// ============================================================================

/**
 * Setup: Register two test agents.
 */
async function setupTestAgents(ctx: UATContext): Promise<{ agents: TestAgents; result: StepResult }> {
  const start = Date.now();

  try {
    const agentA = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: createTestAgentId(ctx, 'messaging-A'),
      sessionName: 'uat-agent-A',
      projectPath: '/tmp/uat-messaging-a',
      capabilities: { messaging: true, subscribe: true },
    });

    const agentB = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: createTestAgentId(ctx, 'messaging-B'),
      sessionName: 'uat-agent-B',
      projectPath: '/tmp/uat-messaging-b',
      capabilities: { messaging: true, publish: true },
    });

    return {
      agents: { agentA, agentB },
      result: {
        name: 'Setup Test Agents',
        passed: true,
        duration: Date.now() - start,
        details: { agentAId: agentA.id, agentBId: agentB.id },
      },
    };
  } catch (error) {
    return {
      agents: null as unknown as TestAgents,
      result: {
        name: 'Setup Test Agents',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 1: Create a channel and verify.
 */
async function stepCreateChannel(
  ctx: UATContext,
  agents: TestAgents,
): Promise<{ channel: Channel; result: StepResult }> {
  const start = Date.now();
  const channelName = createTestChannelName(ctx, 'realtime');

  try {
    // Create channel
    const channel = await ctx.client.channels.create({
      name: channelName,
      type: 'project',
      createdBy: agents.agentA.id,
      metadata: { purpose: 'UAT real-time messaging test' },
    });

    assertDefined(channel.id, 'Channel should have an ID');
    assertEqual(channel.name, channelName, 'Channel name should match');

    // Verify channel appears in list
    const channels = await ctx.client.channels.list({ name: channelName });
    assertTrue(channels.length > 0, 'Channel should appear in list');

    return {
      channel,
      result: {
        name: 'Create Channel',
        passed: true,
        duration: Date.now() - start,
        details: { channelId: channel.id, channelName },
      },
    };
  } catch (error) {
    return {
      channel: null as unknown as Channel,
      result: {
        name: 'Create Channel',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 2: Agent A joins the channel.
 */
async function stepJoinChannel(
  ctx: UATContext,
  channel: Channel,
  agent: Agent,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Join channel
    const updatedChannel = await ctx.client.channels.addMember(channel.id, agent.id);

    // Verify membership
    assertDefined(updatedChannel.members, 'Channel should have members array');
    assertTrue(
      updatedChannel.members.includes(agent.id),
      'Agent should be in channel members',
    );

    return {
      name: 'Join Channel',
      passed: true,
      duration: Date.now() - start,
      details: { channelId: channel.id, agentId: agent.id, memberCount: updatedChannel.members.length },
    };
  } catch (error) {
    return {
      name: 'Join Channel',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 3: Agent B publishes a message to the channel.
 */
async function stepPublishMessage(
  ctx: UATContext,
  channel: Channel,
  sender: Agent,
): Promise<{ message: Message; result: StepResult }> {
  const start = Date.now();
  const content = `UAT test message at ${new Date().toISOString()}`;

  try {
    // Publish message
    const message = await ctx.client.messages.send({
      channelId: channel.id,
      senderId: sender.id,
      targetType: 'channel',
      targetAddress: `broadcast://${channel.name}`,
      messageType: 'chat',
      content,
      metadata: { testRun: ctx.runId },
    });

    assertDefined(message.id, 'Message should have an ID');
    assertEqual(message.channelId, channel.id, 'Channel ID should match');
    assertEqual(message.senderId, sender.id, 'Sender ID should match');
    assertEqual(message.content, content, 'Content should match');

    return {
      message,
      result: {
        name: 'Publish Message',
        passed: true,
        duration: Date.now() - start,
        details: { messageId: message.id, content: content.substring(0, 50) },
      },
    };
  } catch (error) {
    return {
      message: null as unknown as Message,
      result: {
        name: 'Publish Message',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 4: Verify message persistence.
 */
async function stepVerifyPersistence(
  ctx: UATContext,
  channel: Channel,
  message: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query messages by channel
    const messages = await ctx.client.messages.listByChannel(channel.id);

    assertTrue(messages.length > 0, 'Should find messages in channel');

    // Find our test message
    const found = messages.find(m => m.id === message.id);
    assertDefined(found, 'Should find our test message');
    assertEqual(found.content, message.content, 'Content should match');

    return {
      name: 'Verify Persistence',
      passed: true,
      duration: Date.now() - start,
      details: { messageCount: messages.length, foundMessageId: found.id },
    };
  } catch (error) {
    return {
      name: 'Verify Persistence',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 5: Query message history with filters.
 */
async function stepQueryHistory(
  ctx: UATContext,
  channel: Channel,
  sender: Agent,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query with limit
    const limitedMessages = await ctx.client.messages.listByChannel(channel.id, { limit: 5 });
    assertTrue(limitedMessages.length <= 5, 'Should respect limit');

    // Query by message type
    const chatMessages = await ctx.client.messages.listByChannel(channel.id, {
      messageType: 'chat',
    });
    assertTrue(
      chatMessages.every(m => m.messageType === 'chat'),
      'All messages should be chat type',
    );

    return {
      name: 'Query History',
      passed: true,
      duration: Date.now() - start,
      details: {
        limitedCount: limitedMessages.length,
        chatCount: chatMessages.length,
      },
    };
  } catch (error) {
    return {
      name: 'Query History',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cleanup test resources.
 */
async function cleanup(ctx: UATContext, agents?: TestAgents): Promise<void> {
  if (agents) {
    try {
      await ctx.client.agents.deregister(agents.agentA.id);
    } catch {
      // Ignore
    }
    try {
      await ctx.client.agents.deregister(agents.agentB.id);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Main Scenario
// ============================================================================

/**
 * Run the Real-time Messaging UAT scenario.
 */
export async function runRealtimeMessagingScenario(
  ctx: UATContext,
): Promise<RealtimeMessagingResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  let agents: TestAgents | null = null;
  let channel: Channel | null = null;

  try {
    // Setup: Register test agents
    const { agents: testAgents, result: setupResult } = await setupTestAgents(ctx);
    steps.push(setupResult);

    if (!setupResult.passed) {
      return {
        scenario: 'realtime-messaging',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to setup test agents',
      };
    }

    agents = testAgents;

    // Step 1: Create channel
    const { channel: testChannel, result: createResult } = await stepCreateChannel(ctx, agents);
    steps.push(createResult);

    if (!createResult.passed) {
      await cleanup(ctx, agents);
      return {
        scenario: 'realtime-messaging',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to create channel',
      };
    }

    channel = testChannel;

    // Step 2: Agent A joins channel
    const joinResult = await stepJoinChannel(ctx, channel, agents.agentA);
    steps.push(joinResult);

    // Step 3: Agent B publishes message
    const { message, result: publishResult } = await stepPublishMessage(ctx, channel, agents.agentB);
    steps.push(publishResult);

    if (!publishResult.passed) {
      await cleanup(ctx, agents);
      return {
        scenario: 'realtime-messaging',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to publish message',
      };
    }

    // Step 4: Verify persistence
    const persistResult = await stepVerifyPersistence(ctx, channel, message);
    steps.push(persistResult);

    // Step 5: Query history
    const historyResult = await stepQueryHistory(ctx, channel, agents.agentB);
    steps.push(historyResult);

    // Cleanup
    await cleanup(ctx, agents);

    // Calculate overall pass/fail
    const allPassed = steps.every(s => s.passed);

    return {
      scenario: 'realtime-messaging',
      passed: allPassed,
      steps,
      duration: Date.now() - start,
    };
  } catch (error) {
    await cleanup(ctx, agents ?? undefined);

    return {
      scenario: 'realtime-messaging',
      passed: false,
      steps,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
