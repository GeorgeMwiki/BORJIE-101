-- =============================================================================
-- 0179: Tenant_id indexes for the 14 tables the Z-MIG verifier flagged.
--
-- Every RLS-protected tenant-scoped table needs a `(tenant_id, ...)`
-- index so the planner can use the index-only path when the policy
-- expression `tenant_id = public.current_app_tenant_id()` is added to
-- every query as an implicit predicate. The 14 tables below were called
-- out by the verifier as RLS-enabled but missing the leading
-- `(tenant_id)` index — every query hits a full-table scan + filter.
--
-- Tables touched (alphabetical, with the migration that created them):
--   1.  audit_trail_daily_summary     — VIEW (0111) — INDEX SKIPPED
--   2.  case_resolutions              — 0014
--   3.  case_timelines                — 0014
--   4.  customer_segment_memberships  — 0014
--   5.  escalation_chains             — 0014
--   6.  evidence_attachments          — 0014
--   7.  friction_fingerprints         — 0014
--   8.  identity_profiles             — 0014
--   9.  inspection_items              — 0014
--   10. inspection_signatures         — 0014
--   11. intervention_logs             — 0014
--   12. notice_service_receipts       — 0014
--   13. ocr_extractions               — 0014
--   14. verification_badges           — 0014
--
-- NOTE on `audit_trail_daily_summary`: this is a VIEW defined in 0111
-- (line 161) over the `audit_trail_entries` underlying table, not a
-- physical relation. Indexes can only be created on materialized views
-- or tables. The base table `audit_trail_entries` already has a
-- `(tenant_id, occurred_at)` composite index installed by 0111. We
-- therefore SKIP this entry and document the reasoning here so a
-- future operator does not retry it.
--
-- Index naming convention: `<table>_tenant_id_idx` per the task spec.
-- For tables with an obvious secondary access column (verified against
-- 0014's CREATE TABLE column list) we add a secondary composite
-- `<table>_tenant_<col>_idx` so the index supports both bare-tenant
-- scans AND the common application query pattern.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. case_resolutions — by tenant + resolved_at (column: resolved_at).
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='case_resolutions'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_resolutions_tenant_id_idx
             ON public.case_resolutions (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_resolutions_tenant_resolved_idx
             ON public.case_resolutions (tenant_id, resolved_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. case_timelines — by tenant + occurred_at.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='case_timelines'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_timelines_tenant_id_idx
             ON public.case_timelines (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_timelines_tenant_occurred_idx
             ON public.case_timelines (tenant_id, occurred_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. customer_segment_memberships — by tenant + segment.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='customer_segment_memberships'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS customer_segment_memberships_tenant_id_idx
             ON public.customer_segment_memberships (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS customer_segment_memberships_tenant_segment_idx
             ON public.customer_segment_memberships (tenant_id, segment_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. escalation_chains — by tenant + trigger_type.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='escalation_chains'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS escalation_chains_tenant_id_idx
             ON public.escalation_chains (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS escalation_chains_tenant_trigger_idx
             ON public.escalation_chains (tenant_id, trigger_type)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. evidence_attachments — by tenant + created_at.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='evidence_attachments'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS evidence_attachments_tenant_id_idx
             ON public.evidence_attachments (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS evidence_attachments_tenant_created_idx
             ON public.evidence_attachments (tenant_id, created_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6. friction_fingerprints — by tenant + observed_at.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='friction_fingerprints'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS friction_fingerprints_tenant_id_idx
             ON public.friction_fingerprints (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS friction_fingerprints_tenant_observed_idx
             ON public.friction_fingerprints (tenant_id, observed_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7. identity_profiles — by tenant + customer_id.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='identity_profiles'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS identity_profiles_tenant_id_idx
             ON public.identity_profiles (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS identity_profiles_tenant_customer_idx
             ON public.identity_profiles (tenant_id, customer_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 8. inspection_items — by tenant + inspection_id.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='inspection_items'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_items_tenant_id_idx
             ON public.inspection_items (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_items_tenant_inspection_idx
             ON public.inspection_items (tenant_id, inspection_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 9. inspection_signatures — by tenant + inspection_id.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='inspection_signatures'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_signatures_tenant_id_idx
             ON public.inspection_signatures (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_signatures_tenant_inspection_idx
             ON public.inspection_signatures (tenant_id, inspection_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 10. intervention_logs — by tenant + customer_id (no occurred_at;
--     0014 only defines `created_at` on this table).
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='intervention_logs'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS intervention_logs_tenant_id_idx
             ON public.intervention_logs (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS intervention_logs_tenant_created_idx
             ON public.intervention_logs (tenant_id, created_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 11. notice_service_receipts — by tenant + served_at.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='notice_service_receipts'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS notice_service_receipts_tenant_id_idx
             ON public.notice_service_receipts (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS notice_service_receipts_tenant_served_idx
             ON public.notice_service_receipts (tenant_id, served_at DESC)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 12. ocr_extractions — by tenant + document_upload_id (NOT document_id —
--     the column in 0014 is `document_upload_id`).
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ocr_extractions'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ocr_extractions_tenant_id_idx
             ON public.ocr_extractions (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS ocr_extractions_tenant_document_idx
             ON public.ocr_extractions (tenant_id, document_upload_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 13. verification_badges — by tenant + customer_id.
-- ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_badges'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS verification_badges_tenant_id_idx
             ON public.verification_badges (tenant_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS verification_badges_tenant_customer_idx
             ON public.verification_badges (tenant_id, customer_id)';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 14. audit_trail_daily_summary — VIEW, NOT a table. Index intentionally
--     skipped; the underlying audit_trail_entries table already has the
--     (tenant_id, occurred_at) index installed by migration 0111. A
--     future migration that converts this view to a MATERIALIZED VIEW
--     should re-issue the index here.
-- ─────────────────────────────────────────────────────────────────────

-- Operator sanity check after this migration:
--   SELECT t.relname,
--          (SELECT count(*) FROM pg_indexes WHERE schemaname='public'
--            AND tablename=t.relname AND indexname LIKE '%_tenant_id_idx') AS n_idx
--   FROM   pg_class t
--   JOIN   pg_namespace n ON n.oid = t.relnamespace
--   WHERE  n.nspname='public'
--     AND  t.relname IN (
--       'case_resolutions','case_timelines','customer_segment_memberships',
--       'escalation_chains','evidence_attachments','friction_fingerprints',
--       'identity_profiles','inspection_items','inspection_signatures',
--       'intervention_logs','notice_service_receipts','ocr_extractions',
--       'verification_badges'
--     );
-- ...should show n_idx >= 1 for every row.
