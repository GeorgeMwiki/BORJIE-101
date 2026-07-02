/**
 * Service-role-tenant-scope allow-list.
 *
 * The `audit-service-role-tenant-scope` scanner flags a service-role query
 * (a `withServiceRoleContext(...)` / `serviceRole: true` callback, or a
 * raw service-role client) that runs a Drizzle statement against a
 * TENANT-SCOPED table WITHOUT any `tenantId` / `tenant_id` bind inside the
 * same block. Under service-role bypass such a query reads/writes EVERY
 * tenant's rows (or, when the GUC isn't bound, returns ZERO rows under
 * FORCE-RLS) — the recurring RLS-darkness bug class.
 *
 * A file+function pair belongs here ONLY when the cross-tenant span is
 * DELIBERATE and safe. Legitimate categories:
 *
 *   1. Genuine cross-tenant system sweeps that MUST span every tenant
 *      (e.g. a global platform-wide reconciliation that iterates tenants
 *      itself, or a GLOBAL_SPINE_TABLES table with tenant_id = NULL by
 *      design like `intelligence_corpus_chunks`).
 *   2. Repositories over spine/global tables that carry a `tenant_id`
 *      column only for provenance and are NOT tenant-isolated by contract.
 *   3. Aggregate reads that select tenant_id as an OUTPUT column and
 *      GROUP BY it (the tenant is the dimension, not a missing filter).
 *
 * Each entry MUST justify why the un-bound span is safe. Keys are
 * `<relative-path>#<functionOrBlockLabel>`; a bare path key matches the
 * whole file. This is a RATCHET: entries only leave when the code is fixed,
 * never when it merely moves.
 */

export const SERVICE_ROLE_TENANT_SCOPE_ALLOWLIST = new Map([
  // ─── Internal admin cross-tenant read (deliberate) ───────────────────
  [
    'services/api-gateway/src/routes/mining/internal/decision-trace.hono.ts',
    'Internal-admin (/mining/internal) decision-trace list. `tenant` is an ' +
      'OPTIONAL filter (eq(decisionTraces.tenantId, tenant) is built into ' +
      '`conds` outside the block and applied when present); the admin view ' +
      'legitimately spans all tenants. Route is INTERNAL_ADMIN-gated.',
  ],

  // ─── Workflow-engine spine repositories (cross-tenant by contract) ────
  // The workflow-engine is a cross-tenant SPINE: its repositories run under
  // service-role and the per-tenant guard is enforced by the composition
  // layer / route middleware that wraps them (the gateway binds the active
  // tenant before dispatch). findById-by-run-PK + append-by-run-PK are the
  // engine's contract; run ids are unguessable UUIDs. Registered here as the
  // ratchet baseline — a NEW dark query on a tenant-scoped table anywhere
  // else still fails the gate.
  [
    'packages/workflow-engine/src/repositories/drizzle-audit-chain-repository.ts',
    'workflow-engine spine repo; per-run PK access, tenant guard at composition layer.',
  ],
  [
    'packages/workflow-engine/src/repositories/drizzle-run-event-repository.ts',
    'workflow-engine spine repo; per-run PK access, tenant guard at composition layer.',
  ],
  [
    'packages/workflow-engine/src/repositories/drizzle-run-repository.ts',
    'workflow-engine spine repo; per-run PK access, tenant guard at composition layer.',
  ],
  [
    'packages/workflow-engine/src/runs/drizzle-repos.ts',
    'workflow-engine spine repo; per-run PK access, tenant guard at composition layer.',
  ],
]);
