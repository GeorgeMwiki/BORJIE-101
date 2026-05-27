/**
 * Filter builder — typed compiler for a parameterised SQL WHERE.
 *
 * Given a `SearchFilters` value and the caller's tenantId, produces a
 * `{ whereSql, params }` pair. The tenantId is always the first
 * predicate and the first parameter — defence-in-depth against an
 * RLS misconfiguration. The compiler is pure: same inputs → same
 * SQL.
 *
 * The SQL the compiler emits targets a relation that has columns:
 *   - tenant_id text
 *   - capability_kind text
 *   - region text NULL
 *   - posted_at timestamptz
 *   - parent_thread_id uuid NULL
 *   - cross_ref_count int
 *
 * For repos that materialise that view differently, the SQL adapter
 * is expected to alias appropriately before invoking the compiler.
 *
 * @module @borjie/blackboard-intel/search/filter-builder
 */

import type { SearchFilters } from '../types.js';

export interface CompiledFilter {
  readonly whereSql: string;
  readonly params: ReadonlyArray<string | number | boolean>;
}

/**
 * Compile a SearchFilters value (plus tenantId) into a parameterised
 * SQL WHERE clause. Always returns at least `WHERE tenant_id = $1`.
 *
 * Parameter ordering is deterministic — used by tests as the
 * stable predicate the in-memory adapter must reproduce.
 */
export function buildWhere(
  tenantId: string,
  filters: SearchFilters | undefined,
): CompiledFilter {
  const params: Array<string | number | boolean> = [tenantId];
  const predicates: string[] = ['tenant_id = $1'];

  const push = (predicate: string, value: string | number | boolean): void => {
    params.push(value);
    const idx = params.length;
    predicates.push(predicate.replace('$$', `$${idx}`));
  };

  if (filters) {
    if (filters.region !== undefined) {
      push('region = $$', filters.region);
    }
    if (filters.capabilityKind !== undefined) {
      push('capability_kind = $$', filters.capabilityKind);
    }
    if (filters.dateFrom !== undefined) {
      push('posted_at >= $$', filters.dateFrom);
    }
    if (filters.dateTo !== undefined) {
      push('posted_at <= $$', filters.dateTo);
    }
    if (filters.parentThreadId !== undefined) {
      push('parent_thread_id = $$', filters.parentThreadId);
    }
    if (filters.hasCrossRef === true) {
      predicates.push('cross_ref_count > 0');
    } else if (filters.hasCrossRef === false) {
      predicates.push('cross_ref_count = 0');
    }
  }

  return Object.freeze({
    whereSql: predicates.join(' AND '),
    params: Object.freeze([...params]),
  });
}

/**
 * Apply a SearchFilters value to an in-memory row collection. Pure
 * and deterministic — mirrors `buildWhere` so tests assert the same
 * semantics against the in-memory adapter that production will use
 * against Postgres.
 */
export interface InMemoryFilterableRow {
  readonly tenantId: string;
  readonly capabilityKind?: string;
  readonly region?: string;
  readonly postedAt?: string;
  readonly parentThreadId?: string | null;
  readonly crossRefCount?: number;
}

export function applyFiltersInMemory<T extends InMemoryFilterableRow>(
  rows: ReadonlyArray<T>,
  tenantId: string,
  filters: SearchFilters | undefined,
): ReadonlyArray<T> {
  let out = rows.filter((r) => r.tenantId === tenantId);
  if (!filters) return Object.freeze([...out]);

  if (filters.region !== undefined) {
    out = out.filter((r) => r.region === filters.region);
  }
  if (filters.capabilityKind !== undefined) {
    out = out.filter((r) => r.capabilityKind === filters.capabilityKind);
  }
  if (filters.dateFrom !== undefined) {
    const cutoff = Date.parse(filters.dateFrom);
    out = out.filter(
      (r) =>
        r.postedAt !== undefined && Date.parse(r.postedAt) >= cutoff,
    );
  }
  if (filters.dateTo !== undefined) {
    const cutoff = Date.parse(filters.dateTo);
    out = out.filter(
      (r) =>
        r.postedAt !== undefined && Date.parse(r.postedAt) <= cutoff,
    );
  }
  if (filters.parentThreadId !== undefined) {
    out = out.filter(
      (r) => r.parentThreadId === filters.parentThreadId,
    );
  }
  if (filters.hasCrossRef === true) {
    out = out.filter((r) => (r.crossRefCount ?? 0) > 0);
  } else if (filters.hasCrossRef === false) {
    out = out.filter((r) => (r.crossRefCount ?? 0) === 0);
  }
  return Object.freeze([...out]);
}
