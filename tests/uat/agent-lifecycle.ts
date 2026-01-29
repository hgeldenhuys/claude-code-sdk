/**
 * UAT Scenario 1: Agent Lifecycle
 *
 * Tests the complete agent lifecycle:
 * 1. Register agent -> verify in SignalDB
 * 2. Send heartbeats -> verify presence updates
 * 3. Discover other agents -> verify filtering works
 * 4. Deregister -> verify cleanup
 */

import type { Agent } from '../../src/comms/protocol/types';
import { derivePresence } from '../../src/comms/protocol/presence';
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

export interface AgentLifecycleResult {
  scenario: 'agent-lifecycle';
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
 * Step 1: Register agent and verify it appears in SignalDB.
 */
async function stepRegisterAgent(ctx: UATContext): Promise<{ agent: Agent; result: StepResult }> {
  const start = Date.now();
  const sessionId = createTestAgentId(ctx, 'register-test');

  try {
    // Register agent
    const agent = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId,
      sessionName: 'uat-register-test',
      projectPath: '/tmp/uat-test',
      capabilities: { test: true },
    });

    assertDefined(agent.id, 'Agent should have an ID');
    assertEqual(agent.sessionId, sessionId, 'Session ID should match');
    assertEqual(agent.machineId, ctx.envConfig.machineId, 'Machine ID should match');

    // Verify agent appears in list
    const agents = await ctx.client.agents.findBySessionId(sessionId);
    assertTrue(agents.length > 0, 'Agent should appear in list');
    const foundAgent = agents[0];
    assertDefined(foundAgent, 'Found agent should be defined');
    assertEqual(foundAgent.id, agent.id, 'Listed agent should match registered agent');

    return {
      agent,
      result: {
        name: 'Register Agent',
        passed: true,
        duration: Date.now() - start,
        details: { agentId: agent.id, sessionId },
      },
    };
  } catch (error) {
    return {
      agent: null as unknown as Agent,
      result: {
        name: 'Register Agent',
        passed: false,
        duration: Date.now() - start,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Step 2: Send heartbeats and verify presence updates.
 */
async function stepHeartbeat(ctx: UATContext, agent: Agent): Promise<StepResult> {
  const start = Date.now();

  try {
    // Record initial heartbeat time
    assertDefined(agent.heartbeatAt, 'Agent should have initial heartbeat');
    const initialHeartbeat = new Date(agent.heartbeatAt);

    // Wait a moment
    await sleep(100);

    // Send heartbeat
    const updated = await ctx.client.agents.heartbeat(agent.id);

    assertDefined(updated.heartbeatAt, 'Updated agent should have heartbeat timestamp');

    // Verify heartbeat was updated
    const newHeartbeat = new Date(updated.heartbeatAt);
    assertTrue(
      newHeartbeat.getTime() > initialHeartbeat.getTime(),
      'Heartbeat should be more recent',
    );

    // Verify presence is active (just heartbeated)
    const presence = derivePresence(updated.heartbeatAt);
    assertEqual(presence, 'active', 'Agent should be active after heartbeat');

    return {
      name: 'Heartbeat',
      passed: true,
      duration: Date.now() - start,
      details: {
        initialHeartbeat: initialHeartbeat.toISOString(),
        newHeartbeat: newHeartbeat.toISOString(),
        presence,
      },
    };
  } catch (error) {
    return {
      name: 'Heartbeat',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 3: Discover other agents and verify filtering.
 */
async function stepDiscovery(ctx: UATContext, primaryAgent: Agent): Promise<StepResult> {
  const start = Date.now();

  try {
    // Register a second agent
    const secondSessionId = createTestAgentId(ctx, 'discovery-test');
    const secondAgent = await ctx.client.agents.register({
      machineId: ctx.envConfig.machineId,
      sessionId: secondSessionId,
      sessionName: 'uat-discovery-test',
      projectPath: '/tmp/uat-discovery',
      capabilities: { test: true, discovery: true },
    });

    // Test: List all agents on this machine
    const machineAgents = await ctx.client.agents.findByMachineId(ctx.envConfig.machineId);
    assertTrue(machineAgents.length >= 2, 'Should find at least 2 agents on this machine');

    // Test: Filter by session ID
    const bySession = await ctx.client.agents.findBySessionId(secondSessionId);
    assertEqual(bySession.length, 1, 'Should find exactly one agent by session ID');
    const foundBySession = bySession[0];
    assertDefined(foundBySession, 'Found agent should be defined');
    assertEqual(foundBySession.id, secondAgent.id, 'Found agent should match');

    // Test: Filter by project path
    const byProject = await ctx.client.agents.list({ projectPath: '/tmp/uat-discovery' });
    assertTrue(byProject.length >= 1, 'Should find agents by project path');
    assertTrue(
      byProject.some(a => a.id === secondAgent.id),
      'Project filter should include second agent',
    );

    // Test: Filter by status
    const activeAgents = await ctx.client.agents.list({ status: 'active' });
    assertTrue(
      activeAgents.some(a => a.id === primaryAgent.id),
      'Active filter should include primary agent',
    );

    // Cleanup second agent
    await ctx.client.agents.deregister(secondAgent.id);

    return {
      name: 'Agent Discovery',
      passed: true,
      duration: Date.now() - start,
      details: {
        totalOnMachine: machineAgents.length,
        activeCount: activeAgents.length,
        secondAgentId: secondAgent.id,
      },
    };
  } catch (error) {
    return {
      name: 'Agent Discovery',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Step 4: Deregister agent and verify cleanup.
 */
async function stepDeregister(ctx: UATContext, agent: Agent): Promise<StepResult> {
  const start = Date.now();

  try {
    // Deregister the agent
    await ctx.client.agents.deregister(agent.id);

    // Verify agent no longer appears in list
    if (agent.sessionId) {
      const agents = await ctx.client.agents.findBySessionId(agent.sessionId);
      assertEqual(agents.length, 0, 'Agent should no longer appear after deregistration');
    }

    // Verify direct lookup also fails (or returns empty)
    const byMachine = await ctx.client.agents.findByMachineId(ctx.envConfig.machineId);
    assertTrue(
      !byMachine.some(a => a.id === agent.id),
      'Agent should not appear in machine list after deregistration',
    );

    return {
      name: 'Deregister Agent',
      passed: true,
      duration: Date.now() - start,
      details: { deregisteredAgentId: agent.id },
    };
  } catch (error) {
    return {
      name: 'Deregister Agent',
      passed: false,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Main Scenario
// ============================================================================

/**
 * Run the Agent Lifecycle UAT scenario.
 */
export async function runAgentLifecycleScenario(ctx: UATContext): Promise<AgentLifecycleResult> {
  const start = Date.now();
  const steps: StepResult[] = [];
  let agent: Agent | null = null;

  try {
    // Step 1: Register
    const { agent: registeredAgent, result: registerResult } = await stepRegisterAgent(ctx);
    steps.push(registerResult);

    if (!registerResult.passed) {
      return {
        scenario: 'agent-lifecycle',
        passed: false,
        steps,
        duration: Date.now() - start,
        error: 'Failed at registration step',
      };
    }

    agent = registeredAgent;

    // Step 2: Heartbeat
    const heartbeatResult = await stepHeartbeat(ctx, agent);
    steps.push(heartbeatResult);

    // Step 3: Discovery
    const discoveryResult = await stepDiscovery(ctx, agent);
    steps.push(discoveryResult);

    // Step 4: Deregister
    const deregisterResult = await stepDeregister(ctx, agent);
    steps.push(deregisterResult);
    agent = null; // Mark as cleaned up

    // Calculate overall pass/fail
    const allPassed = steps.every(s => s.passed);

    return {
      scenario: 'agent-lifecycle',
      passed: allPassed,
      steps,
      duration: Date.now() - start,
    };
  } catch (error) {
    // Cleanup on unexpected error
    if (agent) {
      try {
        await ctx.client.agents.deregister(agent.id);
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      scenario: 'agent-lifecycle',
      passed: false,
      steps,
      duration: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
