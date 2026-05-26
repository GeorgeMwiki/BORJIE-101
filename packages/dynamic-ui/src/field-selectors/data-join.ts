/**
 * Data-join transform — pre-fills fields whose values already exist in
 * the operator's joined data.
 *
 * Source of truth: spec §2 Layer 2 ("Any pre-fillable value goes into
 * `values` so the operator never re-types data Mr. Mwikila already
 * knows") + §7 anti-pattern #2 ("Compose a form that asks for data
 * already in the corpus or joins").
 *
 * Contract:
 *
 *   - Read each field id against an explicit `field_id → join_key`
 *     mapping. We do NOT auto-derive the mapping (a misspelled field id
 *     would silently leak data otherwise).
 *   - If `ctx.joins.get(joinKey)` returns a value, attach it as
 *     `Field.prefill`.
 *   - We do NOT flip `required` to `false` for pre-filled fields — the
 *     operator can still see + edit the value. The renderer is the one
 *     that disables the input.
 */

import type { FieldGroup, TabComposeContext } from '../types.js';

export interface FieldPrefillRule {
  readonly field_id: string;
  readonly join_key: string;
}

export interface DataJoinTransformOptions {
  readonly rules: ReadonlyArray<FieldPrefillRule>;
}

export function applyDataJoins(
  options: DataJoinTransformOptions,
): (
  groups: ReadonlyArray<FieldGroup>,
  ctx: TabComposeContext,
) => Promise<ReadonlyArray<FieldGroup>> {
  const rulesByField = new Map(options.rules.map((r) => [r.field_id, r]));
  return async (
    groups: ReadonlyArray<FieldGroup>,
    ctx: TabComposeContext,
  ): Promise<ReadonlyArray<FieldGroup>> => {
    const out: FieldGroup[] = [];
    for (const group of groups) {
      const nextFields = await Promise.all(
        group.fields.map(async (field) => {
          const rule = rulesByField.get(field.id);
          if (!rule) {
            return field;
          }
          const value = await ctx.joins.get(rule.join_key);
          if (value === null || value === undefined) {
            return field;
          }
          return { ...field, prefill: value };
        }),
      );
      out.push({ ...group, fields: nextFields });
    }
    return out;
  };
}
