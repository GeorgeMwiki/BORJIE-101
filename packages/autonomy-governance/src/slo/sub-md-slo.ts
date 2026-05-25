/**
 * Sub-MD SLO — Zod-validated factory + helpers.
 *
 * Each (subMd, metric) pair carries a target + breachAction + canary
 * stage. Lower-is-better metrics (`cost-per-resolution`) flip the sign of
 * the delta.
 */

import { z } from 'zod';
import type {
  BreachAction,
  CanaryStage,
  SloMetric,
  SloWindow,
  SubMdSlo,
} from '../types.js';

const SLO_METRICS = [
  'resolution-quality',
  'task-completion-rate',
  'owner-cs-score',
  'cost-per-resolution',
] as const satisfies readonly SloMetric[];

const SLO_WINDOWS = [
  'rolling-24h',
  'rolling-7d',
  'rolling-30d',
] as const satisfies readonly SloWindow[];

const BREACH_ACTIONS = [
  'warn',
  'reduce-traffic',
  'handoff',
  'kill-and-rollback',
] as const satisfies readonly BreachAction[];

const CANARY_STAGES = [
  'shadow',
  'canary-1pct',
  'canary-5pct',
  'canary-25pct',
  'live',
] as const satisfies readonly CanaryStage[];

export const subMdSloSchema = z.object({
  subMd: z.string().min(1),
  tenantId: z.string().uuid().nullable(),
  metric: z.enum(SLO_METRICS),
  target: z.number().min(0),
  window: z.enum(SLO_WINDOWS),
  breachAction: z.enum(BREACH_ACTIONS),
  canaryStage: z.enum(CANARY_STAGES).default('shadow'),
});

export type SubMdSloInput = z.input<typeof subMdSloSchema>;

export function parseSubMdSlo(input: SubMdSloInput): SubMdSlo {
  const parsed = subMdSloSchema.parse(input);
  return Object.freeze({ ...parsed });
}

/**
 * Lower-is-better metrics — for these, the breach condition is
 * `actualValue > target`, not `actualValue < target`.
 */
const LOWER_IS_BETTER: ReadonlySet<SloMetric> = new Set([
  'cost-per-resolution',
]);

export function isLowerBetterMetric(metric: SloMetric): boolean {
  return LOWER_IS_BETTER.has(metric);
}

/**
 * Compute the signed delta of an actual value against the SLO target.
 * For "higher is better" metrics: delta = actual - target (negative = bad).
 * For "lower is better" metrics: delta = target - actual (negative = bad).
 *
 * This means `delta < 0` always signals "worse than target" regardless of
 * metric direction — the SLO monitor only ever has to inspect the sign.
 */
export function computeDelta(
  metric: SloMetric,
  actual: number,
  target: number,
): number {
  return isLowerBetterMetric(metric) ? target - actual : actual - target;
}
