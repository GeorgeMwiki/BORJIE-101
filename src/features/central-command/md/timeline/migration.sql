-- ============================================================================
-- MD Timeline — timelines + timeline_milestones tables
--
-- Auto-generated project roadmaps from the MD. One `timeline` row per
-- project; many `timeline_milestones` rows (the DAG nodes).
--
-- RLS: tenant-scoped reads/writes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS timelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  project_name TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT 'waterfall'
    CHECK (style IN ('waterfall', 'agile-cycles', 'kanban')),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dependencies JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NULL
);

COMMENT ON TABLE timelines IS
  'MD-generated project roadmaps. One row per project plan.';

CREATE INDEX IF NOT EXISTS idx_timelines_tenant_created
  ON timelines (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_timelines_owner
  ON timelines (owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS timeline_milestones (
  id TEXT PRIMARY KEY,
  timeline_id UUID NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  label TEXT NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days >= 0),
  due_at TIMESTAMPTZ NULL,
  earliest_start_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'blocked', 'done', 'skipped')),
  dependencies JSONB NOT NULL DEFAULT '[]',
  on_critical_path BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_milestones_timeline
  ON timeline_milestones (timeline_id, earliest_start_at ASC);

CREATE INDEX IF NOT EXISTS idx_milestones_tenant
  ON timeline_milestones (tenant_id, due_at ASC);

-- updated_at touch triggers
CREATE OR REPLACE FUNCTION timelines_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_timelines_touch_updated_at ON timelines;
CREATE TRIGGER trg_timelines_touch_updated_at
  BEFORE UPDATE ON timelines
  FOR EACH ROW
  EXECUTE FUNCTION timelines_touch_updated_at();

DROP TRIGGER IF EXISTS trg_milestones_touch_updated_at ON timeline_milestones;
CREATE TRIGGER trg_milestones_touch_updated_at
  BEFORE UPDATE ON timeline_milestones
  FOR EACH ROW
  EXECUTE FUNCTION timelines_touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE timelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE timeline_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY timelines_select_own_tenant
  ON timelines FOR SELECT TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY timelines_insert_own_tenant
  ON timelines FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY timelines_update_own_tenant
  ON timelines FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY timelines_delete_own_tenant
  ON timelines FOR DELETE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY milestones_select_own_tenant
  ON timeline_milestones FOR SELECT TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY milestones_insert_own_tenant
  ON timeline_milestones FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY milestones_update_own_tenant
  ON timeline_milestones FOR UPDATE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1))
  WITH CHECK (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));

CREATE POLICY milestones_delete_own_tenant
  ON timeline_milestones FOR DELETE TO authenticated
  USING (tenant_id = (SELECT org_id FROM profiles WHERE id = auth.uid() LIMIT 1));
