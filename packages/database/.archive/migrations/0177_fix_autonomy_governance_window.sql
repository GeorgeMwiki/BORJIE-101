-- =============================================================================
-- 0177: Quote the reserved word `window` in `sub_md_slos` (fix-forward for 0160).
--
-- Closes Z-MIG verifier finding: migration 0160 declares
--
--     CREATE TABLE IF NOT EXISTS sub_md_slos (
--       ...
--       window text NOT NULL,
--       ...
--       CONSTRAINT sub_md_slos_window_chk
--         CHECK (window IN ('rolling-24h', 'rolling-7d', 'rolling-30d'))
--     );
--
-- `window` is a RESERVED WORD in PostgreSQL (used by the window function
-- syntax — `OVER (window_def)`). Postgres tolerates it in some contexts
-- via implicit quoting, but the unquoted `CHECK (window IN (...))` form
-- raises:
--
--     ERROR:  syntax error at or near "IN"
--     LINE 1: ...CHECK (window IN ('rolling-24h', 'rolling-7d', 'rolling-3...
--
-- on Postgres 15+. The portable fix is to double-quote the identifier
-- so it is always parsed as a column reference: `"window" IN (...)`.
--
-- 0160 is already merged (forbidden to edit), so this migration fixes
-- forward by:
--
--   1. Detecting whether the table actually exists (it won't on a fresh
--      DB where 0160 failed mid-CREATE-TABLE).
--   2. If absent → CREATE TABLE with `"window"` quoted everywhere it
--      appears in DDL.
--   3. If present (e.g. a Drizzle-managed DB or a partial-apply that got
--      past the CREATE) → ALTER TABLE … ADD CONSTRAINT IF NOT EXISTS
--      to re-install the CHECK constraint with the quoted identifier.
--
-- The reserved-word issue affects ONLY the CHECK constraint expression
-- in 0160; the `window text NOT NULL` column declaration parses fine in
-- DDL context because `window` is allowed as a column-name token there.
-- That is why some operators saw 0160 succeed; the failure surfaces only
-- when the CHECK constraint expression is parsed. We therefore focus the
-- fix on the constraint, not the column.
--
-- Idempotent: every operation gated on existence checks. Safe to re-run
-- on a partial-apply DB and safe on a fresh DB.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. Ensure the table itself exists. If 0160 succeeded, this is a no-op.
--    If 0160 failed before CREATE TABLE finished, create the table with
--    the constraint correctly quoted.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.sub_md_slos (
  sub_md         text         NOT NULL,
  tenant_id      text         REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric         text         NOT NULL,
  target         numeric(12,6) NOT NULL,
  "window"       text         NOT NULL,
  breach_action  text         NOT NULL,
  canary_stage   text         NOT NULL DEFAULT 'shadow',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (sub_md, tenant_id, metric)
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Re-install the four CHECK constraints from 0160 §2 with the
--    `"window"` identifier quoted. ADD CONSTRAINT IF NOT EXISTS landed
--    in PG 9.6 for ALTER TABLE; use the DROP+ADD pattern with a NOT
--    EXISTS guard for max portability.
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_md_slos_breach_action_chk'
      AND conrelid = 'public.sub_md_slos'::regclass
  ) THEN
    ALTER TABLE public.sub_md_slos
      ADD CONSTRAINT sub_md_slos_breach_action_chk
      CHECK (breach_action IN ('warn', 'reduce-traffic', 'handoff', 'kill-and-rollback'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_md_slos_window_chk'
      AND conrelid = 'public.sub_md_slos'::regclass
  ) THEN
    ALTER TABLE public.sub_md_slos
      ADD CONSTRAINT sub_md_slos_window_chk
      CHECK ("window" IN ('rolling-24h', 'rolling-7d', 'rolling-30d'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_md_slos_canary_stage_chk'
      AND conrelid = 'public.sub_md_slos'::regclass
  ) THEN
    ALTER TABLE public.sub_md_slos
      ADD CONSTRAINT sub_md_slos_canary_stage_chk
      CHECK (canary_stage IN ('shadow', 'canary-1pct', 'canary-5pct', 'canary-25pct', 'live'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sub_md_slos_metric_chk'
      AND conrelid = 'public.sub_md_slos'::regclass
  ) THEN
    ALTER TABLE public.sub_md_slos
      ADD CONSTRAINT sub_md_slos_metric_chk
      CHECK (metric IN ('resolution-quality', 'task-completion-rate', 'owner-cs-score', 'cost-per-resolution'));
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Re-install the indexes from 0160 §2 — `"window"` doesn't appear in
--    them, so this is purely defensive in case 0160 aborted before the
--    indexes were created.
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sub_md_slos_metric
  ON public.sub_md_slos (sub_md, metric);

CREATE INDEX IF NOT EXISTS idx_sub_md_slos_tenant
  ON public.sub_md_slos (tenant_id);

CREATE INDEX IF NOT EXISTS idx_sub_md_slos_canary
  ON public.sub_md_slos (canary_stage);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sub_md_slos_platform_default
  ON public.sub_md_slos (sub_md, metric)
  WHERE tenant_id IS NULL;

COMMENT ON COLUMN public.sub_md_slos."window" IS
  '0177 — Time window for the SLO. Quoted because `window` is a reserved '
  'word in PostgreSQL. Allowed values enforced by sub_md_slos_window_chk.';
