-- =============================================================================
-- 0262: tab_spawn_proposals — Piece O proposals surfaced to users.
--
-- Once the signal aggregator's score for a (user, suggested_module) pair
-- crosses the configured threshold, the proposal emitter writes a row
-- here. The row drives the UX banner ("I noticed N compliance-related
-- questions this week — want to add a Compliance tab?") and tracks the
-- user's decision (accept, decline, expire, snooze).
--
-- Decline + snooze logic is enforced by the emitter, not the schema:
--   * 'declined' → no re-propose for 30 days (configurable per tenant).
--   * 'snoozed'  → no re-propose until next scan cycle.
--   * 'expired'  → row created >14d ago, never acted upon.
--
-- This migration:
--   1. Creates `tab_spawn_proposals` table with a (tenant_id, user_id,
--      suggested_module_template_id, status, decided_at) index so the
--      emitter's snooze check is O(log n).
--   2. GOLD-STANDARD RLS via `public.current_app_tenant_id()` (0172).
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tab_spawn_proposals (
  id                            TEXT PRIMARY KEY,
  tenant_id                     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                       TEXT NOT NULL,
  suggested_module_template_id  TEXT NOT NULL,
  /** Aggregated signal strength at emit time; for forensics. */
  score                         NUMERIC(5,2) NOT NULL,
  /** Signal ids that pushed the score above the threshold. */
  top_signal_ids                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  /** UX-ready text shown to the user (built by emitter using i18n keys). */
  proposal_message              TEXT NOT NULL,
  /** Enum stored as TEXT: pending | accepted | declined | expired | snoozed. */
  status                        TEXT NOT NULL DEFAULT 'pending',
  decided_at                    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Default 14d ahead of creation; expirer cron flips to 'expired'. */
  expires_at                    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS tab_spawn_proposals_tenant_user_status_idx
  ON tab_spawn_proposals (tenant_id, user_id, status);

CREATE INDEX IF NOT EXISTS tab_spawn_proposals_tenant_user_module_status_idx
  ON tab_spawn_proposals (tenant_id, user_id, suggested_module_template_id, status);

CREATE INDEX IF NOT EXISTS tab_spawn_proposals_decided_at_idx
  ON tab_spawn_proposals (tenant_id, decided_at DESC) WHERE decided_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS tab_spawn_proposals_expires_at_idx
  ON tab_spawn_proposals (expires_at) WHERE status = 'pending';

COMMENT ON TABLE tab_spawn_proposals IS
  'Piece O — emitter writes a row here when score crosses threshold. UX surfaces pending rows as banner. Status transitions: pending -> accepted | declined | expired | snoozed.';

COMMENT ON COLUMN tab_spawn_proposals.status IS
  'TEXT enum: pending | accepted | declined | expired | snoozed. Decline triggers 30-day snooze (enforced by emitter, not schema).';

COMMENT ON COLUMN tab_spawn_proposals.top_signal_ids IS
  'Signal ids that pushed the score above the threshold. Bounded length (emitter caps at 20) for forensic replay.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tab_spawn_proposals'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: the expirer cron flips pending rows to 'expired' once
-- now() > expires_at; the index `tab_spawn_proposals_expires_at_idx` is
-- partial on status='pending' to keep the scan cheap.
