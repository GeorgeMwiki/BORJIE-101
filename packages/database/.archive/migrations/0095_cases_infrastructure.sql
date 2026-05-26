-- Migration 0095 — Cases infrastructure (Wave 26, Agent Z1)
--
-- Adds the JSONB `payload` aggregate column the PostgresCaseRepository
-- writes to. The amendment was defined in migration 0025_repo_amendments.sql
-- but that migration was never applied in live Postgres, so the repo's
-- INSERT/UPDATE statements would fail with `column "payload" does not
-- exist` the first time it's exercised.
--
-- This migration is IDEMPOTENT — re-running it is a no-op. Safe to apply
-- to an environment that already received 0025_repo_amendments.sql.
--
-- Refs:
--   - services/domain-services/src/cases/postgres-case-repository.ts
--     (writes timeline + notices + evidence + resolution into `payload`)
--   - Docs/WAVE26_FINDINGS/agent-z1-cases.md (wave writeup)

BEGIN;

-- 1. Aggregate JSONB payload column. The Case entity's denormalised
--    collections (timeline, notices, evidence, resolution,
--    relatedInvoiceIds) are stored here so the read/write surface of
--    the repo matches the domain aggregate without fanning out to the
--    existing `case_timelines` / `evidence_attachments` / `case_resolutions`
--    child tables. Those child tables remain the source of truth for
--    reporting joins; `payload` is the fast-path for the SLA worker +
--    case service which need the full aggregate per request.
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::JSONB;

-- 2. GIN index on `payload` so JSONB containment queries (e.g. finding
--    cases with a specific notice type or evidence tag) stay cheap.
--    Created CONCURRENTLY-equivalent via IF NOT EXISTS so re-running
--    during maintenance windows is safe.
CREATE INDEX IF NOT EXISTS cases_payload_gin_idx ON cases USING GIN (payload);

-- 3. Backfill existing rows with the empty-aggregate shape the repo's
--    `rowToEntity` mapper expects. Rows without `payload` already
--    default to '{}', but we make the shape explicit here so JSONB
--    path accessors (`payload->'timeline'`) return NULL-safe empty
--    arrays rather than requiring a COALESCE at every read site.
UPDATE cases
   SET payload = jsonb_build_object(
         'timeline', COALESCE(payload->'timeline', '[]'::jsonb),
         'notices', COALESCE(payload->'notices', '[]'::jsonb),
         'evidence', COALESCE(payload->'evidence', '[]'::jsonb),
         'resolution', payload->'resolution',
         'relatedInvoiceIds', COALESCE(payload->'relatedInvoiceIds', '[]'::jsonb)
       )
 WHERE NOT (payload ? 'timeline'
            AND payload ? 'notices'
            AND payload ? 'evidence'
            AND payload ? 'relatedInvoiceIds');

COMMIT;
