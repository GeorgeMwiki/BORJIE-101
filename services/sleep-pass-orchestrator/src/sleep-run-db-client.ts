/**
 * Concrete {@link SleepRunDbClient} over a raw Drizzle `execute` client (LP-21).
 *
 * `createDrizzleSleepRunStore` is parameterised over the minimal
 * {@link SleepRunDbClient} port precisely so the orchestrator pod never takes
 * a hard dependency on the database package's query builders. This module is
 * the thin SQL adapter that satisfies that port against the `brain_sleep_runs`
 * + `brain_sleep_emissions` tables (migration 0276).
 *
 * ── SYSTEM rows, no tenant GUC ──────────────────────────────────────────────
 * Per migration 0276 these are SYSTEM tables for the cross-tenant brain
 * heartbeat. The sleep tick runs as a platform job under the privileged /
 * service-role connection; there is NO `app.current_tenant_id` GUC bound and
 * `tenant_id` is NOT the isolation mechanism (table-level grants are). This
 * adapter therefore issues plain statements with no per-tenant `SET LOCAL`.
 *
 * ── Dependency discipline ───────────────────────────────────────────────────
 * The pod stays thin: it consumes a raw `{ execute(query) }` client (the same
 * shape the api-gateway db-client returns) and builds parameterised SQL with
 * drizzle-orm's `sql` tag (a transitive of `@borjie/database`). All values are
 * bound as parameters — no string interpolation of caller data.
 *
 * @module sleep-run-db-client
 */

import { sql } from 'drizzle-orm';
import type {
  SleepRunDbClient,
  SleepRunDbRow,
} from './drizzle-sleep-run-store.js';
import type { IsoTimestamp, PassId, SleepRunFinalize } from './types.js';

/** Raw Drizzle client surface this adapter needs — just `execute(query)`. */
export interface SleepRunExecutor {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Build a {@link SleepRunDbClient} bound to a raw Drizzle `execute` client.
 * The returned client is consumed by {@link createDrizzleSleepRunStore}; it
 * throws on DB error so the store's own try/catch can record + swallow it
 * (a persistence failure must never crash a tick).
 */
export function createSleepRunDbClient(
  db: SleepRunExecutor,
): SleepRunDbClient {
  return {
    async findRunningRun(passId: PassId): Promise<SleepRunDbRow | null> {
      const result = await db.execute(
        sql`SELECT id, started_at, status
              FROM brain_sleep_runs
             WHERE pass_id = ${passId}
               AND status = 'running'
             ORDER BY started_at DESC
             LIMIT 1`,
      );
      const row = firstRow(result);
      if (!row) return null;
      const id = asString(row.id);
      const startedAt = asIso(row.started_at);
      const status = asString(row.status);
      if (!id || !startedAt || !status) return null;
      return { id, startedAt, status };
    },

    async reapStuckRun(runId: string, errorText: string): Promise<void> {
      await db.execute(
        sql`UPDATE brain_sleep_runs
               SET status = 'failed',
                   error_text = ${errorText},
                   completed_at = now()
             WHERE id = ${runId}::uuid
               AND status = 'running'`,
      );
    },

    async insertRunningRun(passId: PassId): Promise<string> {
      const result = await db.execute(
        sql`INSERT INTO brain_sleep_runs (pass_id, status)
            VALUES (${passId}, 'running')
            RETURNING id`,
      );
      const row = firstRow(result);
      const id = row ? asString(row.id) : undefined;
      if (!id) {
        throw new Error('insertRunningRun: INSERT did not return an id');
      }
      return id;
    },

    async insertEmissions(
      runId: string,
      emissions: ReadonlyArray<{ kind: string; payload: unknown }>,
    ): Promise<void> {
      if (emissions.length === 0) return;
      // One multi-row INSERT. Each emission contributes a `(runId, kind,
      // jsonb)` row; the payload is bound as a JSON-encoded parameter cast to
      // jsonb so arbitrary payloads are stored verbatim and safely.
      const values = sql.join(
        emissions.map(
          (e) =>
            sql`(${runId}::uuid, ${e.kind}, ${JSON.stringify(
              e.payload ?? null,
            )}::jsonb)`,
        ),
        sql`, `,
      );
      await db.execute(
        sql`INSERT INTO brain_sleep_emissions (run_id, emission_kind, emission_jsonb)
            VALUES ${values}`,
      );
    },

    async updateRun(runId: string, fin: SleepRunFinalize): Promise<void> {
      await db.execute(
        sql`UPDATE brain_sleep_runs
               SET status = ${fin.status},
                   items_processed = ${fin.itemsProcessed},
                   items_emitted = ${fin.itemsEmitted},
                   duration_ms = ${fin.durationMs},
                   notes_text = ${fin.notes},
                   error_text = ${fin.errorText ?? null},
                   completed_at = now()
             WHERE id = ${runId}::uuid`,
      );
    },

    async latestStartedAt(passId: PassId): Promise<IsoTimestamp | null> {
      const result = await db.execute(
        sql`SELECT started_at
              FROM brain_sleep_runs
             WHERE pass_id = ${passId}
             ORDER BY started_at DESC
             LIMIT 1`,
      );
      const row = firstRow(result);
      return row ? asIso(row.started_at) : null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

function firstRow(result: unknown): Record<string, unknown> | null {
  const rows = rowsOf(result);
  return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function asIso(v: unknown): IsoTimestamp | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
