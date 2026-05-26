-- ─────────────────────────────────────────────────────────────────────
-- Migration 0195 — Personas (Piece D).
--
-- Per-tenant catalogue of brain personas. A persona is a SCOPED, TIERED
-- behavioural template (NOT a user). Examples seeded per tenant:
--
--   T1_owner_strategist        — top-tier strategic voice
--   T2_admin_strategist        — admin command-deck voice
--   T3_module_manager          — module/department head voice
--   T4_field_employee          — field-staff voice (work-orders, etc.)
--   T5_customer_concierge      — external-user voice (resident/guest)
--   T_auditor                  — cross-cutting read-only auditor
--   T_vendor                   — external-vendor voice
--
-- Generic on purpose — no jurisdiction-specific strings in the schema or
-- seeds. Tenants (TRC, hotel, university, ...) name their TITLES in the
-- `titles` table (0199); personas hang off power_tier, not job title.
--
-- All tenant-scoped. RLS by current_setting('app.current_tenant_id').
-- Idempotent — uses IF NOT EXISTS / DO blocks for policies.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS personas (
  id                          TEXT PRIMARY KEY,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Stable slug (e.g. 'estate_officer', 'dg_strategist'). Generic enough
  -- that the brain matches on this, not on title-localised labels.
  slug                        TEXT NOT NULL,
  display_name_en             TEXT NOT NULL,
  display_name_sw             TEXT,
  -- Fixed five-level hierarchy (see CLAUDE.md "Titles vs Tiers").
  --   1 = OWNER, 2 = ADMIN, 3 = MANAGER, 4 = EMPLOYEE, 5 = CUSTOMER
  power_tier                  SMALLINT NOT NULL CHECK (power_tier BETWEEN 1 AND 5),
  -- SQL-friendly predicate template; rendered into WHERE clauses by the
  -- scope-predicate evaluator at request time. Example:
  --   {"kind":"tenant_scope","tenant_id":"{tenant_id}"}
  --   {"kind":"module_scope","module":"maintenance"}
  --   {"kind":"own_records","user_id":"{user_id}"}
  scope_predicate_jsonb       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Catalogue of tool ids this persona can invoke. EMPTY array means
  -- read-only across the persona's scope predicate.
  tool_catalog_ids            TEXT[] NOT NULL DEFAULT '{}',
  -- Channels this persona may answer through (web, mobile, whatsapp,
  -- sms, voice). Channel routing enforces this allowlist.
  channel_allowlist           TEXT[] NOT NULL DEFAULT ARRAY['web','mobile']::TEXT[],
  -- Maximum action tier this persona may *propose* without four-eye
  -- approval. Aligns with central-intelligence stakes:
  --   LOW | MEDIUM | HIGH | SOVEREIGN
  max_action_tier             TEXT NOT NULL DEFAULT 'LOW',
  -- Template for the persona's memory namespace key. Tokens:
  --   {tenant_id} {persona_slug} {project_id} {module_id} {user_id}
  memory_namespace_template   TEXT NOT NULL,
  -- UI section filter — JSON array describing which adaptive-layout
  -- sections this persona sees by default.
  ui_section_filter_jsonb     JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_built_in                 BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_personas_tenant
  ON personas (tenant_id);

CREATE INDEX IF NOT EXISTS idx_personas_tenant_tier
  ON personas (tenant_id, power_tier);

CREATE INDEX IF NOT EXISTS idx_personas_builtin
  ON personas (is_built_in) WHERE is_built_in = TRUE;

COMMENT ON TABLE personas IS
  'Piece D — per-tenant persona catalogue. Persona = scoped, tiered behavioural template. Brain routes on power_tier + slug; tenants relabel via titles.';

-- ─────────────────────────────────────────────────────────────────────
-- Row-level security
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS personas FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'personas') THEN
    DROP POLICY IF EXISTS personas_tenant_isolation ON personas;
    CREATE POLICY personas_tenant_isolation ON personas
      USING (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );

    DROP POLICY IF EXISTS personas_tenant_isolation_write ON personas;
    CREATE POLICY personas_tenant_isolation_write ON personas
      FOR INSERT
      WITH CHECK (
        tenant_id::text = current_setting('app.current_tenant_id', true)
      );
  END IF;
END $$;
