-- Migration 0022: Interactive Reports (NEW 17)
-- Adds interactive_report_versions + interactive_report_action_acks.
-- Additive: no existing tables touched.

CREATE TYPE interactive_report_render_kind AS ENUM (
  'html_bundle',
  'html_with_video',
  'html_with_charts',
  'print_pdf_fallback'
);

CREATE TABLE IF NOT EXISTS interactive_report_versions (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  report_instance_id TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  render_kind        interactive_report_render_kind NOT NULL DEFAULT 'html_bundle',
  media_references   JSONB NOT NULL DEFAULT '[]'::jsonb,
  action_plans       JSONB NOT NULL DEFAULT '[]'::jsonb,
  signed_url         TEXT,
  signed_url_key     TEXT,
  expires_at         TIMESTAMPTZ,
  content_hash       TEXT,
  generated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  generated_by       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interactive_report_versions_tenant_idx
  ON interactive_report_versions(tenant_id);
CREATE INDEX IF NOT EXISTS interactive_report_versions_report_instance_idx
  ON interactive_report_versions(report_instance_id);
CREATE INDEX IF NOT EXISTS interactive_report_versions_render_kind_idx
  ON interactive_report_versions(render_kind);

CREATE TABLE IF NOT EXISTS interactive_report_action_acks (
  id                              TEXT PRIMARY KEY,
  tenant_id                       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  interactive_report_version_id   TEXT NOT NULL REFERENCES interactive_report_versions(id) ON DELETE CASCADE,
  action_plan_id                  TEXT NOT NULL,
  resolution                      TEXT NOT NULL,
  resolution_ref_id               TEXT,
  acknowledged_by                 TEXT NOT NULL,
  acknowledged_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata                        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS interactive_report_action_acks_tenant_idx
  ON interactive_report_action_acks(tenant_id);
CREATE INDEX IF NOT EXISTS interactive_report_action_acks_version_idx
  ON interactive_report_action_acks(interactive_report_version_id);
