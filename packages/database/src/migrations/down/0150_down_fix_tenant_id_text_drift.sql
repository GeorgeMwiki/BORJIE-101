-- =============================================================================
-- Down — Migration 0150 — Fix text/uuid tenant_id drift in 0127, 0128, 0129
--
-- Drops the four tables created in the up migration. Order respects
-- the FK from request_for_bid_responses.rfb_id → request_for_bids.id.
--
-- Data loss: YES — all rows in the four tables are removed.
-- Envs: dev, staging only. NEVER run on prod.
--
-- Note on relationship to 0127/0128/0129:
--   The original migrations (0127, 0128, 0129) declared `tenant_id UUID`
--   which fails FK creation against the live `tenants.id text` column,
--   so they never actually created the tables on the dev DB. Rolling
--   back 0150 therefore returns the DB to the pre-0150 state, which
--   matches the pre-0127 state for these four tables. The runner will
--   still skip 0127/0128/0129 on the next forward run (they remain
--   unmarked because they fail), so re-applying 0150 is the only path
--   forward.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS request_for_bid_responses CASCADE;
DROP TABLE IF EXISTS request_for_bids CASCADE;
DROP TABLE IF EXISTS owner_delegation_prefs CASCADE;
DROP TABLE IF EXISTS mwikila_actions_inbox CASCADE;

DELETE FROM drizzle.__drizzle_migrations
  WHERE hash = '0150_fix_tenant_id_text_drift';

COMMIT;
