/**
 * Regulatory FieldSelector — adds fields the corpus says are required.
 *
 * Source of truth: spec §2 Layer 2, §7 anti-pattern #5
 * ("Propose a UI change without citing why").
 *
 * Every field this selector emits MUST carry a `required_because`
 * citation contract. That contract is the operator's only justification
 * surface — the renderer shows it on hover via the existing
 * `citationId`-aware tooltip in `PrefillForm` + `MultistepWizard` (see
 * §10).
 *
 * Inputs come from the static `RegulatoryRequirement` set passed to the
 * factory. Production callers will hydrate this from
 * `@borjie/compliance-pack`; the contract here is intentionally
 * narrow so the corpus library can evolve without bleeding into the
 * composer.
 */

import type {
  CitationContract,
  Field,
  FieldGroup,
  FieldKind,
  TabComposeContext,
} from '../types.js';

/**
 * RegulatoryRequirement — the corpus's promise about one field.
 *
 * The composer validates each requirement before emitting it:
 *   - `citation.citation_id` must resolve via `ctx.corpus.hasCitation`,
 *   - `group_id` must be one of the recipe's known groups (passed in
 *     via `RegulatoryGroupSpec.id`).
 */
export interface RegulatoryRequirement {
  readonly field_id: string;
  readonly group_id: string;
  readonly kind: FieldKind;
  readonly label_en: string;
  readonly label_sw: string;
  readonly help_en: string;
  readonly help_sw: string;
  readonly citation: CitationContract;
  readonly validate?: Field['validate'];
}

/** RegulatoryGroupSpec — the bilingual title for each group. */
export interface RegulatoryGroupSpec {
  readonly id: string;
  readonly title_en: string;
  readonly title_sw: string;
}

export interface RegulatoryFieldSelectorOptions {
  readonly groups: ReadonlyArray<RegulatoryGroupSpec>;
  readonly requirements: ReadonlyArray<RegulatoryRequirement>;
}

/**
 * Factory — closes over the requirement set and returns a
 * FieldSelector compatible with `composer.ts`.
 */
export function regulatoryFields(
  options: RegulatoryFieldSelectorOptions,
): (ctx: TabComposeContext) => Promise<ReadonlyArray<FieldGroup>> {
  if (options.groups.length === 0) {
    throw new Error(
      'regulatoryFields: at least one group spec is required',
    );
  }
  if (options.requirements.length === 0) {
    throw new Error(
      'regulatoryFields: at least one requirement is required',
    );
  }
  return async (ctx: TabComposeContext): Promise<ReadonlyArray<FieldGroup>> => {
    const validatedRequirements: RegulatoryRequirement[] = [];
    for (const req of options.requirements) {
      const exists = await ctx.corpus.hasCitation(req.citation.citation_id);
      if (exists) {
        validatedRequirements.push(req);
      }
    }
    const groups: FieldGroup[] = [];
    for (const groupSpec of options.groups) {
      const fields: Field[] = validatedRequirements
        .filter((r) => r.group_id === groupSpec.id)
        .map((r) => {
          const base: Field = {
            id: r.field_id,
            kind: r.kind,
            label_en: r.label_en,
            label_sw: r.label_sw,
            required: true,
            required_because: r.citation,
            help_en: r.help_en,
            help_sw: r.help_sw,
            ...(r.validate ? { validate: r.validate } : {}),
          };
          return base;
        });
      if (fields.length > 0) {
        groups.push({
          id: groupSpec.id,
          title_en: groupSpec.title_en,
          title_sw: groupSpec.title_sw,
          fields,
        });
      }
    }
    return groups;
  };
}
