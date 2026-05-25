/**
 * Outbox processor — composition root for the standalone drainer.
 *
 * This is the long-running supervisor that calls
 * `EventBus.processOutbox()` on a fixed cadence so events written
 * transactionally to the outbox table get published to subscribers
 * even if the api-gateway's in-process drainer has not booted yet
 * (or is briefly degraded).
 *
 * Architectural caveat — IMPORTANT for operators (audit DA3 fix, HIGH)
 * -------------------------------------------------------------------
 * The default `EventBus` in `@borjie/observability` uses an
 * in-memory `MemoryOutboxStore`. A separately-deployed processor
 * container therefore drains its OWN in-memory store — not the
 * api-gateway's. Running this container without a shared, durable
 * `IOutboxStore` (Postgres- or Redis-backed) is dishonest: it APPEARS
 * to remove the api-gateway in-process drainer SPOF, but actually
 * drains a private memory store that the gateway never writes to.
 *
 * Fix (audit DA3): refuse to start until a shared store is wired.
 * The entrypoint reads `OUTBOX_STORE_TYPE` (must be `redis` or
 * `postgres`) and exits with code 1 on any other value, including
 * `unset` and `memory`. This makes the audit finding self-healing:
 * an operator who flips `replicas: 1` in compose without first wiring
 * a real store will see a clear crash-loop with an actionable error
 * instead of a silent no-op.
 *
 * Activation path:
 *   1. Implement `PostgresOutboxStore` or `RedisOutboxStore` and wire
 *      it via `getEventBus({ outboxStore })` in BOTH api-gateway and
 *      this file.
 *   2. Set `OUTBOX_STORE_TYPE=postgres` (or `redis`) in
 *      `.env.production`.
 *   3. Flip `replicas: 0` -> `replicas: 1` in compose.
 *
 * Until step 1 lands, compose ships `replicas: 0`. If the flag flips
 * but a store isn't wired, this guard catches it.
 */

import { getEventBus } from '@borjie/observability';
import { logger } from './logger.js';

export interface ProcessorLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

function consoleLogger(): ProcessorLogger {
  return {
    info: (obj, msg) => {
      logger.info('[outbox-processor]', { arg0: msg ?? '', obj })
    },
    warn: (obj, msg) => {
      logger.warn('[outbox-processor]', { arg0: msg ?? '', obj })
    },
    error: (obj, msg) => {
      logger.error('[outbox-processor]', { arg0: msg ?? '', obj })
    },
  };
}

function readInterval(): number {
  const raw = process.env.OUTBOX_PROCESSOR_INTERVAL_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 5_000;
}

function readBatchSize(): number {
  const raw = process.env.OUTBOX_PROCESSOR_BATCH_SIZE;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 50;
}

/**
 * Audit DA3 guard. The standalone container is meaningless without a
 * shared `IOutboxStore`. Refuse to start unless `OUTBOX_STORE_TYPE` is
 * one of the supported shared-store backends.
 *
 * Exported for unit-test coverage. Returns the validated store type on
 * success; throws a `StoreConfigError` (with an actionable message) on
 * any other value so the boot path can `process.exit(1)` with the
 * message visible to the operator.
 */
export const SUPPORTED_OUTBOX_STORE_TYPES = Object.freeze(['redis', 'postgres'] as const);
export type SupportedOutboxStoreType = (typeof SUPPORTED_OUTBOX_STORE_TYPES)[number];

export class OutboxStoreConfigError extends Error {
  readonly received: string;
  constructor(received: string) {
    super(
      `outbox-processor requires a shared durable IOutboxStore. ` +
        `Set OUTBOX_STORE_TYPE=redis|postgres. ` +
        `Set replicas:0 in compose until a store is wired. ` +
        `(received: ${received || '<unset>'})`,
    );
    this.name = 'OutboxStoreConfigError';
    this.received = received;
  }
}

export function assertSharedOutboxStoreConfigured(
  env: NodeJS.ProcessEnv,
): SupportedOutboxStoreType {
  const raw = (env.OUTBOX_STORE_TYPE ?? '').trim().toLowerCase();
  if (
    raw === 'redis' ||
    raw === 'postgres'
  ) {
    return raw;
  }
  throw new OutboxStoreConfigError(raw);
}

// ─────────────────────────────────────────────────────────────────────────
// inFlight watchdog (DA2 fix)
//
// Before: `tick` short-circuited on `inFlight` with no recovery deadline.
// A hung Postgres call (network partition, deadlock, etc.) left
// `inFlight=true` forever → the processor silently stopped draining
// without crashing. The supervisor saw a healthy process and never
// restarted it.
//
// After: pair `inFlight` with `tickStartedAt`. At the top of every tick,
// if a previous tick has been running longer than `2 × intervalMs`, treat
// it as wedged and force-reset the latch. Emit a structured warn so ops
// sees the recovery in logs and can correlate with the underlying stall.
// ─────────────────────────────────────────────────────────────────────────

export const WATCHDOG_MULTIPLIER = 2;

export interface TickState {
  inFlight: boolean;
  tickStartedAt: Date | null;
}

export interface TickDeps {
  readonly bus: { processOutbox(batchSize: number): Promise<number> };
  readonly batchSize: number;
  readonly intervalMs: number;
  readonly state: TickState;
  readonly log: ProcessorLogger;
  readonly stopping: () => boolean;
  readonly now: () => number;
}

/**
 * Create a `tick` function bound to the supplied dependencies. Exported so
 * tests can drive the watchdog deterministically without touching globals.
 */
export function createTick(deps: TickDeps): () => Promise<void> {
  return async function tick(): Promise<void> {
    if (deps.stopping()) return;

    // Watchdog: force-reset a wedged in-flight latch if its tick has
    // been running for more than 2× the configured interval.
    if (deps.state.inFlight && deps.state.tickStartedAt !== null) {
      const elapsedMs = deps.now() - deps.state.tickStartedAt.getTime();
      if (elapsedMs > WATCHDOG_MULTIPLIER * deps.intervalMs) {
        deps.log.warn(
          {
            elapsedMs,
            intervalMs: deps.intervalMs,
            thresholdMs: WATCHDOG_MULTIPLIER * deps.intervalMs,
            tickStartedAt: deps.state.tickStartedAt.toISOString(),
          },
          'outbox-processor: inFlight watchdog force-reset (previous tick wedged)',
        );
        deps.state.inFlight = false;
        deps.state.tickStartedAt = null;
      } else {
        // Earlier tick still within the allowed budget — skip this one.
        return;
      }
    }

    deps.state.inFlight = true;
    deps.state.tickStartedAt = new Date(deps.now());
    try {
      const n = await deps.bus.processOutbox(deps.batchSize);
      if (n > 0) deps.log.info({ processed: n }, 'outbox drained');
    } catch (err) {
      deps.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'outbox drain failed',
      );
    } finally {
      deps.state.inFlight = false;
      deps.state.tickStartedAt = null;
    }
  };
}

async function main(): Promise<void> {
  const log = consoleLogger();
  const intervalMs = readInterval();
  const batchSize = readBatchSize();

  // DA3: refuse to start without a shared durable store. The api-gateway
  // in-process drainer remains the canonical path until this lands.
  let storeType: SupportedOutboxStoreType;
  try {
    storeType = assertSharedOutboxStoreConfigured(process.env);
  } catch (err) {
    // Surface to stderr in a single line so `docker logs` shows the
    // actionable message without scrolling. log.error wraps in JSON
    // which is fine for production aggregation but the bare console
    // call below also lands on stderr for ops greps.
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[outbox-processor] ${msg}`);
    process.exit(1);
  }

  log.info(
    { intervalMs, batchSize, storeType },
    'outbox-processor: shared store type confirmed via OUTBOX_STORE_TYPE',
  );

  const bus = getEventBus({
    serviceName: 'outbox-processor',
    enableOutbox: true,
  });

  let stopping = false;
  const tickState: TickState = { inFlight: false, tickStartedAt: null };

  const tick = createTick({
    bus,
    batchSize,
    intervalMs,
    state: tickState,
    log,
    stopping: () => stopping,
    now: () => Date.now(),
  });

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  void tick();

  log.info({ intervalMs, batchSize }, 'outbox-processor started');

  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, 'outbox-processor shutdown requested');
    clearInterval(timer);
    // Give an in-flight batch up to 5s to finish.
    const deadline = Date.now() + 5_000;
    const wait = (): void => {
      if (!tickState.inFlight || Date.now() > deadline) {
        log.info({}, 'outbox-processor stopped');
        process.exit(0);
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('[outbox-processor] fatal', { error: err });
  process.exit(1);
});
