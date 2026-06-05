-- =============================================================================
-- Migration 0173 — seller_ratings (WS-2 post-settlement seller reputation)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- WS-2 DoD: "buyer can ... rate post-delivery". After a buyer signs delivery
-- (services/api-gateway/src/routes/marketplace/rfb-responses.hono.ts →
-- SettlementOrchestrator.signDelivery, which writes one `settlements` row per
-- RFB-response and posts the double-entry ledger journal), the buyer may leave
-- exactly one star rating for the seller they transacted with. Those ratings
-- aggregate into a reputation score surfaced on the seller's org profile.
--
-- RATING MODEL — one rating per settlement
-- ----------------------------------------
-- A rating is anchored to a `settlement_id` (settlements.id) so a rating can
-- only exist once a real, ledger-backed settlement has occurred — there is no
-- "rate without buying". `settlement_id` is UNIQUE → one rating per settlement
-- (a retried POST is therefore idempotent at the DB layer, never a double
-- rating). `seller_tenant_id` + `seller_id` are denormalised from
-- request_for_bid_responses so the reputation aggregate (AVG/COUNT by seller)
-- is a single-table scan.
--
-- RLS (CLAUDE.md hard rule: FORCE on every tenant-scoped table)
-- ------------------------------------------------------------
-- `tenant_id` = the RATER's tenant (== the buyer's settlement tenant). Standard
-- strict tenant isolation on current_setting('app.current_tenant_id', true) for
-- BOTH read and write — a buyer only ever sees / writes ratings in their own
-- tenant. The reputation AGGREGATE read (AVG stars for a seller across all
-- tenants) is computed by a SECURITY DEFINER function below so the public
-- reputation number is visible to a prospective buyer without weakening the
-- per-row tenant isolation on the underlying table.
--
-- FORWARD-ONLY / IMMUTABLE per CLAUDE.md "Migrations are immutable". Idempotent
-- (IF NOT EXISTS + DROP/CREATE POLICY pairs + pg_roles anon guard). Safe to
-- re-run. tenant_id is TEXT to match tenants.id TEXT heritage (see 0150).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS seller_ratings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RATER's tenant (the buyer's settlement tenant). TEXT — see 0150.
  tenant_id         text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The ledger-backed settlement this rating attests to. UNIQUE → one rating
  -- per settlement (idempotent re-POST short-circuits).
  settlement_id     uuid        NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  -- Denormalised from the settlement's response so reputation aggregates are
  -- a single-table read.
  rfb_response_id   uuid        NOT NULL,
  -- The rated seller's tenant + user id (denormalised from
  -- request_for_bid_responses). seller_tenant_id is the org-profile key.
  seller_tenant_id  text        NOT NULL,
  seller_id         text        NOT NULL,
  rater_user_id     text        NOT NULL,
  -- 1..5 stars.
  stars             integer     NOT NULL,
  comment           text,
  provenance        jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT seller_ratings_stars_chk CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT seller_ratings_comment_len_chk
    CHECK (comment IS NULL OR char_length(comment) <= 2000),
  -- One rating per settlement.
  CONSTRAINT seller_ratings_settlement_unique UNIQUE (settlement_id)
);

-- Reputation aggregate hot path: AVG(stars) / COUNT(*) grouped by seller.
CREATE INDEX IF NOT EXISTS seller_ratings_seller_tenant_idx
  ON seller_ratings (seller_tenant_id, created_at);

CREATE INDEX IF NOT EXISTS seller_ratings_seller_id_idx
  ON seller_ratings (seller_id, created_at);

CREATE INDEX IF NOT EXISTS seller_ratings_tenant_idx
  ON seller_ratings (tenant_id, created_at);

-- -----------------------------------------------------------------------------
-- Row-level security — FORCE per CLAUDE.md hard rule. Strict tenant isolation
-- on the rater's tenant for BOTH read + write. tenant_id is TEXT → bare GUC
-- compare (mirrors 0150).
-- -----------------------------------------------------------------------------

ALTER TABLE seller_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_ratings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS seller_ratings_tenant_isolation ON seller_ratings;
CREATE POLICY seller_ratings_tenant_isolation ON seller_ratings
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.seller_ratings FROM anon;';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Reputation aggregate — SECURITY DEFINER so a prospective buyer can read a
-- seller's PUBLIC reputation (avg stars + count) across all tenants without
-- weakening the per-row tenant isolation above. Returns only aggregates, never
-- a row's tenant_id / rater identity. STABLE: same inputs → same output within
-- a statement.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION seller_reputation(p_seller_tenant_id text)
RETURNS TABLE (rating_count bigint, average_stars numeric)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $fn$
  SELECT
    COUNT(*)::bigint AS rating_count,
    ROUND(AVG(stars)::numeric, 2) AS average_stars
  FROM seller_ratings
  WHERE seller_tenant_id = p_seller_tenant_id;
$fn$;

COMMENT ON TABLE seller_ratings IS
  'WS-2 post-settlement seller ratings. One row per settlements row '
  '(settlement_id UNIQUE → one rating per ledger-backed deal; idempotent '
  're-POST). tenant_id = rater (buyer) tenant. RLS FORCE strict tenant '
  'isolation. Reputation aggregate via seller_reputation() SECURITY DEFINER. '
  'Created in migration 0173.';

COMMENT ON FUNCTION seller_reputation(text) IS
  'Public seller reputation aggregate (count + avg stars) by seller_tenant_id. '
  'SECURITY DEFINER so the score is visible cross-tenant while seller_ratings '
  'rows stay tenant-isolated. Returns aggregates only — never rater identity.';

COMMIT;
