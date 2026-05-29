-- 0146_marketing_pilot_applications.sql
-- Closes R24 from Docs/ROADMAP.md (KI-MARKETING-1).
--
-- Persist inbound marketing-site pilot applications so the founder
-- inbox is not the only place the lead is recorded. Surfaced via:
--   - POST /api/v1/marketing/pilot-application  (write)
--   - admin-web pilot-applications list page    (read, future)
--
-- Public-write surface — RLS intentionally permissive (read-allows
-- SUPER_ADMIN only via app middleware; no tenant scoping because the
-- prospect has no tenant yet).

CREATE TABLE IF NOT EXISTS marketing_pilot_applications (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  company         TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,
  portfolio_size  INTEGER NOT NULL,
  mineral_focus   TEXT NOT NULL,
  source_ip       TEXT,
  user_agent      TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_marketing_pilot_applications_created_at
  ON marketing_pilot_applications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_marketing_pilot_applications_company
  ON marketing_pilot_applications (lower(company));

CREATE INDEX IF NOT EXISTS idx_marketing_pilot_applications_email
  ON marketing_pilot_applications (lower(email));

ALTER TABLE marketing_pilot_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_pilot_applications FORCE ROW LEVEL SECURITY;

-- Public-write (no tenant binding); reads require SUPER_ADMIN context
-- gated by application middleware (`requireRole`). Insert is unbound so
-- the marketing site can POST without a session.
CREATE POLICY pilot_app_insert
  ON marketing_pilot_applications
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY pilot_app_select_super_admin
  ON marketing_pilot_applications
  FOR SELECT
  USING (current_setting('app.is_super_admin', true) = 'true');

CREATE POLICY pilot_app_update_super_admin
  ON marketing_pilot_applications
  FOR UPDATE
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
