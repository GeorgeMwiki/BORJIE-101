-- =============================================================================
-- 0214: document_routing — Piece K document-analysis pipeline (stage 4).
--
-- Routing decisions. After classification + extraction + resolution, the
-- pipeline emits one or more `document_routing` rows that describe which
-- module/tab should consume this document and what action to take. High-
-- confidence routings apply automatically; low-confidence routings are
-- HITL-gated.
--
-- This migration:
--   1. Creates `document_routing` (tenant-scoped, FK to documents).
--   2. Indexes for routing queues by tenant + status, and by module.
--   3. Gold-standard RLS pattern.
--
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS document_routing (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** estate | finance | compliance | hr | legal | crm | inventory */
  target_module     TEXT NOT NULL,
  /** create_lease | post_receipt | archive_id | create_contract |
      update_employee | open_ticket | ... */
  target_action     TEXT NOT NULL,
  /** Optional pointer to the entity row this routing created or updated.
      NULL until the routing is applied. */
  target_entity_id  TEXT,
  /** pending | applied | rejected | error */
  status            TEXT NOT NULL DEFAULT 'pending',
  /** JSON with the reasoning trace (doc_type, entities, confidence,
      thresholds). Used by the audit UI to explain routing decisions. */
  reasoning_jsonb   JSONB,
  hitl_required     BOOLEAN NOT NULL DEFAULT FALSE,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_routing_doc_idx
  ON document_routing (document_id);

CREATE INDEX IF NOT EXISTS document_routing_tenant_status_idx
  ON document_routing (tenant_id, status);

CREATE INDEX IF NOT EXISTS document_routing_module_idx
  ON document_routing (tenant_id, target_module);

-- Partial index for HITL queue.
CREATE INDEX IF NOT EXISTS document_routing_hitl_pending_idx
  ON document_routing (tenant_id, hitl_required, status)
  WHERE hitl_required = TRUE AND status = 'pending';

COMMENT ON TABLE document_routing IS
  'Piece K stage 4 — routing decisions. Maps a processed document to module+action targets; high-confidence auto-apply, low-confidence HITL-gate.';

COMMENT ON COLUMN document_routing.status IS
  'pending | applied | rejected | error';

COMMENT ON COLUMN document_routing.reasoning_jsonb IS
  'Trace: { docType, entities, confidence, thresholds, ruleChain }. For audit + explainability.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS pattern.
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'document_routing'
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
