/**
 * Watch repository — `continuous_watches` table.
 *
 * Migration 0018 §6. Carries id, tenant_id, topic, cadence_minutes,
 * last_run_at, next_run_at, thresholds, status, created_by_user_id.
 *
 * The cron poller calls `listDue()` periodically; on each poll the
 * orchestrator fires a Continuous Watch plan and then calls
 * `markRan()` to advance `next_run_at`.
 *
 * @module research-orchestrator/storage/watch-repository
 */

import type { DueWatch } from '../types.js';
import type { SqlLike } from './plan-repository.js';

export interface WatchRepository {
  listDue(now_iso: string, limit?: number): Promise<ReadonlyArray<DueWatch>>;
  markRan(args: {
    readonly id: string;
    readonly ran_at_iso: string;
    readonly next_run_at_iso: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryWatchRepository(initial: ReadonlyArray<DueWatch> = []): WatchRepository & {
  readonly state: ReadonlyMap<string, DueWatch>;
} {
  const state = new Map<string, DueWatch>();
  for (const w of initial) state.set(w.id, w);
  return {
    state,
    async listDue() {
      return Object.freeze([...state.values()]);
    },
    async markRan(args) {
      const existing = state.get(args.id);
      if (!existing) return;
      state.set(args.id, { ...existing, lastRunAt: args.ran_at_iso });
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation
// ---------------------------------------------------------------------------

export function createSqlWatchRepository(sql: SqlLike): WatchRepository {
  return {
    async listDue(now_iso, limit = 100) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, tenant_id, topic, cadence_minutes, thresholds, last_run_at
        FROM continuous_watches
        WHERE status = 'active'
          AND (next_run_at IS NULL OR next_run_at <= ${now_iso}::timestamptz)
        ORDER BY next_run_at ASC NULLS FIRST
        LIMIT ${limit}
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      return Object.freeze(
        rows.map<DueWatch>((row) => {
          const lastRunAt =
            row['last_run_at'] instanceof Date
              ? (row['last_run_at'] as Date).toISOString()
              : row['last_run_at'] === null || row['last_run_at'] === undefined
                ? null
                : String(row['last_run_at']);
          return {
            id: String(row['id']),
            tenantId: String(row['tenant_id']),
            topic: String(row['topic']),
            cadenceMinutes: Number(row['cadence_minutes']),
            thresholds: (row['thresholds'] as Record<string, unknown>) ?? {},
            lastRunAt,
          };
        }),
      );
    },
    async markRan(args) {
      await sql`
        UPDATE continuous_watches
        SET last_run_at = ${args.ran_at_iso}::timestamptz,
            next_run_at = ${args.next_run_at_iso}::timestamptz
        WHERE id = ${args.id}
      `;
    },
  };
}
