/**
 * Piece O — Personalization engine.
 *
 * Computes the section ordering for a (user, module) pair when a tab
 * spawns. Inputs:
 *   * mastery level (0-100) — controls progressive disclosure
 *   * recent actions — pin recent section ids to the top
 *   * frustration (0-1) — when high, hide advanced sections to reduce
 *     overload; when low, keep the full surface
 *
 * Algorithm — mirrors the spirit of
 * `packages/dynamic-sections/src/lib/adaptive-layout/engine.ts` but
 * stays in this package (it doesn't import React or any UI dependency).
 *
 * Steps:
 *   1. Start with the base section ordering for the module (the
 *      "default layout" computed by the registry upstream).
 *   2. Subtract `forceHidden` from layout_overrides + module-specific
 *      mastery-gated sections (advanced ones for novices, beginner ones
 *      for experts).
 *   3. Apply layout overrides:
 *        * 'visibility' overrides hide/unhide
 *        * 'position'   overrides pin sections to the front
 *        * 'props'      overrides accumulate into custom_props_jsonb
 *   4. Compute a recency boost: each section id present in
 *      `recentActionSectionIds` gets a boost = recencyBoost / position
 *      (most-recent first).
 *   5. Frustration nudge: if frustration >= threshold, hide all
 *      'advanced' sections (those tagged via `advancedSectionIds`) to
 *      simplify the surface.
 *   6. Stable-sort + emit `PersonalizationDecision`.
 *
 * Output is a `PersonalizationDecision` that the caller persists to
 * `tab_personalization` (0263).
 */

import type {
  DensityPreference,
  LayoutOverrideRow,
  PersonalizationDecision,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Inputs.
// ─────────────────────────────────────────────────────────────────────────

export interface PersonalizationInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly moduleId: string | null;
  /** Base section ordering for the module (registry default). */
  readonly baseSectionIds: readonly string[];
  /** Mastery tier — 0-100. Default 0 = novice. */
  readonly masteryLevel: number;
  /**
   * Section ids tagged "advanced" — collapsed for novices, surfaced
   * for experts. Empty array = no progressive disclosure.
   */
  readonly advancedSectionIds: readonly string[];
  /**
   * Section ids tagged "beginner" — pinned to the top for novices,
   * suppressed for experts (they already know).
   */
  readonly beginnerSectionIds: readonly string[];
  /**
   * Recent actions (section ids), most-recent-first. The recency
   * policy pins the head of this array.
   */
  readonly recentActionSectionIds: readonly string[];
  /** Frustration 0-1. Optional. */
  readonly frustration?: number;
  /** Layout overrides scoped to this tenant + section. */
  readonly overrides: readonly LayoutOverrideRow[];
  /** Per-user density preference if already set. Default 'comfortable'. */
  readonly densityPreference?: DensityPreference;
}

/**
 * Tunable thresholds — exported so the cron can override per-tenant.
 */
export interface PersonalizationOptions {
  /** Mastery cutoff below which advanced sections are hidden. Default 31. */
  readonly noviceMaxMastery: number;
  /** Mastery cutoff at or above which beginner sections are hidden. Default 71. */
  readonly expertMinMastery: number;
  /** Frustration >= this hides advanced sections. Default 0.6. */
  readonly frustrationHideThreshold: number;
  /** Recency boost scalar. Default 100 (much larger than typical priority). */
  readonly recencyBoost: number;
}

export const DEFAULT_PERSONALIZATION_OPTIONS: PersonalizationOptions =
  Object.freeze({
    noviceMaxMastery: 31,
    expertMinMastery: 71,
    frustrationHideThreshold: 0.6,
    recencyBoost: 100,
  });

// ─────────────────────────────────────────────────────────────────────────
// Engine.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compute a personalisation decision. Pure.
 *
 * Determinism: input arrays are read positionally; map iteration is
 * keyed by `baseSectionIds` order, never raw object keys. Same input
 * triple yields the same decision.
 */
export function decidePersonalization(
  input: PersonalizationInput,
  options: PersonalizationOptions = DEFAULT_PERSONALIZATION_OPTIONS,
): PersonalizationDecision {
  // 1. Defensive copy + dedupe.
  const base = dedupe(input.baseSectionIds);
  const mastery = clamp(input.masteryLevel, 0, 100);
  const frustration =
    typeof input.frustration === 'number'
      ? clamp(input.frustration, 0, 1)
      : 0;

  const hiddenSet = new Set<string>();
  const score = new Map<string, number>();
  base.forEach((id, idx) => score.set(id, base.length - idx)); // base order

  // 2. Mastery-gated sections.
  if (mastery < options.noviceMaxMastery) {
    // Novice — hide advanced.
    for (const id of input.advancedSectionIds) hiddenSet.add(id);
  } else if (mastery >= options.expertMinMastery) {
    // Expert — hide beginner-only sections (they're noise).
    for (const id of input.beginnerSectionIds) hiddenSet.add(id);
  }

  // 3. Frustration nudge — also hide advanced.
  if (frustration >= options.frustrationHideThreshold) {
    for (const id of input.advancedSectionIds) hiddenSet.add(id);
  }

  // 4. Layout overrides — process by priority ASC so high-priority
  //    overrides write LAST and therefore win (last-writer-wins on the
  //    same section + kind). Position/props are additive; visibility
  //    flips so the highest-priority visibility row decides.
  const sortedOverrides = [...input.overrides].sort(
    (a, b) => a.priority - b.priority,
  );
  const customProps: Record<string, Record<string, unknown>> = {};
  for (const ov of sortedOverrides) {
    if (!base.includes(ov.sectionId)) continue;
    switch (ov.overrideKind) {
      case 'visibility': {
        const hide = ov.override['hidden'];
        if (typeof hide === 'boolean') {
          if (hide) hiddenSet.add(ov.sectionId);
          else hiddenSet.delete(ov.sectionId);
        }
        break;
      }
      case 'position': {
        const pinned = ov.override['pinned'];
        const sortOffset = ov.override['sort_offset'];
        if (pinned === true) {
          // Pin: large positive boost capped above recency.
          score.set(
            ov.sectionId,
            (score.get(ov.sectionId) ?? 0) + 10_000 + ov.priority,
          );
        }
        if (typeof sortOffset === 'number' && Number.isFinite(sortOffset)) {
          score.set(
            ov.sectionId,
            (score.get(ov.sectionId) ?? 0) + sortOffset * ov.priority,
          );
        }
        break;
      }
      case 'props': {
        const props = ov.override['props'];
        if (props && typeof props === 'object' && !Array.isArray(props)) {
          const merged = { ...(customProps[ov.sectionId] ?? {}), ...props };
          customProps[ov.sectionId] = merged as Record<string, unknown>;
        }
        break;
      }
      default:
        break;
    }
  }

  // 5. Recency boost — process oldest first so head gets the biggest.
  const recency = input.recentActionSectionIds;
  if (recency.length > 0) {
    recency.forEach((id, idx) => {
      if (!base.includes(id)) return;
      const boost = options.recencyBoost / (idx + 1);
      score.set(id, (score.get(id) ?? 0) + boost);
    });
  }

  // 6. Build ordering — base order is the stable tiebreak.
  const baseIndex = new Map<string, number>();
  base.forEach((id, i) => baseIndex.set(id, i));
  const visible = base.filter((id) => !hiddenSet.has(id));
  visible.sort((a, b) => {
    const sa = score.get(a) ?? 0;
    const sb = score.get(b) ?? 0;
    if (sa !== sb) return sb - sa;
    return (baseIndex.get(a) ?? 0) - (baseIndex.get(b) ?? 0);
  });

  // 7. Rationale string for debug overlay.
  const rationaleParts: string[] = [];
  if (mastery < options.noviceMaxMastery) {
    rationaleParts.push(`novice(mastery=${mastery})`);
  } else if (mastery >= options.expertMinMastery) {
    rationaleParts.push(`expert(mastery=${mastery})`);
  } else {
    rationaleParts.push(`intermediate(mastery=${mastery})`);
  }
  if (frustration >= options.frustrationHideThreshold) {
    rationaleParts.push(`frustration=${frustration.toFixed(2)}`);
  }
  if (recency.length > 0) {
    rationaleParts.push(`recency=[${recency.slice(0, 3).join(',')}]`);
  }
  if (sortedOverrides.length > 0) {
    rationaleParts.push(`overrides=${sortedOverrides.length}`);
  }

  return Object.freeze({
    userId: input.userId,
    moduleId: input.moduleId,
    sectionOrder: Object.freeze(visible),
    hiddenSectionIds: Object.freeze(Array.from(hiddenSet).sort()),
    densityPreference: input.densityPreference ?? 'comfortable',
    masteryLevel: mastery,
    rationale: rationaleParts.length > 0 ? rationaleParts.join(' | ') : 'default',
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers.
// ─────────────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function dedupe(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
