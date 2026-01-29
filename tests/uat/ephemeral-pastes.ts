/**
 * UAT Scenario 4: Ephemeral Pastes
 *
 * Tests paste creation with TTL and read-once behavior:
 * 1. Create paste with TTL
 * 2. Read paste -> content returned
 * 3. Wait for TTL expiry
 * 4. Read again -> should fail/empty
 * 5. Create read_once paste
 * 6. Read once -> content returned
 * 7. Read again -> should fail
 */

import type { Agent, Paste } from '../../src/comms/protocol/types';
import {
  type UATContext,
  createTestAgentId,
  sleep,
  assertEqual,
  assertDefined,
  assertTrue,
  assertThrowsAsync,
} from './setup';

// ============================================================================
// Types
// ============================================================================

export interface EphemeralPastesResult {
  scenario: 'ephemeral-pastes';
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

// ============================================================================
// Test Steps
// ============================================================================

/**
 * Setup: Register a test agent.
 */
async function setupTestAgent(ctx: UATContext): Promise<{ agent: Agent; result: StepResult }> {
  const start = Date.now();

  try {
    const agent = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: createTestAgentId(ctx, 'paste-test'),
      sessionName: 'uat-paste-test',
      projectPath: '/tmp/uat-paste',
      capabilities: { paste: true },
    });

    return {
      agent,
      result: {
        name: 'Setup Agent',
        passed: true,
        duration: Date.now() - start,
        details: { agentId: agent.id },
      },
    };
  } catch (error) {
    return {
      agent: null as unknown as Agent,
      result: {
        name: 'Setup Agent',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 1: Create a paste with TTL.
 */
async function stepCreateTTLPaste(
  ctx: UATContext,
  agent: Agent,
): Promise<{ paste: Paste; result: StepResult }> {
  const start = Date.now();
  const content = `TTL paste content created at ${new Date().toISOString()}`;
  const ttlSeconds = 3; // Short TTL for testing

  try {
    const paste = await ctx.client.pastes.create({
      creatorId: agent.id,
      content,
      contentType: 'text/plain',
      accessType: 'ttl',
      ttlSeconds,
    });

    assertDefined(paste.id, 'Paste should have an ID');
    assertEqual(paste.content, content, 'Content should match');
    assertEqual(paste.accessType, 'ttl', 'Access type should be ttl');
    assertDefined(paste.expiresAt, 'Paste should have expiration time');

    return {
      paste,
      result: {
        name: 'Create TTL Paste',
        passed: true,
        duration: Date.now() - start,
        details: {
          pasteId: paste.id,
          ttlSeconds,
          expiresAt: paste.expiresAt,
        },
      },
    };
  } catch (error) {
    return {
      paste: null as unknown as Paste,
      result: {
        name: 'Create TTL Paste',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 2: Read paste before TTL expiry.
 */
async function stepReadBeforeExpiry(
  ctx: UATContext,
  paste: Paste,
  reader: Agent,
): Promise<StepResult> {
  const start = Date.now();

  try {
    const read = await ctx.client.pastes.read(paste.id, reader.id);

    assertDefined(read.content, 'Should be able to read content');
    assertEqual(read.content, paste.content, 'Content should match original');

    return {
      name: 'Read Before Expiry',
      passed: true,
      duration: Date.now() - start,
      details: { contentLength: read.content.length },
    };
  } catch (error) {
    return {
      name: 'Read Before Expiry',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 3: Wait for TTL expiry and verify paste is no longer readable.
 */
async function stepVerifyTTLExpiry(
  ctx: UATContext,
  paste: Paste,
  reader: Agent,
  ttlSeconds: number,
): Promise<StepResult> {
  const start = Date.now();

  try {
    // Wait for TTL to expire (with buffer)
    await sleep((ttlSeconds + 1) * 1000);

    // Try to read - should fail or return expired indicator
    let expired = false;
    try {
      const read = await ctx.client.pastes.read(paste.id, reader.id);
      // Some implementations may return null content or throw
      if (!read.content || read.deletedAt) {
        expired = true;
      }
    } catch (error) {
      // 404 or similar error indicates paste is expired/deleted
      expired = true;
    }

    assertTrue(expired, 'Paste should be expired/unreadable after TTL');

    return {
      name: 'Verify TTL Expiry',
      passed: true,
      duration: Date.now() - start,
      details: { expired: true, waitedMs: (ttlSeconds + 1) * 1000 },
    };
  } catch (error) {
    return {
      name: 'Verify TTL Expiry',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 4: Create a read_once paste.
 */
async function stepCreateReadOncePaste(
  ctx: UATContext,
  agent: Agent,
): Promise<{ paste: Paste; result: StepResult }> {
  const start = Date.now();
  const content = `Read-once paste content: secret-${ctx.runId}`;

  try {
    const paste = await ctx.client.pastes.create({
      creatorId: agent.id,
      content,
      contentType: 'text/plain',
      accessType: 'read_once',
    });

    assertDefined(paste.id, 'Paste should have an ID');
    assertEqual(paste.accessType, 'read_once', 'Access type should be read_once');

    return {
      paste,
      result: {
        name: 'Create Read-Once Paste',
        passed: true,
        duration: Date.now() - start,
        details: { pasteId: paste.id },
      },
    };
  } catch (error) {
    return {
      paste: null as unknown as Paste,
      result: {
        name: 'Create Read-Once Paste',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 5: First read of read_once paste.
 */
async function stepFirstRead(
  ctx: UATContext,
  paste: Paste,
  reader: Agent,
): Promise<StepResult> {
  const start = Date.now();

  try {
    const read = await ctx.client.pastes.read(paste.id, reader.id);

    assertDefined(read.content, 'First read should return content');
    assertEqual(read.content, paste.content, 'Content should match');
    assertDefined(read.readAt, 'readAt should be set after read');
    assertTrue(read.readBy.includes(reader.id), 'readBy should include the reader');

    return {
      name: 'First Read (Success)',
      passed: true,
      duration: Date.now() - start,
      details: {
        readAt: read.readAt,
        readBy: read.readBy,
        contentLength: read.content.length,
      },
    };
  } catch (error) {
    return {
      name: 'First Read (Success)',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 6: Second read of read_once paste should fail.
 */
async function stepSecondReadFails(
  ctx: UATContext,
  paste: Paste,
  reader: Agent,
): Promise<StepResult> {
  const start = Date.now();

  try {
    let failed = false;
    let failureReason = '';

    try {
      const read = await ctx.client.pastes.read(paste.id, reader.id);
      // Some implementations return empty content instead of throwing
      if (!read.content || read.deletedAt) {
        failed = true;
        failureReason = 'Content empty or paste deleted';
      }
    } catch (error) {
      // Expected - paste should be unavailable after first read
      failed = true;
      failureReason = error instanceof Error ? error.message : String(error);
    }

    assertTrue(failed, 'Second read should fail for read_once paste');

    return {
      name: 'Second Read (Fails)',
      passed: true,
      duration: Date.now() - start,
      details: { failedAsExpected: true, reason: failureReason },
    };
  } catch (error) {
    return {
      name: 'Second Read (Fails)',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 7: Test paste listing and filtering.
 */
async function stepListPastes(ctx: UATContext, agent: Agent): Promise<StepResult> {
  const start = Date.now();

  try {
    // Create a few test pastes
    const paste1 = await ctx.client.pastes.create({
      creatorId: agent.id,
      content: 'List test paste 1',
      contentType: 'text/plain',
      accessType: 'ttl',
      ttlSeconds: 300, // 5 minutes
    });

    const paste2 = await ctx.client.pastes.create({
      creatorId: agent.id,
      content: 'List test paste 2',
      contentType: 'application/json',
      accessType: 'ttl',
      ttlSeconds: 300,
    });

    // List pastes for agent
    const pastes = await ctx.client.pastes.listForAgent(agent.id);
    assertTrue(pastes.length >= 2, 'Should find at least 2 pastes');

    // Verify our test pastes are in the list
    const ids = pastes.map(p => p.id);
    assertTrue(ids.includes(paste1.id), 'List should include paste 1');
    assertTrue(ids.includes(paste2.id), 'List should include paste 2');

    // Cleanup
    await ctx.client.pastes.delete(paste1.id);
    await ctx.client.pastes.delete(paste2.id);

    return {
      name: 'List Pastes',
      passed: true,
      duration: Date.now() - start,
      details: { totalPastes: pastes.length },
    };
  } catch (error) {
    return {
      name: 'List Pastes',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Cleanup test resources.
 */
async function cleanup(ctx: UATContext, agent?: Agent): Promise<void> {
  if (agent) {
    try {
      await ctx.client.agents.deregister(agent.id);
    } catch {
      // Ignore
    }
  }
}

// ============================================================================
// Main Scenario
// ============================================================================

/**
 * Run the Ephemeral Pastes UAT scenario.
 */
export async function runEphemeralPastesScenario(ctx: UATContext): Promise<EphemeralPastesResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  let agent: Agent | null = null;
  const ttlSeconds = 3;

  try {
    // Setup: Register agent
    const { agent: testAgent, result: setupResult } = await setupTestAgent(ctx);
    steps.push(setupResult);

    if (!setupResult.passed) {
      return {
        scenario: 'ephemeral-pastes',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed to setup test agent',
      };
    }

    agent = testAgent;

    // Step 1: Create TTL paste
    const { paste: ttlPaste, result: createTTLResult } = await stepCreateTTLPaste(ctx, agent);
    steps.push(createTTLResult);

    if (createTTLResult.passed && ttlPaste) {
      // Step 2: Read before expiry
      const readBeforeResult = await stepReadBeforeExpiry(ctx, ttlPaste, agent);
      steps.push(readBeforeResult);

      // Step 3: Verify TTL expiry
      const expiryResult = await stepVerifyTTLExpiry(ctx, ttlPaste, agent, ttlSeconds);
      steps.push(expiryResult);
    }

    // Step 4: Create read_once paste
    const { paste: readOncePaste, result: createReadOnceResult } = await stepCreateReadOncePaste(ctx, agent);
    steps.push(createReadOnceResult);

    if (createReadOnceResult.passed && readOncePaste) {
      // Step 5: First read succeeds
      const firstReadResult = await stepFirstRead(ctx, readOncePaste, agent);
      steps.push(firstReadResult);

      // Step 6: Second read fails
      const secondReadResult = await stepSecondReadFails(ctx, readOncePaste, agent);
      steps.push(secondReadResult);
    }

    // Step 7: List pastes
    const listResult = await stepListPastes(ctx, agent);
    steps.push(listResult);

    // Cleanup
    await cleanup(ctx, agent);

    // Calculate overall pass/fail
    const allPassed = steps.every(s => s.passed);

    return {
      scenario: 'ephemeral-pastes',
      passed: allPassed,
      steps,
      duration: Date.now() - start,
    };
  } catch (error) {
    await cleanup(ctx, agent ?? undefined);

    return {
      scenario: 'ephemeral-pastes',
      passed: false,
      steps,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
