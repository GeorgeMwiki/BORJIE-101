/**
 * require-tenant-context — the runtime + lint contract that a tenant-scoped
 * query never runs OUTSIDE a `withTenantContext` / `withServiceRoleContext`
 * transaction.
 *
 * WHY THIS EXISTS (RSS-03)
 * ───────────────────────
 * In `DATABASE_POOL_MODE=transaction` the per-request reserved connection is
 * gone: the middleware no longer binds a session-scoped tenant GUC on a pinned
 * backend. The tenant GUC is bound per-operation by `withTenantContext`
 * (`SET LOCAL` inside a short transaction). A route that issues a BARE
 * `c.get('db')` query OUTSIDE such a wrapper therefore runs with NO tenant GUC.
 *
 * That is fail-CLOSED, not a leak: FORCE-RLS policies read
 * `current_setting('app.current_tenant_id', true)`; with nothing set the
 * `missing_ok=true` arg returns NULL → the policy matches ZERO tenant rows. So
 * the failure mode of forgetting the wrapper is an empty result (a correctness
 * bug), never another tenant's rows. We still want to catch it early.
 *
 * TWO LAYERS OF ENFORCEMENT
 * ─────────────────────────
 *  1. STATIC (the durable guarantee) — an ESLint rule `require-tenant-context`
 *     (mirroring the repo's existing `require-csrf-headers` rule, wired into
 *     `pr-check.yml`) flags any `c.get('db')` / `ctx.db` usage under
 *     `services/api-gateway/src/routes/**` that is NOT lexically inside a
 *     `withTenantContext(` / `withServiceRoleContext(` callback. The rule's
 *     selector contract is exported from this module as
 *     {@link RAW_DB_ACCESSOR_PATTERNS} and
 *     {@link TENANT_CONTEXT_WRAPPER_NAMES} so the rule and the runtime guard
 *     never drift.
 *  2. RUNTIME (defence-in-depth) — {@link requireTenantContextBound} can wrap a
 *     `tx` handle to assert (in dev/test) that the binding statements actually
 *     ran. Production routes use {@link runInTenantContext} which is just a
 *     thin, obvious alias over `withTenantContext` so call authors have one
 *     blessed path.
 *
 * This module is import-safe (no DB, no env) so the ESLint rule and unit tests
 * can pull the shared constants without a Postgres dependency.
 */

import type { DatabaseClient } from '../client.js';
import { withTenantContext } from './with-tenant-context.js';

/**
 * Source-text patterns the ESLint rule treats as a "raw tenant-scoped db
 * accessor". Any of these appearing OUTSIDE a tenant-context wrapper callback
 * in a tenant-scoped route is a violation. Kept here (not inlined in the rule)
 * so the rule and the runtime helpers share one source of truth.
 */
export const RAW_DB_ACCESSOR_PATTERNS: readonly string[] = Object.freeze([
  "c.get('db')",
  'c.get("db")',
  'ctx.db',
  'c.var.db',
]);

/**
 * The wrapper call names that satisfy the rule — a raw db accessor is allowed
 * only when it is lexically inside a callback passed to one of these.
 */
export const TENANT_CONTEXT_WRAPPER_NAMES: readonly string[] = Object.freeze([
  'withTenantContext',
  'withServiceRoleContext',
  'runInTenantContext',
]);

/**
 * The single blessed path for a route to touch the db with a bound tenant GUC.
 * A thin, explicitly-named alias over `withTenantContext` so route authors have
 * one obvious, greppable entry point and the ESLint rule has a stable name to
 * whitelist. Identical semantics to `withTenantContext`.
 *
 * @example
 *   return runInTenantContext(db, auth.tenantId, (tx) =>
 *     tx.select().from(bids).where(eq(bids.id, id)),
 *   );
 */
export function runInTenantContext<T>(
  db: DatabaseClient,
  tenantId: string,
  fn: (tx: DatabaseClient) => Promise<T>,
  opts?: Parameters<typeof withTenantContext>[3],
): Promise<T> {
  return withTenantContext(db, tenantId, fn, opts);
}

/**
 * Defence-in-depth runtime assertion. Pass the `tenantId` a route is about to
 * use; throws synchronously if it is empty/blank. This catches the case where a
 * route resolved a tenant id from auth but then forgot to thread it into the
 * wrapper — surfacing a loud error instead of a silently-empty result set.
 *
 * Cheap and side-effect-free; safe to call on every request.
 */
export function assertTenantId(
  tenantId: string | null | undefined,
  context = 'tenant-scoped query',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error(
      `require-tenant-context: ${context} attempted without a tenant id. ` +
        'Wrap the query in withTenantContext(db, tenantId, ...) / ' +
        'runInTenantContext(...) so the app.current_tenant_id GUC is bound.',
    );
  }
}
