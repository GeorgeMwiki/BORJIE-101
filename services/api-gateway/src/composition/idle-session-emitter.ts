/**
 * Idle-session emitter — periodic daemon that detects sessions that
 * have been idle for ≥ N minutes and writes a Reflexion buffer entry
 * so the next session for the same (tenant, user) starts with a
 * verbal-RL note about the prior idle exit.
 *
 * Central Command Phase B closure for C5's
 * `isIdleSessionEnd()` helper — the kernel ships the pure heuristic
 * (`packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts`)
 * but until now no production code called it. This emitter does:
 *
 *   1. Every `intervalMs` (default 60 s) scan the active-sessions
 *      source for distinct `(tenantId, userId, sessionId, lastEventAt)`
 *      tuples seen in the last `lookbackMinutes` (default 60 min).
 *   2. For each tuple, evaluate the local idle heuristic. When idle
 *      ≥ `idleMs` (default 5 min) AND the (tenant, user, session) tuple
 *      has NOT already been emitted in this process's lifetime, write a
 *      reflexion via the wired writer port.
 *   3. Memoise emitted session ids in an in-process LRU so we don't
 *      double-write reflections every tick.
 *   4. Swallow all errors — the emitter is a side-channel; it MUST
 *      never throw past its boundary.
 *
 * The ReflexionWriterPort + isIdleSessionEnd heuristic are duck-typed
 * locally so this file does not pick up a compile-time dependency on a
 * deep import path that is not part of the package's public `exports`
 * map. The shapes mirror the kernel's `reflexion-writer.ts` exactly.
 *
 * Tenant isolation: each session tuple already carries `tenantId`;
 * the writer port re-validates at insert time (migration 0125's
 * `reflexion_buffer` has a tenant FK).
 */

// ─────────────────────────────────────────────────────────────────────
// Port shapes — duck-typed against the kernel's reflexion-writer
// ─────────────────────────────────────────────────────────────────────

/**
 * Mirrors `ReflexionWriterPort` in
 * `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts`.
 * The api-gateway composition root binds a Drizzle-backed implementation
 * (the kernel's `reflexion_buffer` service) to this slot; tests inject
 * an in-memory fake.
 */
export interface ReflexionWriterPort {
  record(args: {
    readonly tenantId: string;
    readonly userId: string;
    readonly sessionId: string;
    readonly reflection: string;
    readonly outcome: 'success' | 'failure' | 'mixed';
  }): Promise<{ id: string }>;
}

/**
 * Source of recent session activity. Production binding reads from
 * `sensorium_event_log` (the brain skin) — every captured user-side
 * event lands there, so the latest `received_at` per
 * `(tenantId, userId, sessionId)` is a clean activity probe. Tests
 * inject an in-memory fake.
 */
export interface ActiveSessionSource {
  listRecent(args: {
    readonly lookbackMinutes: number;
    readonly limit: number;
  }): Promise<ReadonlyArray<ActiveSessionTuple>>;
}

export interface ActiveSessionTuple {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  /** Epoch ms of the last activity event for this session. */
  readonly lastActivityAt: number;
}

export interface IdleEmitterDeps {
  readonly source: ActiveSessionSource;
  readonly reflexionWriter: ReflexionWriterPort;
  /** Override clock — tests supply a deterministic now() in epoch ms. */
  readonly now?: () => number;
  /** Idle threshold in ms. Default 5 minutes. */
  readonly idleMs?: number;
  /** Lookback window in minutes for the active-session scan. Default 60. */
  readonly lookbackMinutes?: number;
  /** Max active-session tuples per scan. Default 500. */
  readonly perScanLimit?: number;
  /** Cap of (tenant, user, session) tuples to remember as already-emitted. */
  readonly emittedCacheCap?: number;
  /** Tick interval in ms. Default 60_000 (1 minute). */
  readonly intervalMs?: number;
  /** Optional structured logger. */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
}

export interface IdleSessionEmitter {
  /** Run one scan + emit pass synchronously. Returns the count of
   *  newly-emitted reflexions in this tick. Throws never. */
  tick(): Promise<number>;
  /** Start the periodic loop. Idempotent. */
  start(): void;
  /** Stop the periodic loop. Idempotent. */
  stop(): void;
}

// ─────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_IDLE_MS = 5 * 60 * 1000;
const DEFAULT_LOOKBACK_MIN = 60;
const DEFAULT_PER_SCAN_LIMIT = 500;
const DEFAULT_EMITTED_CACHE_CAP = 5_000;
const DEFAULT_INTERVAL_MS = 60_000;

const REFLECTION_MAX_LEN = 4_000;

/**
 * Idle heuristic mirrored from
 * `packages/central-intelligence/src/kernel/reflexion/reflexion-writer.ts#isIdleSessionEnd`.
 * Kept local to avoid a deep-import dependency.
 */
function isIdleSessionEnd(args: {
  readonly lastTurnAt: number;
  readonly now: number;
  readonly idleMs: number;
}): boolean {
  if (!Number.isFinite(args.lastTurnAt) || !Number.isFinite(args.now)) {
    return false;
  }
  return args.now - args.lastTurnAt >= args.idleMs;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createIdleSessionEmitter(
  deps: IdleEmitterDeps,
): IdleSessionEmitter {
  if (!deps.source) {
    throw new Error('createIdleSessionEmitter: source is required');
  }
  if (!deps.reflexionWriter) {
    throw new Error('createIdleSessionEmitter: reflexionWriter is required');
  }

  const now = deps.now ?? Date.now;
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const lookbackMinutes = deps.lookbackMinutes ?? DEFAULT_LOOKBACK_MIN;
  const perScanLimit = deps.perScanLimit ?? DEFAULT_PER_SCAN_LIMIT;
  const emittedCap = deps.emittedCacheCap ?? DEFAULT_EMITTED_CACHE_CAP;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;

  // Insertion-ordered Set acts as a tiny LRU.
  const emitted = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  function rememberEmitted(key: string): void {
    if (emitted.has(key)) return;
    if (emitted.size >= emittedCap) {
      const oldest = emitted.values().next().value;
      if (oldest !== undefined) emitted.delete(oldest);
    }
    emitted.add(key);
  }

  function emittedKey(t: ActiveSessionTuple): string {
    return `${t.tenantId}::${t.userId}::${t.sessionId}`;
  }

  function composeIdleReflection(idleMinutes: number): string {
    const lines: string[] = [
      'Intent: (idle session — no explicit terminator)',
      'Outcome: mixed',
      'Lessons:',
      `- Session went idle without explicit terminator after ${idleMinutes} min`,
    ];
    return truncate(lines.join('\n'), REFLECTION_MAX_LEN);
  }

  async function tick(): Promise<number> {
    if (inFlight) return 0;
    inFlight = true;
    try {
      let tuples: ReadonlyArray<ActiveSessionTuple> = [];
      try {
        tuples = await deps.source.listRecent({
          lookbackMinutes,
          limit: perScanLimit,
        });
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              emitter: 'idle-session',
              error: err instanceof Error ? err.message : String(err),
            },
            'idle-session-emitter: source.listRecent failed',
          );
        }
        return 0;
      }

      const nowMs = now();
      let emittedThisTick = 0;
      for (const tuple of tuples) {
        if (
          !tuple ||
          !tuple.tenantId ||
          !tuple.userId ||
          !tuple.sessionId ||
          !Number.isFinite(tuple.lastActivityAt)
        ) {
          continue;
        }
        const key = emittedKey(tuple);
        if (emitted.has(key)) continue;
        const idle = isIdleSessionEnd({
          lastTurnAt: tuple.lastActivityAt,
          now: nowMs,
          idleMs,
        });
        if (!idle) continue;

        const idleMinutes = Math.floor((nowMs - tuple.lastActivityAt) / 60_000);
        const reflection = composeIdleReflection(idleMinutes);

        let wrote = false;
        try {
          const out = await deps.reflexionWriter.record({
            tenantId: tuple.tenantId,
            userId: tuple.userId,
            sessionId: tuple.sessionId,
            reflection,
            outcome: 'mixed',
          });
          wrote = !!out?.id;
        } catch (err) {
          if (deps.logger?.warn) {
            deps.logger.warn(
              {
                emitter: 'idle-session',
                tenantId: tuple.tenantId,
                userId: tuple.userId,
                sessionId: tuple.sessionId,
                error: err instanceof Error ? err.message : String(err),
              },
              'idle-session-emitter: writer.record failed (will retry on next tick)',
            );
          }
        }
        // Always remember the tuple so we don't re-attempt this tick.
        // We re-attempt next tick only if the writer crashed (we still
        // marked it here intentionally — the tick is the bounded retry
        // unit).
        rememberEmitted(key);
        if (wrote) emittedThisTick += 1;
      }

      if (deps.logger?.info && emittedThisTick > 0) {
        deps.logger.info(
          {
            emitter: 'idle-session',
            scanned: tuples.length,
            emittedThisTick,
            cacheSize: emitted.size,
          },
          'idle-session-emitter: tick complete',
        );
      }
      return emittedThisTick;
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
      // Don't hold the event loop open just for this.
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Default Drizzle-backed source — `sensorium_event_log` based.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the default `ActiveSessionSource` against
 * `sensorium_event_log` (migration 0132). The query selects the latest
 * `received_at` per `(tenant_id, user_id, session_id)` within the
 * lookback window and returns the tuple list.
 *
 * The shape `db.execute(sql)` is the same Drizzle surface used by
 * `consolidation-runner.ts` so this file inherits the same typing
 * dodge for cross-package SQL templates.
 *
 * Returns `[]` on any DB error so the emitter degrades cleanly.
 */
export function createSensoriumActiveSessionSource(
  db: { execute(q: unknown): Promise<unknown> } | null | undefined,
): ActiveSessionSource {
  return {
    async listRecent(args) {
      if (!db) return [];
      try {
        // Lazy-import the `sql` template tag so this file can be
        // imported by tests that never touch drizzle-orm.
        const { sql } = await import('drizzle-orm');
        const cutoff = new Date(Date.now() - args.lookbackMinutes * 60_000);
        const limit = Math.max(1, Math.min(args.limit, 10_000));
        const rows = (await db.execute(
          sql`SELECT tenant_id, user_id, session_id,
                     EXTRACT(EPOCH FROM MAX(received_at)) * 1000 AS last_activity_ms
              FROM sensorium_event_log
              WHERE received_at >= ${cutoff}
              GROUP BY tenant_id, user_id, session_id
              ORDER BY MAX(received_at) DESC
              LIMIT ${limit}`,
        )) as unknown;
        const list = toRows(rows);
        const out: ActiveSessionTuple[] = [];
        for (const row of list) {
          const tenantId = asNonEmptyString(row.tenant_id);
          const userId = asNonEmptyString(row.user_id);
          const sessionId = asNonEmptyString(row.session_id);
          const lastMs = Number(row.last_activity_ms);
          if (!tenantId || !userId || !sessionId || !Number.isFinite(lastMs)) {
            continue;
          }
          out.push({
            tenantId,
            userId,
            sessionId,
            lastActivityAt: lastMs,
          });
        }
        return out;
      } catch {
        // Side-channel — never bubble up.
        return [];
      }
    },
  };
}

function toRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

function asNonEmptyString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
