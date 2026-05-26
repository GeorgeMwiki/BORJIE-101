-- =============================================================================
-- 0176: Create the missing `owner_statements` table referenced by 0124.
--
-- Closes Z-MIG verifier finding: migration 0124 (Wave-4 D9 query indexes)
-- contains
--
--     CREATE INDEX IF NOT EXISTS owner_statements_tenant_status_period_idx
--       ON owner_statements (tenant_id, status, period_start);
--
-- but no earlier SQL migration ever issues a `CREATE TABLE owner_statements`
-- — the table is defined only in the Drizzle schema
-- (packages/database/src/schemas/payment.schema.ts) and was historically
-- created by a Drizzle auto-migration that was never copied into the
-- canonical packages/database/src/migrations/ tree. On a fresh DB apply,
-- 0124 therefore fails with:
--
--     ERROR:  relation "owner_statements" does not exist
--
-- 0124 is already merged (forbidden to edit), so this migration fixes
-- forward: create the table now, then re-issue the index that 0124 failed
-- to create. After this migration runs, the Wave-4 D9 pdf-renderer
-- draft-drain query (tenant_id, status='draft', period_start = ?) has its
-- intended composite index.
--
-- DDL mirrors `packages/database/src/schemas/payment.schema.ts` lines
-- 672-759 — every column the schema declares is included here, with the
-- exact Postgres types Drizzle emits (text, integer, jsonb, timestamptz).
-- The `owner_statement_status` enum is also created if missing.
--
-- Idempotent: CREATE TABLE / TYPE / INDEX all IF NOT EXISTS. Safe to
-- re-run; safe on a fresh DB; safe on a Drizzle-managed DB where the
-- table already exists.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1. owner_statement_status enum (matches payment.schema.ts:433-439).
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'owner_statement_status'
  ) THEN
    CREATE TYPE owner_statement_status AS ENUM (
      'draft',
      'pending_review',
      'approved',
      'sent',
      'acknowledged'
    );
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. owner_statements table (matches payment.schema.ts:672-759).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.owner_statements (
  id                       text PRIMARY KEY,
  tenant_id                text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  property_id              text NOT NULL,
  owner_id                 text NOT NULL,

  -- Identity
  statement_number         text NOT NULL,

  -- Period
  period_start             timestamptz NOT NULL,
  period_end               timestamptz NOT NULL,

  -- Status
  status                   owner_statement_status NOT NULL DEFAULT 'draft',

  -- Summary (minor-units integers)
  gross_rent_collected     integer NOT NULL DEFAULT 0,
  other_income             integer NOT NULL DEFAULT 0,
  total_income             integer NOT NULL DEFAULT 0,

  management_fee           integer NOT NULL DEFAULT 0,
  maintenance_expenses     integer NOT NULL DEFAULT 0,
  other_expenses           integer NOT NULL DEFAULT 0,
  total_expenses           integer NOT NULL DEFAULT 0,

  net_income               integer NOT NULL DEFAULT 0,

  -- Disbursement
  amount_due               integer NOT NULL DEFAULT 0,
  amount_disbursed         integer NOT NULL DEFAULT 0,
  disbursed_at             timestamptz,
  disbursement_ref         text,

  currency                 text NOT NULL,

  -- Line items
  income_line_items        jsonb DEFAULT '[]'::jsonb,
  expense_line_items       jsonb DEFAULT '[]'::jsonb,

  -- Occupancy summary
  occupancy_summary        jsonb DEFAULT '{}'::jsonb,

  -- Document
  pdf_url                  text,

  -- Approval
  approved_at              timestamptz,
  approved_by              text,

  -- Sending
  sent_at                  timestamptz,
  sent_by                  text,
  delivery_channel         text,

  -- Acknowledgment
  acknowledged_at          timestamptz,

  -- Notes
  internal_notes           text,
  owner_notes              text,

  -- Timestamps
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               text,
  updated_by               text
);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Indexes (matches payment.schema.ts:743-758) + the index that 0124
--    failed to create on a fresh DB.
-- ─────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS owner_statements_tenant_idx
  ON public.owner_statements (tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS owner_statements_statement_number_tenant_idx
  ON public.owner_statements (tenant_id, statement_number);

CREATE INDEX IF NOT EXISTS owner_statements_property_idx
  ON public.owner_statements (property_id);

CREATE INDEX IF NOT EXISTS owner_statements_owner_idx
  ON public.owner_statements (owner_id);

CREATE INDEX IF NOT EXISTS owner_statements_period_idx
  ON public.owner_statements (period_start, period_end);

CREATE INDEX IF NOT EXISTS owner_statements_status_idx
  ON public.owner_statements (status);

-- The index that 0124 failed to create on a fresh DB — re-issue here.
-- Wave-4 D9 pdf-renderer draft-drain pattern:
--   WHERE tenant_id = ? AND status = 'draft' (AND period_start = ?)
CREATE INDEX IF NOT EXISTS owner_statements_tenant_status_period_idx
  ON public.owner_statements (tenant_id, status, period_start);

COMMENT ON TABLE public.owner_statements IS
  'Wave-4 D9 — Per-owner monthly statement. Drains via pdf-renderer when '
  'status=''draft''. Schema matches packages/database/src/schemas/'
  'payment.schema.ts:672-759. Created retroactively by migration 0176 '
  'after Z-MIG verifier flagged 0124 as referencing a missing relation.';
