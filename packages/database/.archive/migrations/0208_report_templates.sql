-- ─────────────────────────────────────────────────────────────────────
-- Migration 0208 — report_templates (Piece H — report engine).
--
-- Backs the report-engine in `packages/report-engine/`. One row per
-- template. tenant_id NULL means a platform-shipped built-in template
-- (visible to every tenant); non-NULL is a tenant-authored override.
--
-- The engine reads this table on render, resolves placeholders against
-- live tenant data via repositories (no LLM-generated SQL), and emits
-- PDF + DOCX + PPTX in tenant brand.
--
-- Composite uniqueness on (tenant_id, slug) — but NULL tenant_id needs
-- COALESCE wrapping or the standard UNIQUE constraint will allow many
-- platform-wide rows with the same slug. We use a partial unique index
-- pair to express "(NULL, slug) is unique" AND "(tenant_id, slug) is
-- unique" without the COALESCE-cast trick.
--
-- RLS pattern:
--   * SELECT: tenant_id IS NULL OR tenant_id = current_app_tenant_id()
--     (platform-wide rows are visible to all tenants).
--   * INSERT / UPDATE / DELETE: tenant_id = current_app_tenant_id()
--     (only tenant-scoped rows can be modified through normal RLS;
--     platform built-ins are seeded by migration / service-role).
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────

-- ============================================================================
-- 1. Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS report_templates (
  id                TEXT PRIMARY KEY,
  /** NULL = platform built-in, visible across all tenants. */
  tenant_id         TEXT,
  slug              TEXT NOT NULL,
  display_name_en   TEXT NOT NULL,
  display_name_sw   TEXT,
  /** JSON list of {section_id, title, data_source, kind} entries. */
  sections_jsonb    JSONB NOT NULL,
  /** Subset of {pdf, docx, pptx} this template can render. */
  output_formats    TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'docx', 'pptx']::TEXT[],
  is_built_in       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_report_templates_slug_nonempty CHECK (length(slug) > 0),
  CONSTRAINT ck_report_templates_sections_array CHECK (
    jsonb_typeof(sections_jsonb) = 'array'
  ),
  CONSTRAINT ck_report_templates_output_formats_nonempty CHECK (
    array_length(output_formats, 1) >= 1
  )
);

-- ============================================================================
-- 2. Indexes — partial unique pair for "(NULL,slug)" + "(tenant,slug)".
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_templates_platform_slug
  ON report_templates (slug)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_templates_tenant_slug
  ON report_templates (tenant_id, slug)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_report_templates_tenant
  ON report_templates (tenant_id);

CREATE INDEX IF NOT EXISTS idx_report_templates_built_in
  ON report_templates (is_built_in);

COMMENT ON TABLE report_templates IS
  'Report-engine template registry. tenant_id NULL = platform built-in, visible to every tenant. Sections are JSONB lists of {section_id, title, data_source, kind} placeholders. RLS allows read of NULL rows; write requires matching tenant_id.';

COMMENT ON COLUMN report_templates.tenant_id IS
  'NULL = platform built-in. Otherwise the tenant that authored this template.';

COMMENT ON COLUMN report_templates.sections_jsonb IS
  'JSONB array of {section_id, title, data_source, kind} entries. data_source binds the section to a repository call (e.g. "payments-ledger.summary.monthly").';

COMMENT ON COLUMN report_templates.output_formats IS
  'Subset of {pdf, docx, pptx} this template can render. The renderer raises if a requested format is not in this list.';

-- ============================================================================
-- 3. ENABLE + FORCE RLS, install policies.
--    Pattern from 0166b_rls_promote_out_wave.sql / 0182_section_layouts.sql,
--    with the NULL-tenant escape on SELECT for platform built-ins.
-- ============================================================================

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'report_templates'
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

      -- Drop pre-existing policies with our canonical names.
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      -- SELECT: tenant scope OR platform-wide (NULL tenant).
      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id IS NULL OR tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      -- INSERT/UPDATE/DELETE: tenant scope only (no NULL escape — only
      -- service-role / migration seeds platform built-ins).
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

-- ============================================================================
-- 4. Seed platform built-ins. tenant_id NULL, is_built_in TRUE.
--    Seven templates: monthly_revenue, occupancy_report, arrears_aging,
--    condition_survey, q3_strategy, board_pack, customer_statement.
-- ============================================================================

INSERT INTO report_templates (id, tenant_id, slug, display_name_en, display_name_sw, sections_jsonb, output_formats, is_built_in)
VALUES
  (
    'tmpl_monthly_revenue',
    NULL,
    'monthly_revenue',
    'Monthly Revenue Report',
    'Ripoti ya Mapato ya Mwezi',
    '[
      {"section_id":"summary","title":"Executive Summary","data_source":"payments-ledger.revenue.month_summary","kind":"narrative"},
      {"section_id":"by_property","title":"Revenue by Property","data_source":"payments-ledger.revenue.by_property","kind":"table"},
      {"section_id":"trend_chart","title":"12-Month Revenue Trend","data_source":"payments-ledger.revenue.trend_12m","kind":"chart"},
      {"section_id":"variance","title":"Variance vs Plan","data_source":"payments-ledger.revenue.variance","kind":"table"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_occupancy_report',
    NULL,
    'occupancy_report',
    'Occupancy Report',
    'Ripoti ya Ujazo',
    '[
      {"section_id":"summary","title":"Portfolio Occupancy Summary","data_source":"occupancy.portfolio.summary","kind":"narrative"},
      {"section_id":"by_property","title":"Occupancy by Property","data_source":"occupancy.by_property","kind":"table"},
      {"section_id":"vacancy_aging","title":"Vacancy Aging","data_source":"occupancy.vacancy_aging","kind":"table"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_arrears_aging',
    NULL,
    'arrears_aging',
    'Arrears Aging Report',
    'Ripoti ya Madeni',
    '[
      {"section_id":"summary","title":"Arrears Summary","data_source":"payments-ledger.arrears.summary","kind":"narrative"},
      {"section_id":"buckets","title":"Aging Buckets (0-30 / 31-60 / 61-90 / 90+)","data_source":"payments-ledger.arrears.buckets","kind":"table"},
      {"section_id":"top_offenders","title":"Top 20 Outstanding Tenants","data_source":"payments-ledger.arrears.top_offenders","kind":"table"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_condition_survey',
    NULL,
    'condition_survey',
    'Property Condition Survey',
    'Ripoti ya Hali ya Mali',
    '[
      {"section_id":"summary","title":"Condition Overview","data_source":"inspections.condition.summary","kind":"narrative"},
      {"section_id":"components","title":"Component-Level Findings","data_source":"inspections.condition.components","kind":"table"},
      {"section_id":"capex_forecast","title":"5-Year Capex Forecast","data_source":"inspections.capex_forecast","kind":"chart"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_q3_strategy',
    NULL,
    'q3_strategy',
    'Q3 Strategy Document',
    'Hati ya Mkakati wa Robo ya Tatu',
    '[
      {"section_id":"intro","title":"Strategic Context","data_source":"strategy.context","kind":"narrative"},
      {"section_id":"kpis","title":"Current KPIs","data_source":"kpi.snapshot","kind":"kpi_grid"},
      {"section_id":"priorities","title":"Quarter Priorities","data_source":"strategy.priorities","kind":"narrative"},
      {"section_id":"financial_plan","title":"Financial Plan","data_source":"strategy.financial_plan","kind":"table"},
      {"section_id":"risks","title":"Top 5 Risks","data_source":"strategy.risks","kind":"table"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_board_pack',
    NULL,
    'board_pack',
    'Board Pack',
    'Pakiti ya Bodi',
    '[
      {"section_id":"agenda","title":"Agenda","data_source":"board.agenda","kind":"narrative"},
      {"section_id":"financials","title":"Financial Statements","data_source":"payments-ledger.statements.summary","kind":"table"},
      {"section_id":"operations","title":"Operations Update","data_source":"operations.summary","kind":"narrative"},
      {"section_id":"compliance","title":"Compliance & Risk","data_source":"compliance.summary","kind":"table"},
      {"section_id":"resolutions","title":"Proposed Resolutions","data_source":"board.resolutions","kind":"narrative"}
    ]'::jsonb,
    ARRAY['pdf', 'docx', 'pptx']::TEXT[],
    TRUE
  ),
  (
    'tmpl_customer_statement',
    NULL,
    'customer_statement',
    'Customer Statement',
    'Hati ya Mteja',
    '[
      {"section_id":"header","title":"Statement Header","data_source":"customer.statement.header","kind":"narrative"},
      {"section_id":"transactions","title":"Transactions","data_source":"customer.statement.transactions","kind":"table"},
      {"section_id":"balance","title":"Closing Balance","data_source":"customer.statement.closing","kind":"narrative"}
    ]'::jsonb,
    ARRAY['pdf', 'docx']::TEXT[],
    TRUE
  )
ON CONFLICT (id) DO NOTHING;

-- Operator note: this is an additive migration. The seven built-in
-- templates are idempotent (ON CONFLICT DO NOTHING). Tenant-authored
-- templates land via repository writes at runtime; the partial unique
-- index pair guarantees (NULL, slug) and (tenant_id, slug) uniqueness
-- without colliding.
