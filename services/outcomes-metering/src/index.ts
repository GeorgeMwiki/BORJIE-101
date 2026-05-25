/**
 * @borjie/outcomes-metering-service — Fastify HTTP entrypoint +
 * barrel exports for the composition root.
 *
 * Wires:
 *   - GET  /healthz
 *   - POST /outcomes/events                       (X-Tenant-Id header)
 *   - GET  /outcomes/billing/:tenantId/:month     (X-Tenant-Id header)
 *
 * Also wires a `BrainEventBus` consumer (when a bus is provided in
 * `BuildAppDeps.bus`) that subscribes to `lease.signed`,
 * `payment.received`, and `ticket.resolved` and turns those into
 * billable MeteringRecords via the pure scorers in
 * `@borjie/outcomes`.
 *
 * Env vars consumed:
 *   - `PORT`         — Fastify listen port (default 3018)
 *   - `HOST`         — Fastify listen host (default 0.0.0.0)
 *   - `NODE_ENV`     — production / staging / dev (no behaviour delta yet;
 *                      reserved for the upcoming Postgres / RLS wiring)
 *
 * Backing store: defaults to the in-memory billing store. The api-
 * gateway composition root will replace it with a Drizzle adapter
 * bound to the `outcome_events` / `outcome_billing_lines` tables
 * (migration `0169_outcomes_metering.sql`) in a follow-up.
 */

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  createBrainEventConsumer,
  type BrainEventConsumerHandle,
  type ConsumerLogger,
  OUTCOMES_METERING_EVENT_TYPES,
} from './consumers/brain-event-consumer.js';
import { authMiddleware, type TestAuthInjector } from './middleware/auth.js';
import {
  registerEventsRoutes,
} from './routes/events.js';
import { registerBillingRoutes } from './routes/billing.js';
import {
  registerReadyzRoutes,
  type ReadinessDbPool,
} from './routes/readyz.js';
import { registerMetrics } from './observability/metrics.js';
import {
  createInMemoryBillingStore,
  type BillingStore,
} from './store/billing-store.js';
import type { BrainEventSubscriber } from '@borjie/ai-copilot/brain-event-bus';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

export interface BuildAppDeps {
  /** Backing store. Defaults to the in-memory store. */
  readonly store?: BillingStore;
  /**
   * Optional brain-event-bus subscriber. When wired, the service
   * subscribes to the three OutcomeEvent-producing events. Tests pass
   * an in-memory bus; production wires the Redis Streams / Kafka /
   * SQS bus from the composition root.
   */
  readonly bus?: BrainEventSubscriber;
  /** Optional logger threaded into the consumer + routes. */
  readonly logger?: ConsumerLogger;
  /** Optional clock for deterministic tests. */
  readonly clock?: () => Date;
  /** Optional record-id minter for deterministic tests. */
  readonly newRecordId?: () => string;
  /**
   * Optional DB pool used by `/readyz`. When omitted, the readiness
   * probe returns 200 in "memory mode" — the in-memory store has no
   * async dependency to wait on.
   */
  readonly dbPool?: ReadinessDbPool;
  /**
   * Test-only — bypass JWT verification by stamping `request.user`
   * directly. Production constructs `buildApp({})` and so the real
   * JWT auth path always runs.
   */
  readonly testAuthInjector?: TestAuthInjector;
}

export interface BuildAppResult {
  readonly app: FastifyInstance;
  readonly consumer: BrainEventConsumerHandle | null;
  readonly store: BillingStore;
}

/**
 * Build a Fastify instance with all routes wired + an optional
 * brain-event-bus consumer registered. Pass concrete deps from a
 * composition root to swap in the production billing store + bus.
 */
export async function buildApp(deps: BuildAppDeps = {}): Promise<BuildAppResult> {
  const app = Fastify({ logger: false });

  const store = deps.store ?? createInMemoryBillingStore();

  // Order matters: metrics middleware registers `onRequest`/`onResponse`
  // hooks that must observe the health/readyz/billing routes below.
  registerMetrics(app);

  // Auth gate — registered BEFORE routes so the preHandler hook fires
  // on every non-public path (/healthz, /readyz, /metrics are
  // whitelisted inside the hook).
  authMiddleware(app, {
    ...(deps.testAuthInjector
      ? { testAuthInjector: deps.testAuthInjector }
      : {}),
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'outcomes-metering' }));

  await registerReadyzRoutes(app, {
    ...(deps.dbPool ? { dbPool: deps.dbPool } : {}),
  });

  await registerEventsRoutes(app, {
    store,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.newRecordId ? { newRecordId: deps.newRecordId } : {}),
  });
  await registerBillingRoutes(app, { store });

  let consumer: BrainEventConsumerHandle | null = null;
  if (deps.bus) {
    consumer = createBrainEventConsumer({
      bus: deps.bus,
      store,
      ...(deps.clock ? { clock: deps.clock } : {}),
      ...(deps.newRecordId ? { newRecordId: deps.newRecordId } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
    });
  }

  return { app, consumer, store };
}

async function main(): Promise<void> {
  const { app, consumer } = await buildApp();
  const port = Number(process.env.PORT ?? 3018);
  const host = process.env.HOST ?? '0.0.0.0';
  try {
    await app.listen({ port, host });
    logger.info(`[outcomes-metering] listening on http://${host}:${port} (consumer=${
        consumer ? 'wired' : 'not-wired'
      })`);
  } catch (err) {
    logger.error('[outcomes-metering] fatal', { error: err });
    process.exit(1);
  }
}

// Auto-start when invoked directly (`node dist/index.js`).
const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false;
    const argvUrl = new URL(`file://${process.argv[1]}`).href;
    return import.meta.url === argvUrl;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  void main();
}

// ---------------------------------------------------------------------------
// Public barrel
// ---------------------------------------------------------------------------

export {
  createInMemoryBillingStore,
  type BillingStore,
  type RecordEventInput,
  type RecordEventResult,
  type MonthlyBillingAggregate,
} from './store/billing-store.js';

export {
  createBrainEventConsumer,
  OUTCOMES_METERING_EVENT_TYPES,
  type BrainEventConsumerDeps,
  type BrainEventConsumerHandle,
  type ConsumerLogger,
} from './consumers/brain-event-consumer.js';

export {
  registerEventsRoutes,
  type RegisterEventsRoutesDeps,
} from './routes/events.js';

export {
  registerBillingRoutes,
  type RegisterBillingRoutesDeps,
} from './routes/billing.js';
