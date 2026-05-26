-- =============================================================================
-- 0225: action_plans — Piece E action runtime root.
--
-- A persisted ActionPlan is the contract between the brain (proposer) and the
-- saga runtime (executor). Each plan carries:
--
--   * `persona_id`             — the proposing persona (bound to a user via
--                                 `persona_bindings`)
--   * `intent`                 — high-level goal slug
--   * `plan_jsonb`             — zod-validated ActionPlan body (the step graph,
--                                 preconditions, compensations, gates)
--   * `status`                 — DRAFT → ROUTED_FOR_APPROVAL → APPROVED →
--                                 EXECUTING → COMPLETED | PARTIAL | FAILED |
--                                 COMPENSATED | COMPENSATION_FAILED | EXPIRED |
--                                 CANCELLED
--   * `audit_chain_link`       — pointer into `ai_audit_chain.id` (hash root)
--   * `budget_micros`          — cap in micro-USD; saga rejects on overrun
--   * `source_*`               — cross-piece provenance (chat capture L, brief
--                                 C, document K)
--   * `expires_at`             — default now() + 72h
--
-- Tenant-scoped, FORCE RLS. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_plans (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  persona_id          TEXT NOT NULL REFERENCES personas(id),
  module_id           TEXT,
  intent              TEXT NOT NULL,
  plan_jsonb          JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN (
                        'DRAFT',
                        'ROUTED_FOR_APPROVAL',
                        'APPROVED',
                        'EXECUTING',
                        'PARTIAL',
                        'COMPLETED',
                        'FAILED',
                        'COMPENSATED',
                        'COMPENSATION_FAILED',
                        'EXPIRED',
                        'CANCELLED'
                      )),
  audit_chain_link    TEXT,
  budget_micros       INTEGER NOT NULL CHECK (budget_micros >= 0),
  budget_used_micros  INTEGER NOT NULL DEFAULT 0 CHECK (budget_used_micros >= 0),
  source_capture_id   TEXT,
  source_brief_id     TEXT,
  source_document_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '72 hours'
);

CREATE INDEX IF NOT EXISTS idx_action_plans_tenant_status
  ON action_plans (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_action_plans_persona
  ON action_plans (tenant_id, persona_id);

CREATE INDEX IF NOT EXISTS idx_action_plans_intent
  ON action_plans (tenant_id, intent);

CREATE INDEX IF NOT EXISTS idx_action_plans_expires
  ON action_plans (expires_at) WHERE status IN ('DRAFT', 'ROUTED_FOR_APPROVAL');

COMMENT ON TABLE action_plans IS
  'Piece E — persisted ActionPlan root. Proposer = persona; executor = saga.';

COMMENT ON COLUMN action_plans.audit_chain_link IS
  'Pointer to ai_audit_chain.id — the plan-creation row that anchors the per-step hash chain.';

COMMENT ON COLUMN action_plans.budget_micros IS
  'Per-plan cap in micro-USD (1 USD = 1_000_000). Saga rejects plans exceeding remaining tenant/persona quota.';

COMMENT ON COLUMN action_plans.source_capture_id IS
  'Piece L chat-capture origin (when the plan was proposed from a conversation turn).';

COMMENT ON COLUMN action_plans.source_brief_id IS
  'Piece C executive-brief origin (when the plan was proposed from a brief recommendation).';

COMMENT ON COLUMN action_plans.source_document_id IS
  'Piece K document-analysis origin (when the plan was proposed from a doc upload routing).';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'action_plans'
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
