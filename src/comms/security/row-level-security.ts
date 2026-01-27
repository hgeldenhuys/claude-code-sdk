/**
 * Row-Level Security Policy Generator
 *
 * Generates PostgreSQL RLS policies for the SignalDB schema.
 * Enforces that agents can only read messages addressed to them
 * and cannot modify other agents' records.
 */

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
