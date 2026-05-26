/**
 * Session-replay retention purge — Central Command Phase C (C4).
 *
 * Periodic supervisor that deletes session-replay chunk metadata rows
 * older than `retentionDays` days, and (best-effort) the corresponding
 * cold-store blobs. Implements B5's Phase-C retention requirement.
 *
 * Why a side-channel supervisor: the recorder uploads chunks
 * continuously; without a purge worker `session_replay_chunks` grows
 * unbounded. The default retention window is 90 days — wide enough to
 * keep cohorts for post-mortem replay, narrow enough to bound storage
 * cost.
 *
 * Storage purge limitation (KNOWN GAP — tracked in #33 and the storage code
 * path below): the `SessionReplayStoragePort` in
 * `services/api-gateway/src/storage/session-replay-storage.ts` does NOT
 * currently expose a `delete()` method (out-of-scope for this agent).
 * When the port grows a `delete()` method the storage-side branch below
 * will start firing. Until then this worker deletes DB rows only and
 * logs a single-line WARN per tick so operators know cold-store rows
 * are orphaned.
 *
 * Hard rules:
 *   - Never throw past the supervisor boundary; this is a side-channel.
 *   - `.start()` / `.stop()` are idempotent.
 *   - `.stop()` cancels the periodic interval but allows the in-flight
 *     tick to finish (matches the `idleSessionEmitter` contract).
 *   - Tests inject a fake DB executor + a fake storage port; the
 *     production composition root binds the live Drizzle client + the
 *     selected storage adapter.
 */

// ─────────────────────────────────────────────────────────────────────
// Port shapes — duck-typed so this file does not pick up cross-package
// compile-time dependencies.
// ─────────────────────────────────────────────────────────────────────

/**
 * Tiny query executor surface. Production binds Drizzle's
 * `db.execute(sql)` (the same shape used by `consolidation-runner.ts`
 * and `idle-session-emitter.ts`). Tests inject an in-memory fake.
 *
 * `executeRaw` is parameterised: the worker passes the cutoff ISO date
 * as a positional parameter so SQL injection is impossible.
 */
export interface SessionReplayPurgeDb {
  /** Select chunk metadata older than `cutoffIso`. */
  listExpired(args: {
    readonly cutoffIso: string;
    readonly limit: number;
  }): Promise<ReadonlyArray<ExpiredChunkRef>>;
  /** Delete the listed chunk rows by id. Returns the count actually deleted. */
  deleteByIds(ids: ReadonlyArray<string>): Promise<number>;
}

export interface ExpiredChunkRef {
  readonly id: string;
  readonly storageUri: string;
  readonly byteSize: number;
}

/**
 * Storage adapter delete surface. The production port
 * (`SessionReplayStoragePort`) does NOT currently expose `delete()` —
 * the slot stays `null` until a follow-up agent adds it. When `null`
 * the worker still deletes DB rows and logs a warning.
 */
export interface SessionReplayPurgeStorage {
  /**
   * Delete a single chunk blob by its storage URI. Must NEVER throw —
   * the caller swallows errors per side-channel rules.
   */
  delete(storageUri: string): Promise<void>;
}

export interface SessionReplayRetentionDeps {
  readonly db: SessionReplayPurgeDb;
  /** Optional storage adapter. When null/undefined, storage purge is skipped. */
  readonly storage?: SessionReplayPurgeStorage | null;
  /** Retention window in days. Default 90. */
  readonly retentionDays?: number;
  /** Tick interval in ms. Default 1 hour. */
  readonly intervalMs?: number;
  /** Max chunks to scan per tick. Default 1000. */
  readonly perTickLimit?: number;
  /** Override clock — tests supply a deterministic now(). */
  readonly now?: () => number;
  /** Optional structured logger. */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface SessionReplayRetentionResult {
  readonly rowsDeleted: number;
  readonly bytesPurged: number;
  readonly storageDeletes: number;
  readonly storageFailures: number;
}

export interface SessionReplayRetention {
  /** Run one purge pass synchronously. Never throws. */
  tick(): Promise<SessionReplayRetentionResult>;
  start(): void;
  stop(): void;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_PER_TICK_LIMIT = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const EMPTY_RESULT: SessionReplayRetentionResult = {
  rowsDeleted: 0,
  bytesPurged: 0,
  storageDeletes: 0,
  storageFailures: 0,
};

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createSessionReplayRetention(
  deps: SessionReplayRetentionDeps,
): SessionReplayRetention {
  if (!deps.db) {
    throw new Error('createSessionReplayRetention: db is required');
  }

  const now = deps.now ?? Date.now;
  const retentionDays =
    deps.retentionDays && deps.retentionDays > 0
      ? Math.floor(deps.retentionDays)
      : DEFAULT_RETENTION_DAYS;
  const intervalMs =
    deps.intervalMs && deps.intervalMs > 0
      ? Math.floor(deps.intervalMs)
      : DEFAULT_INTERVAL_MS;
  const perTickLimit =
    deps.perTickLimit && deps.perTickLimit > 0
      ? Math.floor(deps.perTickLimit)
      : DEFAULT_PER_TICK_LIMIT;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let storageWarnedThisProcess = false;

  function cutoffIso(): string {
    const cutoffMs = now() - retentionDays * MS_PER_DAY;
    return new Date(cutoffMs).toISOString();
  }

  async function tick(): Promise<SessionReplayRetentionResult> {
    if (inFlight) return EMPTY_RESULT;
    inFlight = true;
    try {
      let expired: ReadonlyArray<ExpiredChunkRef> = [];
      try {
        expired = await deps.db.listExpired({
          cutoffIso: cutoffIso(),
          limit: perTickLimit,
        });
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              worker: 'session-replay-retention',
              error: err instanceof Error ? err.message : String(err),
            },
            'session-replay-retention: db.listExpired failed',
          );
        }
        return EMPTY_RESULT;
      }

      if (!expired || expired.length === 0) {
        return EMPTY_RESULT;
      }

      // Step 1 — best-effort storage delete. Each failure is counted
      // but never aborts the pass; the DB row will still be removed so
      // the index stays clean.
      let storageDeletes = 0;
      let storageFailures = 0;
      if (deps.storage) {
        for (const ref of expired) {
          if (!ref?.storageUri) continue;
          try {
            await deps.storage.delete(ref.storageUri);
            storageDeletes += 1;
          } catch (err) {
            storageFailures += 1;
            if (deps.logger?.warn) {
              deps.logger.warn(
                {
                  worker: 'session-replay-retention',
                  storageUri: ref.storageUri,
                  error: err instanceof Error ? err.message : String(err),
                },
                'session-replay-retention: storage.delete failed (row will still be purged from DB)',
              );
            }
          }
        }
      } else if (!storageWarnedThisProcess && deps.logger?.warn) {
        // Follow-up central-command-phase-c (#33): the production
        // `SessionReplayStoragePort` does not yet expose a `delete()`
        // method. Until that port grows the method, the retention
        // worker purges DB rows only. A follow-up agent must:
        //   1. Add `delete(storageUri: string): Promise<void>` to
        //      `services/api-gateway/src/storage/session-replay-storage.ts`.
        //   2. Wire the live storage port into the
        //      `sessionReplayRetention` slot in `service-registry.ts`.
        // Until then orphaned blobs accumulate in the cold store.
        deps.logger.warn(
          {
            worker: 'session-replay-retention',
            limitation: 'storage-port-missing-delete-method',
          },
          'session-replay-retention: storage adapter missing — orphan blobs will accumulate',
        );
        storageWarnedThisProcess = true;
      }

      // Step 2 — delete the DB rows in a single round-trip.
      let rowsDeleted = 0;
      try {
        const ids = expired
          .map((r) => r?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (ids.length > 0) {
          rowsDeleted = await deps.db.deleteByIds(ids);
        }
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              worker: 'session-replay-retention',
              expiredCount: expired.length,
              error: err instanceof Error ? err.message : String(err),
            },
            'session-replay-retention: db.deleteByIds failed (next tick retries)',
          );
        }
        // Do not change the result — storage may already have purged
        // partial blobs. Return what we got so the caller can act.
        return {
          rowsDeleted: 0,
          bytesPurged: 0,
          storageDeletes,
          storageFailures,
        };
      }

      const bytesPurged = expired.reduce(
        (sum, r) => sum + (Number.isFinite(r?.byteSize) ? r.byteSize : 0),
        0,
      );

      if (deps.logger?.info && rowsDeleted > 0) {
        deps.logger.info(
          {
            worker: 'session-replay-retention',
            rowsDeleted,
            bytesPurged,
            storageDeletes,
            storageFailures,
            retentionDays,
          },
          'session-replay-retention: tick complete',
        );
      }

      return {
        rowsDeleted,
        bytesPurged,
        storageDeletes,
        storageFailures,
      };
    } finally {
      inFlight = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        // Fire-and-forget; tick() never throws.
        void tick();
      }, intervalMs);
      // Don't hold the event loop open just for retention.
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
      // Note: an in-flight tick will finish on its own — we do not
      // abort it. The `inFlight` guard prevents overlapping ticks.
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Default Drizzle-backed `SessionReplayPurgeDb` — operates on
// `session_replay_chunks` (migration 0142). Out-of-scope to extend
// the chunks service with a `deleteOlderThan` method (see retention notes at top
// of file), so we issue raw parameterised SQL here. Returns `[]` /
// `0` on any DB error so the supervisor degrades cleanly.
//
// TENANT-ISOLATION NOTE (Mr. Mwikila, SEC-1):
// This purge worker is a *system-level* retention sweep. It runs
// outside any tenant request context and intentionally operates over
// rows from every tenant simultaneously, filtering only by age. It is
// allowlisted in `@borjie/tenant-isolation-guard` scanner because:
//   1. There is no caller-supplied input that selects rows by id —
//      `listExpired` returns ids strictly by `received_at < cutoff`.
//   2. `deleteByIds` only deletes ids that `listExpired` returned in
//      the same tick, so there is no cross-request id-replay risk.
//   3. The supervisor that wires this is a singleton background tick,
//      not a per-request handler. Operator confusion is mitigated by
//      the supervisor's enable/disable feature flag.
// If you change this worker to accept caller-supplied ids, you MUST
// re-introduce a `tenant_id = ${ctx.tenantId}` predicate.
// ─────────────────────────────────────────────────────────────────────

export function createDrizzlePurgeDb(
  db: { execute(q: unknown): Promise<unknown> } | null | undefined,
): SessionReplayPurgeDb {
  return {
    async listExpired(args) {
      if (!db) return [];
      try {
        const { sql } = await import('drizzle-orm');
        const cutoff = new Date(args.cutoffIso);
        const limit = Math.max(1, Math.min(args.limit, 10_000));
        const rows = (await db.execute(
          sql`SELECT id, storage_uri, byte_size
              FROM session_replay_chunks
              WHERE received_at < ${cutoff}
              ORDER BY received_at ASC
              LIMIT ${limit}`,
        )) as unknown;
        const list = toRows(rows);
        const out: ExpiredChunkRef[] = [];
        for (const row of list) {
          const id = asNonEmptyString(row.id);
          const storageUri = asNonEmptyString(row.storage_uri);
          const byteSize = Number(row.byte_size);
          if (!id || !storageUri) continue;
          out.push({
            id,
            storageUri,
            byteSize: Number.isFinite(byteSize) ? byteSize : 0,
          });
        }
        return out;
      } catch {
        // Side-channel — never bubble up.
        return [];
      }
    },
    async deleteByIds(ids) {
      if (!db) return 0;
      if (!ids || ids.length === 0) return 0;
      try {
        const { sql } = await import('drizzle-orm');
        const idList = ids.filter(
          (id) => typeof id === 'string' && id.length > 0,
        );
        if (idList.length === 0) return 0;
        // `ANY(${idList})` is the standard Drizzle pattern for an IN
        // clause over a parameter array.
        const result = (await db.execute(
          sql`DELETE FROM session_replay_chunks WHERE id = ANY(${idList})`,
        )) as unknown;
        // postgres-js returns an object with `count`; the underlying
        // pg `rowCount` is also surfaced via `.rowCount`. Prefer
        // `rowCount` then fall back to `count`.
        const wrapped = result as {
          rowCount?: number;
          count?: number;
        } | null;
        if (typeof wrapped?.rowCount === 'number') return wrapped.rowCount;
        if (typeof wrapped?.count === 'number') return wrapped.count;
        return idList.length;
      } catch {
        return 0;
      }
    },
  };
}

function toRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
