-- =============================================================================
-- Migration 0349 — self_healing_proposals: the INTERNAL-ADMIN self-healing
-- console queue. Every UI/wiring blocker the MAPE-K loop processes
-- (packages/portal-genui/src/self-healing/self-heal.ts) is recorded here for
-- the Borjie PLATFORM team to triage — needs-approval repair proposals
-- (code-gated: corrupt-spec / render-error / unwired-rule / dead-export) AND
-- auto-healed observations (the crystallization-candidate signal: unknown
-- render kinds, unmapped bindings). The owner NEVER sees this — these are
-- Borjie ENGINEERING issues, not tenant operations.
--
-- PLATFORM SCOPE (CLAUDE.md hard rule). This table is platform-internal: a
-- single proposal can originate from ANY tenant's render path, and only Borjie
-- internal-admins read the queue, cross-tenant. So it is NOT tenant-isolated.
-- `tenant_id` is NULLABLE and carries TRIAGE context only (which tenant's
-- render hit the blocker), never an access boundary. The table FORCE-enables
-- RLS with a SERVICE-ROLE-ONLY bypass policy (mirrors the global-spine pattern
-- in 0345 + the service-role bypass in 0342/0348): a tenant request (no
-- `app.is_service_role` flag) sees ZERO rows, so an owner can never read or
-- approve the platform healing its own wiring. The internal-admin routes read
-- + decide via `withServiceRoleContext`. The rls-coverage guard pins this in
-- GLOBAL_SPINE_TABLES so the service-role-only shape stays forever.
--
-- DEDUP. The same blocker recurs on every render of the same broken spec, so a
-- naive insert would flood the queue. `dedupe_key` = blocker_kind + ':' + locus
-- is UNIQUE: a repeat occurrence BUMPS `occurrence_count` + `last_seen_at`
-- instead of inserting a new row. A previously APPROVED proposal that recurs
-- re-opens to `pending` (the fix evidently did not take); a DENIED one stays
-- denied (the admin accepted the degrade — stop surfacing it).
--
-- STATUS. 'pending' (needs approve/deny — escalated/code-gated), 'auto-healed'
-- (observation — the customer was already served by a safe declarative move),
-- 'approved', 'denied'.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule): CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS + pg_policies-guarded CREATE POLICY +
-- pg_roles-guarded anon REVOKE. Every NOT NULL is on a freshly-created column
-- (no backfill hazard), so the NOT-NULL safety validator passes.
--
-- Immutable once shipped — never edit this file; append a new migration.
--
-- Companion files:
--   * packages/database/src/schemas/self-healing-proposals.schema.ts
--   * services/api-gateway/src/composition/portal-genui/self-healing-store.ts
--   * services/api-gateway/src/composition/portal-genui/internal-admin-sink.ts
--   * services/api-gateway/src/routes/mining/internal/self-healing.hono.ts
--   * packages/database/src/migrations/down/0349_down_self_healing_proposals.sql
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS self_healing_proposals (
  id                  text        PRIMARY KEY,
  -- BlockerKind: unknown-render-kind | unmapped-binding | admission-violation |
  -- render-error | unwired-rule | dead-export | corrupt-spec | <novel string>.
  blocker_kind        text        NOT NULL,
  -- RepairClass: reroute-degrade | rebind-generic | escalate-code | escalate-novel.
  repair_class        text        NOT NULL,
  -- Where the blocker fired (path / kind id / file:line).
  locus               text        NOT NULL,
  detail              text,
  title               text        NOT NULL,
  suggested_fix       text        NOT NULL,
  -- WHY + blast radius, for admin triage (never the owner).
  insight             text        NOT NULL,
  -- Ordered human-actionable steps.
  action_plan         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  auto_applicable     boolean     NOT NULL DEFAULT false,
  -- NULLABLE triage context only — which tenant's render hit it. NOT an access
  -- boundary (the service-role-only policy is the boundary).
  tenant_id           text,
  occurrence_count    integer     NOT NULL DEFAULT 1,
  -- blocker_kind || ':' || locus — the UNIQUE dedupe target.
  dedupe_key          text        NOT NULL,
  -- pending | auto-healed | approved | denied.
  status              text        NOT NULL DEFAULT 'pending',
  decided_by_actor_id text,
  decision_note       text,
  decided_at          timestamptz,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Dedup: one row per (kind, locus); repeats bump occurrence_count.
CREATE UNIQUE INDEX IF NOT EXISTS self_healing_proposals_dedupe_key
  ON self_healing_proposals (dedupe_key);

-- The console's hot scan: open items, most-recent first.
CREATE INDEX IF NOT EXISTS self_healing_proposals_status_seen_idx
  ON self_healing_proposals (status, last_seen_at DESC);

-- -----------------------------------------------------------------------------
-- RLS — FORCE + SERVICE-ROLE-ONLY bypass (no tenant-isolation policy, on
-- purpose: this is platform-internal, read cross-tenant by internal-admins).
-- A tenant request sees zero rows. Literal statements (not format/%I) so the
-- rls-coverage static analyzer recognises the FORCE + policy. Idempotent via
-- IF NOT EXISTS / DROP-then-CREATE. Guarded anon REVOKE.
-- -----------------------------------------------------------------------------

ALTER TABLE self_healing_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE self_healing_proposals FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS self_healing_proposals_service_role_bypass ON self_healing_proposals;
CREATE POLICY self_healing_proposals_service_role_bypass
  ON self_healing_proposals
  FOR ALL
  USING (current_setting('app.is_service_role', true) = 'true')
  WITH CHECK (current_setting('app.is_service_role', true) = 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.self_healing_proposals FROM anon;';
  END IF;
END $$;

COMMENT ON TABLE self_healing_proposals IS
  'Internal-admin self-healing console queue. Every UI/wiring blocker the '
  'MAPE-K loop processes is recorded for the Borjie PLATFORM team — '
  'needs-approval code-gated proposals AND auto-healed observations. '
  'Platform-internal: FORCE RLS + service-role-only bypass (owners never see '
  'it); tenant_id is nullable triage context, not an access boundary. '
  'Pinned in the rls-coverage GLOBAL_SPINE_TABLES registry.';

COMMIT;
