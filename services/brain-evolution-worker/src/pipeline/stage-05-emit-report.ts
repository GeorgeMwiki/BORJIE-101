/**
 * Stage 05 — emit a BrainEvolutionReport event for the tenant.
 *
 * Tabulates the day's run (traces read, deltas proposed, applied,
 * escalated, blocked) and ships the report to a `ReportSink` port. The
 * admin portal subscribes downstream so operators can review what the
 * brain learned overnight.
 *
 * The sink is wire-agnostic. Composition root wires it to:
 *   - the existing in-app event bus, OR
 *   - the `consolidation_emissions` event table for durable delivery, OR
 *   - a kafka / nats topic if the deployment has one.
 *
 * Stage failures don't crash the worker — a report-emit failure just
 * means the operators see no entry for this tenant tonight; the deltas
 * themselves are already applied.
 */

import type {
  BrainEvolutionReport,
  DeltaApplicationResult,
  MemoryDelta,
  ReflectionResult,
  BrainWorkerLogger,
} from '../types.js';

export interface ReportSink {
  emit(report: BrainEvolutionReport): Promise<void>;
}

export interface EmitReportArgs {
  readonly tenantId: string;
  readonly runId: string;
  readonly reflection: ReflectionResult;
  readonly deltas: ReadonlyArray<MemoryDelta>;
  readonly results: ReadonlyArray<DeltaApplicationResult>;
  readonly tracesRead: number;
  readonly emittedAt?: Date;
  readonly logger?: BrainWorkerLogger;
}

/**
 * Build the report from inputs (pure) and ship to the sink. Returns the
 * report so the orchestrator can include it in its `TenantRunResult`.
 */
export async function emitEvolutionReport(
  sink: ReportSink,
  args: EmitReportArgs,
): Promise<BrainEvolutionReport> {
  const report = buildReport(args);

  try {
    await sink.emit(report);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    args.logger?.warn?.(
      {
        tenantId: args.tenantId,
        runId: args.runId,
        err: msg,
      },
      'brain-evolution-worker: report emit failed — operators will not see this run',
    );
  }

  return report;
}

/**
 * Pure builder — exposed for tests so they can verify counts independent
 * of the sink wire-up.
 */
export function buildReport(args: EmitReportArgs): BrainEvolutionReport {
  const emittedAt = (args.emittedAt ?? new Date()).toISOString();

  let applied = 0;
  let escalated = 0;
  let blocked = 0;

  for (const result of args.results) {
    if (result.applied) {
      applied += 1;
      continue;
    }
    if (result.escalated) {
      escalated += 1;
      continue;
    }
    blocked += 1;
  }

  const synthesisExcerpt =
    args.reflection.synthesis.length > 480
      ? args.reflection.synthesis.slice(0, 480) + '...'
      : args.reflection.synthesis;

  return {
    tenantId: args.tenantId,
    runId: args.runId,
    windowStart: args.reflection.windowStart,
    windowEnd: args.reflection.windowEnd,
    tracesRead: args.tracesRead,
    deltasProposed: args.deltas.length,
    deltasApplied: applied,
    deltasEscalated: escalated,
    deltasBlocked: blocked,
    agreement: args.reflection.agreement,
    escalateOverall:
      args.reflection.escalate || escalated > 0 || blocked > 0,
    synthesisExcerpt,
    applications: args.results,
    emittedAt,
  };
}
