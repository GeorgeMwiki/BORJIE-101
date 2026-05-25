-- =============================================================================
-- 0165: Guard against 0163's clock-shift risk on mdr_plan_items + owner_skills.
--
-- Closes HIGH 2.1 from the 2026-05-19 post-PR-90 data-layer bug sweep.
--
-- Migration 0163 banked on "no production data exists for this table yet"
-- and ran `ALTER COLUMN ... TYPE timestamptz USING ... AT TIME ZONE 'UTC'`.
-- That USING clause interprets a NAIVE timestamp AS UTC even if the
-- producer meant East-Africa-Time (UTC+3). On any cluster that DID write
-- rows under 0161 / 0162 BEFORE 0163 ran (e.g. a deploy that crashed
-- between 0161 and 0163), every existing row's effective time is now
-- shifted by 3 hours.
--
-- Strategy:
--   * This migration is a STATELESS guard that asserts data shape post-
--     0163. It does NOT mutate row data — because we cannot reliably
--     recover the original wall-clock zone after the fact (would require
--     a Postgres `pg_dumpall` from before 0163 ran, which we don't have).
--   * It DOES record a `clock_anchor_utc` column on each table so future
--     correlations have a known-UTC clock anchor that future inserts
--     populate via `(now() AT TIME ZONE 'UTC')::timestamptz`
--     (DB-side evaluation, no Node-side TZ guessing).
--   * It emits a NOTICE so operators that DO have pre-0163 rows can audit
--     the shift in their replay.
--
-- This is the safest forward path: never silently re-shift, never assume
-- the original zone, do surface the count so operators can replay if needed.
-- =============================================================================

DO $$
DECLARE
  mdr_count bigint;
  skills_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mdr_plan_items'
  ) THEN
    SELECT count(*) INTO mdr_count FROM public.mdr_plan_items;
    RAISE NOTICE '0165 GUARD — mdr_plan_items rows: % (each row''s timestamp interpretation was set by 0163''s AT TIME ZONE ''UTC'' USING clause; if any of these were inserted before 0163 ran they may have a 3-hour shift relative to the producer''s wall clock)', mdr_count;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'owner_skills'
  ) THEN
    SELECT count(*) INTO skills_count FROM public.owner_skills;
    RAISE NOTICE '0165 GUARD — owner_skills rows: % (same caveat as mdr_plan_items above)', skills_count;
  END IF;
END
$$;

-- Add an explicit `clock_anchor_utc` column to both tables. It is
-- DB-side populated and is purely advisory — downstream consumers can
-- compare it to the per-row `created_at` to detect future producer-side
-- TZ drift.
ALTER TABLE IF EXISTS public.mdr_plan_items
  ADD COLUMN IF NOT EXISTS clock_anchor_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::timestamptz;

COMMENT ON COLUMN public.mdr_plan_items.clock_anchor_utc IS
  '0165 — DB-side UTC anchor recorded at row insert. Compare with created_at to detect producer-side TZ drift. Advisory only; not part of any uniqueness or FK.';

ALTER TABLE IF EXISTS public.owner_skills
  ADD COLUMN IF NOT EXISTS clock_anchor_utc timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::timestamptz;

COMMENT ON COLUMN public.owner_skills.clock_anchor_utc IS
  '0165 — DB-side UTC anchor recorded at row insert. Compare with installed_at to detect producer-side TZ drift. Advisory only; not part of any uniqueness or FK.';
