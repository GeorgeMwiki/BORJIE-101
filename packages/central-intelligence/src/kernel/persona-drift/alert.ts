/**
 * Persona-drift alert emitter.
 *
 * Bridges the 24-dim persona-vector probe (`vectors.ts`) to the
 * existing `PersonaDriftSink` (`kernel-types.ts:331-333`). When a
 * probe breaches the per-dim or aggregate-L2 threshold, this module
 * shapes a `PersonaDriftEvent` and posts it to the sink.
 *
 * Mirrors LITFIN's `src/core/governance/persona-drift/alert.ts`:
 *
 *   - default per-dim threshold = 0.15
 *   - aggregate-L2 threshold     = threshold / 2  (= 0.075)
 *   - severity ladder: low (worst-dim < 0.25), medium (< 0.45),
 *     high (≥ 0.45)
 *
 * No cron is wired in this slice; the deploy follow-up will add an
 * hourly probe against the recent-output reservoir.
 */

import type {
  PersonaDriftEvent,
  PersonaDriftSink,
} from '../kernel-types.js';
import type { PersonaVector, PersonaVectorDim } from './vectors.js';
import {
  aggregateL2,
  BORJIE_REFERENCE_PERSONA,
  perDimDrift,
  worstDim,
} from './vectors.js';

export const DEFAULT_PER_DIM_THRESHOLD = 0.15;
export const DEFAULT_AGGREGATE_THRESHOLD = DEFAULT_PER_DIM_THRESHOLD / 2;

export interface DriftAlertVerdict {
  readonly breached: boolean;
  readonly worstDim: PersonaVectorDim;
  readonly worstDimDrift: number;
  readonly aggregateDrift: number;
  readonly severity: PersonaDriftEvent['severity'];
  readonly reasons: ReadonlyArray<string>;
}

export interface AssessDriftInput {
  readonly sample: PersonaVector;
  readonly reference?: PersonaVector;
  readonly perDimThreshold?: number;
  readonly aggregateThreshold?: number;
}

/**
 * Pure verdict — does not emit. Caller decides whether to record.
 */
export function assessPersonaDrift(input: AssessDriftInput): DriftAlertVerdict {
  const reference = input.reference ?? BORJIE_REFERENCE_PERSONA;
  const perDimThreshold = input.perDimThreshold ?? DEFAULT_PER_DIM_THRESHOLD;
  const aggregateThreshold = input.aggregateThreshold ?? DEFAULT_AGGREGATE_THRESHOLD;

  const drift = perDimDrift(input.sample, reference);
  const worst = worstDim(drift);
  const agg = aggregateL2(input.sample, reference);

  const reasons: string[] = [];
  if (worst.value >= perDimThreshold) {
    reasons.push(
      `dim ${worst.dim} drifted by ${worst.value.toFixed(3)} (threshold ${perDimThreshold})`,
    );
  }
  if (agg >= aggregateThreshold) {
    reasons.push(
      `aggregate L2 drift ${agg.toFixed(3)} ≥ ${aggregateThreshold}`,
    );
  }

  const breached = reasons.length > 0;
  const severity: PersonaDriftEvent['severity'] =
    worst.value >= 0.45 ? 'high' : worst.value >= 0.25 ? 'medium' : 'low';

  return {
    breached,
    worstDim: worst.dim,
    worstDimDrift: worst.value,
    aggregateDrift: agg,
    severity,
    reasons,
  };
}

export interface EmitDriftEventInput extends AssessDriftInput {
  readonly thoughtId: string;
  readonly personaId: string;
  readonly capturedAt: string;
  readonly sink: PersonaDriftSink;
}

/**
 * Assess + emit. Returns the verdict (whether emitted or not) so the
 * kernel can fold the result into its provenance record.
 */
export async function emitPersonaDriftIfBreached(
  input: EmitDriftEventInput,
): Promise<DriftAlertVerdict> {
  const verdict = assessPersonaDrift(input);
  if (!verdict.breached) return verdict;

  const event: PersonaDriftEvent = {
    thoughtId: input.thoughtId,
    personaId: input.personaId,
    violationType: 'tone',
    excerpt: `persona-vector drift: ${verdict.reasons.join('; ')}`,
    severity: verdict.severity,
    detectedAt: input.capturedAt,
  };

  await input.sink.record(event);
  return verdict;
}
