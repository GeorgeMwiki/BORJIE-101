-- =============================================================================
-- 0224: briefing_subscriptions — Piece C cron schedule registry.
--
-- One row per (tenant, persona) subscription. The brief-generation cron
-- worker reads `WHERE next_due_at <= NOW() AND enabled = true`, generates
-- the brief, persists it, and bumps `next_due_at` per cadence.
--
-- Cadences (open enumeration kept tight):
--   DAILY     — fires once per local day at `local_time`
--   WEEKLY    — fires once per week (default Mon at local_time)
--   MONTHLY   — fires once per calendar month (first day at local_time)
--   ON_DEMAND — never auto-fires; only generated when caller explicitly
--                triggers via POST /briefs/generate. Stored so subscription
--                preferences (modules, locale) are remembered.
--
-- Delivery channels are an array — same row can hit web + email + WA.
-- Worker honours the kill-switch fail-closed and per-tenant cost budget.
--
-- Tenant-scoped via FORCE RLS using the gold-standard 0185 pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS briefing_subscriptions (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id          TEXT NOT NULL REFERENCES personas(id),
  cadence             TEXT NOT NULL
    CHECK (cadence IN ('DAILY', 'WEEKLY', 'MONTHLY', 'ON_DEMAND')),
  /** Tenant-local clock time (HH:MM, 24h). The cron worker resolves
      tenant tz from tenants.timezone (or 'Africa/Dar_es_Salaam' default)
      when computing next_due_at. */
  local_time          TEXT NOT NULL DEFAULT '06:00',
  /** Which BORJIE module slices the brief covers. Empty array = all
      modules the persona has scope over. */
  modules_in_scope    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  locale              TEXT NOT NULL DEFAULT 'en',
  /** Where to deliver: web, email, whatsapp. */
  delivery_channels   TEXT[] NOT NULL DEFAULT ARRAY['web']::TEXT[],
  enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  last_generated_at   TIMESTAMPTZ,
  /** Cron scanner reads WHERE next_due_at <= NOW() AND enabled = true. */
  next_due_at         TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tenant_id, persona_id, cadence)
);

CREATE INDEX IF NOT EXISTS briefing_subs_due_idx
  ON briefing_subscriptions (next_due_at) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS briefing_subs_tenant_idx
  ON briefing_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS briefing_subs_tenant_persona_idx
  ON briefing_subscriptions (tenant_id, persona_id);

COMMENT ON TABLE briefing_subscriptions IS
  'Piece C — who gets which executive brief on what cadence. Cron worker scans next_due_at; updates last_generated_at + next_due_at after each tick.';

COMMENT ON COLUMN briefing_subscriptions.cadence IS
  'DAILY/WEEKLY/MONTHLY auto-fire via cron worker. ON_DEMAND never auto-fires; preserved for preference storage.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS (0185 pattern)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'briefing_subscriptions'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl);
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
          FOR SELECT TO authenticated
          USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
          FOR ALL TO authenticated
          USING (tenant_id = public.current_app_tenant_id())
          WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
