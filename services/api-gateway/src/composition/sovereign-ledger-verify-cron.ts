/**
 * Sovereign-ledger verify supervisor — Wave-K Tier-3 W-Ops.
 *
 * The sovereign-action ledger (migration 0129) is hash-chained but the
 * verify pass was only invoked from the admin HTTP surface. Without a
 * periodic walker a silent post-hoc tamper would slip past until the
 * next operator decided to look. This supervisor closes that gap.
 *
 * Behaviour:
 *
 *   - Default cadence 1h (override via env `SOVEREIGN_LEDGER_VERIFY_INTERVAL_MS`).
 *     Bounded to [60s, 24h].
 *   - On each tick, discovers active tenants from the `tenants` table
 *     (mirrors `wake-loop-cron.ts` — same `is_active = TRUE` filter)
 *     and calls `verifyLedgerChain(tenantId)` on each.
 *   - Emits `sovereign-ledger.verified` (when `result.ok === true`) or
 *     `sovereign-ledger.tampered` (otherwise) on the shared event bus.
 *     The tampered event carries the broken row id + the expected vs
 *     actual hash so on-call operators have everything they need
 *     without re-running the verify themselves.
 *   - SIGTERM-safe: `.stop()` clears the interval; idempotent.
 *
 * Degraded mode:
 *   When `db` is null (DATABASE_URL unset) the supervisor logs once on
 *   `.start()` and returns immediately. Same contract as wake-loop-cron.
 *
 * Why in-process (not a k8s CronJob)?
 *   The verify-pass is read-only + cheap (forward-walk in 500-row chunks).
 *   Bundling it with the api-gateway keeps observability + alerting
 *   inside the same pid that already owns the chain writers. An out-of-
 *   process CronJob is added under k8s/ for the operator's preference if
 *   they need to isolate the workload — both share the same interval
 *   env, so set `SOVEREIGN_LEDGER_VERIFY_INTERVAL_MS=0` here when the
 *   CronJob is in charge.
 */

import { sql } from 'drizzle-orm';
import { createSovereignActionLedgerService } from '@borjie/database';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MIN_INTERVAL_MS = 60 * 1000; // 1 minute floor — guard against typos
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface SovereignLedgerVerifyCronLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

interface EventBusLike {
  publish?: (env: unknown) => Promise<void> | void;
}

export interface SovereignLedgerVerifyCronDeps {
  /** Drizzle client. May be null — supervisor degrades to no-op. */
  readonly db: unknown | null;
  /** Shared event bus. Optional — the supervisor still verifies but
   *  cannot emit observability events. */
  readonly eventBus?: EventBusLike | null;
  readonly logger: SovereignLedgerVerifyCronLogger;
  /** Override cadence (ms). Falls back to env. Bounded to [60s, 24h]. */
  readonly intervalMs?: number;
  /** Test hook: override tenant discovery. */
  readonly listActiveTenantIds?: () => Promise<ReadonlyArray<string>>;
}

export interface SovereignLedgerVerifyCronTickResult {
  readonly tenantsProcessed: number;
  readonly okCount: number;
  readonly tamperedCount: number;
  readonly skippedReason: 'no-db' | 'no-tenants' | 'inflight' | null;
  /** Per-tenant verdicts so tests + operators can inspect the run. */
  readonly verdicts: ReadonlyArray<{
    readonly tenantId: string;
    readonly ok: boolean;
    readonly count: number;
    readonly brokenAt?: string;
    readonly reason?: string;
  }>;
}

export interface SovereignLedgerVerifyCronSupervisor {
  start(): void;
  stop(): void;
  tick(): Promise<SovereignLedgerVerifyCronTickResult | null>;
  readonly intervalMs: number;
}

function resolveIntervalMs(override?: number): number {
  const envRaw = process.env.SOVEREIGN_LEDGER_VERIFY_INTERVAL_MS?.trim();
  const envNum = envRaw ? Number(envRaw) : NaN;
  // Sentinel `0` → one-shot via the CLI guard / external CronJob; not
  // valid for the in-process interval. Caller handles via `start()`.
  const candidate =
    typeof override === 'number' && Number.isFinite(override) && override > 0
      ? override
      : Number.isFinite(envNum) && envNum > 0
        ? envNum
        : DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(candidate)));
}

async function defaultListActiveTenantIds(
  db: DrizzleLikeClient,
): Promise<ReadonlyArray<string>> {
  try {
    const result = (await db.execute(
      sql`SELECT id FROM tenants WHERE is_active = TRUE`,
    )) as unknown;
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<{ id?: unknown }>)
      : (((result as { rows?: ReadonlyArray<{ id?: unknown }> })?.rows ??
          []) as ReadonlyArray<{ id?: unknown }>);
    return rows
      .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
      .filter((s) => s.length > 0);
  } catch {
    // A schema-pre-migration / connectivity hiccup degrades to "no
    // tenants" — the supervisor stays safe instead of crashing.
    return [];
  }
}

async function emit(
  bus: EventBusLike | null | undefined,
  eventType: string,
  tenantId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!bus || typeof bus.publish !== 'function') return;
  try {
    await bus.publish({
      event: {
        eventId: `sov_ledger_${eventType}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        eventType,
        timestamp: new Date().toISOString(),
        tenantId,
        correlationId: `sov_ledger_cron_${Date.now()}`,
        causationId: null,
        metadata: { source: 'sovereign-ledger-verify-cron' },
        payload,
      } as unknown,
      version: 1,
      aggregateId: tenantId,
      aggregateType: 'SovereignActionLedger',
    } as never);
  } catch {
    // Bus failures are non-fatal; the next tick will retry and the
    // verdict itself is durable in the chain.
  }
}

export function createSovereignLedgerVerifyCronSupervisor(
  deps: SovereignLedgerVerifyCronDeps,
): SovereignLedgerVerifyCronSupervisor {
  const intervalMs = resolveIntervalMs(deps.intervalMs);

  let handle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  async function tick(): Promise<SovereignLedgerVerifyCronTickResult | null> {
    if (inflight) {
      return {
        tenantsProcessed: 0,
        okCount: 0,
        tamperedCount: 0,
        verdicts: [],
        skippedReason: 'inflight',
      };
    }
    inflight = true;
    try {
      if (!deps.db) {
        deps.logger.warn(
          { intervalMs },
          'sovereign-ledger-verify-cron: no db — supervisor is no-op',
        );
        return {
          tenantsProcessed: 0,
          okCount: 0,
          tamperedCount: 0,
          verdicts: [],
          skippedReason: 'no-db',
        };
      }
      const db = deps.db as DrizzleLikeClient;
      const listActive =
        deps.listActiveTenantIds ?? (() => defaultListActiveTenantIds(db));
      const tenantIds = await listActive();
      if (tenantIds.length === 0) {
        deps.logger.info(
          {},
          'sovereign-ledger-verify-cron: no active tenants — skipping cycle',
        );
        return {
          tenantsProcessed: 0,
          okCount: 0,
          tamperedCount: 0,
          verdicts: [],
          skippedReason: 'no-tenants',
        };
      }
      const service = createSovereignActionLedgerService(db as never);
      const verdicts: Array<{
        tenantId: string;
        ok: boolean;
        count: number;
        brokenAt?: string;
        reason?: string;
      }> = [];
      let okCount = 0;
      let tamperedCount = 0;
      for (const tenantId of tenantIds) {
        try {
          const result = await service.verifyLedgerChain(tenantId);
          if (result.ok) {
            okCount += 1;
            verdicts.push({ tenantId, ok: true, count: result.count });
            await emit(deps.eventBus, 'sovereign-ledger.verified', tenantId, {
              tenantId,
              count: result.count,
            });
          } else {
            tamperedCount += 1;
            verdicts.push({
              tenantId,
              ok: false,
              count: result.count,
              brokenAt: result.brokenAt,
              reason: result.reason,
            });
            // Tampered events are SEV-2 by default — surface loudly.
            const errLog = deps.logger.error ?? deps.logger.warn;
            errLog(
              {
                tenantId,
                brokenAt: result.brokenAt,
                expected: result.expected,
                actual: result.actual,
                reason: result.reason,
              },
              'sovereign-ledger-verify-cron: TAMPER DETECTED',
            );
            await emit(deps.eventBus, 'sovereign-ledger.tampered', tenantId, {
              tenantId,
              brokenAt: result.brokenAt,
              expected: result.expected,
              actual: result.actual,
              reason: result.reason,
              count: result.count,
            });
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.logger.warn(
            { tenantId, err: msg },
            'sovereign-ledger-verify-cron: verify threw',
          );
          // Treat threw-during-verify as a tamper signal for visibility
          // — operators must investigate before discarding.
          tamperedCount += 1;
          verdicts.push({
            tenantId,
            ok: false,
            count: 0,
            reason: `verify-threw:${msg}`,
          });
        }
      }
      deps.logger.info(
        {
          tenants: tenantIds.length,
          okCount,
          tamperedCount,
        },
        'sovereign-ledger-verify-cron: cycle complete',
      );
      return {
        tenantsProcessed: tenantIds.length,
        okCount,
        tamperedCount,
        verdicts,
        skippedReason: null,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const errLog = deps.logger.error ?? deps.logger.warn;
      errLog({ err: msg }, 'sovereign-ledger-verify-cron: tick failed');
      return null;
    } finally {
      inflight = false;
    }
  }

  return {
    intervalMs,
    start() {
      if (handle) return;
      void tick();
      if (process.env.SOVEREIGN_LEDGER_VERIFY_INTERVAL_MS?.trim() === '0') {
        deps.logger.info(
          { mode: 'one-shot' },
          'sovereign-ledger-verify-cron: one-shot mode (CronJob driven)',
        );
        return;
      }
      handle = setInterval(() => void tick(), intervalMs);
      if (typeof handle.unref === 'function') handle.unref();
      deps.logger.info(
        { intervalMs },
        'sovereign-ledger-verify-cron: started',
      );
    },
    stop() {
      if (!handle) return;
      clearInterval(handle);
      handle = null;
      deps.logger.info({}, 'sovereign-ledger-verify-cron: stopped');
    },
    tick,
  };
}
