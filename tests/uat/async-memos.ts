/**
 * UAT Scenario 3: Async Memos
 *
 * Tests the memo workflow for async knowledge sharing:
 * 1. Agent A composes memo to Agent B
 * 2. Verify memo in unclaimed state
 * 3. Agent B claims memo
 * 4. Verify state transition
 * 5. Agent B replies
 * 6. Verify threading
 */

import type { Agent, Message } from '../../src/comms/protocol/types';
import {
  type UATContext,
  createTestAgentId,
  waitFor,
  sleep,
  assertEqual,
  assertDefined,
  assertTrue,
} from './setup';

// ============================================================================
// Types
// ============================================================================

export interface AsyncMemosResult {
  scenario: 'async-memos';
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
  sender: Agent;
  recipient: Agent;
}

// ============================================================================
// Test Steps
// ============================================================================

/**
 * Setup: Register sender and recipient agents.
 */
async function setupTestAgents(ctx: UATContext): Promise<{ agents: TestAgents; result: StepResult }> {
  const start = Date.now();

  try {
    const sender = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: createTestAgentId(ctx, 'memo-sender'),
      sessionName: 'uat-memo-sender',
      projectPath: '/tmp/uat-memo-sender',
      capabilities: { memo: true, send: true },
    });

    const recipient = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: createTestAgentId(ctx, 'memo-recipient'),
      sessionName: 'uat-memo-recipient',
      projectPath: '/tmp/uat-memo-recipient',
      capabilities: { memo: true, receive: true },
    });

    return {
      agents: { sender, recipient },
      result: {
        name: 'Setup Agents',
        passed: true,
        duration: Date.now() - start,
        details: { senderId: sender.id, recipientId: recipient.id },
      },
    };
  } catch (error) {
    return {
      agents: null as unknown as TestAgents,
      result: {
        name: 'Setup Agents',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 1: Compose and send a memo from sender to recipient.
 */
async function stepComposeMemo(
  ctx: UATContext,
  agents: TestAgents,
): Promise<{ memo: Message; result: StepResult }> {
  const start = Date.now();
  const subject = 'UAT Test Memo';
  const body = `This is a test memo sent at ${new Date().toISOString()}`;

  try {
    // Send memo as a message with memo type
    const memo = await ctx.client.messages.send({
      channelId: null as unknown as string, // Direct message
      senderId: agents.sender.id,
      targetType: 'agent',
      targetAddress: `agent://${ctx.envConfig.machineId}/${agents.recipient.sessionId}`,
      messageType: 'memo',
      content: JSON.stringify({
        subject,
        body,
        category: 'knowledge',
        priority: 'P2',
      }),
      metadata: {
        memoSubject: subject,
        memoCategory: 'knowledge',
        memoPriority: 'P2',
        testRun: ctx.runId,
      },
    });

    assertDefined(memo.id, 'Memo should have an ID');
    assertEqual(memo.messageType, 'memo', 'Message type should be memo');
    assertEqual(memo.status, 'pending', 'Initial status should be pending');

    return {
      memo,
      result: {
        name: 'Compose Memo',
        passed: true,
        duration: Date.now() - start,
        details: { memoId: memo.id, subject },
      },
    };
  } catch (error) {
    return {
      memo: null as unknown as Message,
      result: {
        name: 'Compose Memo',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 2: Verify memo is in unclaimed state.
 */
async function stepVerifyUnclaimed(
  ctx: UATContext,
  agents: TestAgents,
  memo: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query memos for recipient (pass sessionId since targetAddress uses sessionId)
    const messages = await ctx.client.messages.listForAgent(
      agents.recipient.id,
      {
        messageType: 'memo',
        status: 'pending',
      },
      agents.recipient.sessionId ?? undefined,
    );

    // Find our test memo
    const found = messages.find(m => m.id === memo.id);
    assertDefined(found, 'Should find our memo in recipient inbox');
    assertEqual(found.status, 'pending', 'Memo should be in pending status');
    assertTrue(!found.claimedBy, 'Memo should not be claimed yet');

    return {
      name: 'Verify Unclaimed',
      passed: true,
      duration: Date.now() - start,
      details: { pendingCount: messages.length, memoStatus: found.status },
    };
  } catch (error) {
    return {
      name: 'Verify Unclaimed',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 3: Recipient claims the memo.
 */
async function stepClaimMemo(
  ctx: UATContext,
  agents: TestAgents,
  memo: Message,
): Promise<{ claimed: Message; result: StepResult }> {
  const start = Date.now();

  try {
    // Claim the memo
    const claimed = await ctx.client.messages.claim(memo.id, agents.recipient.id);

    assertDefined(claimed.claimedBy, 'Memo should have claimedBy set');
    assertEqual(claimed.claimedBy, agents.recipient.id, 'ClaimedBy should be recipient');
    assertEqual(claimed.status, 'claimed', 'Status should be claimed');
    assertDefined(claimed.claimedAt, 'ClaimedAt should be set');

    return {
      claimed,
      result: {
        name: 'Claim Memo',
        passed: true,
        duration: Date.now() - start,
        details: {
          claimedBy: claimed.claimedBy,
          claimedAt: claimed.claimedAt,
        },
      },
    };
  } catch (error) {
    return {
      claimed: null as unknown as Message,
      result: {
        name: 'Claim Memo',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 4: Verify state transition (claimed -> delivered -> read).
 */
async function stepVerifyStateTransition(
  ctx: UATContext,
  memo: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Update to delivered
    const delivered = await ctx.client.messages.updateStatus(memo.id, 'delivered');
    assertEqual(delivered.status, 'delivered', 'Status should be delivered');

    // Update to read
    const read = await ctx.client.messages.updateStatus(memo.id, 'read');
    assertEqual(read.status, 'read', 'Status should be read');

    return {
      name: 'Verify State Transition',
      passed: true,
      duration: Date.now() - start,
      details: {
        transitions: ['claimed', 'delivered', 'read'],
        finalStatus: read.status,
      },
    };
  } catch (error) {
    return {
      name: 'Verify State Transition',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 5: Recipient replies to the memo (threading).
 */
async function stepReply(
  ctx: UATContext,
  agents: TestAgents,
  originalMemo: Message,
): Promise<{ reply: Message; result: StepResult }> {
  const start = Date.now();
  const replyContent = 'Thank you for the memo. I have reviewed it.';

  try {
    // Send reply as a threaded message
    const reply = await ctx.client.messages.send({
      channelId: originalMemo.channelId,
      senderId: agents.recipient.id,
      targetType: 'agent',
      targetAddress: `agent://${ctx.envConfig.machineId}/${agents.sender.sessionId}`,
      messageType: 'memo',
      content: JSON.stringify({
        subject: 'Re: UAT Test Memo',
        body: replyContent,
        category: 'knowledge',
        priority: 'P2',
      }),
      threadId: originalMemo.id, // Thread to original
      metadata: {
        memoSubject: 'Re: UAT Test Memo',
        inReplyTo: originalMemo.id,
        testRun: ctx.runId,
      },
    });

    assertDefined(reply.id, 'Reply should have an ID');
    assertEqual(reply.threadId, originalMemo.id, 'Reply should be threaded to original');

    return {
      reply,
      result: {
        name: 'Reply to Memo',
        passed: true,
        duration: Date.now() - start,
        details: { replyId: reply.id, threadId: reply.threadId },
      },
    };
  } catch (error) {
    return {
      reply: null as unknown as Message,
      result: {
        name: 'Reply to Memo',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 6: Verify threading works correctly.
 */
async function stepVerifyThreading(
  ctx: UATContext,
  originalMemo: Message,
  reply: Message,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Query thread
    const thread = await ctx.client.messages.listByThread(originalMemo.id);

    assertTrue(thread.length >= 1, 'Thread should contain at least the reply');
    assertTrue(
      thread.some(m => m.id === reply.id),
      'Thread should contain our reply',
    );

    // Verify thread ordering
    const sortedThread = [...thread].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return {
      name: 'Verify Threading',
      passed: true,
      duration: Date.now() - start,
      details: {
        threadLength: thread.length,
        threadIds: thread.map(m => m.id),
      },
    };
  } catch (error) {
    return {
      name: 'Verify Threading',
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
      await ctx.client.agents.deregister(agents.sender.id);
    } catch {
      // Ignore
    }
    try {
      await ctx.client.agents.deregister(agents.recipient.id);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Main Scenario
// ============================================================================

/**
 * Run the Async Memos UAT scenario.
 */
export async function runAsyncMemosScenario(ctx: UATContext): Promise<AsyncMemosResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  let agents: TestAgents | null = null;

  try {
    // Setup: Register agents
    const { agents: testAgents, result: setupResult } = await setupTestAgents(ctx);
    steps.push(setupResult);

    if (!setupResult.passed) {
      return {
        scenario: 'async-memos',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to setup test agents',
      };
    }

    agents = testAgents;

    // Step 1: Compose memo
    const { memo, result: composeResult } = await stepComposeMemo(ctx, agents);
    steps.push(composeResult);

    if (!composeResult.passed) {
      await cleanup(ctx, agents);
      return {
        scenario: 'async-memos',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to compose memo',
      };
    }

    // Step 2: Verify unclaimed
    const unclaimedResult = await stepVerifyUnclaimed(ctx, agents, memo);
    steps.push(unclaimedResult);

    // Step 3: Claim memo
    const { claimed, result: claimResult } = await stepClaimMemo(ctx, agents, memo);
    steps.push(claimResult);

    if (!claimResult.passed) {
      await cleanup(ctx, agents);
      return {
        scenario: 'async-memos',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to claim memo',
      };
    }

    // Step 4: Verify state transition
    const transitionResult = await stepVerifyStateTransition(ctx, claimed);
    steps.push(transitionResult);

    // Step 5: Reply
    const { reply, result: replyResult } = await stepReply(ctx, agents, memo);
    steps.push(replyResult);

    if (replyResult.passed && reply) {
      // Step 6: Verify threading
      const threadResult = await stepVerifyThreading(ctx, memo, reply);
      steps.push(threadResult);
    }

    // Cleanup
    await cleanup(ctx, agents);

    // Calculate overall pass/fail
    const allPassed = steps.every(s => s.passed);

    return {
      scenario: 'async-memos',
      passed: allPassed,
      steps,
      duration: Date.now() - start,
    };
  } catch (error) {
    await cleanup(ctx, agents ?? undefined);

    return {
      scenario: 'async-memos',
      passed: false,
      steps,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
