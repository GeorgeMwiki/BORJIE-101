-- =============================================================================
-- Migration 0326 — Capability Gap Register: extend md_commitments into the
-- MD's durable SELF-MODEL of its own capability gaps (Loop A, P0).
--
-- See Docs/research/THE_METACOGNITIVE_SELF_MODEL.md §3 (Loop A — the
-- Capability-Gap Register).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- An LLM brain that fails silently — or, worse, confidently guesses past a
-- missing tool / dark organ / absent approval — is the dominant empirical
-- failure mode (Kadavath 2022; AbstentionBench 2025). Mr. Mwikila must instead
-- record what he CANNOT YET do as a first-class, hash-chained, durable register
-- entry keyed on the BLOCKER, and AUTONOMOUSLY complete the deferred work when
-- that blocker clears — under EXTERNAL verification, never self-attestation.
--
-- THE KEY DESIGN TRUTH: a capability gap and an ordinary deferred commitment
-- are the SAME data structure — a typed, suspended goal that auto-resumes when
-- its blocker clears. So we EXTEND md_commitments (migration 0321) rather than
-- fork a second store (a separate gap store would drift from the commitment
-- store and re-introduce the "built-but-disconnected" class of bug). A row with
-- gap_kind = NULL is an ordinary GTD commitment; a non-NULL gap_kind row IS a
-- capability/understanding gap. One table, one reconcile sweep, one closure
-- discipline.
--
-- NET-NEW COLUMNS (all nullable or DEFAULTed — additive, no backfill hazard):
--   * gap_kind          — NULL = ordinary commitment; else one of
--                         missing_tool | bug | unwired_organ | missing_evidence
--                         | needs_approval | understanding_gap | structural.
--   * blocked_by        — jsonb array of blocking commitment ids (the DAG edges,
--                         Claude Agent SDK addBlockedBy). NOT NULL DEFAULT '[]'.
--   * unblock_trigger   — jsonb predicate { kind, target }: the EXACT input that
--                         flips the gap to confident (Kadavath inject-context).
--                         kind ∈ tool_registered | evidence_ingested |
--                         approval_granted | flag_enabled | feature_shipped.
--   * competence_domain — estate-domain coordinate for the jagged-frontier
--                         roll-up (licences | royalty | treasury | ...). Nullable.
--
-- IDEMPOTENCY / FRESH-DB SAFETY (CLAUDE.md hard rule): every column uses
-- ADD COLUMN IF NOT EXISTS so on a fully-migrated DB this is a pure no-op. The
-- one NOT NULL (blocked_by) carries a DEFAULT '[]'::jsonb so there is no
-- backfill hazard and the NOT-NULL safety validator passes (NEW column +
-- DEFAULT). A guarded CHECK on gap_kind enforces the typed enum without
-- breaking existing NULL-gap_kind rows.
--
-- RLS (CLAUDE.md hard rule): md_commitments already FORCE-enables RLS with the
-- canonical app.current_tenant_id tenant-isolation policy + service-role bypass
-- (migration 0321). This migration ADDS COLUMNS ONLY — it NEVER touches RLS,
-- never disables FORCE, never re-creates a policy. The existing isolation is
-- preserved verbatim.
--
-- Companion files:
--   * packages/database/src/schemas/md-commitments.schema.ts
--   * packages/database/src/repositories/md-commitment-repository.ts
--   * packages/central-intelligence/src/kernel/gap-registry-watcher.ts
--   * packages/workflow-engine/src/autonomy/deferred-work-dependency-resolver.ts
--   * packages/database/src/migrations/down/0326_down_capability_gap_register.sql
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- gap_kind — the discriminator. NULL = ordinary GTD commitment; a non-NULL
-- value marks the row as a capability/understanding gap the watcher re-probes.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS gap_kind text;

-- -----------------------------------------------------------------------------
-- blocked_by — the DAG dependency edges (array of blocking commitment ids).
-- NOT NULL with DEFAULT '[]'::jsonb: a NEW column with a default is backfill-safe
-- (every existing row trivially gets '[]'), so the NOT-NULL validator passes.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS blocked_by jsonb NOT NULL DEFAULT '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- unblock_trigger — the predicate that flips the gap to confident. jsonb shape:
--   { "kind": "tool_registered" | "evidence_ingested" | "approval_granted"
--           | "flag_enabled" | "feature_shipped",
--     "target": "<toolName | evidenceId | approvalKey | flagName | featureKey>" }
-- Nullable: an ordinary commitment carries no unblock trigger.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS unblock_trigger jsonb;

-- -----------------------------------------------------------------------------
-- competence_domain — the jagged-frontier coordinate for the org-level
-- capability roll-up (never a single global readiness %). Nullable.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS competence_domain text;

-- -----------------------------------------------------------------------------
-- Typed-enum CHECK for gap_kind. Guarded so re-running on a migrated DB is a
-- no-op. NULL is allowed (ordinary commitment); a non-NULL value must be one of
-- the seven typed gap kinds. NOT VALID is NOT used: every column is new/NULL so
-- no existing row can violate the constraint (validation is trivially cheap).
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'md_commitments_gap_kind_chk'
       AND conrelid = 'md_commitments'::regclass
  ) THEN
    ALTER TABLE md_commitments
      ADD CONSTRAINT md_commitments_gap_kind_chk CHECK (
        gap_kind IS NULL OR gap_kind IN (
          'missing_tool', 'bug', 'unwired_organ', 'missing_evidence',
          'needs_approval', 'understanding_gap', 'structural'
        )
      );
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- attempt_failed_count — the reopened-attempt cap counter. Net-new, NOT NULL
-- with DEFAULT 0: a NEW column with a default is backfill-safe (every existing
-- row trivially gets 0), so the NOT-NULL validator passes. After N reopened
-- attempts the auto-completer dead-letters the gap (no infinite reattempt+verify
-- storm). Distinct from attempt_count (the 0303 surface/delivery retry counter).
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS attempt_failed_count integer NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- gap_audit_seq — the PER-GAP monotonic audit-chain ordinal (FIX 3b). 0 at the
-- gap's genesis advance, +1 per durable advance. Net-new, NOT NULL with
-- DEFAULT 0: a NEW column with a default is backfill-safe (every existing row
-- trivially gets 0), so the NOT-NULL validator passes. The replayable gap-audit
-- log persists this ordinal so an independent replay can detect a TRUNCATED or
-- INSERTED chain (a sound log must present a gapless 0..N run). Distinct from the
-- ai_audit_chain.sequence_id (which is the per-TENANT chain ordinal); this is the
-- per-GAP ordinal the gap-audit replay verifies.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  ADD COLUMN IF NOT EXISTS gap_audit_seq integer NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- Extend the status CHECK with the two TERMINAL gap states. The 0321
-- md_commitments_status_chk only allowed the six live/done states; a parked
-- sovereign gap (needs_approval) and an attempt-exhausted gap (dead_letter) must
-- be writable so they EXIT the watcher live set (no per-tick re-fire storm).
-- This migration is UNCOMMITTED + not yet applied, so re-shaping its own status
-- domain here (NOT an edit of a shipped numbered file) is the correct seam. The
-- done_proof CHECK (md_commitments_done_proof_chk) is untouched: needs_approval
-- and dead_letter never require confirmed_at, and `done` still must carry proof.
-- Idempotent: DROP IF EXISTS then re-add, so a re-run lands the same final shape.
-- -----------------------------------------------------------------------------
ALTER TABLE md_commitments
  DROP CONSTRAINT IF EXISTS md_commitments_status_chk;
ALTER TABLE md_commitments
  ADD CONSTRAINT md_commitments_status_chk CHECK (
    status IN (
      'open', 'scheduled', 'overdue', 'blocked', 'done', 'reopened',
      'needs_approval', 'dead_letter'
    )
  );

-- -----------------------------------------------------------------------------
-- Hot scan for the watcher: OPEN/BLOCKED gap rows for a tenant. Partial index
-- on non-NULL gap_kind keeps the gap sweep cheap even as the ordinary-commitment
-- backlog grows (the watcher never re-reads ordinary commitments).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS md_commitments_gap_open_idx
  ON md_commitments (tenant_id, gap_kind, status)
  WHERE gap_kind IS NOT NULL;

COMMENT ON COLUMN md_commitments.gap_kind IS
  'Capability-gap discriminator. NULL = ordinary GTD commitment; else one of '
  'missing_tool|bug|unwired_organ|missing_evidence|needs_approval|'
  'understanding_gap|structural. The GapRegistryWatcher re-probes only '
  'non-NULL rows.';
COMMENT ON COLUMN md_commitments.blocked_by IS
  'DAG dependency edges — array of blocking commitment ids (Agent SDK '
  'addBlockedBy). A gap becomes READY only when all blocked_by edges resolve.';
COMMENT ON COLUMN md_commitments.unblock_trigger IS
  'The predicate that flips the gap to confident: { kind, target }. kind ∈ '
  'tool_registered|evidence_ingested|approval_granted|flag_enabled|'
  'feature_shipped. Encodes the EXACT missing input (Kadavath inject-context).';
COMMENT ON COLUMN md_commitments.competence_domain IS
  'Estate-domain coordinate for the jagged capability-frontier roll-up '
  '(licences|royalty|treasury|...). Never a single global readiness %.';
COMMENT ON COLUMN md_commitments.attempt_failed_count IS
  'Reopened-attempt cap counter for a capability gap. After N reopened attempts '
  'the auto-completer moves the gap to the dead_letter TERMINAL status (out of '
  'the watcher live set) so it cannot re-fire + re-verify forever.';
COMMENT ON COLUMN md_commitments.gap_audit_seq IS
  'Per-gap monotonic audit-chain ordinal (0 at genesis, +1 per durable advance). '
  'Persisted onto each gap-audit log entry so an independent replay can detect a '
  'truncated or inserted chain (a sound log presents a gapless 0..N run). '
  'Distinct from ai_audit_chain.sequence_id (the per-tenant chain ordinal).';

COMMIT;
