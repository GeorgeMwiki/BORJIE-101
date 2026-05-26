-- =============================================================================
-- Migration 0015 — service_status_history (public status page backing store)
--
-- Powers the public marketing status page at /status. Each row is a
-- single status sample for a named component (api-gateway, database,
-- auth, storage, workers, realtime). The status page polls a public
-- endpoint that aggregates the last 90 days from this table.
--
-- RLS is intentionally DISABLED — this table is public-readable from
-- the marketing surface (anon role via PostgREST / hono). All inserts
-- happen from privileged workers (no anon writes).
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. status enum
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'service_status_t'
  ) THEN
    CREATE TYPE service_status_t AS ENUM ('ok', 'degraded', 'outage');
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. service_status_history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_status_history (
  id        bigserial PRIMARY KEY,
  component text NOT NULL,
  status    service_status_t NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  note      text,
  CONSTRAINT service_status_history_component_chk
    CHECK (component IN (
      'api-gateway',
      'database',
      'auth',
      'storage',
      'workers',
      'realtime'
    ))
);

CREATE INDEX IF NOT EXISTS idx_service_status_history_component_at
  ON service_status_history(component, at DESC);
CREATE INDEX IF NOT EXISTS idx_service_status_history_at
  ON service_status_history(at DESC);

-- Public read access — explicit disable so anon can SELECT.
ALTER TABLE service_status_history DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE service_status_history IS
  'Public status-page backing store. RLS disabled — anon SELECT is intentional.';
COMMENT ON COLUMN service_status_history.component IS
  'Named platform component (api-gateway | database | auth | storage | workers | realtime).';
COMMENT ON COLUMN service_status_history.status IS
  'ok = healthy; degraded = some users affected; outage = unavailable.';

-- -----------------------------------------------------------------------------
-- 3. Seed — one baseline "ok" sample per component so the page never
--    renders empty before the first real sample lands.
-- -----------------------------------------------------------------------------
INSERT INTO service_status_history (component, status, at, note)
SELECT c, 'ok'::service_status_t, now(), 'baseline seed'
FROM unnest(ARRAY[
  'api-gateway',
  'database',
  'auth',
  'storage',
  'workers',
  'realtime'
]) AS c
WHERE NOT EXISTS (
  SELECT 1 FROM service_status_history s WHERE s.component = c
);

COMMIT;
