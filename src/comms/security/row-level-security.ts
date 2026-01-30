/**
 * Row-Level Security
 *
 * Two complementary RLS mechanisms:
 *
 * 1. **RLSPolicyGenerator** - Generates PostgreSQL RLS policies for the
 *    SignalDB schema. Enforces server-side that agents can only read
 *    messages addressed to them and cannot modify other agents' records.
 *
 * 2. **RLSFilter** - Client-side message filter applied in the agent
 *    daemon before routing. Enforces that SSE-delivered messages are
 *    only forwarded to sessions that should receive them:
 *    - Direct messages: only if targetAddress matches this agent/session/machine
 *    - Channel messages: only if the agent is a member of the channel
 *    - Broadcast messages: always delivered
 *    - No target: dropped (unknown routing = reject)
 */

import type { Message } from '../protocol/types';
import { createLogger } from '../daemon/logger';

// ============================================================================
// RLS Policy Generator
// ============================================================================

/**
 * Generates PostgreSQL Row-Level Security (RLS) policies
 * for the SignalDB agent communication schema.
 *
 * Policies enforce:
 * - Agents read only messages addressed to them or their project
 * - Agents can only modify their own records
 * - Project-scoped channel messages visible only to project members
 *
 * @example
 * ```typescript
 * const generator = new RLSPolicyGenerator();
 * const sql = generator.generateAllPolicies();
 * // Execute `sql` against your PostgreSQL database
 * ```
 */
export class RLSPolicyGenerator {
  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Generate RLS policy for agent message reads.
   *
   * Agents can read messages that are:
   * 1. Directly addressed to them (target_address contains their agent ID)
   * 2. Sent by them
   * 3. In a channel they are a member of
   * 4. Broadcast messages (target_type = 'broadcast')
   */
  generateAgentReadPolicy(): string {
    return `
-- ==========================================================================
-- RLS: Agent Read Policy for messages
-- Agents can only read messages addressed to them, sent by them,
-- in their channels, or broadcast messages.
-- ==========================================================================

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_read_messages ON messages
  FOR SELECT
  USING (
    -- Message is addressed directly to the current agent
    target_address LIKE '%' || current_setting('app.current_agent_id', true) || '%'
    -- Message was sent by the current agent
    OR sender_id::text = current_setting('app.current_agent_id', true)
    -- Message is in a channel the agent is a member of
    OR channel_id IN (
      SELECT id FROM channels
      WHERE members @> jsonb_build_array(current_setting('app.current_agent_id', true))
    )
    -- Broadcast messages are visible to all
    OR target_type = 'broadcast'
  );`.trim();
  }

  /**
   * Generate RLS policy for agent record writes.
   *
   * Agents can only:
   * - Insert messages where sender_id matches their ID
   * - Update messages they sent (status changes for their own messages)
   * - Update their own agent record
   */
  generateAgentWritePolicy(): string {
    return `
-- ==========================================================================
-- RLS: Agent Write Policy for messages
-- Agents can only create messages as themselves and update their own messages.
-- ==========================================================================

CREATE POLICY agent_insert_messages ON messages
  FOR INSERT
  WITH CHECK (
    sender_id::text = current_setting('app.current_agent_id', true)
  );

CREATE POLICY agent_update_messages ON messages
  FOR UPDATE
  USING (
    -- Can update own sent messages
    sender_id::text = current_setting('app.current_agent_id', true)
    -- Can claim/update status of messages addressed to them
    OR target_address LIKE '%' || current_setting('app.current_agent_id', true) || '%'
  );

-- ==========================================================================
-- RLS: Agent self-modification policy
-- Agents can only modify their own agent record.
-- ==========================================================================

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_read_self ON agents
  FOR SELECT
  USING (true); -- All agents can see other agents (for discovery)

CREATE POLICY agent_update_self ON agents
  FOR UPDATE
  USING (
    id::text = current_setting('app.current_agent_id', true)
  );`.trim();
  }

  /**
   * Generate RLS policy for project-scoped channel messages.
   *
   * Project channels are only visible to agents whose project_path
   * matches the channel's project scope.
   */
  generateProjectScopePolicy(): string {
    return `
-- ==========================================================================
-- RLS: Project-scoped channel visibility
-- Project channel messages are only visible to agents in the same project.
-- ==========================================================================

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY project_channel_read ON channels
  FOR SELECT
  USING (
    -- Non-project channels are visible to all
    type != 'project'
    -- Project channels visible to members
    OR members @> jsonb_build_array(current_setting('app.current_agent_id', true))
    -- Channel creator can always see it
    OR created_by::text = current_setting('app.current_agent_id', true)
  );

-- ==========================================================================
-- RLS: Paste access control
-- Pastes are visible to creator and designated recipient only.
-- ==========================================================================

ALTER TABLE pastes ENABLE ROW LEVEL SECURITY;

CREATE POLICY paste_read ON pastes
  FOR SELECT
  USING (
    -- Creator can always see their pastes
    creator_id::text = current_setting('app.current_agent_id', true)
    -- Designated recipient can see the paste
    OR recipient_id::text = current_setting('app.current_agent_id', true)
    -- Pastes without a recipient are accessible to all
    OR recipient_id IS NULL
  );

CREATE POLICY paste_insert ON pastes
  FOR INSERT
  WITH CHECK (
    creator_id::text = current_setting('app.current_agent_id', true)
  );`.trim();
  }

  /**
   * Generate all RLS policies combined into a single SQL string.
   *
   * @returns Complete SQL for all row-level security policies
   */
  generateAllPolicies(): string {
    const sections = [
      '-- SignalDB Row-Level Security Policies',
      '-- Generated by RLSPolicyGenerator',
      `-- Generated at: ${new Date().toISOString()}`,
      '',
      '-- NOTE: Set app.current_agent_id before queries:',
      "-- SET LOCAL app.current_agent_id = 'agent-uuid-here';",
      '',
      this.generateAgentReadPolicy(),
      '',
      this.generateAgentWritePolicy(),
      '',
      this.generateProjectScopePolicy(),
    ];

    return sections.join('\n');
  }
}

// ============================================================================
// Client-Side RLS Filter
// ============================================================================

const rlsLog = createLogger('rls-filter');

/**
 * Client-side Row-Level Security filter for SSE messages.
 *
 * Applied in the agent daemon BEFORE routing to ensure that only
 * messages intended for this agent/session/machine are delivered.
 *
 * Filter rules:
 * - **Direct messages**: deliver only if targetAddress matches agentId,
 *   any registered sessionId, or machineId
 * - **Channel messages**: deliver only if channelId is in channelMemberships
 * - **Broadcast messages**: always deliver (metadata.deliveryMode === 'broadcast')
 * - **No target**: drop (unknown routing = reject)
 *
 * @example
 * ```typescript
 * const filter = new RLSFilter('agent-001', 'machine-001', new Set(['ch-general']));
 *
 * if (filter.shouldDeliver(message)) {
 *   router.route(message, sessions);
 * }
 * ```
 */
export class RLSFilter {
  private readonly agentId: string;
  private readonly machineId: string;
  private channelMemberships: Set<string>;
  private sessionIds: Set<string>;

  constructor(
    agentId: string,
    machineId: string,
    channelMemberships: Set<string> = new Set(),
    sessionIds: Set<string> = new Set(),
  ) {
    this.agentId = agentId;
    this.machineId = machineId;
    this.channelMemberships = new Set(channelMemberships);
    this.sessionIds = new Set(sessionIds);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Determine whether a message should be delivered to this agent.
   *
   * @param message - The incoming SSE message
   * @returns true if the message should be delivered, false to drop
   */
  shouldDeliver(message: Message): boolean {
    const deliveryMode = (message.metadata?.deliveryMode as string) || '';

    // Rule (c): Broadcast messages are always delivered
    if (deliveryMode === 'broadcast') {
      rlsLog.debug('RLS pass: broadcast', { messageId: message.id.slice(0, 8) });
      return true;
    }

    // Rule (b): Channel messages - deliver if agent is a member
    if (message.channelId && !message.targetAddress) {
      const isMember = this.channelMemberships.has(message.channelId);
      if (isMember) {
        rlsLog.debug('RLS pass: channel member', {
          messageId: message.id.slice(0, 8),
          channelId: message.channelId.slice(0, 8),
        });
      } else {
        rlsLog.debug('RLS drop: not channel member', {
          messageId: message.id.slice(0, 8),
          channelId: message.channelId.slice(0, 8),
        });
      }
      return isMember;
    }

    // Rule (a): Direct messages - deliver if targetAddress matches
    if (message.targetAddress) {
      const matches = this.matchesTarget(message.targetAddress);
      if (matches) {
        rlsLog.debug('RLS pass: direct target match', {
          messageId: message.id.slice(0, 8),
          targetAddress: message.targetAddress.slice(0, 20),
        });
      } else {
        rlsLog.debug('RLS drop: target mismatch', {
          messageId: message.id.slice(0, 8),
          targetAddress: message.targetAddress.slice(0, 20),
        });
      }
      return matches;
    }

    // Rule (d): No target and not broadcast - drop
    rlsLog.debug('RLS drop: no target, not broadcast', {
      messageId: message.id.slice(0, 8),
    });
    return false;
  }

  /**
   * Update the set of channels this agent is a member of.
   * Called when channel subscriptions change dynamically.
   *
   * @param channels - Updated set of channel IDs
   */
  updateMemberships(channels: Set<string>): void {
    this.channelMemberships = new Set(channels);
    rlsLog.debug('Channel memberships updated', {
      count: this.channelMemberships.size,
    });
  }

  /**
   * Update the set of session IDs this agent represents.
   * Called when new sessions are discovered or stale ones removed.
   *
   * @param sessions - Updated set of session IDs
   */
  updateSessionIds(sessions: Set<string>): void {
    this.sessionIds = new Set(sessions);
    rlsLog.debug('Session IDs updated', {
      count: this.sessionIds.size,
    });
  }

  /**
   * Get the current channel memberships (for diagnostics).
   */
  getMemberships(): Set<string> {
    return new Set(this.channelMemberships);
  }

  /**
   * Get the current session IDs (for diagnostics).
   */
  getSessionIds(): Set<string> {
    return new Set(this.sessionIds);
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Check if a target address matches this agent's identity.
   * Matches against agentId, any registered sessionId, or machineId.
   */
  private matchesTarget(targetAddress: string): boolean {
    // Match against agent ID
    if (targetAddress.includes(this.agentId)) {
      return true;
    }

    // Match against machine ID
    if (targetAddress.includes(this.machineId)) {
      return true;
    }

    // Match against any registered session ID
    for (const sessionId of this.sessionIds) {
      if (targetAddress.includes(sessionId)) {
        return true;
      }
    }

    return false;
  }
}
