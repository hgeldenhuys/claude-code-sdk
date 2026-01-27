-- SignalDB Row-Level Security Policies
-- Enforces agent-level data isolation in PostgreSQL.
--
-- Usage: Set app.current_agent_id before each session's queries:
--   SET LOCAL app.current_agent_id = 'agent-uuid-here';

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
  );

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
  );

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
  );

-- ==========================================================================
-- RLS: Audit log policies
-- Audit log is append-only; agents can only read their own entries.
-- ==========================================================================

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_read ON audit_log
  FOR SELECT
  USING (
    sender_id = current_setting('app.current_agent_id', true)
    OR receiver_id = current_setting('app.current_agent_id', true)
  );

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (true); -- Any authenticated agent can insert audit entries
