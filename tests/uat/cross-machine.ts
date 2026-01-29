/**
 * UAT Scenario 5: Cross-Machine Communication
 *
 * Tests communication between agents on different machines:
 * 1. Start daemon on Machine A (simulated)
 * 2. Start daemon on Machine B (simulated)
 * 3. Send message A -> B
 * 4. Verify delivery via SSE
 * 5. Send response B -> A
 * 6. Verify bidirectional flow
 *
 * Note: In UAT, we simulate different machines using different machineIds
 * rather than actually running on separate hosts.
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

export interface CrossMachineResult {
  scenario: 'cross-machine';
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

interface SimulatedMachine {
  machineId: string;
  agent: Agent;
}

// ============================================================================
// Test Steps
// ============================================================================

/**
 * Step 1: Setup Machine A (simulated with different machineId).
 */
async function stepSetupMachineA(ctx: UATContext): Promise<{ machine: SimulatedMachine; result: StepResult }> {
  const start = Date.now();
  const machineId = `${ctx.envConfig.machineId}-A`;

  try {
    const agent = await ctx.client.agents.register({
      machineId,
      sessionId: createTestAgentId(ctx, 'machine-A'),
      sessionName: 'uat-machine-A',
      projectPath: '/tmp/uat-cross-a',
      capabilities: { messaging: true, crossMachine: true },
    });

    return {
      machine: { machineId, agent },
      result: {
        name: 'Setup Machine A',
        passed: true,
        duration: Date.now() - start,
        details: { machineId, agentId: agent.id },
      },
    };
  } catch (error) {
    return {
      machine: null as unknown as SimulatedMachine,
      result: {
        name: 'Setup Machine A',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 2: Setup Machine B (simulated with different machineId).
 */
async function stepSetupMachineB(ctx: UATContext): Promise<{ machine: SimulatedMachine; result: StepResult }> {
  const start = Date.now();
  const machineId = `${ctx.envConfig.machineId}-B`;

  try {
    const agent = await ctx.client.agents.register({
      machineId,
      sessionId: createTestAgentId(ctx, 'machine-B'),
      sessionName: 'uat-machine-B',
      projectPath: '/tmp/uat-cross-b',
      capabilities: { messaging: true, crossMachine: true },
    });

    return {
      machine: { machineId, agent },
      result: {
        name: 'Setup Machine B',
        passed: true,
        duration: Date.now() - start,
        details: { machineId, agentId: agent.id },
      },
    };
  } catch (error) {
    return {
      machine: null as unknown as SimulatedMachine,
      result: {
        name: 'Setup Machine B',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 3: Verify machine discovery works across machines.
 */
async function stepVerifyDiscovery(
  ctx: UATContext,
  machineA: SimulatedMachine,
  machineB: SimulatedMachine,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // From Machine A's perspective, discover agents on Machine B
    const agentsOnB = await ctx.client.agents.findByMachineId(machineB.machineId);
    assertTrue(
      agentsOnB.some(a => a.id === machineB.agent.id),
      'Should discover agent on Machine B',
    );

    // From Machine B's perspective, discover agents on Machine A
    const agentsOnA = await ctx.client.agents.findByMachineId(machineA.machineId);
    assertTrue(
      agentsOnA.some(a => a.id === machineA.agent.id),
      'Should discover agent on Machine A',
    );

    // List all active agents across machines
    const allActive = await ctx.client.agents.list({ status: 'active' });
    assertTrue(allActive.length >= 2, 'Should find at least 2 active agents');

    return {
      name: 'Cross-Machine Discovery',
      passed: true,
      duration: Date.now() - start,
      details: {
        agentsOnA: agentsOnA.length,
        agentsOnB: agentsOnB.length,
        totalActive: allActive.length,
      },
    };
  } catch (error) {
    return {
      name: 'Cross-Machine Discovery',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 4: Create a shared channel for cross-machine communication.
 */
async function stepCreateSharedChannel(
  ctx: UATContext,
  machineA: SimulatedMachine,
  machineB: SimulatedMachine,
): Promise<{ channel: Channel; result: StepResult }> {
  const start = Date.now();
  const channelName = createTestChannelName(ctx, 'cross-machine');

  try {
    // Create channel
    const channel = await ctx.client.channels.create({
      name: channelName,
      type: 'broadcast',
      createdBy: machineA.agent.id,
      metadata: { purpose: 'UAT cross-machine test' },
    });

    // Both machines join the channel
    await ctx.client.channels.addMember(channel.id, machineA.agent.id);
    await ctx.client.channels.addMember(channel.id, machineB.agent.id);

    // Verify both are members
    const updatedChannel = await ctx.client.channels.get(channel.id);
    assertTrue(
      updatedChannel.members.includes(machineA.agent.id),
      'Machine A should be a member',
    );
    assertTrue(
      updatedChannel.members.includes(machineB.agent.id),
      'Machine B should be a member',
    );

    return {
      channel,
      result: {
        name: 'Create Shared Channel',
        passed: true,
        duration: Date.now() - start,
        details: {
          channelId: channel.id,
          members: updatedChannel.members,
        },
      },
    };
  } catch (error) {
    return {
      channel: null as unknown as Channel,
      result: {
        name: 'Create Shared Channel',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 5: Send message from Machine A to Machine B.
 */
async function stepSendAtoB(
  ctx: UATContext,
  channel: Channel,
  machineA: SimulatedMachine,
  machineB: SimulatedMachine,
): Promise<{ message: Message; result: StepResult }> {
  const start = Date.now();
  const content = `Cross-machine message A->B at ${new Date().toISOString()}`;

  try {
    const message = await ctx.client.messages.send({
      channelId: channel.id,
      senderId: machineA.agent.id,
      targetType: 'agent',
      targetAddress: `agent://${machineB.machineId}/${machineB.agent.sessionId}`,
      messageType: 'chat',
      content,
      metadata: {
        fromMachine: machineA.machineId,
        toMachine: machineB.machineId,
        testRun: ctx.runId,
      },
    });

    assertDefined(message.id, 'Message should have an ID');
    assertEqual(message.senderId, machineA.agent.id, 'Sender should be Machine A');

    return {
      message,
      result: {
        name: 'Send A → B',
        passed: true,
        duration: Date.now() - start,
        details: {
          messageId: message.id,
          from: machineA.machineId,
          to: machineB.machineId,
        },
      },
    };
  } catch (error) {
    return {
      message: null as unknown as Message,
      result: {
        name: 'Send A → B',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 6: Verify message delivery to Machine B.
 */
async function stepVerifyDeliveryToB(
  ctx: UATContext,
  machineB: SimulatedMachine,
  sentMessage: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query messages for Machine B (pass sessionId since targetAddress uses sessionId)
    const messages = await ctx.client.messages.listForAgent(
      machineB.agent.id,
      undefined,
      machineB.agent.sessionId ?? undefined,
    );

    // Find our test message
    const received = messages.find(m => m.id === sentMessage.id);
    assertDefined(received, 'Machine B should receive the message');
    assertEqual(received.content, sentMessage.content, 'Content should match');

    // Claim the message
    const claimed = await ctx.client.messages.claim(received.id, machineB.agent.id);
    assertEqual(claimed.claimedBy, machineB.agent.id, 'Message should be claimed by B');

    return {
      name: 'Verify Delivery to B',
      passed: true,
      duration: Date.now() - start,
      details: {
        messageId: received.id,
        claimedBy: claimed.claimedBy,
      },
    };
  } catch (error) {
    return {
      name: 'Verify Delivery to B',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 7: Send response from Machine B to Machine A.
 */
async function stepSendBtoA(
  ctx: UATContext,
  channel: Channel,
  machineA: SimulatedMachine,
  machineB: SimulatedMachine,
  originalMessage: Message,
): Promise<{ response: Message; result: StepResult }> {
  const start = Date.now();
  const content = `Response B->A at ${new Date().toISOString()}`;

  try {
    const response = await ctx.client.messages.send({
      channelId: channel.id,
      senderId: machineB.agent.id,
      targetType: 'agent',
      targetAddress: `agent://${machineA.machineId}/${machineA.agent.sessionId}`,
      messageType: 'chat',
      content,
      threadId: originalMessage.id, // Thread to original
      metadata: {
        fromMachine: machineB.machineId,
        toMachine: machineA.machineId,
        inReplyTo: originalMessage.id,
        testRun: ctx.runId,
      },
    });

    assertDefined(response.id, 'Response should have an ID');
    assertEqual(response.threadId, originalMessage.id, 'Should be threaded');

    return {
      response,
      result: {
        name: 'Send B → A',
        passed: true,
        duration: Date.now() - start,
        details: {
          responseId: response.id,
          threadId: response.threadId,
        },
      },
    };
  } catch (error) {
    return {
      response: null as unknown as Message,
      result: {
        name: 'Send B → A',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 8: Verify bidirectional flow.
 */
async function stepVerifyBidirectional(
  ctx: UATContext,
  channel: Channel,
  originalMessage: Message,
  response: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query all messages in the channel
    const allMessages = await ctx.client.messages.listByChannel(channel.id);
    assertTrue(allMessages.length >= 2, 'Should have at least 2 messages');

    // Verify both messages exist
    assertTrue(
      allMessages.some(m => m.id === originalMessage.id),
      'Original message should exist',
    );
    assertTrue(
      allMessages.some(m => m.id === response.id),
      'Response message should exist',
    );

    // Verify thread contains both
    const thread = await ctx.client.messages.listByThread(originalMessage.id);
    assertTrue(
      thread.some(m => m.id === response.id),
      'Thread should contain response',
    );

    return {
      name: 'Verify Bidirectional Flow',
      passed: true,
      duration: Date.now() - start,
      details: {
        totalMessages: allMessages.length,
        threadLength: thread.length,
      },
    };
  } catch (error) {
    return {
      name: 'Verify Bidirectional Flow',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cleanup test resources.
 */
async function cleanup(
  ctx: UATContext,
  machineA?: SimulatedMachine,
  machineB?: SimulatedMachine,
): Promise<void> {
  if (machineA) {
    try {
      await ctx.client.agents.deregister(machineA.agent.id);
    } catch {
      // Ignore
    }
  }
  if (machineB) {
    try {
      await ctx.client.agents.deregister(machineB.agent.id);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Main Scenario
// ============================================================================

/**
 * Run the Cross-Machine Communication UAT scenario.
 */
export async function runCrossMachineScenario(ctx: UATContext): Promise<CrossMachineResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  let machineA: SimulatedMachine | null = null;
  let machineB: SimulatedMachine | null = null;

  try {
    // Step 1: Setup Machine A
    const { machine: machA, result: setupAResult } = await stepSetupMachineA(ctx);
    steps.push(setupAResult);

    if (!setupAResult.passed) {
      return {
        scenario: 'cross-machine',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to setup Machine A',
      };
    }
    machineA = machA;

    // Step 2: Setup Machine B
    const { machine: machB, result: setupBResult } = await stepSetupMachineB(ctx);
    steps.push(setupBResult);

    if (!setupBResult.passed) {
      await cleanup(ctx, machineA);
      return {
        scenario: 'cross-machine',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to setup Machine B',
      };
    }
    machineB = machB;

    // Step 3: Verify discovery
    const discoveryResult = await stepVerifyDiscovery(ctx, machineA, machineB);
    steps.push(discoveryResult);

    // Step 4: Create shared channel
    const { channel, result: channelResult } = await stepCreateSharedChannel(ctx, machineA, machineB);
    steps.push(channelResult);

    if (!channelResult.passed) {
      await cleanup(ctx, machineA, machineB);
      return {
        scenario: 'cross-machine',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to create shared channel',
      };
    }

    // Step 5: Send A -> B
    const { message: sentAtoB, result: sendAtoBResult } = await stepSendAtoB(ctx, channel, machineA, machineB);
    steps.push(sendAtoBResult);

    if (!sendAtoBResult.passed) {
      await cleanup(ctx, machineA, machineB);
      return {
        scenario: 'cross-machine',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to send message A->B',
      };
    }

    // Step 6: Verify delivery to B
    const deliveryResult = await stepVerifyDeliveryToB(ctx, machineB, sentAtoB);
    steps.push(deliveryResult);

    // Step 7: Send B -> A
    const { response, result: sendBtoAResult } = await stepSendBtoA(
      ctx,
      channel,
      machineA,
      machineB,
      sentAtoB,
    );
    steps.push(sendBtoAResult);

    if (sendBtoAResult.passed && response) {
      // Small delay for eventual consistency
      await sleep(200);
      // Step 8: Verify bidirectional
      const biResult = await stepVerifyBidirectional(ctx, channel, sentAtoB, response);
      steps.push(biResult);
    }

    // Cleanup
    await cleanup(ctx, machineA, machineB);

    // Calculate overall pass/fail
    const allPassed = steps.every(s => s.passed);

    return {
      scenario: 'cross-machine',
      passed: allPassed,
      steps,
      duration: Date.now() - start,
    };
  } catch (error) {
    await cleanup(ctx, machineA ?? undefined, machineB ?? undefined);

    return {
      scenario: 'cross-machine',
      passed: false,
      steps,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
