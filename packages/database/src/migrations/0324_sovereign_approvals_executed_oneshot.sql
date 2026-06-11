-- =============================================================================
-- Migration 0324 — sovereign_approvals.executed: the REAL one-shot column.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- The four-eye apply gate (assertApplyApproved, HARD RULE 3) refuses to replay
-- an approval that has already been consumed — it reads `approval.executed`.
-- Until now `sovereign_approvals` had NO `executed` column; the executor's
-- `toView` synthesised the flag from `payload.executed`, which NOTHING ever
-- writes. The one-shot guard was therefore permanently inert: an approval could
-- be replayed onto the same spec indefinitely (and a post-commit crash left the
-- approval re-usable). This migration gives the table a first-class boolean the
-- executor flips, atomically, inside the apply transaction via a compare-and-set
-- (UPDATE ... SET executed = true WHERE action_id = $1 AND executed = false
-- RETURNING action_id). A DDL failure in the same txn rolls back the consume,
-- so a corrected retry can still claim it; a successful apply commits both.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule)
-- ---------------------------------------------------
-- ADD COLUMN IF NOT EXISTS ... boolean NOT NULL DEFAULT false is a NOT-NULL
-- add WITH a constant DEFAULT: Postgres records the default in catalog metadata
-- and synthesises it for existing rows WITHOUT rewriting the table — no backfill
-- hazard, no long lock, no NULL window. The migration-safety gate classifies a
-- NOT-NULL-with-DEFAULT add as WARN (review for default-vs-business-truth), not
-- FAIL: `false` ("not yet executed") is the correct historical truth for every
-- pre-existing approval row, so the WARN is expected and benign. A re-run is a
-- pure no-op (IF NOT EXISTS). References only the pre-existing
-- `sovereign_approvals` table (migration 0305).
--
-- THIS CANNOT WEAKEN ISOLATION
-- ----------------------------
-- A new boolean column changes no RLS policy, no FORCE flag, no GUC. The
-- canonical `sovereign_approvals_tenant_isolation` policy on
-- `app.current_tenant_id` (migration 0305) is left untouched; the executor's
-- CAS write runs WITHIN that same tenant GUC the apply txn already binds first.
--
-- Companion files:
--   * packages/database/src/schemas/sovereign-approvals.schema.ts
--   * services/api-gateway/src/composition/module-spawning/approval.ts
--   * services/api-gateway/src/composition/module-spawning/executor.ts
--   * packages/module-orchestrator/src/ports.ts
--   * packages/module-orchestrator/src/apply.ts
-- =============================================================================

BEGIN;

-- The first-class one-shot flag. NOT NULL WITH a constant DEFAULT ⇒ no table
-- rewrite, no backfill UPDATE, no NULL window. Existing rows read `false`
-- ("not yet executed"), which is the correct historical truth.
ALTER TABLE sovereign_approvals
  ADD COLUMN IF NOT EXISTS executed boolean NOT NULL DEFAULT false;

COMMIT;
