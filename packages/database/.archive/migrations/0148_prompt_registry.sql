-- ─────────────────────────────────────────────────────────────────────
-- Migration 0148 — Kernel prompt registry (Central Command Phase D, D5).
--
-- Backs the rollout-safety patterns that prevent Klarna-style silent
-- prompt regression. One row per (capability, version) pair carrying:
--
--   - prompt_text         : the full instruction body shipped to the
--                           sensor for the named capability
--   - golden_set_version  : the eval bundle id that signed off on this
--                           prompt — every promotion runs the matching
--                           golden set FIRST
--   - status              : 'shadow' (0% traffic, runs in parallel for
--                           divergence comparison only)
--                           'canary' (5% traffic — early-life prod)
--                           'canary-25' (25% — graduated canary)
--                           'active' (100% — current stable)
--                           'degraded' (SLO breach auto-rollback;
--                                       NEVER routed to new traffic)
--                           'archived' (decommissioned; retained for
--                                       audit replay only)
--   - promoted_at / promoted_by : operator audit trail. Mandatory on
--                                 every status change. Sourced from the
--                                 admin JWT subject of the API caller.
--
-- Companion service:
--   `packages/database/src/services/kernel-prompt-registry.service.ts`
--
-- Rollout controller + SLO tracker:
--   `packages/central-intelligence/src/kernel/rollout/*.ts`
--
-- The registry is the SOURCE OF TRUTH for which prompt the kernel
-- composes at sensor-call time. When the table is empty (or the
-- service is degraded), the kernel falls back to its hard-coded
-- identity preamble — the same shape every prior release shipped —
-- so this migration is non-breaking.
--
-- Hard guardrails:
--   - Append-mostly: status transitions are UPDATEs on the SAME row,
--     never deletes. Archived rows stay for replay forever.
--   - Idempotent: every CREATE uses IF NOT EXISTS; every index uses
--     IF NOT EXISTS so rerunning the migration is safe.
--   - Unique (capability, version): the kernel addresses prompts by
--     this tuple, never by the surrogate id.
--   - Status check constraint anchors the rollout state machine at the
--     SQL layer so a buggy admin tool cannot stash a free-form value.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS kernel_prompt_registry (
  id                  TEXT PRIMARY KEY,
  capability          TEXT NOT NULL,
  version             TEXT NOT NULL,
  prompt_text         TEXT NOT NULL,
  golden_set_version  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'shadow',
  promoted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_by         TEXT NOT NULL,
  archived_at         TIMESTAMPTZ,
  archived_reason     TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_kernel_prompt_registry_capability_version
    UNIQUE (capability, version),
  CONSTRAINT chk_kernel_prompt_registry_status
    CHECK (status IN ('shadow','canary','canary-25','active','degraded','archived'))
);

CREATE INDEX IF NOT EXISTS idx_kernel_prompt_registry_capability_status
  ON kernel_prompt_registry (capability, status);

CREATE INDEX IF NOT EXISTS idx_kernel_prompt_registry_promoted_at
  ON kernel_prompt_registry (promoted_at DESC);

COMMENT ON TABLE kernel_prompt_registry IS
  'Per-capability prompt version store. Powers shadow -> canary -> active rollout with instant rollback (Sierra Agent Studio 2.0 pattern). Source of truth for the kernel''s rollout controller.';

COMMENT ON COLUMN kernel_prompt_registry.status IS
  'shadow=0% traffic (parallel comparison only); canary=5%; canary-25=25%; active=100%; degraded=auto-rollback held (never routed); archived=decommissioned.';

COMMENT ON COLUMN kernel_prompt_registry.golden_set_version IS
  'Eval bundle id that signed off on this prompt. Promotions must reference a matching golden_set_version that passed offline scoring.';

COMMENT ON COLUMN kernel_prompt_registry.promoted_by IS
  'Admin subject from the JWT that issued the promote / rollback / shadow API call. Mandatory audit trail.';
