-- =============================================================================
-- Migration 0142 - Tab proposals inbox (CT-6)
--
-- Companion to:
--   - services/api-gateway/src/services/tab-suggester/*
--   - services/api-gateway/src/routes/owner/tab-proposals.hono.ts
--   - apps/owner-web/src/lib/use-tab-multi-device-sync.ts (consumer)
--   - Docs/research/CHAT_TAB_SPAWN_SOTA_2026-05-29.md §5
--
-- Persona: Mr. Mwikila (founder).
-- Brand: Borjie.
--
-- Stores autonomous proposals the tab-suggester produces from owner
-- activity patterns:
--   - drill-down repeat (same {type, focus} ≥3 times in 7 days)
--   - navigation loop   (same ui_navigate route ≥4 times in 24 hours)
--   - mwikila escalation (≥2 T0/T1 proposals on same category in 7 days)
--
-- A row is created each time a pattern is detected; the owner's next
-- chat session emits a `<tab_proposal>` SSE tag referencing the row's
-- id. Acceptance binds to `POST /api/v1/owner/tabs` and the row is
-- marked `accepted_at`; dismissal marks `dismissed_at` so the same
-- proposal does not re-surface for 7 days (suggester re-checks the
-- timestamp before producing a duplicate).
--
-- Tenant isolation: every row carries `tenant_id`. RLS FORCE-enabled
-- per the Borjie hard rule (CLAUDE.md).
--
-- Evidence chain: per the Borjie grounding rule every proposal MUST
-- cite ≥1 evidence id (LMBM observation, decision, ui_navigate trail,
-- or mwikila action). The `evidence_ids` jsonb array is NOT NULL +
-- CHECK length ≥ 1 — the Auditor Agent rejects empty-evidence
-- proposals at the route layer too.
--
-- Idempotent (IF NOT EXISTS + DO blocks). Append-only. Forward-only.
-- IMMUTABLE: per CLAUDE.md "Migrations are immutable" — never edit
-- this file after merge; append a new numbered file instead.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── tab_proposals_inbox ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tab_proposals_inbox (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  /** Owner the proposal is for (the owner whose pattern was detected). */
  user_id             text        NOT NULL,
  /** Tab type the proposal would spawn — e.g. `finance`, `compliance`. */
  tab_type            text        NOT NULL,
  /** Render-ready title — bilingual variants in `title_en` / `title_sw`. */
  title_en            text        NOT NULL,
  title_sw            text,
  /** Reason copy shown on the accept/dismiss chip. */
  reason_en           text        NOT NULL,
  reason_sw           text,
  /** Per-type config preview the FE uses when the owner accepts. */
  config              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  /** Confidence 0..1 — drives the chip's high/medium pip. */
  confidence          double precision,
  /**
   * Evidence chain — ≥1 id from any grounded source:
   *   - LMBM observation id (`obs:...`)
   *   - decision id (`dec:...`)
   *   - ui_navigate trail id (`nav:...`)
   *   - mwikila action id (`mwa:...`)
   * Per CLAUDE.md the Auditor Agent rejects rows with empty arrays.
   */
  evidence_ids        jsonb       NOT NULL,
  /** Pattern detector that produced this row — for analytics + dedup. */
  detector            text        NOT NULL,
  /** When the suggester first produced this row. */
  created_at          timestamptz NOT NULL DEFAULT now(),
  /** Owner acted on the chip — accept binds to `owner_tabs`. */
  accepted_at         timestamptz,
  /** Owner dismissed the chip — re-surface only after `dismissed_at + 7d`. */
  dismissed_at        timestamptz,
  /** When the FE last surfaced this chip in a chat reply. */
  last_surfaced_at    timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tab_proposals_inbox_detector_chk'
  ) THEN
    ALTER TABLE tab_proposals_inbox
      ADD CONSTRAINT tab_proposals_inbox_detector_chk
      CHECK (detector IN (
        'drill_down_repeat',
        'navigation_loop',
        'mwikila_escalation',
        'manual'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tab_proposals_inbox_evidence_min_chk'
  ) THEN
    ALTER TABLE tab_proposals_inbox
      ADD CONSTRAINT tab_proposals_inbox_evidence_min_chk
      CHECK (jsonb_array_length(evidence_ids) >= 1
         AND jsonb_array_length(evidence_ids) <= 5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tab_proposals_inbox_confidence_chk'
  ) THEN
    ALTER TABLE tab_proposals_inbox
      ADD CONSTRAINT tab_proposals_inbox_confidence_chk
      CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tab_proposals_inbox_resolution_mutex_chk'
  ) THEN
    ALTER TABLE tab_proposals_inbox
      ADD CONSTRAINT tab_proposals_inbox_resolution_mutex_chk
      CHECK (NOT (accepted_at IS NOT NULL AND dismissed_at IS NOT NULL));
  END IF;
END $$;

-- Hot path: "what unresolved proposals does this owner have?" — drives
-- the in-chat chip surface on every new session.
CREATE INDEX IF NOT EXISTS tab_proposals_inbox_open_idx
  ON tab_proposals_inbox (tenant_id, user_id, created_at DESC)
  WHERE accepted_at IS NULL AND dismissed_at IS NULL;

-- Hot path: dedup-by-detector — suggester checks this before inserting
-- a new row so the SAME (type, detector, focus) doesn't re-fire while
-- a prior proposal is still pending or dismissed-within-7d.
CREATE INDEX IF NOT EXISTS tab_proposals_inbox_dedup_idx
  ON tab_proposals_inbox (tenant_id, user_id, tab_type, detector, created_at DESC);

ALTER TABLE tab_proposals_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE tab_proposals_inbox FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tab_proposals_inbox'
       AND policyname = 'tab_proposals_inbox_tenant_isolation'
  ) THEN
    CREATE POLICY tab_proposals_inbox_tenant_isolation
      ON tab_proposals_inbox
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
