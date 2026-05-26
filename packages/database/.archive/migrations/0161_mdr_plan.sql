-- ─────────────────────────────────────────────────────────────────────
-- Migration 0161 — MDR plan items (Phase E.7).
--
-- The MD's owner-visible, steerable plan tree. Hierarchical schedule:
-- annual → quarterly → monthly → weekly → daily. Owner can accept /
-- reject / re-prioritise items. Status is a soft state machine:
--   proposed → active → done | cancelled
--                 ↘ paused → active
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mdr_plan_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  parent_id         UUID,
  /** 'annual' | 'quarterly' | 'monthly' | 'weekly' | 'daily' */
  horizon           TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  /** 'proposed' | 'active' | 'paused' | 'done' | 'cancelled' */
  status            TEXT NOT NULL,
  /** 'md' | 'owner' */
  proposed_by       TEXT NOT NULL,
  accepted_at       TIMESTAMP,
  start_date        TEXT,
  due_date          TEXT,
  owner_editable    BOOLEAN NOT NULL DEFAULT TRUE,
  metadata          JSONB DEFAULT '{}'::jsonb,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdr_plan_tenant_horizon
  ON mdr_plan_items (tenant_id, horizon);

CREATE INDEX IF NOT EXISTS idx_mdr_plan_tenant_parent
  ON mdr_plan_items (tenant_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_mdr_plan_status
  ON mdr_plan_items (tenant_id, status);

COMMENT ON TABLE mdr_plan_items IS
  'MDR plan tree — MD-proposed, owner-steerable items across annual/quarterly/monthly/weekly/daily horizons.';

COMMENT ON COLUMN mdr_plan_items.horizon IS
  'One of: annual | quarterly | monthly | weekly | daily';

COMMENT ON COLUMN mdr_plan_items.status IS
  'State machine: proposed → active → done | cancelled (with paused side-state).';

COMMENT ON COLUMN mdr_plan_items.proposed_by IS
  'md = proposed by Mr. Mwikila; owner = added by the human owner.';
