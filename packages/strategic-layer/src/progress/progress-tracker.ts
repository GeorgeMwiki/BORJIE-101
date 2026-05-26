/**
 * `ProgressTracker` — observation log + velocity + drift signal.
 *
 * Spec: STRATEGIC_DIRECTION_LAYER_SPEC.md §15.2–§15.3.
 *
 * - `observe(input)` appends one row to `objective_progress`.
 * - `percentComplete(objective)` returns `latest / target` clipped to
 *   `[0, +∞)` (over-achievement is reportable but capped at 1.0 for
 *   the drift signal).
 * - `velocity(objective, windowDays)` returns the average daily delta
 *   in `observed_value` over the trailing window.
 * - `driftSignal(objective)` returns `'on_track' | 'at_risk' |
 *   'off_track'` per the SRE burn-rate analogue.
 */

import { randomUUID } from 'node:crypto';
import {
  type DriftSignal,
  type NorthStar,
  type ObjectiveProgress,
  type ObjectiveProgressRepository,
  type ObserveProgressInput,
  STRATEGIC_CONSTANTS,
} from '../types.js';
import { computeStrategicAuditHash } from '../audit/audit-chain-link.js';

export interface ProgressTrackerDeps {
  readonly repo: ObjectiveProgressRepository;
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export interface ProgressTracker {
  observe(input: ObserveProgressInput): Promise<ObjectiveProgress>;
  percentComplete(
    tenantId: string,
    objective: NorthStar,
  ): Promise<number>;
  velocity(
    tenantId: string,
    objective: NorthStar,
    windowDays: number,
  ): Promise<number>;
  driftSignal(
    tenantId: string,
    objective: NorthStar,
  ): Promise<DriftSignal>;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function createProgressTracker(
  deps: ProgressTrackerDeps,
): ProgressTracker {
  const { repo, now } = deps;

  return {
    async observe(input: ObserveProgressInput): Promise<ObjectiveProgress> {
      const id = randomUUID();
      const recordedAt = now().toISOString();
      const evidence: Readonly<Record<string, unknown>> =
        input.evidence ?? {};
      const auditHash = computeStrategicAuditHash({
        op: 'observe',
        id,
        tenantId: input.tenantId,
        objectiveId: input.objectiveId,
        observedValue: input.observedValue,
        at: recordedAt,
      });
      const row: ObjectiveProgress = Object.freeze({
        id,
        objectiveId: input.objectiveId,
        tenantId: input.tenantId,
        recordedAt,
        observedValue: input.observedValue,
        evidence,
        auditHash,
      });
      return repo.insert(row);
    },

    async percentComplete(
      tenantId: string,
      objective: NorthStar,
    ): Promise<number> {
      const latest = await repo.latest(tenantId, objective.id);
      if (latest === null) {
        return 0;
      }
      if (objective.targetValue === 0) {
        return latest.observedValue === 0 ? 1 : Number.POSITIVE_INFINITY;
      }
      return latest.observedValue / objective.targetValue;
    },

    async velocity(
      tenantId: string,
      objective: NorthStar,
      windowDays: number,
    ): Promise<number> {
      const rows = await repo.listForObjective(
        tenantId,
        objective.id,
        1000,
      );
      if (rows.length < 2) {
        return 0;
      }
      const cutoff = now().getTime() - windowDays * MS_PER_DAY;
      const inWindow = rows.filter(
        (r) => new Date(r.recordedAt).getTime() >= cutoff,
      );
      if (inWindow.length < 2) {
        // Fall back to full series if window is too narrow.
        return computeAverageDailyDelta(rows);
      }
      return computeAverageDailyDelta(inWindow);
    },

    async driftSignal(
      tenantId: string,
      objective: NorthStar,
    ): Promise<DriftSignal> {
      const latest = await repo.latest(tenantId, objective.id);
      if (latest === null) {
        return 'on_track';
      }
      const rows = await repo.listForObjective(
        tenantId,
        objective.id,
        1000,
      );
      const vel = rows.length >= 2 ? computeAverageDailyDelta(rows) : 0;
      const remaining = objective.targetValue - latest.observedValue;

      // Already at or past target — on track regardless of velocity.
      if (remaining <= 0) {
        return 'on_track';
      }

      // Velocity is non-positive while we need positive growth → off track.
      if (vel <= 0) {
        return 'off_track';
      }

      const daysNeeded = remaining / vel;
      const daysAvailable =
        (new Date(objective.targetAt).getTime() - now().getTime()) /
        MS_PER_DAY;

      if (daysAvailable <= 0) {
        // Past the deadline without meeting the target.
        return 'off_track';
      }

      if (daysNeeded <= daysAvailable) {
        return 'on_track';
      }
      if (daysNeeded <= daysAvailable * STRATEGIC_CONSTANTS.DRIFT_AT_RISK_FACTOR) {
        return 'at_risk';
      }
      return 'off_track';
    },
  };
}

function computeAverageDailyDelta(
  rows: ReadonlyArray<ObjectiveProgress>,
): number {
  if (rows.length < 2) {
    return 0;
  }
  // Sort ascending by recordedAt so the delta is monotonic in time.
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return 0;
  }
  const elapsedMs =
    new Date(last.recordedAt).getTime() -
    new Date(first.recordedAt).getTime();
  if (elapsedMs <= 0) {
    return 0;
  }
  const elapsedDays = elapsedMs / MS_PER_DAY;
  const valueDelta = last.observedValue - first.observedValue;
  return valueDelta / elapsedDays;
}
