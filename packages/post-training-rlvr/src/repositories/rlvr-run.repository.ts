/**
 * `RlvrRunRepository` — persistence port for `rlvr_runs`.
 *
 * Two implementations:
 *
 *   - `createInMemoryRlvrRunRepository()` — for tests + local dev.
 *   - `createSqlRlvrRunRepository()` — production wiring; the SQL
 *     implementation is dependency-injected with a query executor
 *     (Drizzle / pg client) so this package stays DB-agnostic.
 */

import type { RlvrRun, RlvrRunStatus } from '../types.js';

export interface RlvrRunRepository {
  create(run: RlvrRun): Promise<RlvrRun>;
  findById(id: string): Promise<RlvrRun | null>;
  updateStatus(
    id: string,
    status: RlvrRunStatus,
    endedAt: string | null,
  ): Promise<RlvrRun>;
  listByTenant(tenantId: string): Promise<ReadonlyArray<RlvrRun>>;
}

// ────────────────────────────────────────────────────────────────────────
// In-memory implementation
// ────────────────────────────────────────────────────────────────────────

export function createInMemoryRlvrRunRepository(): RlvrRunRepository {
  let runs: ReadonlyArray<RlvrRun> = Object.freeze([]);

  return {
    async create(run: RlvrRun): Promise<RlvrRun> {
      if (runs.some((r) => r.id === run.id)) {
        throw new Error(`RlvrRun already exists: ${run.id}`);
      }
      runs = Object.freeze([...runs, run]);
      return run;
    },

    async findById(id: string): Promise<RlvrRun | null> {
      return runs.find((r) => r.id === id) ?? null;
    },

    async updateStatus(
      id: string,
      status: RlvrRunStatus,
      endedAt: string | null,
    ): Promise<RlvrRun> {
      const existing = runs.find((r) => r.id === id);
      if (!existing) {
        throw new Error(`RlvrRun not found: ${id}`);
      }
      const updated: RlvrRun = Object.freeze({
        ...existing,
        status,
        endedAt,
      });
      runs = Object.freeze(runs.map((r) => (r.id === id ? updated : r)));
      return updated;
    },

    async listByTenant(
      tenantId: string,
    ): Promise<ReadonlyArray<RlvrRun>> {
      return Object.freeze(runs.filter((r) => r.tenantId === tenantId));
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// SQL implementation port (caller provides the executor)
// ────────────────────────────────────────────────────────────────────────

/**
 * Minimal SQL executor surface. The caller wires this to Drizzle or
 * a `pg` client.
 */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>>;
}

interface RlvrRunRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: string;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly status: string;
  readonly verifier_set: ReadonlyArray<string>;
  readonly audit_hash: string;
  readonly prev_hash: string;
}

function rowToRun(row: RlvrRunRow): RlvrRun {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenant_id,
    kind: row.kind as RlvrRun['kind'],
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status as RlvrRunStatus,
    verifierSet: Object.freeze([...row.verifier_set]),
    auditHash: row.audit_hash,
    prevHash: row.prev_hash,
  });
}

export function createSqlRlvrRunRepository(
  executor: SqlExecutor,
): RlvrRunRepository {
  return {
    async create(run: RlvrRun): Promise<RlvrRun> {
      const rows = await executor.query<RlvrRunRow>(
        `INSERT INTO rlvr_runs
           (id, tenant_id, kind, started_at, ended_at, status,
            verifier_set, audit_hash, prev_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          run.id,
          run.tenantId,
          run.kind,
          run.startedAt,
          run.endedAt,
          run.status,
          run.verifierSet,
          run.auditHash,
          run.prevHash,
        ],
      );
      const first = rows[0];
      if (!first) throw new Error('SQL insert returned no row');
      return rowToRun(first);
    },

    async findById(id: string): Promise<RlvrRun | null> {
      const rows = await executor.query<RlvrRunRow>(
        `SELECT * FROM rlvr_runs WHERE id = $1`,
        [id],
      );
      const first = rows[0];
      return first ? rowToRun(first) : null;
    },

    async updateStatus(
      id: string,
      status: RlvrRunStatus,
      endedAt: string | null,
    ): Promise<RlvrRun> {
      const rows = await executor.query<RlvrRunRow>(
        `UPDATE rlvr_runs
           SET status = $2, ended_at = $3
         WHERE id = $1
         RETURNING *`,
        [id, status, endedAt],
      );
      const first = rows[0];
      if (!first) throw new Error(`RlvrRun not found: ${id}`);
      return rowToRun(first);
    },

    async listByTenant(
      tenantId: string,
    ): Promise<ReadonlyArray<RlvrRun>> {
      const rows = await executor.query<RlvrRunRow>(
        `SELECT * FROM rlvr_runs
           WHERE tenant_id = $1
         ORDER BY started_at DESC`,
        [tenantId],
      );
      return Object.freeze(rows.map(rowToRun));
    },
  };
}
