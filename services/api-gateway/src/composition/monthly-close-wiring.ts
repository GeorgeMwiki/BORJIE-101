/**
 * Monthly-close wiring — composes the `MonthlyCloseOrchestrator` with the
 * Drizzle-backed `monthly_close_runs` storage adapter (migration 0099,
 * shipped in commit e33cebc) and binds the side-effect ports to whatever
 * concrete services the parent composition root can supply.
 *
 * Wave 28 Phase A → Phase B: a previous revision constructed every
 * external port as a stub. This revision upgrades two ports to real
 * adapters and tightens the remaining stubs:
 *
 *   - `AutonomyPolicyPort`  → real adapter over `AutonomyPolicyRepository`
 *     (Postgres-backed `autonomy_policies` table). The orchestrator only
 *     needs the master switch + a single `finance` knob; we project the
 *     full `AutonomyPolicy` down to that narrow shape and fall back to a
 *     safe `autonomousModeEnabled = false` when no row exists.
 *
 *   - `EventPort`           → real adapter wrapping the platform
 *     `EventBus` (`@borjie/domain-services`). Each orchestrator event
 *     is wrapped into an `EventEnvelope<DomainEvent>` so existing
 *     subscribers — including the observability bridge that backs the
 *     webhook outbox — see the published `MonthlyCloseCompleted` /
 *     `MonthlyCloseAwaitingApproval` event types.
 *
 *   - `ReconciliationPort`, `StatementPort`, `DisbursementPort`,
 *     `NotificationPort` are now real Drizzle-backed period-bulk
 *     adapters (Wave-2 deep-scrub B1):
 *       * Reconciliation aggregates `payments` joined with `invoices`
 *         for the closing window and reports
 *         `{ reconciled, unmatched, grossRentMinor, currency }` in a
 *         single round-trip.
 *       * Statement adapter walks owners with active leases in the
 *         period, computes per-owner gross rent, and writes a
 *         `draft` row per owner into `owner_statements` (existing
 *         schema) — PDF rendering stays a follow-up worker.
 *       * Disbursement adapter computes per-owner breakdown from the
 *         payments / leases / properties chain and records each
 *         `executeDisbursement` call into `event_outbox` as a
 *         `MonthlyCloseDisbursementProposed` event so the eventual
 *         payouts worker has a durable queue.
 *       * Notification adapter writes one row per (owner, statement)
 *         into the existing `notification_dispatch_log` (status
 *         `pending`); the dispatcher worker drains it.
 *     The wiring still falls back to the original stubs (with refined
 *     `degraded_reason` strings) when no DB is provided.
 *
 * The DI shape stays compatible with the old `{ db, logger? }` signature
 * via optional `eventBus` / `autonomyRepository` slots — older callers
 * (and the test suite) keep working without retrofit.
 */

import { MonthlyClose } from '@borjie/ai-copilot/orchestrators';
import {
  createMonthlyCloseRunsService,
  createDatabaseClient,
} from '@borjie/database';
import type {
  AutonomyPolicy,
  AutonomyPolicyRepository,
} from '@borjie/ai-copilot/autonomy';
import type {
  DomainEvent,
  EventBus,
  EventEnvelope,
} from '@borjie/domain-services';
import { createDrizzleReconciliationAdapter } from '../services/monthly-close/reconciliation-adapter.js';
import { createDrizzleStatementAdapter } from '../services/monthly-close/statement-adapter.js';
import { createCurrencyPreferencesService } from '@borjie/database';
import { createDrizzleDisbursementAdapter } from '../services/monthly-close/disbursement-adapter.js';
import { createDrizzleNotificationAdapter } from '../services/monthly-close/notification-adapter.js';
import {
  withAgentSpan,
  recordDegraded,
} from '../instrumentation/agent-spans.js';
import { logger } from '../utils/logger.js';

const { MonthlyCloseOrchestrator } = MonthlyClose;

type EventPort = MonthlyClose.EventPort;
type AutonomyPolicyPort = MonthlyClose.AutonomyPolicyPort;
type RunStorePort = MonthlyClose.RunStorePort;
type OrchestratorLogger = MonthlyClose.OrchestratorLogger;
type MonthlyCloseOrchestratorDeps = MonthlyClose.MonthlyCloseOrchestratorDeps;

/**
 * DatabaseClient derived via `ReturnType<typeof createDatabaseClient>`
 * so we sidestep the package-barrel `TS2709 Cannot use namespace ... as
 * a type` drift documented in service-registry.ts.
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export interface MonthlyCloseWiringDeps {
  readonly db: DatabaseClient | null;
  /**
   * Platform `EventBus`. When provided, the orchestrator's `EventPort`
   * publishes each `MonthlyCloseCompleted` / `MonthlyCloseAwaitingApproval`
   * envelope onto the bus so downstream subscribers (webhook outbox,
   * observability bridge, etc.) receive it. When absent, the wiring
   * falls back to the structured-degraded stub.
   */
  readonly eventBus?: EventBus;
  /**
   * Per-tenant autonomy policy repository. When provided, the
   * orchestrator's autonomy gate consults the live policy row before
   * deciding whether to auto-execute the disbursement batch. When
   * absent, the wiring falls back to the safe-default stub
   * (`autonomousModeEnabled: false`) so disbursements always park for
   * human approval.
   */
  readonly autonomyRepository?: AutonomyPolicyRepository;
  readonly logger?: {
    warn(meta: object, msg: string): void;
    info(meta: object, msg: string): void;
  };
}

export interface MonthlyCloseWiring {
  readonly orchestrator: InstanceType<typeof MonthlyCloseOrchestrator>;
}

/**
 * Build the monthly-close wiring. Returns null when no Drizzle client
 * is available — DATABASE_URL must be set for the run/step audit trail
 * to be durable. Routers already render a 503 envelope when they see a
 * null orchestrator, so this short-circuit is the load-bearing degraded-
 * mode signal.
 */
export function createMonthlyCloseWiring(
  deps: MonthlyCloseWiringDeps,
): MonthlyCloseWiring | null {
  if (!deps.db) {
    return null;
  }

  const logger = adaptLogger(deps.logger);
  const store = adaptStore(createMonthlyCloseRunsService(deps.db));

  // Per-tenant currency resolver — used by the statement-adapter to
  // resolve the display currency for owners that have no completed
  // payments in the period. Removes the literal `'XXX'` fallback so a
  // missed wire surfaces as a thrown error rather than an unreadable
  // statement.
  // NOTE: `createCurrencyPreferencesService` expects the platform DB
  // client shape; we pass it through as-is because both wiring sites
  // share a single Drizzle client.
  const currencyPreferences = createCurrencyPreferencesService(
    deps.db as never,
  );
  const statementCurrencyResolver = {
    async resolveForTenant(tenantId: string): Promise<string> {
      const resolved = await currencyPreferences.resolve({ tenantId });
      return resolved.currency;
    },
  };

  const orchestratorDeps: MonthlyCloseOrchestratorDeps = {
    store,
    reconciliation: createDrizzleReconciliationAdapter(deps.db, logger),
    statements: createDrizzleStatementAdapter(deps.db, logger, {
      currencyResolver: statementCurrencyResolver,
    }),
    disbursement: createDrizzleDisbursementAdapter(deps.db, logger),
    notifications: createDrizzleNotificationAdapter(deps.db, logger),
    eventBus: deps.eventBus
      ? createRealEventPort(deps.eventBus, logger)
      : createStubEventPort(logger),
    autonomy: deps.autonomyRepository
      ? createRealAutonomyPort(deps.autonomyRepository, logger)
      : createStubAutonomyPort(logger),
    logger,
  };

  const orchestrator = new MonthlyCloseOrchestrator(orchestratorDeps);
  return {
    orchestrator: instrumentOrchestrator(orchestrator),
  };
}

/**
 * Wrap the orchestrator's public async methods (`triggerRun`,
 * `listRuns`, `getRun`, `approveStep`) in `withAgentSpan(...)` so
 * operators see latency and error rate per-method in Prometheus +
 * per-tenant traces. Behaviour is otherwise unchanged — the wrappers
 * proxy the underlying instance method 1:1.
 *
 * Methods are rebound on the instance (rather than via Object.create)
 * because `MonthlyCloseOrchestrator` reads private fields through
 * `this`, and a prototype-only proxy would break those reads. Rebinding
 * happens once at wiring-construction time (not per call).
 */
function instrumentOrchestrator(
  orchestrator: InstanceType<typeof MonthlyCloseOrchestrator>,
): InstanceType<typeof MonthlyCloseOrchestrator> {
  const originalTriggerRun = orchestrator.triggerRun.bind(orchestrator);
  const originalListRuns = orchestrator.listRuns.bind(orchestrator);
  const originalGetRun = orchestrator.getRun.bind(orchestrator);
  const originalApproveStep = orchestrator.approveStep.bind(orchestrator);

  orchestrator.triggerRun = (input) =>
    withAgentSpan(
      'monthly-close',
      'triggerRun',
      () => originalTriggerRun(input),
      {
        tenantId: input?.tenantId ?? null,
        attributes: {
          ...(typeof input?.periodYear === 'number' && {
            periodYear: input.periodYear,
          }),
          ...(typeof input?.periodMonth === 'number' && {
            periodMonth: input.periodMonth,
          }),
        },
      },
    );

  orchestrator.listRuns = (tenantId, limit) =>
    withAgentSpan(
      'monthly-close',
      'listRuns',
      () => originalListRuns(tenantId, limit),
      { tenantId },
    );

  orchestrator.getRun = (runId, tenantId) =>
    withAgentSpan(
      'monthly-close',
      'getRun',
      () => originalGetRun(runId, tenantId),
      { tenantId, attributes: { runId } },
    );

  orchestrator.approveStep = (input) =>
    withAgentSpan(
      'monthly-close',
      'approveStep',
      () => originalApproveStep(input),
      {
        tenantId: input?.tenantId ?? null,
        attributes: {
          ...(input?.runId && { runId: input.runId }),
          ...(input?.stepName && { stepName: input.stepName }),
        },
      },
    );

  return orchestrator;
}

// ---------------------------------------------------------------------------
// Logger adaptation
// ---------------------------------------------------------------------------

function adaptLogger(
  injected: MonthlyCloseWiringDeps['logger'],
): OrchestratorLogger {
  if (injected) {
    return {
      info(meta, msg) {
        injected.info(meta, msg);
      },
      warn(meta, msg) {
        injected.warn(meta, msg);
      },
      error(meta, msg) {
        // Caller may not implement `error` — degrade to warn so we
        // never lose error context.
        const maybeError = (injected as { error?: unknown }).error;
        if (typeof maybeError === 'function') {
          (maybeError as (m: object, s: string) => void).call(
            injected,
            meta,
            msg,
          );
          return;
        }
        injected.warn(meta, msg);
      },
    };
  }
  return {
    info(meta, msg) {
      logger.info('[monthly-close]', { msg, meta });
    },
    warn(meta, msg) {
      logger.warn('[monthly-close]', { msg, meta });
    },
    error(meta, msg) {
      logger.error('[monthly-close]', { msg, meta });
    },
  };
}

// ---------------------------------------------------------------------------
// Store adapter — duck-types createMonthlyCloseRunsService into RunStorePort
// ---------------------------------------------------------------------------

/**
 * The Drizzle adapter shipped in `@borjie/database` matches the
 * `RunStorePort` shape exactly (string-typed `stepName` widens to the
 * orchestrator's `Step` literal union). We re-cast at the boundary
 * rather than have the adapter compile-depend on `@borjie/ai-copilot`.
 */
function adaptStore(
  svc: ReturnType<typeof createMonthlyCloseRunsService>,
): RunStorePort {
  return svc as unknown as RunStorePort;
}

// ---------------------------------------------------------------------------
// Real adapters
// ---------------------------------------------------------------------------

/**
 * Real `AutonomyPolicyPort` adapter. Reads the per-tenant policy row
 * via `AutonomyPolicyRepository.get` and projects it down to the narrow
 * shape the orchestrator's autonomy gate consumes.
 *
 * Falls back to `autonomousModeEnabled: false` when:
 *   - the repo returns `null` (no row for this tenant),
 *   - the repo throws (we never let an autonomy lookup tear down a run;
 *     parking the disbursement batch is the safe degraded posture).
 *
 * Each fallback logs a structured `{ port: 'autonomy', degraded_reason }`
 * warning so operators can see the row is missing or the table is
 * unreachable.
 */
function createRealAutonomyPort(
  repo: AutonomyPolicyRepository,
  logger: OrchestratorLogger,
): AutonomyPolicyPort {
  const warnedTenants = new Set<string>();
  const warnOnce = (tenantId: string, reason: string): void => {
    const key = `${tenantId}:${reason}`;
    if (warnedTenants.has(key)) return;
    warnedTenants.add(key);
    logger.warn(
      {
        port: 'autonomy',
        tenantId,
        degraded_reason: reason,
      },
      `monthly-close: autonomy port falling back to safe defaults — ${reason}`,
    );
  };

  return {
    async getPolicy(tenantId) {
      let policy: AutonomyPolicy | null = null;
      try {
        policy = await repo.get(tenantId);
      } catch (err) {
        warnOnce(tenantId, 'repository_error');
        logger.warn(
          {
            port: 'autonomy',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: autonomy policy read failed — defaulting to disabled',
        );
        return safeAutonomyDefault();
      }

      if (!policy) {
        warnOnce(tenantId, 'no_policy_row');
        return safeAutonomyDefault();
      }

      return {
        autonomousModeEnabled: policy.autonomousModeEnabled,
        finance: {
          autoApproveRefundsMinorUnits:
            policy.finance?.autoApproveRefundsMinorUnits ?? 0,
        },
      };
    },
  };
}

function safeAutonomyDefault(): {
  readonly autonomousModeEnabled: boolean;
  readonly finance: { readonly autoApproveRefundsMinorUnits: number };
} {
  return {
    autonomousModeEnabled: false,
    finance: {
      autoApproveRefundsMinorUnits: 0,
    },
  };
}

/**
 * Real `EventPort` adapter. Wraps the orchestrator's flat event shape
 * into the platform's `EventEnvelope<DomainEvent>` and publishes onto
 * the injected `EventBus`. Failures are absorbed (the orchestrator
 * already guards `safePublish`, and the bus contract requires
 * subscriber failures not to tear down publishers).
 */
function createRealEventPort(
  bus: EventBus,
  logger: OrchestratorLogger,
): EventPort {
  return {
    async publish(event) {
      const envelope: EventEnvelope<DomainEvent & { eventType: string }> = {
        event: {
          eventId: `monthly_close_${event.runId}_${event.type}`,
          eventType: event.type,
          // ISOTimestamp is a structural string brand — `toISOString` is
          // the canonical producer everywhere else in the codebase.
          timestamp: new Date().toISOString() as DomainEvent['timestamp'],
          tenantId: event.tenantId as DomainEvent['tenantId'],
          correlationId: event.runId,
          causationId: null,
          metadata: {
            source: 'monthly-close-orchestrator',
            runId: event.runId,
            ...event.payload,
          },
        },
        version: 1,
        aggregateId: event.runId,
        aggregateType: 'MonthlyCloseRun',
      };
      try {
        await bus.publish(envelope);
      } catch (err) {
        logger.warn(
          {
            port: 'eventBus',
            runId: event.runId,
            eventType: event.type,
            err: err instanceof Error ? err.message : String(err),
          },
          'monthly-close: eventBus publish failed (non-fatal)',
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Stub ports — degraded-mode safe defaults
// ---------------------------------------------------------------------------

/**
 * Internal helper — guarantees each stub port logs a single
 * `degraded_port` warning on first invocation rather than spamming the
 * logger on every step. The reason string is structured so log
 * aggregators can group on `degraded_reason` and surface gaps to ops.
 */
function makeOnceWarner(
  logger: OrchestratorLogger,
  portName: string,
  degradedReason: string,
): () => void {
  let warned = false;
  return () => {
    if (warned) return;
    warned = true;
    recordDegraded('monthly-close', portName, degradedReason);
    logger.warn(
      {
        port: portName,
        status: 'degraded',
        degraded_reason: degradedReason,
      },
      `monthly-close: ${portName} running in degraded stub mode (${degradedReason}) — pending real adapter (Docs/TODO_BACKLOG.md)`,
    );
  };
}

// The old stub ReconciliationPort / StatementPort / DisbursementPort /
// NotificationPort factories were removed in Wave-2 deep-scrub B1
// in favour of the real Drizzle-backed adapters in
// `services/monthly-close/`. The `makeOnceWarner` helper below is
// retained because the EventBus / AutonomyPolicy stubs still use it
// when the parent composition root opts out of those wirings.

// Stub `EventPort` — used only when no `EventBus` is injected.
// Production callers always pass `eventBus` so this path only runs in
// tests / degraded composition.
function createStubEventPort(logger: OrchestratorLogger): EventPort {
  const warn = makeOnceWarner(logger, 'eventBus', 'no_event_bus_injected');
  return {
    async publish() {
      warn();
      // The orchestrator already wraps publish() in a try/catch
      // (`safePublish`), so swallowing here is belt-and-braces.
    },
  };
}

// Stub `AutonomyPolicyPort` — used only when no `AutonomyPolicyRepository`
// is injected. Returns `autonomousModeEnabled: false` so any
// disbursement batch is parked for human approval — the safe degraded
// posture.
function createStubAutonomyPort(
  logger: OrchestratorLogger,
): AutonomyPolicyPort {
  const warn = makeOnceWarner(
    logger,
    'autonomy',
    'no_policy_repository_injected',
  );
  return {
    async getPolicy() {
      warn();
      return safeAutonomyDefault();
    },
  };
}
