-- Migration 0023: Station Master Coverage + Worker Tags (NEW 18)
-- Additive only.

CREATE TYPE station_master_coverage_kind AS ENUM (
  'tag',
  'polygon',
  'city',
  'property_ids',
  'region'
);

CREATE TABLE IF NOT EXISTS station_master_coverage (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  station_master_id   TEXT NOT NULL,
  coverage_kind       station_master_coverage_kind NOT NULL,
  coverage_value      JSONB NOT NULL,
  priority            INTEGER NOT NULL DEFAULT 100,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          TEXT,
  updated_by          TEXT
);

CREATE INDEX IF NOT EXISTS station_master_coverage_tenant_idx
  ON station_master_coverage(tenant_id);
CREATE INDEX IF NOT EXISTS station_master_coverage_station_master_idx
  ON station_master_coverage(station_master_id);
CREATE INDEX IF NOT EXISTS station_master_coverage_kind_idx
  ON station_master_coverage(coverage_kind);
CREATE INDEX IF NOT EXISTS station_master_coverage_priority_idx
  ON station_master_coverage(priority);

CREATE TABLE IF NOT EXISTS worker_tags (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  tag         TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT
);

CREATE INDEX IF NOT EXISTS worker_tags_tenant_idx ON worker_tags(tenant_id);
CREATE INDEX IF NOT EXISTS worker_tags_user_idx ON worker_tags(user_id);
CREATE INDEX IF NOT EXISTS worker_tags_tag_idx ON worker_tags(tag);
