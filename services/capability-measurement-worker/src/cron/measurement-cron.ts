/**
 * Measurement cron — Wave CAPABILITY.
 *
 * On each tick:
 *   1. Walk every tenant.
 *   2. For each tenant × live capability:
 *      a. Pull invocations + outcomes over each of the 3 windows
 *         (7d / 28d / 91d).
 *      b. Aggregate into a Measurement row.
 *      c. Persist when the window produced data.
 *   3. Optionally run the lifecycle manager and persist transitions.
 *
 * The actual port wiring (which tenants, which repositories) is
 * injected — so the cron is fully testable with in-memory adapters.
 *
 * @module @borjie/capability-measurement-worker/cron/measurement-cron
 */

import {
  aggregateMeasurement,
  type Capability,
  type CapabilityRepository,
  type InvocationRepository,
  type Measurement,
  type MeasurementRepository,
  type MeasurementWindowDays,
  type OutcomeRepository,
} from '@borjie/capability-catalogue';

const WINDOWS: ReadonlyArray<MeasurementWindowDays> = [7, 28, 91];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TickLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface TickDeps {
  /** Lists all tenants the worker should sweep. */
  readonly listTenants: () => Promise<ReadonlyArray<string>>;
  readonly capabilityRepo: CapabilityRepository;
  readonly invocationRepo: InvocationRepository;
  readonly outcomeRepo: OutcomeRepository;
  readonly measurementRepo: MeasurementRepository;
  /** Inject a clock source so tests can pin time. */
  readonly now: () => Date;
  readonly logger: TickLogger;
}

export interface TickReport {
  readonly tenantsSwept: number;
  readonly capabilitiesSwept: number;
  readonly measurementsPersisted: number;
  readonly measurementsSkipped: number;
}

/**
 * Run a single measurement tick. Pure orchestration — the heavy work
 * (axis math, audit hashing) lives inside
 * `@borjie/capability-catalogue`.
 */
export async function runMeasurementTick(deps: TickDeps): Promise<TickReport> {
  const startedAt = deps.now();
  const tenants = await deps.listTenants();

  let capabilitiesSwept = 0;
  let measurementsPersisted = 0;
  let measurementsSkipped = 0;

  for (const tenantId of tenants) {
    const caps = await deps.capabilityRepo.listAll(tenantId);
    const live = caps.filter(
      (c) => c.lifecycleState === 'live' || c.lifecycleState === 'shadow',
    );
    capabilitiesSwept += live.length;

    for (const cap of live) {
      for (const window of WINDOWS) {
        const measurement = await measureCapability({
          capability: cap,
          tenantId,
          windowDays: window,
          now: startedAt,
          invocationRepo: deps.invocationRepo,
          outcomeRepo: deps.outcomeRepo,
        });
        if (measurement === null) {
          measurementsSkipped += 1;
          continue;
        }
        await deps.measurementRepo.insert(measurement);
        measurementsPersisted += 1;
      }
    }
  }

  const report: TickReport = Object.freeze({
    tenantsSwept: tenants.length,
    capabilitiesSwept,
    measurementsPersisted,
    measurementsSkipped,
  });

  deps.logger.info(
    {
      tenants_swept: report.tenantsSwept,
      capabilities_swept: report.capabilitiesSwept,
      measurements_persisted: report.measurementsPersisted,
      measurements_skipped: report.measurementsSkipped,
    },
    'capability-measurement-worker tick complete',
  );
  return report;
}

/**
 * Measure a single (capability, window). Returns `null` to signal the
 * caller to skip persistence (e.g. empty window).
 */
async function measureCapability(args: {
  readonly capability: Capability;
  readonly tenantId: string;
  readonly windowDays: MeasurementWindowDays;
  readonly now: Date;
  readonly invocationRepo: InvocationRepository;
  readonly outcomeRepo: OutcomeRepository;
}): Promise<Measurement | null> {
  const to = args.now.toISOString();
  const from = new Date(
    args.now.getTime() - args.windowDays * MS_PER_DAY,
  ).toISOString();

  const invocations = await args.invocationRepo.listByCapabilityInWindow({
    tenantId: args.tenantId,
    capabilityId: args.capability.id,
    from,
    to,
  });
  if (invocations.length === 0) return null;

  const outcomes = await args.outcomeRepo.listForInvocations({
    invocationIds: invocations.map((i) => i.id),
  });

  return aggregateMeasurement({
    tenantId: args.tenantId,
    capabilityId: args.capability.id,
    windowDays: args.windowDays,
    measuredAt: to,
    invocations,
    outcomes,
  });
}
