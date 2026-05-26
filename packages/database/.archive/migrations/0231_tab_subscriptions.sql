-- =============================================================================
-- 0231: tab_subscriptions — Piece L brain-tab loop subscriptions.
--
-- A row binds a (persona × module_template) pair to a Supabase Realtime
-- channel so the frontend tab can subscribe to proposal events without
-- per-tenant config. The chat-ui's `<PendingProposalCard>` reads this
-- to know which channel name to subscribe to.
--
-- This migration:
--   1. Creates `tab_subscriptions` — tenant-scoped, with a uniqueness
--      constraint on (tenant_id, persona_id, module_template_id) since
--      one persona × module pair has exactly one channel.
--   2. Indexes for lookup by persona id and by channel name.
--   3. Gold-standard RLS pattern from 0185.
--
-- Channel naming convention:
--   tenant:{tenant_id}:module:{module_template_id}:proposals
--
-- The persona dimension is captured in the row (not the channel name)
-- because a single tab may serve multiple personas with different
-- scope predicates (Piece D).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the tab_subscriptions table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tab_subscriptions (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Persona id (matches persona_registry.id). */
  persona_id               TEXT NOT NULL,
  /** Soft FK to modules table (Piece B). */
  module_template_id       TEXT NOT NULL,
  /** Realtime channel name — `tenant:{id}:module:{tpl}:proposals`. */
  channel_name             TEXT NOT NULL,
  /** Whether the subscription is currently active (paused tabs flip to FALSE). */
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  /** Free-form metadata (UI hints, filter predicates, etc.). */
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** One (tenant, persona, module) triple = one channel. */
  CONSTRAINT tab_subscriptions_tenant_persona_module_uq
    UNIQUE (tenant_id, persona_id, module_template_id)
);

CREATE INDEX IF NOT EXISTS tab_subscriptions_tenant_persona_idx
  ON tab_subscriptions (tenant_id, persona_id);

CREATE INDEX IF NOT EXISTS tab_subscriptions_channel_idx
  ON tab_subscriptions (channel_name);

CREATE INDEX IF NOT EXISTS tab_subscriptions_tenant_active_idx
  ON tab_subscriptions (tenant_id, active)
  WHERE active = TRUE;

COMMENT ON TABLE tab_subscriptions IS
  'Piece L — persona × module pair → realtime channel binding. Drives <PendingProposalCard> subscription lookup.';

COMMENT ON COLUMN tab_subscriptions.channel_name IS
  'Convention: tenant:{tenant_id}:module:{module_template_id}:proposals.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tab_subscriptions'
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
