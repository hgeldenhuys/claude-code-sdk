-- SignalDB Schema: Agent Communication System
-- PostgreSQL DDL for the four core tables.

-- ============================================================================
-- agents: Registry of running Claude Code sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id TEXT NOT NULL,
  session_id TEXT,
  session_name TEXT,
  project_path TEXT,
  status TEXT NOT NULL DEFAULT 'offline',
  capabilities JSONB DEFAULT '{}',
  heartbeat_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  registered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_machine_id ON agents (machine_id);
CREATE INDEX IF NOT EXISTS idx_agents_session_id ON agents (session_id);
CREATE INDEX IF NOT EXISTS idx_agents_heartbeat_at ON agents (heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (status);
CREATE INDEX IF NOT EXISTS idx_agents_project_path ON agents (project_path);

-- ============================================================================
-- channels: Named communication channels
-- ============================================================================

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  members JSONB DEFAULT '[]',
  created_by UUID REFERENCES agents(id),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channels_type ON channels (type);
CREATE INDEX IF NOT EXISTS idx_channels_created_by ON channels (created_by);

-- ============================================================================
-- messages: Unified message bus
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID REFERENCES channels(id),
  sender_id UUID REFERENCES agents(id),
  target_type TEXT NOT NULL,
  target_address TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  claimed_by UUID REFERENCES agents(id),
  claimed_at TIMESTAMPTZ,
  thread_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages (channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages (thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_target_address ON messages (target_address);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_expires_at ON messages (expires_at);

-- ============================================================================
-- pastes: Ephemeral content with TTL or read-once access
-- ============================================================================

CREATE TABLE IF NOT EXISTS pastes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES agents(id),
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text/plain',
  access_type TEXT NOT NULL DEFAULT 'ttl',
  ttl_seconds INTEGER DEFAULT 3600,
  recipient_id UUID REFERENCES agents(id),
  read_by JSONB DEFAULT '[]',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pastes_creator_id ON pastes (creator_id);
CREATE INDEX IF NOT EXISTS idx_pastes_recipient_id ON pastes (recipient_id);
CREATE INDEX IF NOT EXISTS idx_pastes_expires_at ON pastes (expires_at);
CREATE INDEX IF NOT EXISTS idx_pastes_access_type ON pastes (access_type);

-- ============================================================================
-- audit_log: Security audit trail for all agent commands
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sender_id TEXT NOT NULL,
  receiver_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  result TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  machine_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_sender_id ON audit_log (sender_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_receiver_id ON audit_log (receiver_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_machine_id ON audit_log (machine_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_result ON audit_log (result);
