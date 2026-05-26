-- =============================================================================
-- 0025: Wave 3 repo amendments
-- =============================================================================
-- Adds the minimal column surface required by the new Postgres repositories
-- so they can persist the aggregate state exposed by their domain services.
--
-- Additive only — all ALTERs are `ADD COLUMN IF NOT EXISTS` and all new
-- tables use `CREATE TABLE IF NOT EXISTS`.
--
-- Spec refs:
--   Docs/analysis/SCAFFOLDED_COMPLETION.md §3 (cases SLA / case repo)
--   Wave 3 repo-implementation pass
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Case aggregate payload column
--
--   The `Case` domain entity carries denormalised arrays (timeline, notices,
--   evidence, resolution, related invoice IDs) that don't have a single
--   authoritative column on the base `cases` table. Rather than fan out to
--   every sub-table on read from the Postgres case repo, we cache the
--   aggregate on the `cases.payload` JSONB column. The sub-tables
--   (case_timelines, evidence_attachments, case_resolutions) remain the
--   source of truth for reporting/joins; `payload` is the
--   fast-path for the service-level read.
-- ----------------------------------------------------------------------------
ALTER TABLE cases ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::JSONB;

CREATE INDEX IF NOT EXISTS cases_payload_gin_idx ON cases USING GIN (payload);

-- ----------------------------------------------------------------------------
-- 2. Damage deduction cases — evidence bundle index
--
--   The Postgres repo's `setEvidenceBundleId` write path benefits from an
--   index on evidence_bundle_id for future lookups from the bundle side.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS damage_deduction_cases_evidence_bundle_idx
  ON damage_deduction_cases (evidence_bundle_id)
  WHERE evidence_bundle_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Conditional surveys — scheduled_at filter used by findOverdue
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS conditional_surveys_overdue_idx
  ON conditional_surveys (tenant_id, scheduled_at)
  WHERE status NOT IN ('compiled', 'approved', 'archived', 'cancelled');

-- ----------------------------------------------------------------------------
-- 4. FAR assignments — due filter used by findDue / findDueAssignments
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS far_assignments_due_idx
  ON far_assignments (tenant_id, next_check_due_at)
  WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- 5. Sublease requests — list pending by tenant
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS sublease_requests_tenant_status_idx
  ON sublease_requests (tenant_id, status);
