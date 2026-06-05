-- =============================================================================
-- Migration 0172 — bid_messages (WS-2 bid chat / messaging)
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The buyer-mobile marketplace surface (apps/buyer-mobile/src/api/marketplace.ts
-- → sendBidMessage / fetchBids) and the chat screens (app/chat/index.tsx,
-- app/bids/[id].tsx) shipped against a backend that did not exist — there was
-- no message store, so a "send" returned nothing real. This table is the
-- canonical thread store for buyer ↔ seller messaging.
--
-- THREAD MODEL — one thread per RFB response
-- ------------------------------------------
-- A "thread" is keyed by `rfb_response_id` (request_for_bid_responses.id). The
-- two participants live in DIFFERENT tenants by construction:
--   * the BUYER  — owns the parent request_for_bids row (tenant = RFB tenant)
--   * the SELLER — owns the request_for_bid_responses row (tenant = response
--                  tenant; the seller's own tenant)
-- The thread is reconstructed by selecting all rows for a given
-- `rfb_response_id` ordered by `created_at ASC`. Rows are APPEND-ONLY.
--
-- RLS (CLAUDE.md hard rule: FORCE on every tenant-scoped table)
-- ------------------------------------------------------------
-- Each row carries `tenant_id` = the SENDER's tenant. Naively scoping reads to
-- `tenant_id = app.current_tenant_id` would hide the counter-party's messages
-- and break the conversation. The RFB marketplace is an explicit, sanctioned
-- cross-tenant surface (a buyer in one tenant negotiates with a seller in
-- another — see services/api-gateway/src/routes/marketplace/rfb.hono.ts). So
-- the read (USING) clause additionally permits a row when the caller's tenant
-- is a PARTICIPANT in the parent RFB / response. The write (WITH CHECK) clause
-- stays strict — a sender can only insert rows stamped with their OWN tenant.
-- RLS therefore enforces "writers are tenant-locked; both negotiation parties
-- may read the shared thread" at the database layer (never disabled, never
-- bypassed by app code).
--
-- IDEMPOTENT SEND (CLAUDE.md hard rule: sends idempotent)
-- ------------------------------------------------------
-- A partial UNIQUE index on (rfb_response_id, sender_id, idempotency_key)
-- WHERE idempotency_key IS NOT NULL gives a hard DB-level dedup: a retried
-- send carrying the same Idempotency-Key collides and the route short-circuits
-- to the already-stored row instead of double-inserting.
--
-- FORWARD-ONLY / IMMUTABLE per CLAUDE.md "Migrations are immutable". Idempotent
-- (IF NOT EXISTS + DROP/CREATE POLICY pairs + pg_roles anon guard). Safe to
-- re-run. tenant_id is TEXT to match tenants.id TEXT heritage (see 0150).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bid_messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SENDER's tenant. TEXT to match tenants.id TEXT (see migration 0150).
  tenant_id         text        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Thread key — the RFB response this conversation hangs off.
  rfb_response_id   uuid        NOT NULL
                                REFERENCES request_for_bid_responses(id) ON DELETE CASCADE,
  -- Denormalised parent RFB id so the participant-read predicate can join
  -- without a second hop, and so the buyer (RFB owner) read path is cheap.
  rfb_id            uuid        NOT NULL
                                REFERENCES request_for_bids(id) ON DELETE CASCADE,
  -- Authoring user id (text — mirrors request_for_bid_responses.seller_id /
  -- request_for_bids.buyer_id which are TEXT user ids).
  sender_id         text        NOT NULL,
  -- 'buyer' (RFB owner) | 'seller' (responder). Drives bubble alignment.
  sender_role       text        NOT NULL,
  body              text        NOT NULL,
  -- Idempotency-Key header value (NULL when the client did not send one).
  idempotency_key   text,
  provenance        jsonb       NOT NULL DEFAULT '{"via":"unknown"}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT bid_messages_sender_role_chk
    CHECK (sender_role IN ('buyer', 'seller')),
  CONSTRAINT bid_messages_body_len_chk
    CHECK (char_length(body) BETWEEN 1 AND 4000)
);

-- Hot path: rebuild a thread (all rows for a response, oldest-first).
CREATE INDEX IF NOT EXISTS bid_messages_response_created_idx
  ON bid_messages (rfb_response_id, created_at);

-- Buyer-side read: "all my threads' messages" join key.
CREATE INDEX IF NOT EXISTS bid_messages_rfb_idx
  ON bid_messages (rfb_id, created_at);

CREATE INDEX IF NOT EXISTS bid_messages_tenant_idx
  ON bid_messages (tenant_id, created_at);

-- Idempotent-send dedup. Partial — only rows that carry an Idempotency-Key
-- participate, so un-keyed messages are never falsely collapsed.
CREATE UNIQUE INDEX IF NOT EXISTS bid_messages_idem_unique
  ON bid_messages (rfb_response_id, sender_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Row-level security — FORCE per CLAUDE.md hard rule.
--
-- READ (USING): own-tenant rows OR rows whose parent RFB/response names the
--   caller's tenant as a participant (the buyer's tenant == request_for_bids
--   .tenant_id; the seller's tenant == request_for_bid_responses.tenant_id).
-- WRITE (WITH CHECK): strict — sender may only stamp their OWN tenant.
-- tenant_id is TEXT so the GUC compare is bare (no cast); mirrors 0150.
-- -----------------------------------------------------------------------------

ALTER TABLE bid_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE bid_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bid_messages_participant_read ON bid_messages;
CREATE POLICY bid_messages_participant_read ON bid_messages
  FOR SELECT
  USING (
    tenant_id = current_setting('app.current_tenant_id', true)
    OR EXISTS (
      SELECT 1 FROM request_for_bid_responses r
       WHERE r.id = bid_messages.rfb_response_id
         AND r.tenant_id = current_setting('app.current_tenant_id', true)
    )
    OR EXISTS (
      SELECT 1 FROM request_for_bids f
       WHERE f.id = bid_messages.rfb_id
         AND f.tenant_id = current_setting('app.current_tenant_id', true)
    )
  );

DROP POLICY IF EXISTS bid_messages_sender_write ON bid_messages;
CREATE POLICY bid_messages_sender_write ON bid_messages
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));

-- anon is a Supabase construct; guard so this still applies on vanilla PG
-- (CI empty-PG migration check / non-Supabase env).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.bid_messages FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE bid_messages IS
  'WS-2 buyer ↔ seller bid chat. One thread per request_for_bid_responses row '
  '(rfb_response_id). Append-only. tenant_id = sender''s tenant. RLS FORCE: '
  'participant-aware READ (both negotiation tenants), tenant-locked WRITE. '
  'Idempotent send via partial unique (rfb_response_id, sender_id, '
  'idempotency_key). Created in migration 0172.';

COMMIT;
