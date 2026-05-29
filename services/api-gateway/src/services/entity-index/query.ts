/**
 * Persona-aware entity-index query layer.
 *
 * Single entry-point used by the brain tools + the route handlers.
 * Wraps the SQL search/resolve/full-picture/recent calls in the
 * two-pass persona filter:
 *
 *   1) computePersonaProjection() returns the SQL scope projection +
 *      post-query redaction flags.
 *   2) The SQL runs with the scope projection appended to the WHERE.
 *   3) applyPersonaFilter() walks the rows and redacts financials +
 *      rewrites worker vocabulary as required.
 *
 * Tenant isolation: the RLS GUC is the authoritative tenant cap; this
 * layer adds the persona ceiling on top. The DB port is injected so
 * tests can run without a live PG.
 */

import { sql } from 'drizzle-orm';
import {
  applyPersonaFilter,
  computePersonaProjection,
  type EntityIndexPersona,
  type EntityIndexRow,
  type PersonaProjection,
} from './persona-filter.js';

export interface EntityIndexQueryDb {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow extends Record<string, unknown> {}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function toEntityIndexRow(row: ExecRow): EntityIndexRow {
  const base: Record<string, unknown> = {
    kind: String(row['kind']),
    id: String(row['id']),
    displayName: String(row['display_name'] ?? row['displayName'] ?? ''),
    summary: String(row['summary'] ?? ''),
  };
  if (row['tags'] !== undefined && Array.isArray(row['tags'])) {
    base['tags'] = Object.freeze((row['tags'] as ReadonlyArray<unknown>).map(String));
  }
  if (row['lifecycle_stage'] !== undefined || row['lifecycleStage'] !== undefined) {
    base['lifecycleStage'] = String(
      row['lifecycle_stage'] ?? row['lifecycleStage'] ?? 'active',
    );
  }
  if (row['refreshed_at'] !== undefined || row['refreshedAt'] !== undefined) {
    base['refreshedAt'] = String(row['refreshed_at'] ?? row['refreshedAt']);
  }
  if (row['scope_id'] !== undefined || row['scopeId'] !== undefined) {
    base['scopeId'] =
      row['scope_id'] === null || row['scopeId'] === null
        ? null
        : String(row['scope_id'] ?? row['scopeId']);
  }
  if (row['metadata'] !== undefined && row['metadata'] !== null) {
    base['metadata'] = Object.freeze(
      row['metadata'] as Readonly<Record<string, unknown>>,
    );
  }
  return Object.freeze(base) as unknown as EntityIndexRow;
}

export interface QueryEntityIndexInput {
  readonly tenantId: string;
  readonly persona: EntityIndexPersona;
  readonly actorScopeIds: ReadonlyArray<string>;
  /** Free-form query string — fuzzy + semantic depending on the operation. */
  readonly query?: string;
  /** Restrict to one or more kinds (offtake_contract, drill_hole, ...). */
  readonly kindFilter?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly language?: 'en' | 'sw';
  readonly counterpartyId?: string | null;
}

export interface QueryEntityIndexResult {
  readonly hits: ReadonlyArray<EntityIndexRow>;
  readonly projection: PersonaProjection;
  readonly queriedAt: string;
}

/**
 * Execute a persona-aware entity-index search. Returns the filtered +
 * redacted hits along with the projection that was applied (so the
 * caller can include it in audit traces).
 *
 * The SQL is intentionally simple — the real LMBM + semantic search
 * lives in `services/cross-reference-discovery`. This layer is the
 * persona-aware front-end the brain tools call.
 */
export async function queryEntityIndex(
  db: EntityIndexQueryDb,
  input: QueryEntityIndexInput,
): Promise<QueryEntityIndexResult> {
  const projection = computePersonaProjection({
    persona: input.persona,
    actorScopeIds: input.actorScopeIds,
    ...(input.counterpartyId !== undefined && {
      counterpartyId: input.counterpartyId,
    }),
  });

  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);
  const kindClause =
    input.kindFilter && input.kindFilter.length > 0
      ? sql`AND kind = ANY(${input.kindFilter as string[]}::text[])`
      : sql``;
  const queryClause = input.query
    ? sql`AND (display_name ILIKE ${'%' + input.query + '%'} OR summary ILIKE ${'%' + input.query + '%'})`
    : sql``;
  const scopeClause =
    projection.scopeIdsAllowed && projection.scopeIdsAllowed.length > 0
      ? sql`AND scope_id = ANY(${projection.scopeIdsAllowed as string[]}::text[])`
      : projection.scopeIdsAllowed !== null
        ? // Explicit empty allowlist means "no scope" — return nothing.
          sql`AND scope_id IS NULL`
        : sql``;

  const rawRows = rowsOf(
    await db.execute(sql`
      SELECT kind, id, display_name, summary, tags, lifecycle_stage,
             refreshed_at, scope_id, metadata
        FROM entity_index
       WHERE tenant_id = ${input.tenantId}
         ${queryClause}
         ${kindClause}
         ${scopeClause}
       ORDER BY refreshed_at DESC
       LIMIT ${limit}
    `),
  );

  const rows = rawRows.map(toEntityIndexRow);
  const hits = applyPersonaFilter(rows, projection, input.language ?? 'en');

  return Object.freeze({
    hits,
    projection,
    queriedAt: new Date().toISOString(),
  });
}
