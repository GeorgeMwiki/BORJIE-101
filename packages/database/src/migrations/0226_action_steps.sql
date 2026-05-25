-- =============================================================================
-- 0226: action_steps — Piece E saga step rows.
--
-- Per-step persistence for the saga. Each row carries the kind, payload,
-- idempotency key (tool_call_ref), span id, audit row id, and full status
-- machine (PENDING → RUNNING → SUCCEEDED | FAILED → COMPENSATING →
-- COMPENSATED).
--
-- Compensation discipline: when a step fails, the saga drives prior
-- SUCCEEDED steps through COMPENSATING → COMPENSATED in reverse order via
-- the per-kind compensation registry. The original row is NEVER mutated
-- post-success; the COMPENSATING/COMPENSATED transition is the standard
-- in-flight status update for compensation drive.
--
-- Tenant-scoped, FORCE RLS. Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS action_steps (
  id                          TEXT PRIMARY KEY,
  plan_id                     TEXT NOT NULL REFERENCES action_plans(id) ON DELETE CASCADE,
  tenant_id                   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step_index                  SMALLINT NOT NULL CHECK (step_index >= 0),
  kind                        TEXT NOT NULL CHECK (kind IN (
                                'DRAFT_LETTER',
                                'ROUTE_APPROVAL',
                                'POST_LEDGER',
                                'FILE_GEPG',
                                'SEND_WHATSAPP',
                                'SEND_SMS',
                                'SEND_EMAIL',
                                'SCHEDULE_FIELD_VISIT',
                                'MUTATE_ENTITY',
                                'CALL_EXTERNAL_API',
                                'EMIT_WEBHOOK',
                                'NOTIFY',
                                'VERIFY',
                                'COMPENSATE'
                              )),
  payload_jsonb               JSONB NOT NULL DEFAULT '{}'::jsonb,
  tool_call_ref               TEXT,
  otel_span_id                TEXT,
  audit_chain_id              TEXT,
  status                      TEXT NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN (
                                'PENDING',
                                'RUNNING',
                                'SUCCEEDED',
                                'FAILED',
                                'COMPENSATING',
                                'COMPENSATED',
                                'SKIPPED'
                              )),
  attempts                    SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error                  TEXT,
  compensation_step_index     SMALLINT,
  started_at                  TIMESTAMPTZ,
  finished_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_action_steps_plan
  ON action_steps (plan_id, step_index);

CREATE INDEX IF NOT EXISTS idx_action_steps_tenant_status
  ON action_steps (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_action_steps_tool_call_ref
  ON action_steps (tenant_id, tool_call_ref) WHERE tool_call_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_action_steps_kind
  ON action_steps (tenant_id, kind);

COMMENT ON TABLE action_steps IS
  'Piece E — per-step row. Stores kind, payload, idempotency key, audit id, and status machine driven by the saga runtime.';

COMMENT ON COLUMN action_steps.tool_call_ref IS
  'Idempotency key for at-least-once delivery. The step handler MUST be safe under replay: same ref → same effect.';

COMMENT ON COLUMN action_steps.audit_chain_id IS
  'Per-step ai_audit_chain row id — child of the plan-creation root.';

COMMENT ON COLUMN action_steps.compensation_step_index IS
  'When this step is COMPENSATED, the index of the compensation step that ran. NULL when no compensation fired.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'action_steps'
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
