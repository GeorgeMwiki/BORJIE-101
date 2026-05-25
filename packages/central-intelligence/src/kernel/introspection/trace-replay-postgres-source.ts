/**
 * Postgres-backed ReplaySource — reads `kernel_provenance` rows and
 * reconstructs `ReplayInput`s for the trace-replay runner.
 *
 * Duck-typed by design: we don't import `@borjie/database` so this
 * module stays in the kernel's hexagonal-port style. Production wires
 * a thin adapter around `pg.Pool`; tests pass a vi.fn() query client.
 *
 * The adapter expects rows with a superset of the columns produced by
 * the kernel's `ProvenanceRecord` writer. Optional columns (e.g.
 * `original_decision_kind`, `original_confidence_overall`) are read
 * back from a co-located audit table; missing fields fall back to
 * sensible defaults so a replay sweep can still produce a summary
 * even when the audit table is sparse.
 */

import type { ReplayInput, ReplaySource } from './trace-replay.js';

/**
 * Minimal duck-typed Postgres client. Mirrors the shape of `pg.Pool`
 * and `node-postgres`-style query clients, so production code can pass
 * a Pool directly and tests can pass a vi.fn() returning `{ rows }`.
 */
export interface PostgresProvenanceQueryClient {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

/**
 * Build a ReplaySource that fetches historical kernel turns from a
 * `kernel_provenance` Postgres table.
 *
 * The query joins `kernel_provenance` against an optional
 * `kernel_provenance_replay` table that carries the user message and
 * decision kind. Callers that don't have that audit-side table can
 * substitute a view with the same column names — the adapter only
 * cares about the column shape, not the underlying storage.
 */
export function createPostgresReplaySource(
  client: PostgresProvenanceQueryClient,
): ReplaySource {
  return {
    async fetchTraces(args) {
      const params: unknown[] = [args.limit];
      const conditions: string[] = [];
      let nextParam = 2;

      if (args.olderThanDays !== undefined) {
        conditions.push(`produced_at < NOW() - ($${nextParam} || ' days')::interval`);
        params.push(String(args.olderThanDays));
        nextParam += 1;
      }
      if (args.newerThanDays !== undefined) {
        conditions.push(`produced_at > NOW() - ($${nextParam} || ' days')::interval`);
        params.push(String(args.newerThanDays));
        nextParam += 1;
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const sql = [
        'SELECT',
        '  thought_id,',
        '  thread_id,',
        '  user_message,',
        '  scope_kind,',
        '  scope_tenant_id,',
        '  scope_actor_user_id,',
        '  scope_roles,',
        '  scope_persona_id,',
        '  tier,',
        '  stakes,',
        '  surface,',
        '  original_decision_kind,',
        '  original_sensor_id,',
        '  original_confidence_overall,',
        '  produced_at',
        'FROM kernel_provenance',
        whereClause,
        'ORDER BY produced_at DESC',
        'LIMIT $1',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await client.query(sql, params);

      return result.rows.map(rowToReplayInput).filter(isReplayInput);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Row mapping
// ─────────────────────────────────────────────────────────────────────

function rowToReplayInput(
  row: Record<string, unknown>,
): ReplayInput | null {
  const thoughtId = readString(row, 'thought_id');
  const threadId = readString(row, 'thread_id');
  const userMessage = readString(row, 'user_message');
  const scopeKindRaw = readString(row, 'scope_kind');
  const tier = readString(row, 'tier');
  const stakesRaw = readString(row, 'stakes');
  const surface = readString(row, 'surface');
  const originalSensorId = readString(row, 'original_sensor_id');
  const originalProducedAt = readString(row, 'produced_at');

  if (!thoughtId || !threadId || !userMessage || !tier || !surface) {
    return null;
  }
  if (scopeKindRaw !== 'tenant' && scopeKindRaw !== 'platform') return null;
  if (!isStakes(stakesRaw)) return null;

  const decisionKindRaw = readString(row, 'original_decision_kind');
  if (!isDecisionKind(decisionKindRaw)) return null;

  const actorUserId = readString(row, 'scope_actor_user_id');
  if (!actorUserId) return null;

  const roles = readStringArray(row, 'scope_roles');
  const personaId = readString(row, 'scope_persona_id') ?? '';

  const tenantIdRaw = readString(row, 'scope_tenant_id');
  const scope: ReplayInput['scope'] =
    scopeKindRaw === 'tenant'
      ? {
          kind: 'tenant',
          tenantId: tenantIdRaw ?? '',
          actorUserId,
          roles,
          personaId,
        }
      : {
          kind: 'platform',
          actorUserId,
          roles,
          personaId,
        };

  return {
    thoughtId,
    threadId,
    userMessage,
    scope,
    tier,
    stakes: stakesRaw,
    surface,
    originalDecisionKind: decisionKindRaw,
    originalSensorId: originalSensorId ?? '__unknown__',
    originalConfidenceOverall: readNumber(
      row,
      'original_confidence_overall',
    ) ?? 0,
    originalProducedAt: originalProducedAt ?? '',
  };
}

function isReplayInput(v: ReplayInput | null): v is ReplayInput {
  return v !== null;
}

function readString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readNumber(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readStringArray(
  row: Record<string, unknown>,
  key: string,
): ReadonlyArray<string> {
  const v = row[key];
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

function isStakes(
  v: string | null,
): v is 'low' | 'medium' | 'high' | 'critical' {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

function isDecisionKind(
  v: string | null,
): v is 'answer' | 'softened' | 'refusal' {
  return v === 'answer' || v === 'softened' || v === 'refusal';
}
