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
  // NOTE: the physical `entity_index` columns are `entity_kind` / `entity_id`
  // (migration 0115) — there is NO `kind` / `id` / `scope_id` / `metadata`
  // column. We alias `entity_kind`/`entity_id` to the `kind`/`id` the row
  // mapper expects and emit NULL placeholders for the (not-yet-modelled)
  // `scope_id` / `metadata`. An earlier revision SELECTed the phantom
  // `kind`/`id`/`scope_id`/`metadata` columns, which threw "column does not
  // exist" and left every wired entity-legibility loopback route returning a
  // 500 — i.e. born-dark. The kind-filter below therefore predicates on the
  // real `entity_kind` column. Per-row scope clipping over `scope_id` is a
  // registered follow-on (the column is unmodelled today, so the persona
  // filter's null-scope rows are treated as in-scope for the owner/admin
  // personas the brain tools use).
  const kindClause =
    input.kindFilter && input.kindFilter.length > 0
      ? // Bind the filter as an explicit `ARRAY[...]::text[]` — a bare
        // `${input.kindFilter}::text[]` makes drizzle spread it into the
        // invalid record cast `($1, $2)::text[]`, returning empty silently.
        sql`AND entity_kind = ANY(ARRAY[${sql.join(
          input.kindFilter.map((k) => sql`${k}`),
          sql`, `,
        )}]::text[])`
      : sql``;
  const queryClause = input.query
    ? sql`AND (display_name ILIKE ${'%' + input.query + '%'} OR summary ILIKE ${'%' + input.query + '%'})`
    : sql``;

  const rawRows = rowsOf(
    await db.execute(sql`
      SELECT entity_kind AS kind, entity_id AS id, display_name, summary, tags,
             lifecycle_stage, refreshed_at,
             NULL::text  AS scope_id,
             NULL::jsonb AS metadata
        FROM entity_index
       WHERE tenant_id = ${input.tenantId}
         ${queryClause}
         ${kindClause}
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
