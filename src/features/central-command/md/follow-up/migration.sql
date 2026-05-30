-- ============================================================================
-- MD Follow-Up — follow_ups table
--
-- The AI Managing Director persists commitments captured from chat turns
-- ("I'll get back to you Tuesday") here. Heartbeat ticks scan the table
-- and surface due / overdue / escalated rows back to the owner.
--
-- RLS: rows are scoped to `tenant_id`; authenticated users may only read
-- and write rows for their own tenant.
-- ============================================================================

CREATE TABLE IF NOT EXISTS follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  subject TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  snoozed_until TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'due', 'completed', 'cancelled', 'escalated')),
  origin_turn_id TEXT NOT NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 3),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  counterparty TEXT NULL,
  metadata JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE follow_ups IS
  'MD-tracked commitments. Source of truth for the follow-up scheduler.';

CREATE INDEX IF NOT EXISTS idx_follow_ups_tenant_due
  ON follow_ups (tenant_id, due_at ASC)
  WHERE status IN ('pending', 'escalated');

CREATE INDEX IF NOT EXISTS idx_follow_ups_owner
  ON follow_ups (owner_id, due_at ASC);

CREATE INDEX IF NOT EXISTS idx_follow_ups_status
  ON follow_ups (tenant_id, status, due_at ASC);

-- ============================================================================
-- updated_at trigger (keeps `updated_at` honest on every mutation).
-- ============================================================================

CREATE OR REPLACE FUNCTION follow_ups_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_follow_ups_touch_updated_at ON follow_ups;
CREATE TRIGGER trg_follow_ups_touch_updated_at
  BEFORE UPDATE ON follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION follow_ups_touch_updated_at();

-- ============================================================================
-- RLS — tenant-scoped.
-- ============================================================================

ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY follow_ups_select_own_tenant
  ON follow_ups
  FOR SELECT
  TO authenticated
  USING (tenant_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

CREATE POLICY follow_ups_insert_own_tenant
  ON follow_ups
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

CREATE POLICY follow_ups_update_own_tenant
  ON follow_ups
  FOR UPDATE
  TO authenticated
  USING (tenant_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ))
  WITH CHECK (tenant_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));

CREATE POLICY follow_ups_delete_own_tenant
  ON follow_ups
  FOR DELETE
  TO authenticated
  USING (tenant_id = (
    SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1
  ));
