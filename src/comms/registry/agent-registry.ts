/**
 * Agent Registry
 *
 * High-level agent lifecycle management wrapping the SignalDB REST client.
 * Provides registration, discovery, heartbeat loops, and presence queries.
 */

import type { SignalDBClient } from '../client/signaldb';
import { parseAddress } from '../protocol/address';
import { derivePresence } from '../protocol/presence';
import type { Agent, AgentFilter, AgentStatus } from '../protocol/types';

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Options for registering a new agent.
 */
export interface AgentRegistrationOptions {
  machineId: string;
  sessionId: string;
  sessionName?: string;
  projectPath?: string;
  capabilities?: Record<string, unknown>;
}

/**
 * Manages agent lifecycle: registration, heartbeat, discovery, and presence.
 *
 * @example
 * ```typescript
 * const registry = new AgentRegistry(client);
 *
 * const agent = await registry.register({
 *   machineId: 'mac-001',
 *   sessionId: 'abc-123',
 *   sessionName: 'jolly-squid',
 *   projectPath: '/Users/dev/my-project',
 * });
 *
 * const cleanup = registry.startHeartbeatLoop(agent.id);
 * // ... later ...
 * cleanup();
 * await registry.deregister(agent.id);
 * ```
 */
export class AgentRegistry {
  private readonly client: SignalDBClient;

  constructor(client: SignalDBClient) {
    this.client = client;
  }

  /**
   * Register a new agent in the SignalDB system.
   *
   * @param opts - Agent registration details
   * @returns The registered Agent entity with generated ID
   */
  async register(opts: AgentRegistrationOptions): Promise<Agent> {
    return this.client.agents.register({
      machineId: opts.machineId,
      sessionId: opts.sessionId,
      sessionName: opts.sessionName,
      projectPath: opts.projectPath,
      capabilities: opts.capabilities ?? {},
    });
  }

  /**
   * Remove an agent from the registry.
   * Sets status to offline and removes from active agents.
   *
   * @param agentId - UUID of the agent to deregister
   */
  async deregister(agentId: string): Promise<void> {
    return this.client.agents.deregister(agentId);
  }

  /**
   * Send a heartbeat for an agent, updating its heartbeat_at timestamp.
   *
   * @param agentId - UUID of the agent
   */
  async heartbeat(agentId: string): Promise<void> {
    await this.client.agents.heartbeat(agentId);
  }

  /**
   * Discover agents matching the given filter criteria.
   *
   * @param filter - Optional filter by machineId, projectPath, or status
   * @returns Array of matching Agent entities
   */
  async discover(filter?: AgentFilter): Promise<Agent[]> {
    return this.client.agents.list(filter);
  }

  /**
   * Resolve an address URI to matching agents.
   *
   * For agent:// addresses, queries by machineId and identifier (session ID or name).
   * For project:// addresses, queries by machineId and projectPath.
   * For broadcast:// addresses, returns all agents in the named channel.
   *
   * @param address - SignalDB address URI
   * @returns Array of matching Agent entities
   */
  async resolveAddress(address: string): Promise<Agent[]> {
    const parsed = parseAddress(address);

    switch (parsed.type) {
      case 'agent': {
        // Try session ID first, then session name
        const bySessionId = await this.client.agents.findBySessionId(parsed.identifier);
        if (bySessionId.length > 0) {
          // Filter by machine ID
          const filtered: Agent[] = [];
          for (const agent of bySessionId) {
            if (agent.machineId === parsed.machineId) {
              filtered.push(agent);
            }
          }
          if (filtered.length > 0) return filtered;
        }
        // Fall back to listing all on machine and filtering by session name
        const byMachine = await this.client.agents.findByMachineId(parsed.machineId);
        const results: Agent[] = [];
        for (const agent of byMachine) {
          if (agent.sessionName === parsed.identifier || agent.sessionId === parsed.identifier) {
            results.push(agent);
          }
        }
        return results;
      }
      case 'project': {
        return this.client.agents.list({
          machineId: parsed.machineId,
          projectPath: parsed.repoPath,
        });
      }
      case 'broadcast': {
        // For broadcast, get the channel and return agents that are members
        const channel = await this.client.channels.getByName(parsed.channelName);
        if (!channel || !channel.members || channel.members.length === 0) {
          return [];
        }
        // Fetch each member agent
        const agents: Agent[] = [];
        for (const memberId of channel.members) {
          try {
            const memberAgents = await this.client.agents.list();
            for (const agent of memberAgents) {
              if (agent.id === memberId) {
                agents.push(agent);
              }
            }
          } catch {
            // Skip agents that can't be found
          }
        }
        return agents;
      }
    }
  }

  /**
   * Get the current presence status of an agent.
   * Fetches the latest agent data and derives presence from heartbeat.
   *
   * @param agentId - UUID of the agent
   * @returns Derived AgentStatus
   */
  async getPresence(agentId: string): Promise<AgentStatus> {
    const agents = await this.client.agents.list();
    for (const agent of agents) {
      if (agent.id === agentId) {
        return derivePresence(agent.heartbeatAt);
      }
    }
    return 'offline';
  }

  /**
   * Start a periodic heartbeat loop for an agent.
   *
   * @param agentId - UUID of the agent to send heartbeats for
   * @param intervalMs - Heartbeat interval in milliseconds (default: 5000)
   * @returns Cleanup function that stops the heartbeat loop when called
   */
  startHeartbeatLoop(agentId: string, intervalMs = 5000): () => void {
    const timer = setInterval(async () => {
      try {
        await this.heartbeat(agentId);
      } catch {
        // Silently ignore heartbeat failures - next one will retry
      }
    }, intervalMs);

    return () => {
      clearInterval(timer);
    };
  }
}
