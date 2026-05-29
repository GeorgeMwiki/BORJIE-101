-- =============================================================================
-- Migration 0141 — Borjie company-brain onboarding state.
--
-- Companion to:
--   - services/api-gateway/src/services/onboarding-jumpstart/* (new)
--   - services/api-gateway/src/services/ingestion-intent-inferrer/* (new)
--   - services/api-gateway/src/routes/owner/brain-ingest.hono.ts (new)
--
-- Wave: COMPANY-BRAIN (C-5 — Day-1 super-powered demo end-to-end).
--
-- One row per tenant — written by `onboarding-jumpstart` after the first
-- corpus_doc_uploads.status='indexed' row lands so we know whether the
-- "Day-1 insights" demo has fired. Subsequent uploads do not re-trigger
-- the jumpstart (the inferrer still runs on every ingest — this row only
-- gates the celebratory chat block + welcome cockpit-event).
--
-- The two surfaces that read this row:
--
--   1. brain-ingest.hono.ts        decides whether to inline the
--                                  Day-1 jumpstart card in the
--                                  ingest receipt
--   2. cockpit home (chat panel)   shows the "Day-1 insights" header
--                                  once, then hides it
--
-- MEMORY DURABILITY: append-only. No DELETE policy. Status is the only
-- mutable column (it transitions pending → ready → demoed exactly once
-- and then never changes again). See Docs/OPS/MEMORY_DURABILITY.md.
--
-- Tenant scope: tenant_id::text = current_setting('app.current_tenant_id', true)
-- RLS: FORCE-enabled per the Borjie hard rule.
--
-- Idempotent (IF NOT EXISTS). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_state (
  tenant_id          uuid          PRIMARY KEY,
  /** When the very first corpus_doc_uploads.status='indexed' row landed. */
  first_ingest_at    timestamptz,
  /** When the Day-1 jumpstart fired (chat block + welcome cockpit-event). */
  jumpstarted_at     timestamptz,
  /** When the first IngestIntent was generated (Y-A). */
  first_intent_at    timestamptz,
  /** Lifecycle. */
  status             text          NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending','ready','demoed','dismissed'
                     )),
  /** Snapshot of the first intent the inferrer produced — kept so the
   *  cockpit can re-render the welcome card without re-running the LLM. */
  first_intent_json  jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS onboarding_state_status_idx
  ON onboarding_state (status);

ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_state FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'current_schema'
       AND tablename  = 'onboarding_state'
       AND policyname = 'onboarding_state_tenant_iso'
  ) THEN
    CREATE POLICY onboarding_state_tenant_iso ON onboarding_state
      USING (tenant_id::text = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

COMMIT;
