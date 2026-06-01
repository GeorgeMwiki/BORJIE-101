-- =============================================================================
-- Migration 0161 — Settlements money columns: numeric(15,2) FLOAT -> BIGINT
--                   INTEGER minor units (whole TZS).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- 0131_settlements.sql stored gross_tzs / royalty_tzs / fee_tzs / net_tzs as
-- numeric(15,2). That is WRONG for the platform's money model on two counts:
--
--   1. CLAUDE.md hard rule + the rest of the money path (accounts /
--      ledger_entries / payment_intents — see 0160) store money as INTEGER
--      MINOR UNITS, never float / numeric. A numeric(15,2) column invites
--      fractional-cent drift and forces float<->int conversions at every
--      ledger boundary.
--
--   2. TZS is a ZERO-DECIMAL currency: the minor unit IS the whole shilling.
--      Carrying `.2` scale on a 0-decimal currency is meaningless precision
--      and a rounding hazard. The correct representation is a whole-shilling
--      integer.
--
-- numeric(15,2) also caps the magnitude at 13 integer digits; a large
-- gold/tanzanite settlement in TZS can approach/overflow that. BIGINT
-- (up to 9.22e18) removes the overflow risk entirely.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- ALTER the four money columns to BIGINT, converting in place with
-- `round(col)::bigint`. `round()` collapses the (already whole-shilling in
-- practice) numeric values to the nearest integer so the cast cannot fail on
-- a stray fractional value (dev data). The settlements table is buyer->owner
-- payout settlement; on dev/staging it holds at most demo rows, so the
-- in-place rewrite is safe.
--
-- The companion service-code sibling (settlement orchestrator math in the
-- commercial-chain service) must switch its gross/royalty/fee/net arithmetic
-- to INTEGER minor units (BIGINT) — see the post-condition note at the tail.
--
-- CONSTRAINT INTERACTION
-- ----------------------
-- 0131 defined CHECK constraints that reference these columns:
--   settlements_gross_positive_chk  (gross_tzs > 0)
--   settlements_royalty_nonneg_chk  (royalty_tzs >= 0)
--   settlements_fee_nonneg_chk      (fee_tzs >= 0)
--   settlements_net_positive_chk    (net_tzs > 0)
--   settlements_math_chk            (net_tzs = gross_tzs - royalty_tzs - fee_tzs)
-- All five are preserved AS-IS: the comparisons / subtraction are valid on
-- BIGINT and the value identities hold after a uniform round() (x>0 stays
-- x>0; a-b-c identity is preserved when each side is rounded to whole
-- shillings, which the source data already is). PostgreSQL re-checks each
-- constraint against the new column type automatically on ALTER TYPE, so we
-- do NOT drop/recreate them.
--
-- IDEMPOTENT / FORWARD-ONLY: each ALTER is guarded by an information_schema
-- check that fires ONLY while the column is still a non-bigint type, so a
-- re-run (or a DB already on bigint) is a no-op. Append-only per CLAUDE.md
-- "Migrations are immutable".
-- =============================================================================

BEGIN;

DO $$
DECLARE
  money_cols text[] := ARRAY['gross_tzs', 'royalty_tzs', 'fee_tzs', 'net_tzs'];
  col text;
  cur_type text;
BEGIN
  -- Only act when the settlements table exists (safe on a shard that never
  -- created it).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'settlements'
  ) THEN
    RAISE NOTICE 'settlements table absent — 0161 is a no-op on this DB';
    RETURN;
  END IF;

  FOREACH col IN ARRAY money_cols LOOP
    SELECT data_type
      INTO cur_type
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'settlements'
       AND column_name  = col;

    -- Convert only if the column is still present and not already bigint.
    -- information_schema reports bigint as 'bigint'; numeric reports 'numeric'.
    IF cur_type IS NOT NULL AND cur_type <> 'bigint' THEN
      EXECUTE format(
        'ALTER TABLE public.settlements '
          || 'ALTER COLUMN %I TYPE bigint USING round(%I)::bigint;',
        col, col
      );
      RAISE NOTICE 'settlements.% converted % -> bigint (whole TZS minor units)', col, cur_type;
    END IF;
  END LOOP;
END $$;

COMMENT ON COLUMN settlements.gross_tzs IS
  'Gross settlement in WHOLE TZS (BIGINT minor units — TZS is 0-decimal). '
  'Converted from numeric(15,2) in 0161 to match the integer-minor-units '
  'money model (accounts/ledger_entries/payment_intents).';
COMMENT ON COLUMN settlements.royalty_tzs IS
  'Royalty in WHOLE TZS (BIGINT minor units). See 0161.';
COMMENT ON COLUMN settlements.fee_tzs IS
  'Platform fee in WHOLE TZS (BIGINT minor units). See 0161.';
COMMENT ON COLUMN settlements.net_tzs IS
  'Net payout in WHOLE TZS (BIGINT minor units). '
  'net_tzs = gross_tzs - royalty_tzs - fee_tzs (settlements_math_chk). See 0161.';

COMMIT;

-- Operator / sibling note: after 0161 the settlements money columns are
-- BIGINT whole-TZS minor units. The settlement orchestrator service code that
-- computes gross = tonnage * price, royalty, fee, and
-- net = gross - royalty - fee MUST do this arithmetic in INTEGER minor units
-- (BIGINT) and stop round-tripping through float/numeric. Any Drizzle schema
-- for `settlements` must type these four columns as `bigint('...', { mode:
-- 'number' | 'bigint' })`, NOT `numeric`.
