-- =============================================================================
-- 0223: executive_briefs — Piece C MD Executive Brief outputs.
--
-- The "06:00 AM brief" — what an executive (T1 Owner / T2 Admin like a
-- Director General) sees the moment they open the portal. Each brief is
-- a structured object of:
--
--   gaps             — what's missing / behind (e.g. "rent collection
--                       below target in Mwanza district by 18%")
--   opportunities    — what could be optimised / harvested
--   risks            — what threatens the plan (expiry, breach, default)
--   recommended_actions — concrete Piece B / Piece L actions, with the
--                          target module + payload prebuilt
--   approval_packets    — pre-bundled K5 four-eye approval payloads,
--                          ready to fire when the executive clicks
--                          "Approve" on a recommended action.
--   citations        — array of {claim_index, entity_id|audit_event_id,
--                       page?} so every claim is backed
--
-- Hash-chained: each brief's `hash` is sha256(prev_hash + payload).
-- Tamper-evident across the per-persona timeline. `audit_chain_link`
-- references the canonical ai_audit_chain row.
--
-- Status enum:
--   GENERATED  — fresh, never viewed
--   VIEWED     — executive has opened it
--   ACTIONED   — at least one recommended_action has been approved
--   DISMISSED  — executive explicitly dismissed
--   ARCHIVED   — older than 30 days, hidden from default views
--
-- Tenant-scoped via FORCE RLS using the gold-standard 0185 pattern.
-- =============================================================================

CREATE TABLE IF NOT EXISTS executive_briefs (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Persona this brief targets — gates who can read it via RLS + tier
      check at the application layer. */
  persona_id               TEXT NOT NULL REFERENCES personas(id),
  /** Scope shape:
        {
          modules:        ["ESTATE", "FINANCE", ...],
          time_window:    "P7D",
          focus_entities: ["ce_..."]
        }
  */
  scope_jsonb              JSONB NOT NULL,
  /** Each is array of {title, description, severity, citations[]}. */
  gaps_jsonb               JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunities_jsonb      JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks_jsonb              JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** [{title, target_module, action, payload, confidence}]. */
  recommended_actions_jsonb JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Prebuilt four-eye approval packets — fire when the executive
      clicks "Approve" on a recommended action. K5 wires these through
      the actual approval pipeline. */
  approval_packets_jsonb   JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** [{claim_index, entity_id?, audit_event_id?, page?}]. Every
      gap/opportunity/risk item MUST have at least one citation. The
      application-layer Zod schema rejects briefs without citations. */
  citations_jsonb          JSONB NOT NULL DEFAULT '[]'::jsonb,
  locale                   TEXT NOT NULL DEFAULT 'en',
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_start             TIMESTAMPTZ NOT NULL,
  period_end               TIMESTAMPTZ NOT NULL,
  /** Pin the prompt + planner version that generated this brief.
      Used by replay + drift-detector evals. */
  generator_version        TEXT NOT NULL,
  /** USD cost in microdollars (consistent with cost-ledger). */
  cost_micros              INTEGER,
  /** sha256(prev_hash || canonical_payload). Tamper-evident chain. */
  hash                     TEXT NOT NULL,
  /** Chains to the prior brief for the same persona. NULL = first brief
      for this (tenant, persona). */
  prev_hash                TEXT,
  /** Optional anchor into ai_audit_chain. */
  audit_chain_link         TEXT,
  status                   TEXT NOT NULL DEFAULT 'GENERATED'
    CHECK (status IN ('GENERATED', 'VIEWED', 'ACTIONED', 'DISMISSED', 'ARCHIVED')),
  viewed_at                TIMESTAMPTZ,
  dismissed_at             TIMESTAMPTZ,

  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS executive_briefs_tenant_persona_idx
  ON executive_briefs (tenant_id, persona_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS executive_briefs_tenant_status_idx
  ON executive_briefs (tenant_id, status);
CREATE INDEX IF NOT EXISTS executive_briefs_tenant_generated_idx
  ON executive_briefs (tenant_id, generated_at DESC);

COMMENT ON TABLE executive_briefs IS
  'Piece C — structured executive briefs (gaps/opportunities/risks/recommended_actions). Hash-chained for tamper-evident timeline per persona.';

COMMENT ON COLUMN executive_briefs.hash IS
  'sha256(prev_hash || canonical_payload). prev_hash chains to the prior brief for the same (tenant, persona).';

COMMENT ON COLUMN executive_briefs.citations_jsonb IS
  'Per-claim citations. Each citation references core_entity.id OR audit_event.id. Application-layer Zod rejects briefs where a gap/opportunity/risk has zero citations.';

-- ─────────────────────────────────────────────────────────────────────────
-- Gold-standard RLS (0185 pattern)
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'executive_briefs'
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
