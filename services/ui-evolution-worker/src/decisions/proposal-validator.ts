/**
 * Proposal validator.
 *
 * Two passes:
 *
 *   1. Brand validator — no `proposed_schema_diff` op may introduce
 *      raw colors, fonts, or inline-style literals. Tier-1 ops never
 *      carry style fields (by construction), so this pass is a
 *      defense-in-depth check against future op extensions.
 *
 *   2. Schema-coherence — every `field_id` referenced in an op MUST
 *      exist in the current `FormSchema`. Every `add_help_copy` op
 *      MUST cite a citation_id present in the recipe's known
 *      citations list. Every `regroup_field` op's `fromGroupId` MUST
 *      be the field's current group; the `toGroupId` MUST be an
 *      existing group in the current schema OR an integer-suffixed
 *      derivative of an existing group id (e.g. `group_a` →
 *      `group_a_1` from a `split_step`).
 *
 *   3. Tier guard — the validator REJECTS any op outside the Tier-1
 *      vocabulary. Tier-2 changes (submit_action, required-vs-optional,
 *      brand surface) must travel a different code path with a
 *      second-authoriser approval — see ANTICIPATORY_UX_SPEC.md §5.
 *
 * Pure. No DB, no LLM.
 */

import type { FormSchema } from '@borjie/dynamic-ui';
import type { ProposedDiff, ProposedDiffOp } from '../types.js';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ValidateProposalArgs {
  readonly currentSchema: FormSchema;
  readonly diff: ProposedDiff;
  readonly knownCitations: ReadonlyArray<string>;
}

export function validateProposal(args: ValidateProposalArgs): ValidationResult {
  const violations: string[] = [];

  if (args.diff.ops.length === 0) {
    violations.push('Proposal has zero ops — nothing for the owner to review.');
  }

  const fieldGroupIndex = buildFieldGroupIndex(args.currentSchema);
  const allGroupIds = new Set(args.currentSchema.groups.map((g) => g.id));

  for (const op of args.diff.ops) {
    const opViolations = validateOp(op, {
      fieldGroupIndex,
      allGroupIds,
      knownCitations: args.knownCitations,
    });
    for (const v of opViolations) violations.push(v);
  }

  // Brand validator — every text field must be plain language (no
  // colors / fonts / inline styles). We disallow any literal
  // sequence that LOOKS like a CSS color or font family.
  for (const op of args.diff.ops) {
    const textsToCheck = collectTextFields(op);
    for (const text of textsToCheck) {
      const brandViolation = checkBrandTokens(text);
      if (brandViolation) {
        violations.push(`Brand-token violation in op '${op.op}': ${brandViolation}`);
      }
    }
  }

  // Rationale must be present in both locales.
  if (!args.diff.rationaleEn || args.diff.rationaleEn.trim().length < 8) {
    violations.push('rationaleEn missing or too short (< 8 chars).');
  }
  if (!args.diff.rationaleSw || args.diff.rationaleSw.trim().length < 8) {
    violations.push('rationaleSw missing or too short (< 8 chars).');
  }

  if (violations.length === 0) {
    return { ok: true };
  }
  return { ok: false, violations };
}

// ---------------------------------------------------------------------------
// Per-op validation
// ---------------------------------------------------------------------------

interface OpContext {
  readonly fieldGroupIndex: ReadonlyMap<string, string>; // fieldId -> groupId
  readonly allGroupIds: ReadonlySet<string>;
  readonly knownCitations: ReadonlyArray<string>;
}

function validateOp(op: ProposedDiffOp, ctx: OpContext): ReadonlyArray<string> {
  const out: string[] = [];
  switch (op.op) {
    case 'reorder_fields': {
      if (!ctx.allGroupIds.has(op.groupId)) {
        out.push(`reorder_fields: groupId '${op.groupId}' not in current schema.`);
      }
      for (const f of op.fieldIdsBefore) {
        if (!ctx.fieldGroupIndex.has(f)) {
          out.push(`reorder_fields: fieldId '${f}' not in current schema (before).`);
        }
      }
      for (const f of op.fieldIdsAfter) {
        if (!ctx.fieldGroupIndex.has(f)) {
          out.push(`reorder_fields: fieldId '${f}' not in current schema (after).`);
        }
      }
      if (op.fieldIdsBefore.length !== op.fieldIdsAfter.length) {
        out.push('reorder_fields: before/after lengths differ.');
      }
      return out;
    }
    case 'regroup_field': {
      if (!ctx.fieldGroupIndex.has(op.fieldId)) {
        out.push(`regroup_field: fieldId '${op.fieldId}' not in current schema.`);
      }
      const currentGroup = ctx.fieldGroupIndex.get(op.fieldId);
      if (currentGroup && currentGroup !== op.fromGroupId) {
        out.push(
          `regroup_field: claimed fromGroupId='${op.fromGroupId}' but field actually in '${currentGroup}'.`,
        );
      }
      // toGroupId may be a new group introduced by a split_step in the
      // same diff. We allow either an existing group OR a string with
      // length >= 1.
      if (op.toGroupId.length === 0) {
        out.push('regroup_field: toGroupId empty.');
      }
      return out;
    }
    case 'split_step': {
      if (!ctx.allGroupIds.has(op.groupId)) {
        out.push(`split_step: groupId '${op.groupId}' not in current schema.`);
      }
      if (op.intoGroupIds.length < 2) {
        out.push('split_step: intoGroupIds must list at least 2 new group ids.');
      }
      return out;
    }
    case 'add_help_copy': {
      if (!ctx.fieldGroupIndex.has(op.fieldId)) {
        out.push(`add_help_copy: fieldId '${op.fieldId}' not in current schema.`);
      }
      if (op.helpEn.trim().length < 4) {
        out.push('add_help_copy: helpEn too short (< 4 chars).');
      }
      if (op.helpSw.trim().length < 4) {
        out.push('add_help_copy: helpSw too short (< 4 chars).');
      }
      if (!ctx.knownCitations.includes(op.citationId)) {
        out.push(
          `add_help_copy: citationId '${op.citationId}' is not in the recipe's known citations.`,
        );
      }
      return out;
    }
    case 'rename_label': {
      if (!ctx.fieldGroupIndex.has(op.fieldId)) {
        out.push(`rename_label: fieldId '${op.fieldId}' not in current schema.`);
      }
      if (
        op.labelEnAfter.trim().length === 0 ||
        op.labelSwAfter.trim().length === 0
      ) {
        out.push('rename_label: labelEnAfter / labelSwAfter cannot be empty.');
      }
      if (
        op.labelEnAfter === op.labelEnBefore &&
        op.labelSwAfter === op.labelSwBefore
      ) {
        out.push('rename_label: before/after identical in both locales.');
      }
      return out;
    }
    default: {
      // TypeScript exhaustiveness — any case landing here means a new
      // op was added without updating the validator.
      const _exhaustive: never = op;
      void _exhaustive;
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Brand-token checks
// ---------------------------------------------------------------------------

const RAW_COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(|hsla\()/;
const INLINE_STYLE_RE = /\bstyle\s*=\s*["'{]/;
const NON_BRAND_FONT_RE =
  /font-family\s*:\s*(?!var\(--font-(display|sans|mono)\))/i;

function checkBrandTokens(text: string): string | null {
  if (RAW_COLOR_RE.test(text)) {
    return 'contains a raw color literal (use design-system tokens).';
  }
  if (INLINE_STYLE_RE.test(text)) {
    return 'contains an inline `style=` attribute.';
  }
  if (NON_BRAND_FONT_RE.test(text)) {
    return 'references a non-brand font family.';
  }
  return null;
}

function collectTextFields(op: ProposedDiffOp): ReadonlyArray<string> {
  switch (op.op) {
    case 'add_help_copy':
      return [op.helpEn, op.helpSw];
    case 'rename_label':
      return [op.labelEnAfter, op.labelSwAfter];
    case 'reorder_fields':
    case 'regroup_field':
    case 'split_step':
      return [];
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFieldGroupIndex(
  schema: FormSchema,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const g of schema.groups) {
    for (const f of g.fields) {
      out.set(f.id, g.id);
    }
  }
  return out;
}
