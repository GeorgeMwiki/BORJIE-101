-- =============================================================================
-- 0219: routing_rules — Piece B routing matrix (data not code).
--
-- The dispatcher (Piece L Hop 3 + Piece K's tab router) reads this table
-- to map a captured `(entity_type × intent)` pair to a concrete
-- `(module_template × action)` to invoke. Platform defaults are seeded
-- in 0221; tenants override per-(entity_type, intent) with priority.
--
-- RLS pattern:
--   * SELECT — tenant scope OR platform-wide (NULL tenant_id) visible
--     to all (predicate: tenant_id IS NULL OR tenant_id = current_app_tenant_id()).
--   * INSERT / UPDATE / DELETE — tenant scope only (no NULL escape;
--     platform defaults are seeded by migration / service-role).
--
-- Override semantics: when multiple rows match the same
-- (entity_type, intent), the one with the higher `priority` wins; a
-- non-NULL `tenant_id` row always beats a NULL one regardless of
-- priority. Computed at dispatcher resolution time.
--
-- See: PIECE_L_BRAIN_TAB_LOOP.md §4 — the 17 platform defaults.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create routing_rules table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS routing_rules (
  id                    TEXT PRIMARY KEY,
  /** NULL = platform default. */
  tenant_id             TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type           TEXT NOT NULL,
  intent                TEXT NOT NULL,
  module_template_id    TEXT NOT NULL REFERENCES module_templates(slug) ON DELETE CASCADE,
  action                TEXT NOT NULL,
  payload_template      JSONB,
  min_confidence        NUMERIC(3,2) NOT NULL DEFAULT 0.78,
  hitl_required         BOOLEAN NOT NULL DEFAULT TRUE,
  priority              SMALLINT NOT NULL DEFAULT 100,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_routing_rules_min_confidence CHECK (
    min_confidence >= 0.00 AND min_confidence <= 1.00
  ),
  CONSTRAINT ck_routing_rules_entity_type_nonempty CHECK (
    length(entity_type) > 0
  ),
  CONSTRAINT ck_routing_rules_intent_nonempty CHECK (
    length(intent) > 0
  ),
  CONSTRAINT ck_routing_rules_action_nonempty CHECK (
    length(action) > 0
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes.
--    The hot read path is "find rules matching entity_type+intent for
--    this tenant (or platform default)". One index covers it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS routing_rules_match_idx
  ON routing_rules (entity_type, intent, priority DESC);

CREATE INDEX IF NOT EXISTS routing_rules_tenant_idx
  ON routing_rules (tenant_id);

CREATE INDEX IF NOT EXISTS routing_rules_template_idx
  ON routing_rules (module_template_id);

-- A tenant cannot have two rows of equal (entity_type, intent, priority)
-- — the override resolution would be ambiguous. Platform defaults are
-- exempt (NULL tenant_id can appear once per (entity, intent, priority)).
CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_rules_tenant_match
  ON routing_rules (tenant_id, entity_type, intent, priority)
  WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_routing_rules_platform_match
  ON routing_rules (entity_type, intent, priority)
  WHERE tenant_id IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Gold-standard RLS with NULL-tenant SELECT escape (mirrors
--    0208_report_templates RLS for platform-built-ins).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'routing_rules'
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
        USING (tenant_id IS NULL OR tenant_id = public.current_app_tenant_id());
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

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE routing_rules IS
  'Piece B routing matrix. Dispatcher reads (entity_type, intent) and '
  'returns (module_template_id, action). NULL tenant_id = platform '
  'default; tenant-scoped rows override by (entity, intent, priority DESC). '
  'Seeded with 17 platform defaults in 0221_routing_rules_seed.sql.';

COMMENT ON COLUMN routing_rules.tenant_id IS
  'NULL = platform default, visible to all tenants. Non-NULL = tenant '
  'override, beats platform default of equal priority at resolution time.';

COMMENT ON COLUMN routing_rules.payload_template IS
  'JSONB template with {{entity_id}}, {{amount}} placeholders. The '
  'dispatcher fills these from the capture row before invoking the '
  'accept_proposal handler.';

COMMENT ON COLUMN routing_rules.min_confidence IS
  'Capture confidence floor. If the capture''s composed score is below '
  'this AND hitl_required is true, the proposal stays pending until a '
  'human accepts; below this AND hitl_required is false, the rule is '
  'skipped entirely.';

COMMENT ON COLUMN routing_rules.priority IS
  'Higher wins on ties. Defaults to 100; tenant overrides typically use '
  '200+ to beat platform defaults.';
