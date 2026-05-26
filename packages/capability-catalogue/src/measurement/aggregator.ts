/**
 * Measurement aggregator — Wave CAPABILITY.
 *
 * Combines the three axes (competence, calibration, utility) over a
 * single (capability, window) slice into one `Measurement` row ready
 * for persistence. Pure function; no I/O.
 *
 * The function is *tolerant* to partial data: it returns `null` when
 * the window contains zero invocations, and uses neutral defaults
 * (`competence = 0`, `calibration_error = 0`, `utility_rate = 0`) when
 * the outcome stream is empty but invocations exist.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §5.4`.
 *
 * @module @borjie/capability-catalogue/measurement/aggregator
 */

import { randomUUID, createHash } from 'node:crypto';

import { computeCalibration } from './calibration.js';
import { computeCompetence } from './competence.js';
import { computeUtility } from './utility.js';
import {
  type Invocation,
  type Measurement,
  type MeasurementWindowDays,
  type Outcome,
} from '../types.js';

export interface AggregateInput {
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly windowDays: MeasurementWindowDays;
  readonly measuredAt: string;
  readonly invocations: ReadonlyArray<Invocation>;
  readonly outcomes: ReadonlyArray<Outcome>;
  readonly prevHash?: string | null;
}

function computeAuditHash(args: {
  readonly capabilityId: string;
  readonly windowDays: number;
  readonly measuredAt: string;
  readonly competenceRate: number;
  readonly calibrationError: number;
  readonly utilityRate: number;
  readonly prevHash: string;
}): string {
  const h = createHash('sha256');
  h.update(args.capabilityId);
  h.update('|');
  h.update(String(args.windowDays));
  h.update('|');
  h.update(args.measuredAt);
  h.update('|');
  h.update(args.competenceRate.toFixed(6));
  h.update('|');
  h.update(args.calibrationError.toFixed(6));
  h.update('|');
  h.update(args.utilityRate.toFixed(6));
  h.update('|');
  h.update(args.prevHash);
  return h.digest('hex');
}

/**
 * Aggregate a single window's measurements. Returns `null` when there
 * are no invocations at all in the window — that signals the worker
 * to skip persistence rather than insert a zero row.
 */
export function aggregateMeasurement(
  input: AggregateInput,
): Measurement | null {
  if (input.invocations.length === 0) return null;

  const outcomesById = new Map<string, Outcome>();
  for (const o of input.outcomes) outcomesById.set(o.invocationId, o);

  const competence = computeCompetence({
    invocations: input.invocations,
    outcomesByInvocationId: outcomesById,
  });

  const competenceRate = competence.rate;

  let calibrationError = 0;
  if (input.outcomes.length > 0) {
    try {
      const cal = computeCalibration({ outcomes: input.outcomes });
      calibrationError = cal.error;
    } catch {
      calibrationError = 0;
    }
  }

  let utilityRate = 0;
  if (input.outcomes.length > 0) {
    const util = computeUtility({ outcomes: input.outcomes });
    utilityRate = util.rate;
  }

  const auditHash = computeAuditHash({
    capabilityId: input.capabilityId,
    windowDays: input.windowDays,
    measuredAt: input.measuredAt,
    competenceRate,
    calibrationError,
    utilityRate,
    prevHash: input.prevHash ?? '',
  });

  return Object.freeze({
    id: randomUUID(),
    tenantId: input.tenantId,
    capabilityId: input.capabilityId,
    windowDays: input.windowDays,
    measuredAt: input.measuredAt,
    competenceRate,
    calibrationError,
    utilityRate,
    nObservations: input.invocations.length,
    auditHash,
  });
}
