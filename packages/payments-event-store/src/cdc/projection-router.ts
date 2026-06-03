/**
 * CDC projection router (LP-20b) — transport-agnostic.
 *
 * Holds a consumer registry and dispatches `CdcEvent`s to the
 * consumers whose filters match. The actual subscription transport
 * (Supabase realtime / pg LISTEN-NOTIFY) is INJECTED, so the routing
 * logic is unit-testable without Postgres. The production adapter
 * wires `subscribe` to `supabase.channel('postgres_changes')` or a
 * direct `pg` `LISTEN borjie_cdc` connection.
 *
 * Why a router separate from the pure `project()` reducer in
 * `projector.ts`: `project()` folds a known event array into state;
 * this router is the live FAN-OUT that decides which consumers a
 * streamed change reaches, with per-consumer error isolation.
 *
 * Re-skinned from LITFIN `src/core/cdc/projection-stream.ts`.
 *
 * @module @borjie/payments-event-store/cdc/projection-router
 */

import {
  eventMatches,
  parseCdcPayload,
  type CdcConsumer,
  type CdcEvent,
  type CdcListenerHandle,
  type CdcStats,
} from './types.js';

/** Minimal structured logger (Pino-shaped). No console.log. */
export interface CdcLogger {
  warn(meta: Readonly<Record<string, unknown>>, msg: string): void;
  error(meta: Readonly<Record<string, unknown>>, msg: string): void;
}

export interface ProjectionStreamDeps {
  /**
   * Transport. Calls `onPayload(rawJson)` for every channel message and
   * resolves to a "stop" function the router invokes on shutdown.
   */
  readonly subscribe: (
    onPayload: (raw: string) => void,
  ) => Promise<() => Promise<void>>;
  /** Optional allow-set override for which tables to accept. */
  readonly allowedTables?: ReadonlyArray<string>;
  readonly logger?: CdcLogger;
}

export interface ProjectionRouter {
  /** Register a consumer; returns an unsubscribe fn. */
  register(consumer: CdcConsumer): () => void;
  /** Dispatch one event to all matching consumers. */
  dispatch(event: CdcEvent): Promise<void>;
  stats(): CdcStats;
  consumerCount(): number;
}

const NOOP_LOGGER: CdcLogger = {
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Build a pure consumer-registry + dispatcher. Side-effect free except
 * for invoking consumer callbacks. A throwing/ rejecting consumer is
 * caught and counted — it never breaks the dispatch loop for the other
 * consumers (one bad projector cannot stall the stream).
 */
export function createProjectionRouter(
  logger: CdcLogger = NOOP_LOGGER,
): ProjectionRouter {
  const consumers = new Map<string, CdcConsumer>();
  const counters = { received: 0, dispatched: 0, errors: 0, malformed: 0 };

  return {
    register(consumer: CdcConsumer): () => void {
      consumers.set(consumer.id, consumer);
      return () => {
        consumers.delete(consumer.id);
      };
    },

    async dispatch(event: CdcEvent): Promise<void> {
      counters.received += 1;
      for (const consumer of consumers.values()) {
        if (!eventMatches(consumer, event)) continue;
        try {
          await Promise.resolve(consumer.onEvent(event));
          counters.dispatched += 1;
        } catch (err) {
          counters.errors += 1;
          logger.error(
            {
              consumerId: consumer.id,
              table: event.table,
              op: event.op,
              error: err instanceof Error ? err.message : String(err),
            },
            'cdc: consumer onEvent threw',
          );
        }
      }
    },

    stats(): CdcStats {
      return { ...counters };
    },

    consumerCount(): number {
      return consumers.size;
    },
  };
}

/**
 * Wire an injected transport to a fresh router. Malformed payloads are
 * counted + skipped (best-effort streaming). Returns the router (to
 * register consumers) and a handle the caller stops at shutdown.
 */
export async function startProjectionStream(
  deps: ProjectionStreamDeps,
): Promise<{ router: ProjectionRouter; handle: CdcListenerHandle }> {
  const logger = deps.logger ?? NOOP_LOGGER;
  const router = createProjectionRouter(logger);
  let stopped = false;
  // Track malformed separately on the router's stats by routing through
  // a wrapper count — we surface it via the handle below.
  let malformed = 0;

  const stopTransport = await deps.subscribe(async (raw) => {
    if (stopped) return;
    const event = parseCdcPayload(raw, deps.allowedTables);
    if (!event) {
      malformed += 1;
      logger.warn({ raw }, 'cdc: malformed payload dropped');
      return;
    }
    try {
      await router.dispatch(event);
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'cdc: dispatch failed',
      );
    }
  });

  const handle: CdcListenerHandle = {
    stats: () => ({ ...router.stats(), malformed }),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await stopTransport();
    },
  };
  return { router, handle };
}
