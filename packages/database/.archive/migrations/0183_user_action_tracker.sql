-- ─────────────────────────────────────────────────────────────────────
-- Migration 0183 — user_action_tracker (progressive-disclosure mastery).
--
-- Closes the persistence gap for the chat-ui MasteryGate / useUserMastery
-- pair. Each (tenant_id, user_id, action_id) tuple holds a lifetime
-- counter plus first/last-seen timestamps. The mastery scorer reads
-- one slice per render: O(1) lookup via the composite primary key.
--
-- Schema:
--
--   user_action_tracker
--   ├── tenant_id   TEXT   NOT NULL  (component of composite PK)
--   ├── user_id     TEXT   NOT NULL  (component of composite PK)
--   ├── action_id   TEXT   NOT NULL  (component of composite PK)
--   ├── action_count BIGINT NOT NULL DEFAULT 0  CHECK (action_count >= 0)
--   ├── first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   └── last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW()
--
-- Idempotent — IF NOT EXISTS on the table + index; policies are
-- DROP-then-CREATE inside a DO/IF EXISTS guard (no `CREATE POLICY IF
-- NOT EXISTS` form in Postgres).
--
-- RLS predicate: `tenant_id = public.current_app_tenant_id()` (canonical
-- helper that bridges the new `app.current_tenant_id` GUC and the legacy
-- `app.tenant_id` GUC — see migration 0172). This is a STRICT predicate:
-- no `tenant_id IS NULL` escape, because user_action_tracker holds
-- per-user counter data and a tenant_id-less row could leak across
-- tenants if the GUC is ever unset. Platform-default action catalogues
-- (if ever added) go in a separate table.
-- ─────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_action_tracker (
  tenant_id    TEXT        NOT NULL,
  user_id      TEXT        NOT NULL,
  action_id    TEXT        NOT NULL,
  action_count BIGINT      NOT NULL DEFAULT 0,
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, action_id),
  CONSTRAINT user_action_tracker_action_count_chk CHECK (action_count >= 0)
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

-- "Recently active users in this tenant" cohort queries — the PK
-- already covers (tenant_id, user_id, action_id) lookups, so we only
-- need the supplementary (tenant_id, last_seen DESC) ordering.
CREATE INDEX IF NOT EXISTS idx_user_action_tracker_tenant_last_seen
  ON user_action_tracker (tenant_id, last_seen DESC);

COMMENT ON TABLE user_action_tracker IS
  'Per-(tenant, user, action) action-frequency counters powering the chat-ui MasteryGate (UI-3) and LearnedShortcutsPanel (UI-5). Tenant-scoped RLS via current_app_tenant_id() GUC helper. Strict tenant predicate — no NULL escape branch.';

-- ============================================================================
-- 3. ENABLE + FORCE RLS, install tenant-isolation policies.
--    Pattern from 0166b_rls_promote_out_wave.sql / 0182_section_layouts.sql.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'user_action_tracker'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- Enable + force RLS (idempotent).
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      -- Drop pre-existing policies with our canonical names. Also drop
      -- the prior (insecure) `user_action_tracker_tenant_isolation*`
      -- policies that allowed `tenant_id IS NULL` rows — superseded by
      -- the strict `tenant_isolation_select/_modify` pair below.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS user_action_tracker_tenant_isolation ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS user_action_tracker_tenant_isolation_insert ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS user_action_tracker_tenant_isolation_update ON public.%I;', tbl
      );

      -- Tenant-scoped SELECT (strict).
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Tenant-scoped INSERT/UPDATE/DELETE (strict). FOR ALL covers
      -- INSERT + UPDATE + DELETE in one policy — no implicit DELETE
      -- gap left to the default permissive policy.
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- Revoke anon access (defence-in-depth).
      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;

-- Operator note: this is an additive migration. No backfill required —
-- user-action rows are created on first user interaction. Existing
-- users start at zero mastery and accumulate from their next action.
