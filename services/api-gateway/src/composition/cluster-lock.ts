/**
 * Cluster leader-election (CAP RSS-06).
 *
 * THE PROBLEM
 * ───────────
 * The api-gateway starts ~27 in-process cron / worker supervisors at
 * boot (`index.ts` cron block). Today EVERY replica runs EVERY cron, so
 * at N replicas a daily brief, an fx-feed pull, a notification fan-out,
 * or an LLM-spending autonomous sweep fires N times. Only `wakeLoopCron`
 * self-guards (per-tick `pg_try_advisory_lock`); the other ~26 duplicate
 * their work cluster-wide → N× LLM spend, N× gov-endpoint hits (fx-feed
 * ban risk), N× duplicate notifications.
 *
 * THE FIX
 * ───────
 * Cluster-wide leader election via a Postgres SESSION-LEVEL advisory
 * lock. Exactly one replica acquires the leadership lock; only that
 * replica's leader-gated crons run their bodies. If the leader dies its
 * session drops → Postgres auto-releases the lock → another replica
 * acquires it and takes over. No RBAC, no ServiceAccount, no k8s API
 * watch — the crons already depend on Postgres, so a DB-backed lock adds
 * no new failure mode (and HA-Postgres removes the SPOF).
 *
 * WHY A *DEDICATED SESSION* CONNECTION (security-/correctness-critical)
 * ────────────────────────────────────────────────────────────────────
 * `pg_advisory_lock` taken WITHOUT a surrounding transaction is a
 * SESSION-level lock: it lives for the lifetime of the backend session
 * and releases on disconnect. That is exactly what a long-lived
 * leadership lock needs.
 *
 * BUT a Supabase / PgBouncer **transaction-mode** pooler (`:6543`)
 * multiplexes a single backend session across many clients between
 * transactions. A session-level lock taken on such a connection is
 * SILENTLY DROPPED the moment the pooler hands that backend to another
 * client between statements — so two replicas could both "hold" the
 * lock, defeating leader election entirely. We therefore open a
 * DEDICATED `max:1` connection against a SESSION pooler (`:5432`) or a
 * direct connection via `DATABASE_SESSION_URL` (falling back to
 * `DATABASE_URL` for operators who already run a single session pooler).
 * This dedicated connection is held open for the supervisor's lifetime
 * and is NEVER returned to the request pool. `prepare:false` +
 * `fetch_types:false` keep it safe even if the URL happens to point at a
 * transaction pooler (the lock would still be unreliable there — hence
 * the doc-comment + an operator warning is logged on init).
 *
 * REVERSIBILITY (hard requirement)
 * ────────────────────────────────
 * Behaviour is gated behind env `CRON_LEADER_ELECTION`:
 *   - unset / "off" (DEFAULT) → `withClusterLeader` is a PASS-THROUGH:
 *     `start()` → `supervisor.start()` directly, exactly today's
 *     run-on-every-replica behaviour. Merging this module changes
 *     NOTHING at runtime until the flag is flipped.
 *   - "on" → only the elected leader's gated supervisors run.
 *
 * No `console.*` (Pino-shim only), no `process.env` read per-request —
 * the flag + session URL are read once inside `initClusterLock(...)`
 * which the integration phase calls at bootstrap (mirrors how
 * `db-client.ts` reads `DATABASE_URL_READONLY` in its factory).
 */

import { createHash } from 'node:crypto';
import postgres from 'postgres';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal session-connection port the lock manager needs. The real
 * implementation is a `postgres(url, { max: 1 })` tagged-template Sql;
 * tests inject a recording fake. Kept structural so this module never
 * imports the request-pool client (a held session lock must NOT consume
 * a pooled backend).
 */
export interface ClusterLockConnection {
  /**
   * Run a query and return rows. Accepts a pre-built SQL string and
   * bound params (we never interpolate the lock id into the string —
   * it is always a bound `$1` parameter, even though it is an integer we
   * compute ourselves).
   */
  query<T = Record<string, unknown>>(
    sqlText: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>>;
  /** Close the underlying session connection (releases the lock). */
  close(): Promise<void>;
}

/** Factory that opens a dedicated session connection on demand. */
export type ClusterLockConnectionFactory = () => ClusterLockConnection;

/** A startable/stoppable cron supervisor (the wrapped unit of work). */
export interface ClusterCronSupervisor {
  start(): void;
  stop(): void;
}

export interface ClusterLockConfig {
  /**
   * Whether leader election is active. Resolved from
   * `CRON_LEADER_ELECTION` once at bootstrap. Default `false` = today's
   * behaviour (every replica runs its crons).
   */
  readonly enabled: boolean;
  /**
   * Connection factory for the dedicated session lock connection. Null
   * when no session/database URL is configured → election degrades to
   * "everyone is a leader" (i.e. pass-through) so a misconfigured cron
   * never crashes the gateway.
   */
  readonly connectionFactory: ClusterLockConnectionFactory | null;
  readonly logger: PinoLikeLogger;
  /**
   * How long to wait before retrying a lost / never-acquired lock, in
   * ms. Bounded; default 30s. A non-leader replica re-attempts on this
   * cadence so it can be promoted when the current leader dies.
   */
  readonly retryIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Lock-id allocation
// ---------------------------------------------------------------------------

/**
 * `pg_advisory_lock` takes a single signed BIGINT (or two int4s). We map
 * a stable cron name → a deterministic BIGINT via sha256, sliced to the
 * positive int63 range so it always fits a signed BIGINT and never
 * collides for distinct names in practice. Mirrors the hand-picked
 * `WAKE_LOCK_ID = 7321946218472901` constant in `wake-loop-cron.ts`.
 *
 * Returned as a string of decimal digits so callers can pass it straight
 * to a bound `$1` param without bigint↔number precision loss (a BIGINT
 * exceeds `Number.MAX_SAFE_INTEGER`).
 */
export function lockIdFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error('lockIdFor: name must be a non-empty string');
  }
  const digest = createHash('sha256').update(trimmed, 'utf8').digest();
  // Take the first 8 bytes as an unsigned 64-bit, then clear the top bit
  // so the value is a positive signed int63 (always BIGINT-safe).
  const hi = digest.readUInt32BE(0) & 0x7fffffff; // clear sign bit
  const lo = digest.readUInt32BE(4);
  // Compose hi*2^32 + lo with BigInt to avoid float precision loss.
  const value = (BigInt(hi) << 32n) | BigInt(lo);
  return value.toString();
}

/**
 * The single leadership lock id used when a caller does not scope a
 * named lock. One leader per process-cluster guards the default cron
 * fleet. Crons that genuinely need their OWN independent leader (so the
 * fleet can be split across replicas later) pass `lockIdFor('<name>')`.
 */
export const DEFAULT_LEADER_LOCK_ID = lockIdFor('borjie-cron-leader');

// ---------------------------------------------------------------------------
// Real connection factory (dedicated session connection)
// ---------------------------------------------------------------------------

/**
 * Build a `ClusterLockConnectionFactory` over a dedicated `max:1`
 * postgres-js session connection. `prepare:false`/`fetch_types:false`
 * keep it pooler-tolerant. NOT memoised here — `initClusterLock` owns
 * the single instance so the connection is opened lazily only when
 * election is enabled.
 */
export function createSessionLockConnectionFactory(
  sessionUrl: string,
): ClusterLockConnectionFactory {
  return () => {
    const sql = postgres(sessionUrl, {
      max: 1,
      prepare: false,
      fetch_types: false,
      idle_timeout: 0, // never auto-close — we hold the session for the lock
      max_lifetime: 0, // never rotate — rotation would drop the lock
      connection: {
        // Keep the application_name greppable in pg_stat_activity so an
        // operator can SEE which backend holds the leadership lock.
        application_name: 'borjie-cluster-lock',
      },
    });
    return {
      async query<T = Record<string, unknown>>(
        sqlText: string,
        params: ReadonlyArray<unknown> = [],
      ): Promise<ReadonlyArray<T>> {
        // The lock id is the only bound param and is always a decimal
        // string we computed (never user input), so the cast to the
        // postgres-js parameter type is sound. We never interpolate it
        // into the SQL string — it stays a bound `$1`.
        const rows = await sql.unsafe(
          sqlText,
          params as unknown as Parameters<typeof sql.unsafe>[1],
        );
        return rows as unknown as ReadonlyArray<T>;
      },
      async close(): Promise<void> {
        // `{ timeout: 5 }` lets in-flight statements drain; the session
        // ending releases the advisory lock regardless.
        await sql.end({ timeout: 5 });
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Leadership manager
// ---------------------------------------------------------------------------

interface LeadershipState {
  /** Whether THIS instance currently holds the lock. */
  isLeader: boolean;
  /** The dedicated session connection holding the lock (when leader). */
  connection: ClusterLockConnection | null;
  /** Retry timer for non-leader replicas attempting promotion. */
  retryHandle: ReturnType<typeof setInterval> | null;
  /** Callbacks fired the moment this instance becomes leader. */
  readonly onElected: Array<() => void>;
}

/**
 * Per-lock-id leadership registry. Module-scoped so `isLeader()` is a
 * cheap, sync read for callers (e.g. a cron body that wants to bail
 * early). Reset in tests via `__resetClusterLockForTests`.
 */
const leadership = new Map<string, LeadershipState>();

let config: ClusterLockConfig | null = null;

function ensureState(lockId: string): LeadershipState {
  let s = leadership.get(lockId);
  if (!s) {
    s = { isLeader: false, connection: null, retryHandle: null, onElected: [] };
    leadership.set(lockId, s);
  }
  return s;
}

/**
 * Initialise the cluster-lock subsystem from the environment. MUST be
 * called once at bootstrap (the integration phase wires this from the
 * composition root — this module never edits index.ts). Reads env here,
 * never per-request. Idempotent: a second call replaces the config.
 *
 * Env:
 *   - CRON_LEADER_ELECTION = "on" → election active; anything else
 *     (unset / "off") → DISABLED (today's run-on-every-replica).
 *   - DATABASE_SESSION_URL → dedicated session/direct URL for the lock
 *     connection; falls back to DATABASE_URL when unset.
 *   - CRON_LEADER_RETRY_MS → non-leader promotion-retry cadence
 *     (default 30s, clamped to [5s, 5m]).
 */
export function initClusterLock(
  overrides?: Partial<ClusterLockConfig> & {
    sessionUrl?: string | null;
  },
): ClusterLockConfig {
  const logger = overrides?.logger ?? createPinoLikeLogger('cluster-lock');

  const enabled =
    overrides?.enabled ??
    process.env.CRON_LEADER_ELECTION?.trim().toLowerCase() === 'on';

  const retryIntervalMs = clampRetry(
    overrides?.retryIntervalMs ??
      parsePositiveIntOr(process.env.CRON_LEADER_RETRY_MS, 30_000),
  );

  // Resolve the connection factory. Explicit override wins (tests);
  // otherwise build the dedicated session factory from the session URL.
  let connectionFactory: ClusterLockConnectionFactory | null = null;
  if (overrides && 'connectionFactory' in overrides) {
    connectionFactory = overrides.connectionFactory ?? null;
  } else {
    const sessionUrl =
      overrides?.sessionUrl ??
      process.env.DATABASE_SESSION_URL?.trim() ??
      process.env.DATABASE_URL?.trim() ??
      null;
    if (enabled && sessionUrl) {
      connectionFactory = createSessionLockConnectionFactory(sessionUrl);
      const usingDirect = Boolean(process.env.DATABASE_SESSION_URL?.trim());
      if (!usingDirect) {
        // LOUD, structured boot-warning. CRON_LEADER_ELECTION is on but no
        // dedicated session/direct URL was provided, so we fell back to the
        // request-pool DATABASE_URL. If that is a Supabase / PgBouncer
        // TRANSACTION pooler (:6543) the session-level advisory lock backing
        // leader election is silently dropped between statements — TWO
        // replicas can both "hold" leadership and the ~28 in-process crons
        // DOUBLE-FIRE cluster-wide (N× LLM spend, N× notifications, N×
        // gov-endpoint hits / fx-feed ban risk). Default behaviour is
        // UNCHANGED — this is observability only.
        logger.warn(
          {
            event: 'cluster_lock_session_url_unset',
            severity: 'HIGH',
            risk:
              'session advisory locks are SILENTLY DROPPED on a transaction ' +
              'pooler (:6543) → leader election unreliable → the ~28 ' +
              'in-process crons may DOUBLE-FIRE across replicas',
            fix:
              'set DATABASE_SESSION_URL to the Supabase session-pooler ' +
              '(:5432) / direct Postgres URL — OR pin api-gateway to 1 ' +
              'replica (see Docs/OPERATIONS.md > Cron leader election)',
            usingFallback: 'DATABASE_URL',
          },
          'cluster-lock: CRON_LEADER_ELECTION is ON but DATABASE_SESSION_URL ' +
            'is UNSET — falling back to DATABASE_URL. If that is a TRANSACTION ' +
            'pooler (:6543) leader election is UNRELIABLE and crons may ' +
            'double-fire. Provide DATABASE_SESSION_URL (:5432/direct) or pin ' +
            'api-gateway to 1 replica.',
        );
      }
    }
  }

  if (enabled && !connectionFactory) {
    // LOUD, structured boot-warning. Election was switched on but NO database
    // URL resolved at all, so we degrade to pass-through (every replica runs
    // every cron) — the SAME double-fire risk as above. Default behaviour is
    // UNCHANGED — this is observability only.
    logger.warn(
      {
        event: 'cluster_lock_no_connection',
        severity: 'HIGH',
        risk:
          'no session/direct DB URL resolved → election degraded to ' +
          'pass-through → the ~28 in-process crons run on EVERY replica ' +
          '(double-fire: N× LLM spend, N× notifications, N× gov-endpoint hits)',
        fix:
          'set DATABASE_SESSION_URL (:5432/direct) — OR pin api-gateway to ' +
          '1 replica (see Docs/OPERATIONS.md > Cron leader election)',
      },
      'cluster-lock: CRON_LEADER_ELECTION is ON but NO session connection ' +
        'configured — degrading to pass-through (every replica runs its ' +
        'crons → double-fire). Provide DATABASE_SESSION_URL or pin ' +
        'api-gateway to 1 replica.',
    );
  }

  config = { enabled, connectionFactory, logger, retryIntervalMs };
  logger.info(
    { enabled, retryIntervalMs, hasConnection: Boolean(connectionFactory) },
    'cluster-lock: initialised',
  );
  return config;
}

function requireConfig(): ClusterLockConfig {
  if (!config) {
    // Auto-init from env on first use so a caller that forgot to wire
    // bootstrap still gets correct (default-off) behaviour instead of a
    // crash. This keeps the module safe-by-default.
    return initClusterLock();
  }
  return config;
}

/**
 * Attempt to acquire cluster leadership for `lockId` (defaults to the
 * fleet-wide leader lock). Resolves to whether THIS instance is the
 * leader after the attempt.
 *
 * - Election DISABLED → always resolves `true` (pass-through: every
 *   replica is its own "leader", i.e. runs its crons).
 * - Election ENABLED but no connection → resolves `true` (degraded,
 *   logged in init) so crons still run rather than silently stopping.
 * - Election ENABLED with a connection → opens the dedicated session
 *   connection (once) and runs `pg_try_advisory_lock($1)`. On success
 *   marks this instance leader and fires `onElected` callbacks. On
 *   failure arms a retry timer so the replica can be promoted later.
 *
 * Idempotent: calling again while already leader is a no-op that returns
 * `true` without re-acquiring.
 */
export async function acquireLeadership(
  lockId: string = DEFAULT_LEADER_LOCK_ID,
): Promise<boolean> {
  const cfg = requireConfig();
  const state = ensureState(lockId);

  if (!cfg.enabled || !cfg.connectionFactory) {
    // Pass-through / degraded: treat as leader so gated work runs.
    state.isLeader = true;
    return true;
  }

  if (state.isLeader) return true;

  // Open the dedicated session connection lazily on first acquire.
  if (!state.connection) {
    try {
      state.connection = cfg.connectionFactory();
    } catch (error) {
      cfg.logger.error(
        { err: errMsg(error), lockId },
        'cluster-lock: failed to open session connection',
      );
      scheduleRetry(lockId);
      return false;
    }
  }

  try {
    const rows = await state.connection.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId],
    );
    const acquired = Boolean(rows[0]?.acquired);
    if (acquired) {
      state.isLeader = true;
      clearRetry(state);
      cfg.logger.info({ lockId }, 'cluster-lock: acquired leadership');
      for (const cb of state.onElected.splice(0)) {
        try {
          cb();
        } catch (error) {
          cfg.logger.error(
            { err: errMsg(error), lockId },
            'cluster-lock: onElected callback threw',
          );
        }
      }
      return true;
    }
    cfg.logger.info(
      { lockId },
      'cluster-lock: leadership held by another replica — will retry',
    );
    scheduleRetry(lockId);
    return false;
  } catch (error) {
    cfg.logger.error(
      { err: errMsg(error), lockId },
      'cluster-lock: pg_try_advisory_lock failed',
    );
    // Connection may be dead — drop it so the next retry re-opens.
    await safeClose(state.connection);
    state.connection = null;
    state.isLeader = false;
    scheduleRetry(lockId);
    return false;
  }
}

/**
 * Synchronous read: is THIS instance the leader for `lockId`?
 *
 * - Election DISABLED → always `true` (every replica acts as leader).
 * - Election ENABLED → reflects the last `acquireLeadership` outcome.
 *
 * Cheap enough to call from a cron tick body to early-out on followers.
 */
export function isLeader(lockId: string = DEFAULT_LEADER_LOCK_ID): boolean {
  const cfg = requireConfig();
  if (!cfg.enabled || !cfg.connectionFactory) return true;
  return leadership.get(lockId)?.isLeader ?? false;
}

/**
 * Release leadership for `lockId`: unlock + close the dedicated session
 * connection. Called on graceful shutdown so another replica can be
 * promoted promptly (the session ending would release the lock anyway,
 * but an explicit unlock is cleaner and faster).
 */
export async function releaseLeadership(
  lockId: string = DEFAULT_LEADER_LOCK_ID,
): Promise<void> {
  const cfg = requireConfig();
  const state = leadership.get(lockId);
  if (!state) return;
  clearRetry(state);
  if (state.connection && state.isLeader) {
    try {
      await state.connection.query('SELECT pg_advisory_unlock($1)', [lockId]);
    } catch (error) {
      cfg.logger.warn(
        { err: errMsg(error), lockId },
        'cluster-lock: pg_advisory_unlock failed (session close will release)',
      );
    }
  }
  await safeClose(state.connection);
  state.connection = null;
  state.isLeader = false;
}

// ---------------------------------------------------------------------------
// The cron wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap a cron supervisor so its body only runs when this instance holds
 * leadership. Returns a supervisor with the SAME `start`/`stop` surface,
 * so it is a drop-in for any `supervisor.start()` call site.
 *
 * Behaviour:
 *   - Election DISABLED (default) → PASS-THROUGH. `start()` calls the
 *     inner `supervisor.start()` immediately — identical to today.
 *   - Election ENABLED →
 *       · If already leader → start the inner supervisor now.
 *       · Else → register an `onElected` callback that starts it the
 *         instant this replica wins the lock, and kick off a (non-
 *         blocking) `acquireLeadership` attempt. A follower never starts
 *         the inner supervisor, so its crons never run.
 *   - `stop()` always stops the inner supervisor (idempotent) and clears
 *     any pending election callback.
 *
 * The wrapper NEVER blocks `start()` on the DB round-trip — election is
 * fire-and-forget so a slow/unreachable lock connection cannot stall
 * boot. Followers simply never start; the retry loop promotes them.
 */
export function withClusterLeader(
  supervisor: ClusterCronSupervisor,
  lockId: string = DEFAULT_LEADER_LOCK_ID,
): ClusterCronSupervisor {
  const cfg = requireConfig();
  let started = false;
  let pendingElect: (() => void) | null = null;

  const startInner = (): void => {
    if (started) return;
    started = true;
    supervisor.start();
  };

  return {
    start(): void {
      if (!cfg.enabled || !cfg.connectionFactory) {
        // Pass-through: today's behaviour.
        startInner();
        return;
      }
      const state = ensureState(lockId);
      if (state.isLeader) {
        startInner();
        return;
      }
      // Register a one-shot start-on-election hook, then attempt to win.
      pendingElect = startInner;
      state.onElected.push(startInner);
      void acquireLeadership(lockId).then((won) => {
        // If we already won synchronously, acquireLeadership fired the
        // onElected callbacks itself; nothing more to do here.
        if (won && !started) startInner();
      });
    },
    stop(): void {
      if (pendingElect) {
        const state = leadership.get(lockId);
        if (state) {
          const idx = state.onElected.indexOf(pendingElect);
          if (idx >= 0) state.onElected.splice(idx, 1);
        }
        pendingElect = null;
      }
      // Always safe to stop — inner supervisors are idempotent on stop.
      supervisor.stop();
      started = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function scheduleRetry(lockId: string): void {
  const cfg = requireConfig();
  const state = ensureState(lockId);
  if (state.retryHandle || state.isLeader) return;
  const handle = setInterval(() => {
    void acquireLeadership(lockId);
  }, cfg.retryIntervalMs);
  if (typeof handle.unref === 'function') handle.unref();
  state.retryHandle = handle;
}

function clearRetry(state: LeadershipState): void {
  if (state.retryHandle) {
    clearInterval(state.retryHandle);
    state.retryHandle = null;
  }
}

async function safeClose(conn: ClusterLockConnection | null): Promise<void> {
  if (!conn) return;
  try {
    await conn.close();
  } catch {
    // Best-effort — the OS reclaims the socket on process exit anyway.
  }
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function clampRetry(ms: number): number {
  const MIN = 5_000;
  const MAX = 5 * 60 * 1000;
  return Math.min(MAX, Math.max(MIN, Math.floor(ms)));
}

/** Test-only: reset module state so each test starts clean. */
export function __resetClusterLockForTests(): void {
  for (const state of leadership.values()) {
    clearRetry(state);
  }
  leadership.clear();
  config = null;
}
