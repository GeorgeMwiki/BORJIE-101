-- =============================================================================
-- 0180_perf_indexes.sql
--
-- Performance indexes flagged by the MS-B (M-Pesa / auth hot paths) and
-- Z-MIG (RLS-enabled tenant table coverage) audits.
--
-- Slot history:
--   0094 added the first wave of (tenant_id, X) composite indexes for
--   invoices / payments / leases / customers. 0179 swept the 14 tables
--   the Z-MIG verifier called out as RLS-enabled but missing a leading
--   (tenant_id) index. This migration closes the residual MS-B findings
--   (M-Pesa callback full-scan, OTP/MFA phone lookup full-scan, activity-
--   reports last_activity full-scan) and adds the `(tenant_id,
--   created_at DESC NULLS LAST)` composite the Z-MIG audit asked for on
--   the same 14 tables — 0179 used the simpler `(tenant_id)` and a
--   secondary by a domain-specific column; the audit's exact remediation
--   is the recency composite, captured here as a sibling so dashboards
--   that ORDER BY created_at DESC have a true index-only path.
--
-- Audit findings closed by this migration:
--
--   MS-B (audit `.audit/ms-b-perf-2026-05.md`):
--     - payments(tenant_id, external_reference) full-scan on every
--       M-Pesa STK Push callback. The callback resolves a pending
--       payment by the gateway-issued external_reference; without an
--       index this is `Seq Scan + Filter` and grows linearly with
--       payment volume per tenant. Fix: a btree on
--       (tenant_id, external_reference).
--
--     - users(phone) full-scan on every OTP / MFA send and on every
--       "find user by phone" admin lookup. Partial WHERE phone IS NOT
--       NULL keeps the index small because the column is nullable for
--       email-only accounts. The MS-B audit specifically called out
--       OTP latency under load.
--
--     - users(tenant_id, last_activity_at DESC) full-scan on activity
--       reports ("active users in last N days", admin dashboards). The
--       column is nullable for never-logged-in seed accounts, so the
--       partial WHERE keeps the index dense and the DESC clause matches
--       the dominant `ORDER BY last_activity_at DESC LIMIT N` pattern.
--
--   Z-MIG (audit `.audit/z-mig-rls-coverage-2026-05.md`):
--     The 14 RLS-enabled tables that 0179 swept also need the audit's
--     prescribed `(tenant_id, created_at DESC NULLS LAST)` composite so
--     queries that page by tenant + recency hit a single btree instead
--     of intersecting bitmap scans. Listed alphabetically:
--
--       1.  audit_trail_daily_summary    — VIEW (0111), index skipped
--           (same reasoning as 0179: indexes only attach to physical
--           relations; the underlying audit_trail_entries already has
--           (tenant_id, occurred_at) installed by 0111).
--       2.  case_resolutions             — 0014
--       3.  case_timelines               — 0014
--       4.  customer_segment_memberships — 0014
--       5.  escalation_chains            — 0014
--       6.  evidence_attachments         — 0014
--       7.  friction_fingerprints        — 0014
--       8.  identity_profiles            — 0014
--       9.  inspection_items             — 0014
--       10. inspection_signatures        — 0014
--       11. intervention_logs            — 0014
--       12. notice_service_receipts      — 0014
--       13. ocr_extractions              — 0014
--       14. verification_badges          — 0014
--
-- Safety:
--   - Every CREATE INDEX uses IF NOT EXISTS — idempotent across reruns.
--   - Every Z-MIG table is gated on information_schema.tables existence
--     so the migration is safe on shards where a feature-flag table
--     was deferred or has not been deployed yet.
--   - All three MS-B indexes (payments, users-phone, users-last-activity)
--     target tables installed by 0001_initial.sql so they need no DO
--     guard — the relations are guaranteed present.
--   - No ALTER TABLE, no NOT NULL adds, no data migration — additive only.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- MS-B #1: payments(tenant_id, external_reference)
-- M-Pesa STK Push callbacks resolve pending rows by external_reference
-- inside the tenant scope. Without this index every callback does a
-- Seq Scan on `payments` filtered by tenant — latency grows with
-- payment volume. Btree composite covers the exact predicate pattern.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS payments_external_reference_idx
  ON public.payments (tenant_id, external_reference);

-- ─────────────────────────────────────────────────────────────────────
-- MS-B #2: users(phone) WHERE phone IS NOT NULL
-- OTP / MFA flows look up users by phone. The column is nullable for
-- email-only accounts, so a partial index keeps the btree dense and
-- avoids carrying NULL-bearing rows that never match the predicate.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS users_phone_idx
  ON public.users (phone)
  WHERE phone IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- MS-B #3: users(tenant_id, last_activity_at DESC) WHERE last_activity_at IS NOT NULL
-- Activity reports and admin dashboards page by `ORDER BY
-- last_activity_at DESC LIMIT N` within a tenant. Column is nullable
-- for never-logged-in seed accounts; partial index keeps it small.
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS users_last_activity_idx
  ON public.users (tenant_id, last_activity_at DESC)
  WHERE last_activity_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Z-MIG: (tenant_id, created_at DESC NULLS LAST) composite per the 14
-- audit-flagged tables. NULLS LAST so pre-backfill rows (where
-- created_at could theoretically be NULL) sort to the bottom rather
-- than the top of paginated recency views.
-- ─────────────────────────────────────────────────────────────────────

-- 1. case_resolutions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='case_resolutions'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_resolutions_tenant_id_idx
             ON public.case_resolutions (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 2. case_timelines
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='case_timelines'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS case_timelines_tenant_id_idx
             ON public.case_timelines (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 3. customer_segment_memberships
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='customer_segment_memberships'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS customer_segment_memberships_tenant_id_idx
             ON public.customer_segment_memberships (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 4. escalation_chains
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='escalation_chains'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS escalation_chains_tenant_id_idx
             ON public.escalation_chains (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 5. evidence_attachments
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='evidence_attachments'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS evidence_attachments_tenant_id_idx
             ON public.evidence_attachments (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 6. friction_fingerprints
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='friction_fingerprints'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS friction_fingerprints_tenant_id_idx
             ON public.friction_fingerprints (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 7. identity_profiles
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='identity_profiles'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS identity_profiles_tenant_id_idx
             ON public.identity_profiles (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 8. inspection_items
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='inspection_items'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_items_tenant_id_idx
             ON public.inspection_items (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 9. inspection_signatures
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='inspection_signatures'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS inspection_signatures_tenant_id_idx
             ON public.inspection_signatures (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 10. intervention_logs
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='intervention_logs'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS intervention_logs_tenant_id_idx
             ON public.intervention_logs (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 11. notice_service_receipts
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='notice_service_receipts'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS notice_service_receipts_tenant_id_idx
             ON public.notice_service_receipts (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 12. ocr_extractions
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='ocr_extractions'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS ocr_extractions_tenant_id_idx
             ON public.ocr_extractions (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 13. verification_badges
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_badges'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS verification_badges_tenant_id_idx
             ON public.verification_badges (tenant_id, created_at DESC NULLS LAST)';
  END IF;
END $$;

-- 14. audit_trail_daily_summary — VIEW (0111), no physical index target.
--     The underlying audit_trail_entries table already carries the
--     (tenant_id, occurred_at) index from 0111. A future migration
--     that converts this view to MATERIALIZED should re-issue the
--     index here.

-- Operator sanity check after this migration runs:
--   SELECT t.relname,
--          (SELECT count(*) FROM pg_indexes
--             WHERE schemaname='public'
--               AND tablename=t.relname
--               AND indexname = t.relname || '_tenant_id_idx') AS has_z_mig_idx
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
--   ...should show has_z_mig_idx = 1 for every row.
--
--   SELECT indexname FROM pg_indexes WHERE schemaname='public'
--     AND indexname IN ('payments_external_reference_idx',
--                       'users_phone_idx',
--                       'users_last_activity_idx');
--   ...should return all three rows.
