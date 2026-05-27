/**
 * Intel-trace curator — shapes resolved intel invocations into the
 * { prompt, completion, reward } training examples the meta-learning
 * conductor + RLVR runner already consume for `research_v1` and
 * `compose_anything_v1`.
 *
 * Spec §4 of Docs/DESIGN/INTELLIGENCE_SELF_IMPROVE_WIRING_2026.md.
 *
 * Inputs : a list of `IntelInvocationAuditRow` whose `observed_outcome`
 *          column is filled (i.e. the outcome-observer has resolved
 *          them).
 * Output : `IntelTrainingPair[]` — a deterministic, audit-hash-stable
 *          projection that the existing curator (`@borjie/post-
 *          training-rlvr`) can fold into its dedup / redact / exclude
 *          pipeline.
 *
 * Reward shape:
 *
 *   confirmed     ⇒ 1
 *   partial       ⇒ 0.5
 *   disconfirmed  ⇒ 0
 *   unknown       ⇒ pair is excluded ('observation_unknown')
 *
 *   AND a utility kicker:
 *     accepted / modified  ⇒ × 1.0
 *     rejected / ignored   ⇒ × 0.5
 *
 * The output reward is clamped to `[0, 1]`. The training pair
 * preserves the canonical input / output projections so the curator
 * can dedup deterministically.
 *
 * @module @borjie/intel-self-improve/curate/intel-trace-curator
 */

import type { IntelInvocationAuditRow } from '../repositories/intel-invocation-audit-repository.js';
import type { IntelKind } from '../types.js';

export interface IntelTrainingPair {
  readonly invocationId: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  readonly intelKind: IntelKind;
  readonly prompt: Readonly<Record<string, unknown>>;
  readonly completion: Readonly<Record<string, unknown>>;
  readonly reward: number;
  readonly included: boolean;
  readonly exclusionReason: string | null;
}

export interface IntelCuratorConfig {
  /** Pairs with `reward < floor` are emitted with `included = false`. */
  readonly rewardFloor: number;
  /** Include pairs whose observation is `unknown`. Defaults to false. */
  readonly includeUnknown: boolean;
}

export const DEFAULT_INTEL_CURATOR_CONFIG: IntelCuratorConfig = Object.freeze({
  rewardFloor: 0.5,
  includeUnknown: false,
});

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function baseReward(observedOutcome: string | null): number {
  switch (observedOutcome) {
    case 'confirmed':
      return 1;
    case 'partial':
      return 0.5;
    case 'disconfirmed':
      return 0;
    default:
      return 0;
  }
}

function utilityKicker(followthrough: string | null): number {
  if (followthrough === 'accepted' || followthrough === 'modified') return 1;
  return 0.5;
}

/**
 * Shape one row into a training pair. Pure — does not mutate the row.
 */
export function shapeIntelTrainingPair(
  row: IntelInvocationAuditRow,
  config: IntelCuratorConfig = DEFAULT_INTEL_CURATOR_CONFIG,
): IntelTrainingPair {
  const unknown = row.observedOutcome === 'unknown' || row.observedOutcome === null;
  if (unknown && !config.includeUnknown) {
    return Object.freeze({
      invocationId: row.id,
      tenantId: row.tenantId,
      capabilityId: row.capabilityId,
      intelKind: row.intelKind,
      prompt: row.inputPayload,
      completion: row.outputPayload,
      reward: 0,
      included: false,
      exclusionReason: 'observation_unknown',
    });
  }
  const reward = clamp01(
    baseReward(row.observedOutcome) * utilityKicker(row.userFollowthrough),
  );
  const included = reward >= config.rewardFloor;
  return Object.freeze({
    invocationId: row.id,
    tenantId: row.tenantId,
    capabilityId: row.capabilityId,
    intelKind: row.intelKind,
    prompt: row.inputPayload,
    completion: row.outputPayload,
    reward,
    included,
    exclusionReason: included ? null : 'reward_below_floor',
  });
}

/**
 * Shape a batch deterministically. Order-preserving and audit-stable.
 */
export function curateIntelTrainingPairs(
  rows: ReadonlyArray<IntelInvocationAuditRow>,
  config: IntelCuratorConfig = DEFAULT_INTEL_CURATOR_CONFIG,
): ReadonlyArray<IntelTrainingPair> {
  const out: Array<IntelTrainingPair> = [];
  for (const row of rows) {
    out.push(shapeIntelTrainingPair(row, config));
  }
  return Object.freeze(out);
}
