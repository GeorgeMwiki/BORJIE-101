-- =============================================================================
-- 0261: tab_spawn_signals — Piece O need-detection signal stream.
--
-- One row per observed behavioural signal that could justify spawning a
-- new tab/module for a user. Signals are append-only, fire-and-forget;
-- the aggregator (`packages/tab-need-detector/src/signal-aggregator.ts`)
-- reads from this table to produce per-(user, suggested_module) scores.
--
-- Signal sources (signal_kind):
--   * 'search_keyword'        — search query matched a module keyword
--   * 'conversation_intent'   — chat NER detected a module-related entity
--   * 'doc_upload'            — document_extractions surfaced a doc_type
--                               that maps to a module
--   * 'tab_event_pattern'     — repeated navigation pattern (e.g. visits
--                               finance tab but no actions available)
--   * 'external_trigger'      — webhook/connector emits a signal
--
-- `suggested_module_template_id` is a soft TEXT pointer — the module
-- catalogue / templates table may land later (Piece B). Today it's just
-- a string label like 'COMPLIANCE', 'LEGAL', 'HR', 'PROCUREMENT', 'FLEET'.
--
-- This migration:
--   1. Creates `tab_spawn_signals` table.
--   2. Indexes for the aggregator's "scan signals for tenant since X" query.
--   3. GOLD-STANDARD RLS via `public.current_app_tenant_id()` (0172).
--
-- Idempotent.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tab_spawn_signals (
  id                            TEXT PRIMARY KEY,
  tenant_id                     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /**
   * `user_id` is a soft TEXT pointer. The users table exists today but
   * we keep this loose so signals can also be ingested from system
   * actors (e.g. a connector that observes a tenant-wide pattern).
   */
  user_id                       TEXT NOT NULL,
  /** Enum stored as TEXT for forward-compat (see file header). */
  signal_kind                   TEXT NOT NULL,
  /** Free-form payload (raw search text, ner entities, doc_type, …). */
  signal_payload_jsonb          JSONB NOT NULL DEFAULT '{}'::jsonb,
  /**
   * Suggested module template id this signal "votes" for. NULL means
   * the signal was observed but no module mapping fired — useful for
   * later analysis of dark patterns.
   */
  suggested_module_template_id  TEXT,
  /** Per-signal weight. Defaults from scoring-matrix.ts but tunable. */
  weight                        NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tab_spawn_signals_tenant_created_idx
  ON tab_spawn_signals (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tab_spawn_signals_tenant_user_module_idx
  ON tab_spawn_signals (tenant_id, user_id, suggested_module_template_id);

CREATE INDEX IF NOT EXISTS tab_spawn_signals_module_kind_idx
  ON tab_spawn_signals (suggested_module_template_id, signal_kind);

COMMENT ON TABLE tab_spawn_signals IS
  'Piece O — append-only signal stream feeding the need-detection aggregator. One row per observed user-behaviour signal that might justify spawning a new module tab.';

COMMENT ON COLUMN tab_spawn_signals.signal_kind IS
  'TEXT enum: search_keyword | conversation_intent | doc_upload | tab_event_pattern | external_trigger.';

COMMENT ON COLUMN tab_spawn_signals.suggested_module_template_id IS
  'Soft TEXT pointer to a module template (catalogue lands in Piece B). Typical values: COMPLIANCE, LEGAL, HR, PROCUREMENT, FLEET, STRATEGY.';

COMMENT ON COLUMN tab_spawn_signals.weight IS
  'Per-signal weight (0.0-9.99). Defaults from scoring-matrix.ts but per-row override is allowed so a high-confidence connector signal can outweigh a weak NER hit.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. RLS — FORCE + tenant isolation (pattern from 0182/0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tab_spawn_signals'
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

-- Operator note: write-heavy table. Observers fire-and-forget — failures
-- never block the user flow. The aggregator scans on a cron; old signals
-- (>30d) can be archived by a future retention job, no PII concerns since
-- payload is JSONB-typed and consumer-controlled.
