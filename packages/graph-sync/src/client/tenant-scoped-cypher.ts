/**
 * Tenant-scoped Cypher helper — closes Gap D from
 * `.planning/parity-litfin/09-tools-connectors-kg.md`.
 *
 * The base `Neo4jClient.readQuery` / `writeQuery` accept an open
 * `Record<string, unknown>` for params. Nothing in the type system
 * requires a `tenantId`. A future tool that forgets a single
 * `WHERE n._tenantId = $tenantId` will silently leak cross-tenant
 * data — impossible to catch in CI without a Cypher linter.
 *
 * This wrapper provides a TYPE-LEVEL guarantee:
 *   - `TenantScopedParams<T>` widens any caller-supplied param object
 *     with a mandatory `tenantId: string`. Forgetting it is a
 *     TypeScript compile error.
 *   - At runtime the wrapper also asserts the Cypher actually
 *     references `$tenantId` and rejects queries that don't.
 *
 * The wrapper is purely additive — it composes ON TOP of any
 * `Neo4jReadClient` / `Neo4jWriteClient` duck-type. The graph-sync
 * `Neo4jClient` already satisfies the duck-typed interfaces, so the
 * wrapper drops in without changing the underlying client.
 *
 * The runtime check is conservative — it allows `$tenantId`,
 * `{tenantId: $tenantId}`, and embedded `_tenantId: $tenantId` forms.
 * It rejects queries with no `$tenantId` reference at all.
 */

// ---------- Public types ----------

/**
 * Param object every tenant-scoped query must supply. The intersection
 * with `T` ensures callers can ADD extra params but never DROP
 * `tenantId`.
 */
export type TenantScopedParams<T extends Record<string, unknown> = Record<string, unknown>> =
  T & { readonly tenantId: string };

/**
 * Minimal duck-typed surface needed for tenant-scoped reads. Matches
 * `Neo4jClient.readQuery` exactly so the production client drops in.
 */
export interface Neo4jReadClient {
  readQuery<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
    database?: string,
  ): Promise<T[]>;
}

/** Same shape for write-side queries. */
export interface Neo4jWriteClient {
  writeQuery<T = Record<string, unknown>>(
    cypher: string,
    params?: Record<string, unknown>,
    database?: string,
  ): Promise<T[]>;
}

export interface TenantScopedCypherClient {
  readScoped<R = Record<string, unknown>, P extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string,
  ): Promise<R[]>;

  writeScoped<R = Record<string, unknown>, P extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string,
  ): Promise<R[]>;
}

export interface TenantScopedCypherDeps {
  readonly reader: Neo4jReadClient;
  readonly writer?: Neo4jWriteClient;
  /**
   * When true (default), reject Cypher queries that don't reference
   * `$tenantId`. Tests may relax this for negative-path coverage.
   */
  readonly strict?: boolean;
}

export class TenantScopeViolation extends Error {
  public readonly code = 'TENANT_SCOPE_VIOLATION' as const;
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeViolation';
  }
}

// ---------- Helpers ----------

const TENANT_ID_PATTERN = /\$tenantId\b/;

export function assertCypherReferencesTenantId(cypher: string): void {
  if (!TENANT_ID_PATTERN.test(cypher)) {
    throw new TenantScopeViolation(
      'TenantScopedCypher: query MUST reference $tenantId; refusing to run a tenant-unscoped Cypher query',
    );
  }
}

function assertTenantIdParam(params: Record<string, unknown>): void {
  const tenantId = params.tenantId;
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeViolation(
      'TenantScopedCypher: params.tenantId is required and must be a non-empty string',
    );
  }
}

// ---------- Factory ----------

export function createTenantScopedCypher(
  deps: TenantScopedCypherDeps,
): TenantScopedCypherClient {
  const strict = deps.strict ?? true;

  async function readScoped<R = Record<string, unknown>, P extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string,
  ): Promise<R[]> {
    if (strict) assertCypherReferencesTenantId(cypher);
    assertTenantIdParam(params);
    return deps.reader.readQuery<R>(cypher, params, database);
  }

  async function writeScoped<R = Record<string, unknown>, P extends Record<string, unknown> = Record<string, unknown>>(
    cypher: string,
    params: TenantScopedParams<P>,
    database?: string,
  ): Promise<R[]> {
    if (!deps.writer) {
      throw new TenantScopeViolation(
        'TenantScopedCypher: writer client not configured; refuse to write',
      );
    }
    if (strict) assertCypherReferencesTenantId(cypher);
    assertTenantIdParam(params);
    return deps.writer.writeQuery<R>(cypher, params, database);
  }

  return { readScoped, writeScoped };
}

// ─────────────────────────────────────────────────────────────────────
// Cypher mini-builder — utility for assembling tenant-scoped queries
// without forgetting the gate. Optional; callers can hand-roll Cypher
// and the runtime guard will still catch missing `$tenantId`.
// ─────────────────────────────────────────────────────────────────────

/**
 * Inject a `{_tenantId: $tenantId}` clause into a node pattern. Useful
 * for templating multi-tenant queries where authors keep forgetting the
 * gate. Returns the rewritten pattern string.
 *
 * Example:
 *   scopeNodePattern('(p:Property)')  →  '(p:Property {_tenantId: $tenantId})'
 *   scopeNodePattern('(p:Property {status: "active"})')
 *     →  '(p:Property {_tenantId: $tenantId, status: "active"})'
 */
export function scopeNodePattern(pattern: string): string {
  const trimmed = pattern.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return pattern; // not a node pattern; leave alone
  }
  if (TENANT_ID_PATTERN.test(trimmed)) {
    return pattern; // already scoped
  }
  // Strip outer parens, then re-emit with the tenant gate inserted.
  const inner = trimmed.slice(1, -1);
  // Detect existing property bag — naive match for the FIRST '{'.
  const braceIdx = inner.indexOf('{');
  if (braceIdx === -1) {
    return `(${inner} {_tenantId: $tenantId})`;
  }
  const before = inner.slice(0, braceIdx).trimEnd();
  const after = inner.slice(braceIdx + 1).replace(/^\s*/, '');
  // `after` now starts with the bag contents (and ends with `}`).
  // Prefix it with `_tenantId: $tenantId, ` and re-close the outer paren.
  return `(${before} {_tenantId: $tenantId, ${after})`;
}
