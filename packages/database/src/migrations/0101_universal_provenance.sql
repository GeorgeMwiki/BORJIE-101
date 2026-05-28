-- =============================================================================
-- Migration 0101 — Universal Provenance Column
--
-- Wave CHAT-AS-OS-PARITY. Implements principle 4 of the Chat-as-OS
-- Bidirectional Parity Manifesto
-- (`Docs/RESEARCH/CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md`):
--
--   "Every record carries a `provenance` jsonb column —
--    {via: 'chat' | 'form' | 'agent_apply' | 'api', actorId,
--     sessionId, requestedAt, turnId?}"
--
-- Adds the column to every state-mutable table the brain or the
-- product UI writes. Backfills every existing row to
-- `{"via":"legacy","actorId":null,"sessionId":null,
--   "requestedAt":<created_at>}` so old rows render in lists without
-- a "via Mr. Mwikila" pill while new rows carry the path they came
-- from.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS`. Safe to re-run.
-- Forward-only per CLAUDE.md (`Migrations are immutable`).
--
-- The column is added with `NOT NULL DEFAULT '{"via":"unknown"}'`
-- so the default catches any code path that forgot to forward
-- provenance — the row will still land, just flagged "unknown" for
-- the on-call to fix.
--
-- Tables covered (each is a state-mutable entity the brain or the
-- explicit form path writes):
--
--   - `reminders`                        — Owner reminders tab
--   - `owner_tabs`                       — Owner dynamic tabs
--   - `workforce_tab_change_requests`    — Workforce tab requests
--   - `document_drafts`                  — Universal drafter
--   - `draft_revisions`                  — Per-revision history
--   - `incidents`                        — Safety/CSR incidents
--   - `shift_reports`                    — Production shifts
--   - `sales`                            — Mineral sales
--   - `estate_capital_movements`         — Estate ledger
--   - `external_party_engagements`       — Counterparty log
--   - `mineral_chain_of_custody`         — CoC append
--   - `regulatory_filings`               — Compliance filings
--   - `marketplace_bids`                 — Buyer bids
--   - `bid_negotiations`                 — Buyer counters
--   - `workforce_role_tab_configs`       — Role tab configs
--   - `mining_tasks`                     — Worker / manager tasks
--   - `mining_escalations`               — Manager-to-owner escalations
--   - `mining_approval_items`            — Approval queue items
--   - `pilot_feedback`                   — Pilot triage
--   - `workforce_invitations`            — Workforce onboarding
--   - `external_parties`                 — Counterparty master
--   - `estate_assets`                    — Estate holdings master
--
-- =============================================================================

BEGIN;

DO $$
DECLARE
  t text;
  has_created_at boolean;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'reminders',
    'owner_tabs',
    'workforce_tab_change_requests',
    'document_drafts',
    'draft_revisions',
    'incidents',
    'shift_reports',
    'sales',
    'estate_capital_movements',
    'external_party_engagements',
    'mineral_chain_of_custody',
    'regulatory_filings',
    'marketplace_bids',
    'bid_negotiations',
    'workforce_role_tab_configs',
    'mining_tasks',
    'mining_escalations',
    'mining_approval_items',
    'pilot_feedback',
    'workforce_invitations',
    'external_parties',
    'estate_assets'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT ''{"via":"unknown"}''::jsonb',
        t
      );

      -- Backfill rows still on the default `{"via":"unknown"}`. If
      -- the table has a `created_at` column we use it; otherwise we
      -- fall back to `now()` so we never insert an invalid timestamp.
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = t
          AND column_name = 'created_at'
      ) INTO has_created_at;

      IF has_created_at THEN
        EXECUTE format(
          $f$UPDATE %I
             SET provenance = jsonb_build_object(
               'via',         'legacy',
               'actorId',     NULL,
               'sessionId',   NULL,
               'requestedAt', to_char(coalesce(created_at, now()) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             )
             WHERE provenance ->> 'via' = 'unknown'$f$,
          t
        );
      ELSE
        EXECUTE format(
          $f$UPDATE %I
             SET provenance = jsonb_build_object(
               'via',         'legacy',
               'actorId',     NULL,
               'sessionId',   NULL,
               'requestedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
             )
             WHERE provenance ->> 'via' = 'unknown'$f$,
          t
        );
      END IF;

      -- GIN index for "show me everything chat created in the last
      -- day" / "show me legacy rows" queries. Idempotent.
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON %I USING gin (provenance)',
        t || '_provenance_gin',
        t
      );
    END IF;
  END LOOP;
END$$;

COMMIT;
