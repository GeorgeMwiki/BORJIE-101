/**
 * @borjie/executive-brief-engine — sensors.
 *
 * Sensor signals are the raw evidence the brief is built on. Each
 * sensor is a port: the engine takes a `SensorBundle` of port
 * implementations and gathers signals before the LLM hypothesis pass.
 *
 * Sensors deliberately surface RAW NUMBERS, not interpretations. The
 * hypothesis generator (Haiku) is the layer that interprets. This
 * separation lets us:
 *
 *   - Drop in mock sensors for tests (deterministic counts).
 *   - Replace any sensor with a degraded fallback (e.g. ledger sensor
 *     fails → brief continues without arrears trend, marked degraded).
 *   - Reuse the same sensors across the daily cron AND on-demand briefs.
 *
 * Every sensor signal carries an `evidenceRefs` array — these become
 * citations downstream.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Signal shape — uniform across sensors so the hypothesis generator
// has one schema to reason over.
// ─────────────────────────────────────────────────────────────────────

export const SensorSignalSchema = z.object({
  sensor: z.string().min(1),                 // 'ledger_health' | 'arrears_trend' | …
  metric: z.string().min(1),                 // 'collection_rate' | 'open_complaints' | …
  value: z.number(),
  unit: z.string().optional(),               // 'pct' | 'count' | 'currency_minor'
  delta: z.number().optional(),              // change vs prior period (when known)
  baseline: z.number().optional(),
  timestamp: z.date(),
  /** entity_id / audit_event_id / document_id refs that gave this signal. */
  evidenceRefs: z.array(
    z.object({
      kind: z.enum(['entity', 'audit_event', 'document']),
      id: z.string().min(1),
    }),
  ).default([]),
  /** Sensor-side note for downstream hypothesis prompts. */
  note: z.string().optional(),
});
export type SensorSignal = z.infer<typeof SensorSignalSchema>;

// ─────────────────────────────────────────────────────────────────────
// Sensor ports — implementations live in the api-gateway composition
// over Drizzle (ledger, leases, complaints) or Piece K (documents).
// ─────────────────────────────────────────────────────────────────────

export interface LedgerSensorPort {
  /** Reads from payments-ledger. */
  ledgerHealth(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface ArrearsSensorPort {
  /** Trend in open arrears + days-overdue across the period. */
  arrearsTrend(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface ComplaintsSensorPort {
  complaintVolume(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface AuditAnomaliesSensorPort {
  anomalies(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface ContractsSensorPort {
  /** Leases / vendor contracts expiring in the period. */
  upcomingExpirations(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
    readonly horizonDays: number;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface KpiSensorPort {
  /** KPI deltas vs prior period. */
  kpiDeltas(args: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<ReadonlyArray<SensorSignal>>;
}

export interface SensorBundle {
  readonly ledger: LedgerSensorPort;
  readonly arrears: ArrearsSensorPort;
  readonly complaints: ComplaintsSensorPort;
  readonly audit: AuditAnomaliesSensorPort;
  readonly contracts: ContractsSensorPort;
  readonly kpi: KpiSensorPort;
}

// ─────────────────────────────────────────────────────────────────────
// Result of a sensor sweep — one signal stream per sensor.
// ─────────────────────────────────────────────────────────────────────

export interface SensorSweepResult {
  readonly signals: ReadonlyArray<SensorSignal>;
  /** Sensors that failed (degraded mode markers). */
  readonly failedSensors: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// gatherSignals — runs every sensor in parallel with bounded failure
// containment. A failing sensor degrades the brief (flag in result)
// but never breaks generation.
// ─────────────────────────────────────────────────────────────────────

export interface GatherArgs {
  readonly tenantId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly horizonDays?: number;
  readonly sensors: SensorBundle;
}

export async function gatherSignals(args: GatherArgs): Promise<SensorSweepResult> {
  const horizonDays = args.horizonDays ?? 60;
  const signals: SensorSignal[] = [];
  const failedSensors: string[] = [];

  const tasks: Array<{ name: string; promise: Promise<ReadonlyArray<SensorSignal>> }> = [
    {
      name: 'ledger',
      promise: args.sensors.ledger.ledgerHealth({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    },
    {
      name: 'arrears',
      promise: args.sensors.arrears.arrearsTrend({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    },
    {
      name: 'complaints',
      promise: args.sensors.complaints.complaintVolume({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    },
    {
      name: 'audit',
      promise: args.sensors.audit.anomalies({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    },
    {
      name: 'contracts',
      promise: args.sensors.contracts.upcomingExpirations({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        horizonDays,
      }),
    },
    {
      name: 'kpi',
      promise: args.sensors.kpi.kpiDeltas({
        tenantId: args.tenantId,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
      }),
    },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.promise));
  for (let i = 0; i < settled.length; i += 1) {
    const outcome = settled[i]!;
    const task = tasks[i]!;
    if (outcome.status === 'fulfilled') {
      for (const s of outcome.value) signals.push(s);
    } else {
      failedSensors.push(task.name);
    }
  }

  return { signals, failedSensors };
}

// ─────────────────────────────────────────────────────────────────────
// Helper — group signals by sensor for the hypothesis prompt.
// ─────────────────────────────────────────────────────────────────────

export function groupSignalsBySensor(
  signals: ReadonlyArray<SensorSignal>,
): Record<string, ReadonlyArray<SensorSignal>> {
  const grouped: Record<string, SensorSignal[]> = {};
  for (const s of signals) {
    const list = grouped[s.sensor];
    if (list) {
      list.push(s);
    } else {
      grouped[s.sensor] = [s];
    }
  }
  return grouped;
}
