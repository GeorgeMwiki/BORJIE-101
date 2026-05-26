/**
 * Weekly report generator (Wave 18BB-gap).
 *
 * Aggregates every observation resolved in the prior `REPORT_PERIOD_DAYS`
 * (default 7) into one `CalibrationReport` per `(tenant_id,
 * prediction_kind)`. Emits Brier + ECE + the reliability diagram.
 *
 * Cron-driven in production (Sunday 02:00 UTC). The generator is
 * pure orchestration over the metric primitives + the observation
 * repository; the host provides the clock, the repository, and the
 * audit chain.
 *
 * If a window has no resolved observations, no report row is emitted
 * for that `prediction_kind` — empty rows would skew the per-tenant
 * trend view.
 */

import {
  computeMeanBrierScore,
  type CalibrationPoint,
} from '../metrics/brier-score.js';
import {
  computeReliabilityDiagram,
  type ReliabilityDiagramOptions,
} from '../metrics/reliability-diagram.js';
import { eceFromDiagram } from '../metrics/expected-calibration-error.js';
import {
  CalibrationMonitorError,
  REPORT_PERIOD_DAYS,
  type AuditChainPort,
  type CalibrationObservation,
  type CalibrationReport,
  type CalibrationWriteContext,
  type ObservationRepository,
  type ReportRepository,
} from '../types.js';

export interface WeeklyReportGeneratorDeps {
  readonly observations: ObservationRepository;
  readonly reports: ReportRepository;
  readonly audit: AuditChainPort;
}

export interface WeeklyReportGenerateInput {
  readonly prediction_kind: string;
  readonly period_days?: number;
  readonly bin_count?: number;
}

export type WeeklyReportGenerateFn = (
  ctx: CalibrationWriteContext,
  input: WeeklyReportGenerateInput,
) => Promise<CalibrationReport | null>;

export function createWeeklyReportGenerator(
  deps: WeeklyReportGeneratorDeps,
): WeeklyReportGenerateFn {
  return async (ctx, input) => {
    if (!ctx.tenant_id) {
      throw new CalibrationMonitorError(
        'tenant_id required',
        'MISSING_TENANT',
      );
    }
    if (!input.prediction_kind) {
      throw new CalibrationMonitorError(
        'prediction_kind required',
        'INVALID_INPUT',
      );
    }

    const periodDays = input.period_days ?? REPORT_PERIOD_DAYS;
    if (!Number.isInteger(periodDays) || periodDays < 1) {
      throw new CalibrationMonitorError(
        `period_days must be positive integer, got ${periodDays}`,
        'INVALID_INPUT',
      );
    }

    const now = ctx.now();
    const periodEnd = new Date(now.getTime());
    const periodStart = new Date(
      periodEnd.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );

    const resolved = await deps.observations.findResolvedInWindow(
      ctx.tenant_id,
      input.prediction_kind,
      periodStart.toISOString(),
      periodEnd.toISOString(),
    );

    if (resolved.length === 0) {
      return null;
    }

    const points: ReadonlyArray<CalibrationPoint> = resolved
      .filter(
        (
          r,
        ): r is CalibrationObservation & {
          outcome_value: 0 | 1;
        } => r.outcome_value !== null,
      )
      .map((r) => ({
        predicted_confidence: r.predicted_confidence,
        outcome_value: r.outcome_value,
      }));

    if (points.length === 0) {
      return null;
    }

    const brierScore = computeMeanBrierScore(points);
    const diagramOpts: ReliabilityDiagramOptions =
      input.bin_count !== undefined ? { bin_count: input.bin_count } : {};
    const diagram = computeReliabilityDiagram(points, diagramOpts);
    const ece = eceFromDiagram(diagram, points.length);

    const id = generateId('rep');
    const auditHash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'calibration.report.emit',
      entity_id: input.prediction_kind,
      recorded_at: now.toISOString(),
      payload_digest: `${brierScore.toFixed(6)}|${ece.toFixed(6)}|${points.length}`,
    });

    const report: CalibrationReport = {
      id,
      tenant_id: ctx.tenant_id,
      prediction_kind: input.prediction_kind,
      report_period_start: periodStart.toISOString(),
      report_period_end: periodEnd.toISOString(),
      sample_size: points.length,
      brier_score: brierScore,
      ece,
      reliability_diagram: diagram,
      generated_at: now.toISOString(),
      audit_hash: auditHash,
    };

    await deps.reports.insert(report);
    return report;
  };
}

function generateId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  const t = Date.now().toString(16);
  return `${prefix}-${t}-${rnd}`;
}
