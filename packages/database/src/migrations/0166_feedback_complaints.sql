-- =============================================================================
-- Migration 0166 — feedback_submissions + complaint_records: RE-MATERIALISE the
-- Wave 18 feedback/complaint persistence layer (originally migration 0092).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- services/api-gateway/src/routes/feedback.ts imports `feedbackSubmissions` and
-- `complaintRecords` from @borjie/database, but both tables had been archived
-- (the 0092 migration + their schema moved to .archive). With nothing backing
-- the imports the barrel type resolution broke and every feedback/complaint
-- route (POST /api/v1/feedback, /complaints, GET …) failed at runtime. This
-- migration restores the two tables; companion schema lives in
-- packages/database/src/schemas/feedback.schema.ts.
--
-- SOURCE OF TRUTH = THE ROUTE CODE
-- --------------------------------
-- Column names / types / nullability / defaults / CHECK sets are dictated by
-- what feedback.ts writes + reads. Two deliberate differences from the archived
-- 0092 file (the code is canonical):
--   * feedback_submissions.type ADMITS 'turn-thumbs' (the Jarvis 👍/👎 path
--     writes it). The 0092 CHECK omitted it, which would have rejected that
--     insert at runtime; the CHECK below includes it.
--   * user_id is NOT NULL on both tables (the route always writes auth.userId,
--     and the sibling support_cases / 0164 carries user_id NOT NULL). 0092 had
--     it nullable; nothing in the code relies on the nullable form.
--   * No tenants(id) FK (0092 had one). We mirror the 0164 support_cases
--     template: tenant_id is a bare TEXT column isolated by FORCE RLS, which
--     keeps the migration forward-only + re-runnable on a vanilla / empty PG.
--
-- NO MONEY COLUMNS. These are feedback/complaint records only — there is
-- nothing money-shaped here for any code path to write by mistake.
--
-- HARD RULES HONOURED
-- -------------------
--   * Tenant-scoped tables -> FORCE ROW LEVEL SECURITY + a tenant policy on
--     current_setting('app.current_tenant_id', true) (mirrors 0162/0163/0164's
--     CORRECT GUC; never the legacy app.tenant_id). REVOKE anon (guarded for
--     vanilla PG / CI empty-PG).
--   * user_id is carried for per-user scoping but RLS isolates by TENANT; the
--     app additionally predicates on user_id where relevant (belt-and-braces).
--
-- IDEMPOTENT / FORWARD-ONLY: CREATE TABLE / INDEX IF NOT EXISTS + pg_policies
-- existence guard + pg_roles anon guard. Safe to re-run. Append-only per
-- CLAUDE.md "Migrations are immutable".
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- §1 — feedback_submissions
--
-- `type` admits the legacy survey enum AND 'turn-thumbs' (the Jarvis thumbs
-- click shares this table with a stable discriminator). `context` is a free-
-- form jsonb bag (the turn-thumbs path stores turnId/threadId/signal/correction
-- text). status / type are TEXT with CHECK constraints (small closed enums) —
-- no pg_enum so the migration stays forward-only + re-runnable.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  type              TEXT NOT NULL
                      CHECK (type IN ('general','bug','feature','improvement','turn-thumbs')),
  subject           TEXT NOT NULL,
  message           TEXT NOT NULL,
  rating            INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  context           JSONB DEFAULT '{}'::jsonb,
  status            TEXT NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted','reviewing','resolved','closed')),
  reviewed_by       TEXT,
  reviewed_at       TIMESTAMPTZ,
  resolution_notes  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-scoped list, newest first (GET / ordering hot path).
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_tenant_created
  ON feedback_submissions (tenant_id, created_at DESC);

-- Tenant + status listing.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status
  ON feedback_submissions (tenant_id, status);

-- Backs the `?type=` filter on GET /.
CREATE INDEX IF NOT EXISTS idx_feedback_submissions_type
  ON feedback_submissions (tenant_id, type);

-- -----------------------------------------------------------------------------
-- §2 — complaint_records
--
-- Carries a resolve state machine: open -> (in_progress) -> resolved | closed.
-- The PUT /complaints/:id/resolve handler stamps status='resolved' + resolution
-- + resolution_notes + resolved_by + resolved_at + updated_at. category /
-- priority / status are TEXT with CHECK constraints.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS complaint_records (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  user_id               TEXT NOT NULL,
  subject               TEXT NOT NULL,
  description           TEXT NOT NULL,
  category              TEXT NOT NULL DEFAULT 'other'
                          CHECK (category IN ('maintenance','neighbor','payment','lease','other')),
  related_entity_type   TEXT,
  related_entity_id     TEXT,
  priority              TEXT NOT NULL DEFAULT 'medium'
                          CHECK (priority IN ('low','medium','high','urgent')),
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','in_progress','resolved','closed')),
  resolution            TEXT,
  resolution_notes      TEXT,
  resolved_by           TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tenant-scoped list, newest first.
CREATE INDEX IF NOT EXISTS idx_complaint_records_tenant_created
  ON complaint_records (tenant_id, created_at DESC);

-- Tenant + status triage listing.
CREATE INDEX IF NOT EXISTS idx_complaint_records_status
  ON complaint_records (tenant_id, status);

-- Tenant + priority + status (queue prioritisation).
CREATE INDEX IF NOT EXISTS idx_complaint_records_priority
  ON complaint_records (tenant_id, priority, status);

-- -----------------------------------------------------------------------------
-- §3 — FORCE RLS + tenant-isolation policy on BOTH tables.
--
-- Mirrors 0164 §2: current_setting('app.current_tenant_id', true). tenant_id is
-- TEXT so the compare is bare. FOR ALL covers the repo's INSERT + the list /
-- single SELECT + the resolve UPDATE. Idempotent: ENABLE/FORCE are no-ops if
-- already set; each policy guarded by a pg_policies existence check; anon REVOKE
-- guarded by a pg_roles existence check (anon is a Supabase construct — guard so
-- the migration still applies on a vanilla Postgres / CI empty-PG).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  -- feedback_submissions ------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'feedback_submissions'
  ) THEN
    EXECUTE 'ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.feedback_submissions FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'feedback_submissions'
        AND policyname = 'feedback_submissions_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY feedback_submissions_tenant_isolation ON public.feedback_submissions
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.feedback_submissions FROM anon;';
    END IF;
  END IF;

  -- complaint_records ---------------------------------------------------------
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'complaint_records'
  ) THEN
    EXECUTE 'ALTER TABLE public.complaint_records ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.complaint_records FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'complaint_records'
        AND policyname = 'complaint_records_tenant_isolation'
    ) THEN
      EXECUTE $pol$
        CREATE POLICY complaint_records_tenant_isolation ON public.complaint_records
        FOR ALL
        USING (tenant_id = current_setting('app.current_tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
      $pol$;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.complaint_records FROM anon;';
    END IF;
  END IF;
END $$;

COMMENT ON TABLE feedback_submissions IS
  'Wave 18 feedback: long-form survey feedback + Jarvis turn-thumbs signal '
  '(type=''turn-thumbs''). Tenant-scoped; RLS FORCE on app.current_tenant_id. '
  'NO money columns. Re-materialised in 0166 (originally 0092).';

COMMENT ON TABLE complaint_records IS
  'Wave 18 complaints: owner/tenant complaints with an open->resolved state '
  'machine. Tenant-scoped; RLS FORCE on app.current_tenant_id. NO money '
  'columns. Re-materialised in 0166 (originally 0092).';

COMMIT;
