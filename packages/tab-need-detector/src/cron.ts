/**
 * Piece O — Need-detection cron orchestrator.
 *
 * Runs every N hours per tenant. The orchestrator is split into a pure
 * pipeline + an IO port (`NeedDetectorRepository`) so tests can inject
 * an in-memory implementation while production wires up a Drizzle-backed
 * repo against migrations 0261-0265.
 *
 * Pipeline:
 *   1. Load detector state config for tenant; merge with defaults.
 *   2. Fetch signals over `config.lookbackDays` for the tenant.
 *   3. Aggregate signals (half-life decay; see signal-aggregator.ts).
 *   4. Fetch installed module template ids + proposal history.
 *   5. Plan emissions (see proposal-emitter.ts).
 *   6. Plan expirations for stale pending rows.
 *   7. Persist via the repository.
 *   8. Upsert detector state row.
 *
 * The pure parts are unit-tested via `__tests__/cron.test.ts` using an
 * in-memory repository fake. Production wires the same orchestrator
 * against a Drizzle repo.
 */

import {
  aggregateSignals,
  filterAboveThreshold,
} from './signal-aggregator.js';
import {
  planEmissions,
  planExpirations,
  type ProposalHistoryEntry,
} from './proposal-emitter.js';
import {
  resolveDetectorConfig,
  type DetectorStateConfig,
  type ModuleTemplateId,
  type ProposalRow,
  type SignalRow,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Repository port.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Anything the cron needs to read/write. The Drizzle implementation lives
 * outside this package (in services/api-gateway or services/cron-worker)
 * so the package stays IO-free and standalone-testable.
 */
export interface NeedDetectorRepository {
  /** Tenant ids the cron should consider this run. */
  readonly listTenants: () => Promise<readonly string[]>;
  /** Read detector state row, returning defaults if absent. */
  readonly getDetectorState: (
    tenantId: string,
  ) => Promise<{
    readonly lastScanAt: Date | null;
    readonly totalSignalsScanned: number;
    readonly totalProposalsEmitted: number;
    readonly config: DetectorStateConfig;
  }>;
  /** Fetch tenant signals created at or after `since`. */
  readonly fetchSignalsSince: (
    tenantId: string,
    since: Date,
  ) => Promise<readonly SignalRow[]>;
  /** Resolve installed module template ids for tenant. */
  readonly getInstalledModuleTemplateIds: (
    tenantId: string,
  ) => Promise<ReadonlySet<ModuleTemplateId>>;
  /** Fetch proposal history needed by emitter snooze rules. */
  readonly fetchProposalHistory: (
    tenantId: string,
    sinceDecidedAfter: Date,
  ) => Promise<readonly ProposalHistoryEntry[]>;
  /** Fetch pending proposals whose expires_at <= now. */
  readonly fetchExpiredPending: (
    tenantId: string,
    now: Date,
  ) => Promise<
    readonly { readonly id: string; readonly expiresAt: Date }[]
  >;
  /** Insert proposal rows. */
  readonly insertProposals: (rows: readonly ProposalRow[]) => Promise<void>;
  /** Flip status -> expired for given ids. */
  readonly markExpired: (
    tenantId: string,
    ids: readonly string[],
    now: Date,
  ) => Promise<void>;
  /** Upsert detector state row. */
  readonly upsertDetectorState: (input: {
    readonly tenantId: string;
    readonly lastScanAt: Date;
    readonly signalsScanned: number;
    readonly proposalsEmitted: number;
    readonly config: DetectorStateConfig;
  }) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────
// Options.
// ─────────────────────────────────────────────────────────────────────────

export interface RunCronOptions {
  readonly repo: NeedDetectorRepository;
  readonly now: Date;
  readonly generateId: () => string;
  /**
   * Logger handle — gateways inject a Pino logger; tests inject a noop.
   * String log messages only (no PII).
   */
  readonly log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface CronTenantSummary {
  readonly tenantId: string;
  readonly signalsScanned: number;
  readonly proposalsEmitted: number;
  readonly expired: number;
  readonly skipped: number;
}

export interface CronRunSummary {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly tenantsProcessed: number;
  readonly perTenant: readonly CronTenantSummary[];
}

// ─────────────────────────────────────────────────────────────────────────
// Single-tenant scan — the pure-ish atomic unit.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the need-detection pipeline for one tenant. Returns the summary
 * the caller logs into `spawn_detector_state.total_*` counters.
 *
 * IO is fully mediated by `options.repo`; this function therefore has
 * no implicit clock, network, or filesystem dependency beyond what the
 * caller provides.
 */
export async function scanTenant(
  tenantId: string,
  options: RunCronOptions,
): Promise<CronTenantSummary> {
  const { repo, now, generateId, log } = options;
  const noop = (): void => undefined;
  const logFn = log ?? noop;

  const state = await repo.getDetectorState(tenantId);
  const config = resolveDetectorConfig(state.config);

  const lookbackMs = config.lookbackDays * 24 * 60 * 60 * 1000;
  const since = new Date(now.getTime() - lookbackMs);

  const signals = await repo.fetchSignalsSince(tenantId, since);

  const aggregations = aggregateSignals(signals, {
    now,
    halfLifeDays: config.signalHalfLifeDays,
    lookbackDays: config.lookbackDays,
  });

  const aboveThreshold = filterAboveThreshold(aggregations, config.scoreThreshold);

  // For installed-module + history lookups, only ask if we actually have
  // candidates above threshold — saves a round-trip in the cold case.
  let proposalsEmitted = 0;
  let skipped = 0;
  if (aboveThreshold.length > 0) {
    const installed = await repo.getInstalledModuleTemplateIds(tenantId);
    const historyCutoffMs =
      now.getTime() - config.declineSnoozeDays * 24 * 60 * 60 * 1000;
    const history = await repo.fetchProposalHistory(
      tenantId,
      new Date(historyCutoffMs),
    );

    const plan = planEmissions(aboveThreshold, {
      now,
      scoreThreshold: config.scoreThreshold,
      declineSnoozeDays: config.declineSnoozeDays,
      proposalExpiryDays: config.proposalExpiryDays,
      installedModuleTemplateIds: installed,
      history,
      generateId,
    });

    if (plan.emit.length > 0) {
      await repo.insertProposals(plan.emit.map((entry) => entry.row));
      proposalsEmitted = plan.emit.length;
    }
    skipped = plan.skipped.length;
  }

  // Process expirations independently — even if we emit nothing this
  // cycle, we still want to flip overdue rows.
  const expiredCandidates = await repo.fetchExpiredPending(tenantId, now);
  const expiredIds = planExpirations(expiredCandidates, now);
  if (expiredIds.length > 0) {
    await repo.markExpired(tenantId, expiredIds, now);
  }

  await repo.upsertDetectorState({
    tenantId,
    lastScanAt: now,
    signalsScanned: state.totalSignalsScanned + signals.length,
    proposalsEmitted: state.totalProposalsEmitted + proposalsEmitted,
    config: state.config,
  });

  logFn(
    'info',
    `[need-detector] tenant=${tenantId} signals=${signals.length} aggregations=${aggregations.length} emitted=${proposalsEmitted} expired=${expiredIds.length} skipped=${skipped}`,
  );

  return Object.freeze({
    tenantId,
    signalsScanned: signals.length,
    proposalsEmitted,
    expired: expiredIds.length,
    skipped,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Multi-tenant scan — the cron entry.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run the scan across every tenant the repo enumerates. Failures in
 * one tenant don't break the others — each tenant's scan is wrapped
 * in try/catch and the error is logged.
 */
export async function runCron(
  options: RunCronOptions,
): Promise<CronRunSummary> {
  const { repo, log } = options;
  const startedAt = options.now;
  const tenantIds = await repo.listTenants();
  const perTenant: CronTenantSummary[] = [];

  for (const tenantId of tenantIds) {
    try {
      const summary = await scanTenant(tenantId, options);
      perTenant.push(summary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log?.('error', `[need-detector] tenant=${tenantId} failed: ${msg}`);
      perTenant.push({
        tenantId,
        signalsScanned: 0,
        proposalsEmitted: 0,
        expired: 0,
        skipped: 0,
      });
    }
  }

  const finishedAt = new Date(options.now.getTime());

  return Object.freeze({
    startedAt,
    finishedAt,
    tenantsProcessed: perTenant.length,
    perTenant: Object.freeze(perTenant),
  });
}
