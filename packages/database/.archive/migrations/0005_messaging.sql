-- BORJIE Messaging Migration
-- Creates conversations, messages, and participants tables

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE conversation_type AS ENUM ('support', 'maintenance', 'general', 'lease');

-- ============================================================================
-- Conversations Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Classification
  type conversation_type NOT NULL DEFAULT 'general',
  subject TEXT,

  -- Related entity (optional)
  entity_type TEXT,
  entity_id TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'open',

  -- Timestamps
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT
);

CREATE INDEX conversations_tenant_idx ON conversations(tenant_id);
CREATE INDEX conversations_type_idx ON conversations(type);
CREATE INDEX conversations_entity_idx ON conversations(entity_type, entity_id);
CREATE INDEX conversations_status_idx ON conversations(status);
CREATE INDEX conversations_created_at_idx ON conversations(created_at);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Participants Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Participant (user or customer)
  participant_type TEXT NOT NULL,
  participant_id TEXT NOT NULL,

  -- Role in conversation
  role TEXT NOT NULL DEFAULT 'member',

  -- Timestamps
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ
);

CREATE INDEX participants_conversation_idx ON participants(conversation_id);
CREATE INDEX participants_participant_idx ON participants(participant_type, participant_id);
CREATE UNIQUE INDEX participants_conversation_participant_idx ON participants(conversation_id, participant_type, participant_id);

-- ============================================================================
-- Messages Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- Sender
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,

  -- Content
  content TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',

  -- Status
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id);
CREATE INDEX messages_sender_idx ON messages(sender_type, sender_id);
CREATE INDEX messages_created_at_idx ON messages(conversation_id, created_at);

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY conversations_tenant_isolation ON conversations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY participants_tenant_isolation ON participants
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT
    )
  );

CREATE POLICY messages_tenant_isolation ON messages
  FOR ALL USING (
    conversation_id IN (
      SELECT id FROM conversations WHERE tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT
    )
  );
