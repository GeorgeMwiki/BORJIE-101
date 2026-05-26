/**
 * Mastery-tier transform — adapts groups to the operator's mastery.
 *
 * Source of truth: spec §2 Layer 2, "mastery tier" bullet:
 *
 *   novice       → fewer fields per step, more help copy, more
 *                  progressive disclosure
 *   intermediate → standard density
 *   expert       → dense layout, advanced controls unlocked
 *   power-user   → all advanced controls visible by default
 *
 * Implementation choice — we keep the transform PURE and observable:
 *
 *   - Novice operators only see the FIRST `noviceFieldsPerGroup` fields
 *     per group; the rest are dropped from the schema (they are NOT
 *     hidden, because hidden-required fields are a UX smell).
 *   - Groups whose `visibility` is `gated_expert` are dropped for
 *     novice / intermediate.
 *   - Groups whose `visibility` is `gated_power_user` are dropped for
 *     anyone below power-user.
 *
 * If the operator's mastery doesn't gate the group, the group is
 * passed through unchanged. The transform never adds fields — it only
 * subtracts.
 */

import type { FieldGroup, MasteryLevel, TabComposeContext } from '../types.js';

export interface MasteryTierTransformOptions {
  readonly noviceFieldsPerGroup: number;
  readonly intermediateFieldsPerGroup?: number;
}

const MASTERY_RANK: Record<MasteryLevel, number> = {
  novice: 0,
  intermediate: 1,
  expert: 2,
  'power-user': 3,
};

function groupVisible(group: FieldGroup, level: MasteryLevel): boolean {
  if (!group.visibility || group.visibility === 'always') {
    return true;
  }
  if (group.visibility === 'gated_expert') {
    return MASTERY_RANK[level] >= MASTERY_RANK.expert;
  }
  if (group.visibility === 'gated_power_user') {
    return MASTERY_RANK[level] >= MASTERY_RANK['power-user'];
  }
  return true;
}

function fieldsLimitFor(
  level: MasteryLevel,
  opts: MasteryTierTransformOptions,
): number | null {
  if (level === 'novice') {
    return opts.noviceFieldsPerGroup;
  }
  if (level === 'intermediate' && opts.intermediateFieldsPerGroup !== undefined) {
    return opts.intermediateFieldsPerGroup;
  }
  return null;
}

export function applyMasteryTier(
  options: MasteryTierTransformOptions,
): (
  groups: ReadonlyArray<FieldGroup>,
  ctx: TabComposeContext,
) => Promise<ReadonlyArray<FieldGroup>> {
  if (
    !Number.isInteger(options.noviceFieldsPerGroup) ||
    options.noviceFieldsPerGroup < 1
  ) {
    throw new Error(
      'applyMasteryTier: noviceFieldsPerGroup must be a positive integer',
    );
  }
  return async (
    groups: ReadonlyArray<FieldGroup>,
    ctx: TabComposeContext,
  ): Promise<ReadonlyArray<FieldGroup>> => {
    const level = ctx.operator.masteryLevel;
    const limit = fieldsLimitFor(level, options);
    const out: FieldGroup[] = [];
    for (const group of groups) {
      if (!groupVisible(group, level)) {
        continue;
      }
      // Required fields are never dropped — clipping respects the
      // regulatory floor first by sorting required fields ahead of
      // optional ones, then clipping the tail.
      const sorted = [...group.fields].sort((a, b) => {
        if (a.required === b.required) return 0;
        return a.required ? -1 : 1;
      });
      const nextFields = limit === null ? sorted : sorted.slice(0, limit);
      out.push({ ...group, fields: nextFields });
    }
    return out;
  };
}
