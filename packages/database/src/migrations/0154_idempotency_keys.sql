-- =============================================================================
-- Migration 0154 - Idempotency Keys (hard DB-level uniqueness)
--
-- Closes H2 deferral: the prior `services/api-gateway/src/middleware/
-- idempotency.ts` cached responses in Redis but had NO server-side
-- hard uniqueness. Under a Redis split-brain (or before the first
-- replica SETEXes) two simultaneous duplicate requests could both
-- pass through to the handler and double-execute side effects.
--
-- This table is the canonical dedup record. The middleware INSERTs
-- BEFORE invoking the handler — a duplicate INSERT collides on the
-- unique constraint and is treated as a replay. After the handler
-- runs the row is UPDATEd with the captured response so the next
-- replay returns the same status / body / headers.
--
-- Companion to:
--   - services/api-gateway/src/middleware/db-idempotency.middleware.ts
--   - services/api-gateway/src/composition/idempotency-sweeper.ts
--   - packages/database/src/schemas/idempotency-keys.schema.ts
--
-- Tenant scope: `tenant_id` is NULL for anonymous (webhook) calls,
-- in which case the unique scope is (key, resource_kind, NULL). For
-- authenticated calls the scope is (tenant_id, key, resource_kind).
-- Partial unique indexes per nullability variant defeat PostgreSQL's
-- NULL-distinct UNIQUE semantics.
--
-- RLS is FORCE-enabled per CLAUDE.md hard rule. Tenant context is
-- bound by api-gateway middleware via `app.current_tenant_id`.
--
-- Append-only / forward-only / IMMUTABLE per CLAUDE.md hard rule:
-- never edit this file after merge.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text,                                   -- NULL for anonymous (webhook)
  key             text        NOT NULL,                   -- Idempotency-Key header value
  resource_kind   text        NOT NULL,                   -- e.g. 'webhook.mpesa' | 'owner.bulk-action'
  request_hash    text        NOT NULL,                   -- sha256(method + path + body)
  response_status integer,                                -- populated on completion
  response_body   jsonb,                                  -- populated on completion
  response_headers jsonb,                                 -- populated on completion
  state           text        NOT NULL DEFAULT 'in_flight',
  actor_id        text,                                   -- requesting user / agent
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'idempotency_keys_state_chk'
  ) THEN
    ALTER TABLE idempotency_keys
      ADD CONSTRAINT idempotency_keys_state_chk
      CHECK (state IN ('in_flight', 'completed', 'failed'));
  END IF;
END $$;

-- Authenticated scope: (tenant_id, key, resource_kind) — UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_tenant_unique
  ON idempotency_keys (tenant_id, key, resource_kind)
  WHERE tenant_id IS NOT NULL;

-- Anonymous scope: (key, resource_kind) when tenant is NULL — UNIQUE.
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_anon_unique
  ON idempotency_keys (key, resource_kind)
  WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx
  ON idempotency_keys (expires_at);

CREATE INDEX IF NOT EXISTS idempotency_keys_state_idx
  ON idempotency_keys (state, created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'idempotency_keys'
       AND policyname = 'idempotency_keys_tenant_isolation'
  ) THEN
    CREATE POLICY idempotency_keys_tenant_isolation
      ON idempotency_keys
      FOR ALL
      USING (
        (tenant_id IS NOT NULL
          AND tenant_id = current_setting('app.current_tenant_id', true))
        OR
        (tenant_id IS NULL
          AND coalesce(current_setting('app.current_tenant_id', true), '') = '')
      )
      WITH CHECK (
        (tenant_id IS NOT NULL
          AND tenant_id = current_setting('app.current_tenant_id', true))
        OR
        (tenant_id IS NULL
          AND coalesce(current_setting('app.current_tenant_id', true), '') = '')
      );
  END IF;
END $$;

COMMIT;
