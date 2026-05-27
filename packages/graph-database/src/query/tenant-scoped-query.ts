/**
 * Tenant-scoped query gate.
 *
 * Builder is the normal path. This file is the *escape hatch*: when
 * a host service must run a raw Cypher string (e.g. from a migration
 * file, or a manual operational query), it goes through
 * `wrapTenantScopedQuery` which:
 *
 *   1. Verifies the cypher mentions `$tenantId` at least once.
 *   2. Verifies every labelled node pattern includes the
 *      `tenantId: $tenantId` predicate.
 *   3. Injects `tenantId` into the params if missing.
 *   4. Rejects any cypher that fails these checks.
 *
 * This mirrors the discipline of `tenant-isolation-guard.ts` in
 * `@borjie/database`: cross-tenant leakage is unrecoverable, so
 * the wrapper fails closed.
 *
 * @module @borjie/graph-database/query/tenant-scoped-query
 */

import {
  GraphDatabaseError,
  type CypherQuery,
  type GraphDriverId,
} from '../types.js';

export interface WrapTenantScopedQueryArgs {
  readonly cypher: string;
  readonly tenantId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly readOnly?: boolean;
  readonly preferredDriver?: GraphDriverId;
}

/**
 * Validate + wrap a raw Cypher string into a `CypherQuery`. Throws
 * `GraphDatabaseError('tenant_scope_missing')` if the cypher does
 * not reference `$tenantId`. Throws if any labelled node pattern
 * is missing the `tenantId` property predicate.
 */
export function wrapTenantScopedQuery(
  args: WrapTenantScopedQueryArgs,
): CypherQuery {
  if (!args.tenantId || args.tenantId.trim().length === 0) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'wrapTenantScopedQuery requires a non-empty tenantId',
    );
  }
  if (!args.cypher || args.cypher.trim().length === 0) {
    throw new GraphDatabaseError(
      'invalid_cypher',
      'wrapTenantScopedQuery requires a non-empty cypher string',
    );
  }

  assertCypherReferencesTenantId(args.cypher);
  assertAllNodePatternsHaveTenantFilter(args.cypher);

  const params: Record<string, unknown> = {
    ...(args.params ?? {}),
    tenantId: args.tenantId,
  };

  const query: CypherQuery = {
    cypher: args.cypher,
    params,
    tenantId: args.tenantId,
    tenantScoped: true,
    readOnly: args.readOnly ?? false,
    ...(args.preferredDriver !== undefined
      ? { preferredDriver: args.preferredDriver }
      : {}),
  };
  return query;
}

// ---------------------------------------------------------------------------
// Internal assertions
// ---------------------------------------------------------------------------

function assertCypherReferencesTenantId(cypher: string): void {
  if (!cypher.includes('$tenantId')) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'cypher does not reference $tenantId — tenant isolation invariant violated',
      { cypher },
    );
  }
}

/**
 * Inspect every labelled node pattern `(var:Label ...)` and confirm
 * each one contains the `tenantId: $tenantId` predicate either as a
 * property map or via a `WHERE var.tenantId = $tenantId` clause.
 *
 * We use a deliberately permissive regex pass — false positives are
 * acceptable, false negatives are not.
 */
function assertAllNodePatternsHaveTenantFilter(cypher: string): void {
  const nodePatternRegex = /\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*[A-Za-z_][A-Za-z0-9_]*[^)]*\)/g;
  const variablesSeen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = nodePatternRegex.exec(cypher)) !== null) {
    const variable = match[1];
    const fullPattern = match[0];
    if (variable === undefined) continue;
    variablesSeen.add(variable);
    const inlineHasTenant = fullPattern.includes('tenantId');
    if (inlineHasTenant) continue;
    // Inline didn't include — accept if there's a WHERE clause
    // referencing this variable's tenantId.
    const wherePattern = new RegExp(
      `\\b${variable}\\.tenantId\\s*=\\s*\\$tenantId`,
      'g',
    );
    if (wherePattern.test(cypher)) continue;
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      `node pattern for variable '${variable}' missing tenantId filter`,
      { variable, pattern: fullPattern },
    );
  }
  if (variablesSeen.size === 0) {
    throw new GraphDatabaseError(
      'invalid_cypher',
      'no labelled node patterns found — wrapTenantScopedQuery expects at least one',
      { cypher },
    );
  }
}

/**
 * Strict guard: reject `CypherQuery` values whose `tenantScoped`
 * flag is missing or false. The driver port uses this to fail
 * closed before any I/O.
 */
export function assertTenantScopedQuery(query: CypherQuery): void {
  if (query.tenantScoped !== true) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'query is not tenant-scoped — drivers refuse to run unscoped queries',
    );
  }
  if (!query.tenantId || query.tenantId.trim().length === 0) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'query.tenantId is empty — tenant isolation invariant violated',
    );
  }
  if (!query.cypher.includes('$tenantId')) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'query.cypher does not reference $tenantId',
      { cypher: query.cypher },
    );
  }
  if (!('tenantId' in query.params)) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'query.params.tenantId is missing',
    );
  }
}
