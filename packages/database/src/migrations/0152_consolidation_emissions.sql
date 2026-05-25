-- ============================================================================
-- Migration 0152 — Consolidation emissions / morning digest (D8 follow-up)
--
-- One row per (tenant, day) summarising the nightly consolidation tick.
-- Powers the morning briefing's "what changed overnight" surface and the
-- weekly digest. Idempotent: a re-run of stage 08 (publish) on the same
-- day for the same tenant updates rather than inserts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS consolidation_emissions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  emission_date DATE NOT NULL,
  tick_id TEXT NOT NULL,
  -- Headline scalars surfaced in the morning brief.
  facts_distilled INTEGER NOT NULL DEFAULT 0,
  facts_promoted INTEGER NOT NULL DEFAULT 0,
  reflexion_lessons_written INTEGER NOT NULL DEFAULT 0,
  entities_consolidated INTEGER NOT NULL DEFAULT 0,
  communities_detected INTEGER NOT NULL DEFAULT 0,
  rows_re_embedded INTEGER NOT NULL DEFAULT 0,
  -- LLM-narrated digest (Haiku-compiled in stage 08).
  digest_markdown TEXT,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Audit + provenance.
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One row per (tenant, date) — re-runs UPSERT.
  UNIQUE (tenant_id, emission_date)
);

CREATE INDEX IF NOT EXISTS idx_consolidation_emissions_tenant_date
  ON consolidation_emissions (tenant_id, emission_date DESC);

CREATE INDEX IF NOT EXISTS idx_consolidation_emissions_emitted_at
  ON consolidation_emissions (emitted_at DESC);
