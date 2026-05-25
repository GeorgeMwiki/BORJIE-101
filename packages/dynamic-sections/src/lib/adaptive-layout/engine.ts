/**
 * Adaptive layout engine — `decideLayout`.
 *
 * Pure function. Folds N weighted policies into a single, determinist
 * {@link LayoutDecision}. The merge strategy:
 *
 *   1. Run every policy once. Collect their {@link LayoutPreference}s.
 *   2. Aggregate `hide` sets. A section is hidden if ANY policy hides it.
 *   3. Aggregate `pin` orderings into a weighted score map:
 *        score[id] = Σ ( (pinIndex.totalPinned - position) * policy.weight )
 *      across every policy that pinned the id. The most-recent pin and
 *      the highest-weight policy both pull a section closer to the top.
 *   4. Per-id `boost` weights are added to the score (with policy weight).
 *   5. Build the final ordering by stable-sorting `baseSections`:
 *        a. Pinned ids (score > 0) come first, sorted by descending score,
 *           with the original input order as the tiebreak (stable).
 *        b. Hidden ids are removed.
 *        c. Non-pinned ids retain their input order.
 *
 * Determinism: every map iteration is keyed by `baseSections`, never
 * by Object.keys() ordering of the boost map directly. The sort is
 * the JS array sort which is stable as of ES2019 — for older runtimes
 * we'd reach for `array-stable-sort`, but the dynamic-sections package
 * targets modern Next.js runtimes only.
 *
 * Idempotency: `decideLayout(decideLayout(ctx, base, pols).sections,
 *   …)` returns the same `sections` for the same context (the engine
 * is stateless; running it twice on its own output is a no-op).
 */

import type {
  LayoutContext,
  LayoutDecision,
  LayoutPolicy,
  LayoutPreference,
  SectionId,
} from './types.js';

/**
 * Decide the layout for the given context.
 *
 * @param context       Per-render context (tenant, user, route, role, …)
 * @param baseSections  Section ids in their default (registry) order
 * @param policies      Ordered list of policies to apply. Order is
 *                      cosmetic — the engine respects per-policy
 *                      `weight` for conflict resolution — but is
 *                      preserved in the rationale string for debug.
 * @returns LayoutDecision with deterministic `sections` ordering.
 */
export function decideLayout(
  context: LayoutContext,
  baseSections: readonly SectionId[],
  policies: readonly LayoutPolicy[],
): LayoutDecision {
  // De-dupe baseSections defensively. The registry should never hand
  // us duplicates but a typo in seedRegistry would be load-bearing.
  const dedupedBase = dedupeStable(baseSections);

  if (policies.length === 0) {
    return {
      sections: dedupedBase,
      pinned: [],
      hidden: [],
      rationale: 'no-policies-applied',
    };
  }

  // 1. Collect preferences. Each policy runs ONCE per render.
  const preferences: ReadonlyArray<{
    readonly policyId: string;
    readonly pref: LayoutPreference;
  }> = policies.map((p) => ({ policyId: p.id, pref: p.decide(context, dedupedBase) }));

  // 2. Hidden = union of every policy's hide set, intersected with
  //    base (don't hide ids the registry never declared).
  const baseSet = new Set(dedupedBase);
  const hiddenSet = new Set<SectionId>();
  for (const { pref } of preferences) {
    for (const id of pref.hide) {
      if (baseSet.has(id)) hiddenSet.add(id);
    }
  }

  // 3. Score map. Higher = closer to top.
  const score = new Map<SectionId, number>();
  for (const id of dedupedBase) score.set(id, 0);

  for (const { pref } of preferences) {
    const w = Math.max(0, pref.weight);
    // Pin ordering — earlier-pinned ids get a bigger boost.
    const total = pref.pin.length;
    pref.pin.forEach((id, idx) => {
      if (!baseSet.has(id)) return;
      if (hiddenSet.has(id)) return;
      const positional = (total - idx) * w;
      score.set(id, (score.get(id) ?? 0) + positional);
    });
    // Explicit boost map.
    for (const [id, b] of Object.entries(pref.boost)) {
      if (!baseSet.has(id)) continue;
      if (hiddenSet.has(id)) continue;
      score.set(id, (score.get(id) ?? 0) + b * w);
    }
  }

  // 4. Pinned set = ids whose score > 0 AND not hidden.
  const pinned: SectionId[] = dedupedBase.filter(
    (id) => !hiddenSet.has(id) && (score.get(id) ?? 0) > 0,
  );
  // Sort pinned by descending score, with stable tiebreak on base index.
  const baseIndex = new Map<SectionId, number>();
  dedupedBase.forEach((id, i) => baseIndex.set(id, i));
  pinned.sort((a, b) => {
    const sa = score.get(a) ?? 0;
    const sb = score.get(b) ?? 0;
    if (sa !== sb) return sb - sa;
    return (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0);
  });

  // 5. Build final ordering: pinned (in pinned order), then the
  //    remaining base ids minus pinned minus hidden, in base order.
  const pinnedSet = new Set(pinned);
  const rest: SectionId[] = dedupedBase.filter(
    (id) => !pinnedSet.has(id) && !hiddenSet.has(id),
  );
  const sections: readonly SectionId[] = [...pinned, ...rest];

  // 6. Rationale — readable string for debug overlay + telemetry.
  const rationale = buildRationale(preferences, pinned, hiddenSet);

  return Object.freeze({
    sections,
    pinned,
    hidden: Array.from(hiddenSet),
    rationale,
  });
}

/**
 * Build a human-readable rationale string from the collected
 * preferences and the final pinned/hidden sets. Stable + PII-free.
 */
function buildRationale(
  preferences: ReadonlyArray<{ readonly policyId: string; readonly pref: LayoutPreference }>,
  pinned: readonly SectionId[],
  hiddenSet: ReadonlySet<SectionId>,
): string {
  const reasons = preferences
    .filter(({ pref }) => pref.reason && (pref.pin.length > 0 || pref.hide.length > 0 || Object.keys(pref.boost).length > 0))
    .map(({ policyId, pref }) => `${policyId}:${pref.reason}`);
  const parts: string[] = [];
  if (reasons.length > 0) parts.push(reasons.join(' | '));
  if (pinned.length > 0) parts.push(`pinned=[${pinned.join(',')}]`);
  if (hiddenSet.size > 0) parts.push(`hidden=[${Array.from(hiddenSet).join(',')}]`);
  if (parts.length === 0) return 'no-effective-policy';
  return parts.join(' :: ');
}

/**
 * Stable-dedupe — preserves first occurrence order.
 */
function dedupeStable(ids: readonly SectionId[]): readonly SectionId[] {
  const seen = new Set<SectionId>();
  const out: SectionId[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
