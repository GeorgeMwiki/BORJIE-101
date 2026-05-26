/**
 * Curator — filter and dedupe scored traces into training examples.
 *
 * Each (trace, reward-shape) tuple becomes a `CuratedExample` whose
 * `included` flag tells the runner whether the example should ship.
 * Dropped examples persist with an `exclusionReason` for audit.
 *
 * Exclusion priorities (first match wins):
 *
 *   1. `synthetic_in_production` — `metadata.synthetic === true` and
 *      run kind is not `synthetic_test`.
 *   2. `tier_2_critical_no_founder` — mutation tier is T2-Critical
 *      without `founder` in the approver list.
 *   3. `any_fail` (only when `includeFailures === false`) — at least
 *      one verifier emitted `fail`.
 *   4. `no_passing_verifier` — all verifiers were `skip`.
 *   5. `reward_below_floor` — aggregate reward < `rewardFloor`.
 *   6. `duplicate_prompt` — same canonical prompt as a previously
 *      included example (only when `dedupe === true`).
 */

import { createHash } from 'node:crypto';
import type {
  CuratedExample,
  CuratorConfig,
  ExclusionReason,
  RewardShape,
  RlvrRunKind,
  RlvrTrace,
} from '../types.js';

export interface CurateInput {
  readonly runId: string;
  readonly runKind: RlvrRunKind;
  readonly entries: ReadonlyArray<{
    readonly trace: RlvrTrace;
    readonly reward: RewardShape;
  }>;
  readonly config: CuratorConfig;
  readonly idGen: () => string;
  readonly clock: () => Date;
}

function canonicalHash(value: unknown): string {
  const stable = JSON.stringify(value, Object.keys(value ?? {}).sort());
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}

function decideExclusion(
  entry: { trace: RlvrTrace; reward: RewardShape },
  runKind: RlvrRunKind,
  config: CuratorConfig,
  seenPromptHashes: Set<string>,
): ExclusionReason | null {
  const meta = entry.trace.metadata as Record<string, unknown>;

  if (meta['synthetic'] === true && runKind !== 'synthetic_test') {
    return 'synthetic_in_production';
  }

  const mutation = meta['mutation'];
  if (typeof mutation === 'object' && mutation !== null) {
    const m = mutation as Record<string, unknown>;
    const approvers = Array.isArray(m['approvers']) ? m['approvers'] : [];
    if (
      m['required_tier'] === 't2_critical' &&
      !approvers.includes('founder')
    ) {
      return 'tier_2_critical_no_founder';
    }
  }

  if (!config.includeFailures && entry.reward.anyFail) {
    return 'any_fail';
  }

  const hasNonSkip = entry.reward.perVerifier.some(
    (r) => r.verdict !== 'skip',
  );
  if (!hasNonSkip) {
    return 'no_passing_verifier';
  }

  if (entry.reward.aggregate < config.rewardFloor) {
    return 'reward_below_floor';
  }

  if (config.dedupe) {
    const hash = canonicalHash(entry.trace.prompt);
    if (seenPromptHashes.has(hash)) {
      return 'duplicate_prompt';
    }
  }

  return null;
}

export function curate(
  input: CurateInput,
): ReadonlyArray<CuratedExample> {
  const seenPromptHashes = new Set<string>();
  const out: CuratedExample[] = [];

  for (const entry of input.entries) {
    const exclusion = decideExclusion(
      entry,
      input.runKind,
      input.config,
      seenPromptHashes,
    );
    const included = exclusion === null;
    if (included && input.config.dedupe) {
      seenPromptHashes.add(canonicalHash(entry.trace.prompt));
    }
    out.push(
      Object.freeze({
        id: input.idGen(),
        runId: input.runId,
        traceId: entry.trace.id,
        tenantId: entry.trace.tenantId,
        prompt: Object.freeze({ text: entry.trace.prompt }),
        completion: Object.freeze({ text: entry.trace.completion }),
        reward: entry.reward.aggregate,
        included,
        exclusionReason: exclusion,
        curatedAt: input.clock().toISOString(),
        auditHash: canonicalHash({
          traceId: entry.trace.id,
          reward: entry.reward.aggregate,
          included,
          exclusion,
        }),
      }),
    );
  }

  return Object.freeze(out);
}
