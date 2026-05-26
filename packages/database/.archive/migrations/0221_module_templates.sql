-- =============================================================================
-- 0218: module_templates — Piece B platform-built-in & tenant-fork bundles.
--
-- Templates are the starter blueprints a tenant forks to spawn a new
-- `modules` row. Ten platform-built-in templates ship with Borjie:
--   ESTATE / HR / FLEET / PROCUREMENT / LEGAL / FINANCE
--   STRATEGY / COMPLIANCE / CRM / INVENTORY
--
-- Each template's `default_spec_jsonb` is a complete, valid module_spec
-- (≥3 entities, ≥2 workflows, ≥3 ui_sections) — a tenant clones it and
-- customises before publishing.
--
-- `slug` is the natural key. Platform built-ins use the slugs above,
-- written in UPPERCASE for consistency with `module_template_id`
-- references in `routing_rules` and `module_accept_handlers`.
--
-- Template content is intentionally light — the rich spec lives in the
-- @borjie/module-templates package and is loaded at boot. Seeds
-- here only register slugs/titles so FKs resolve; the package code
-- supplies the actual spec_jsonb when a tenant spawns from one.
--
-- The 10 starter rows are seeded with minimal stub spec_jsonb to
-- guarantee the table is referentially valid out-of-the-box.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create module_templates table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS module_templates (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  title_en              TEXT NOT NULL,
  title_sw              TEXT,
  description           TEXT,
  default_spec_jsonb    JSONB NOT NULL,
  icon                  TEXT,
  is_built_in           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_module_templates_spec_object CHECK (
    jsonb_typeof(default_spec_jsonb) = 'object'
  ),
  CONSTRAINT ck_module_templates_slug_nonempty CHECK (length(slug) > 0)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS module_templates_is_built_in_idx
  ON module_templates (is_built_in);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Add deferred FK from modules.template_id → module_templates.id.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'modules'
      AND constraint_name = 'modules_template_id_fkey'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'modules'
  ) THEN
    ALTER TABLE modules
      ADD CONSTRAINT modules_template_id_fkey
      FOREIGN KEY (template_id)
      REFERENCES module_templates(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Module templates are PLATFORM-WIDE catalogue, not tenant-scoped.
--    All authenticated users may SELECT; only service-role / migration
--    seeds may INSERT/UPDATE/DELETE. ENABLE + FORCE + REVOKE FROM anon.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'module_templates'
  ) THEN
    ALTER TABLE public.module_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.module_templates FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS module_templates_select_all ON public.module_templates;
    DROP POLICY IF EXISTS module_templates_modify_none ON public.module_templates;

    -- SELECT: any authenticated user.
    EXECUTE $pol$
      CREATE POLICY module_templates_select_all ON public.module_templates
      FOR SELECT
      TO authenticated
      USING (true);
    $pol$;

    -- INSERT / UPDATE / DELETE: forbidden from authenticated; only
    -- service-role and migration seeds (which bypass RLS) may modify.
    EXECUTE $pol$
      CREATE POLICY module_templates_modify_none ON public.module_templates
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
    $pol$;

    REVOKE ALL ON public.module_templates FROM anon;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Seed 10 built-in template stubs. Real default_spec_jsonb lives in
--    `packages/module-templates/src/templates/{slug}/spec.json` and is
--    UPSERTed at runtime by the orchestrator's boot routine. The stubs
--    here ensure the table is referentially valid even before the
--    package boots.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO module_templates (id, slug, title_en, title_sw, description, default_spec_jsonb, icon, is_built_in)
VALUES
  ('mtpl_estate', 'ESTATE', 'Estate Management', 'Usimamizi wa Mali',
   'Land, buildings, units, leases, maintenance — the property core.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'building', TRUE),
  ('mtpl_hr', 'HR', 'Human Resources', 'Rasilimali Watu',
   'Employees, departments, contracts, leave, payroll inputs.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'users', TRUE),
  ('mtpl_fleet', 'FLEET', 'Fleet Management', 'Usimamizi wa Magari',
   'Vehicles, drivers, routes, fuel, service intervals.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'truck', TRUE),
  ('mtpl_procurement', 'PROCUREMENT', 'Procurement', 'Manunuzi',
   'Vendors, RFPs, purchase orders, goods-received notes.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'shopping-cart', TRUE),
  ('mtpl_legal', 'LEGAL', 'Legal', 'Sheria',
   'Cases, contracts, counsel routing, jurisdictional filings.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'scale', TRUE),
  ('mtpl_finance', 'FINANCE', 'Finance', 'Fedha',
   'Receipts, invoices, ledger, statements, variance.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'banknote', TRUE),
  ('mtpl_strategy', 'STRATEGY', 'Strategy', 'Mkakati',
   'KPIs, forecasts, executive calendar, scenario planning.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'target', TRUE),
  ('mtpl_compliance', 'COMPLIANCE', 'Compliance', 'Utii',
   'Permits, audits, regulatory deadlines, gap remediation.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'shield-check', TRUE),
  ('mtpl_crm', 'CRM', 'CRM', 'Mahusiano',
   'Leads, complaints, prospects, customer-touch timeline.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'message-circle', TRUE),
  ('mtpl_inventory', 'INVENTORY', 'Inventory', 'Ghala',
   'Stock, movements, reorder triggers, warehouse locations.',
   '{"entities":[],"workflows":[],"ui_sections":[]}'::jsonb,
   'package', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE module_templates IS
  'Piece B module template registry — ten platform built-ins shipped, '
  'tenant forks land here too. SELECT visible to all authenticated; '
  'INSERT/UPDATE/DELETE forbidden from authenticated (service-role only).';

COMMENT ON COLUMN module_templates.slug IS
  'Stable natural key (UPPERCASE for built-ins). Referenced by '
  'routing_rules.module_template_id and module_accept_handlers.'
  'module_template_id as a soft TEXT pointer.';

COMMENT ON COLUMN module_templates.default_spec_jsonb IS
  'Starter spec the tenant forks. Stub at migration time; real spec '
  'UPSERTed by @borjie/module-templates boot routine.';
