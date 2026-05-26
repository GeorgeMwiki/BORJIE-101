/**
 * tenant-aware-query — wraps a Drizzle-shaped query builder so that
 * every `select`/`update`/`delete`/`insert` call asserts the active
 * tenant id appears in the WHERE / VALUES clause.
 *
 * We deliberately keep the type surface tiny — the guard does NOT
 * import Drizzle itself, because:
 *   (a) Drizzle has many cross-platform exports we do not need;
 *   (b) keeping it dep-free lets the package live below the
 *       database package in the import graph.
 *
 * The wrapper accepts any "query builder" exposing the four
 * mutator methods and returns a typed proxy that asserts before
 * delegating. Tests use a stub.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { getTenantContext } from '../context/tenant-context.js';
import {
  IsolationViolation,
  type TenantId,
} from '../types.js';

export interface DrizzleLikeQueryBuilder {
  // We model select / update / delete / insert as opaque
  // chainable objects. The wrapper does not introspect the
  // chain — it only inspects the *table* name (passed as a
  // string via .from() / .table) plus the WHERE expression
  // (string-serialised by Drizzle).
  select(...args: ReadonlyArray<unknown>): unknown;
  update(table: unknown, ...args: ReadonlyArray<unknown>): unknown;
  delete(table: unknown, ...args: ReadonlyArray<unknown>): unknown;
  insert(table: unknown, ...args: ReadonlyArray<unknown>): unknown;
}

/**
 * A minimal description of the table shape we depend on. Drizzle
 * tables expose `tenant_id` as a column when defined as
 * tenant-scoped via the platform's schema helpers.
 */
export interface TenantScopedTable {
  readonly _name: string;
  readonly tenant_id: unknown;
}

/**
 * Build the WHERE-fragment that asserts tenant_id == ctx.tenantId.
 * Returned as an opaque value because Drizzle's `eq` is what we
 * actually want to call — but the guard package does not depend
 * on Drizzle, so callers pass `eq` in via the factory.
 */
export interface EqFn {
  (column: unknown, value: string): unknown;
}

export interface TenantAwareQueryFactoryOptions {
  readonly db: DrizzleLikeQueryBuilder;
  readonly eq: EqFn;
}

/**
 * Returns a query builder that auto-applies the tenant-id WHERE
 * fragment. Refuses to operate outside a tenant context.
 *
 * Usage:
 *   const q = tenantAwareQuery({ db, eq });
 *   await q.select(parcels);              // -> WHERE tenant_id = $1
 *   await q.update(parcels, { area: ... });
 */
export function tenantAwareQuery(
  opts: TenantAwareQueryFactoryOptions,
): TenantAwareQueryBuilder {
  return new TenantAwareQueryBuilder(opts.db, opts.eq);
}

export class TenantAwareQueryBuilder {
  constructor(
    private readonly db: DrizzleLikeQueryBuilder,
    private readonly eq: EqFn,
  ) {}

  /**
   * Select with mandatory tenant_id WHERE. The caller MAY add
   * additional .where(...) clauses by calling .where on the
   * returned chain — the tenant fragment is folded in via
   * `and(...)` semantics by Drizzle itself once we apply it
   * before handing back the chain.
   */
  select(table: TenantScopedTable): unknown {
    const ctx = this.requireCtx(table, 'select');
    const chain = this.db.select() as { from(t: unknown): unknown };
    const fromChain = chain.from(table) as {
      where(expr: unknown): unknown;
    };
    return fromChain.where(this.eq(table.tenant_id, ctx.tenantId));
  }

  /** Update with mandatory tenant_id WHERE. */
  update(table: TenantScopedTable, values: Record<string, unknown>): unknown {
    const ctx = this.requireCtx(table, 'update');
    const chain = this.db.update(table) as {
      set(v: Record<string, unknown>): { where(expr: unknown): unknown };
    };
    return chain
      .set(values)
      .where(this.eq(table.tenant_id, ctx.tenantId));
  }

  /** Delete with mandatory tenant_id WHERE. */
  delete(table: TenantScopedTable): unknown {
    const ctx = this.requireCtx(table, 'delete');
    const chain = this.db.delete(table) as {
      where(expr: unknown): unknown;
    };
    return chain.where(this.eq(table.tenant_id, ctx.tenantId));
  }

  /**
   * Insert — asserts that the row payload carries a tenant_id
   * equal to the context tenant. Refuses any row that omits the
   * tenant_id key, or whose tenant_id differs from context.
   */
  insert(
    table: TenantScopedTable,
    rows: ReadonlyArray<Record<string, unknown>>,
  ): unknown {
    const ctx = this.requireCtx(table, 'insert');
    for (const row of rows) {
      if (!('tenant_id' in row)) {
        throw new IsolationViolation({
          layer: 'drizzle',
          kind: 'unscoped-query',
          tenantId: ctx.tenantId,
          message: `insert into ${table._name} omitted tenant_id column`,
        });
      }
      const observed = String(row.tenant_id);
      if (observed !== ctx.tenantId) {
        throw new IsolationViolation({
          layer: 'drizzle',
          kind: 'cross-tenant-access',
          tenantId: ctx.tenantId,
          observedTenantId: observed as TenantId,
          message: `insert into ${table._name} with tenant_id=${observed} ≠ context ${ctx.tenantId}`,
        });
      }
    }
    const chain = this.db.insert(table) as {
      values(rows: ReadonlyArray<Record<string, unknown>>): unknown;
    };
    return chain.values(rows);
  }

  private requireCtx(table: TenantScopedTable, op: string): {
    readonly tenantId: TenantId;
  } {
    const tableAny = table as { readonly _name?: unknown; readonly tenant_id?: unknown } | null;
    if (!tableAny || typeof tableAny._name !== 'string') {
      throw new IsolationViolation({
        layer: 'drizzle',
        kind: 'unscoped-query',
        message: `tenantAwareQuery.${op} requires a tenant-scoped table (with _name + tenant_id)`,
      });
    }
    if (!('tenant_id' in tableAny)) {
      throw new IsolationViolation({
        layer: 'drizzle',
        kind: 'unscoped-query',
        message: `tenantAwareQuery.${op}: table ${String(tableAny._name)} has no tenant_id column — refuse to scope`,
      });
    }
    const ctx = getTenantContext();
    return { tenantId: ctx.tenantId };
  }
}
