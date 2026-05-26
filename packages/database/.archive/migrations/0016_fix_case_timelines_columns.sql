-- =============================================================================
-- 0016: Fix case_timelines column name drift
-- =============================================================================
-- Migration 0014 created case_timelines with columns `summary` and
-- `details`, but the Drizzle schema (cases.schema.ts) defines `title`
-- and `description`. Application code reads the schema names, so every
-- query gets NULLs for those fields. This migration renames the columns
-- to match the schema without data loss.
-- =============================================================================

-- Rename is idempotent via guards so the migration survives reruns and
-- also survives fresh DBs where the columns were never named summary/details.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'case_timelines' AND column_name = 'summary')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'case_timelines' AND column_name = 'title') THEN
    ALTER TABLE case_timelines RENAME COLUMN summary TO title;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'case_timelines' AND column_name = 'details')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'case_timelines' AND column_name = 'description') THEN
    ALTER TABLE case_timelines RENAME COLUMN details TO description;
  END IF;
END $$;

-- Ensure columns exist after rename (for fresh DBs that went through 0014
-- but never had the old summary/details column names).
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS description TEXT;

-- Also add the extra columns the schema declares but 0014 missed:
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS is_customer_visible BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS previous_value JSONB;
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS new_value JSONB;
ALTER TABLE case_timelines ADD COLUMN IF NOT EXISTS actor_name TEXT;

-- End of 0016
