/**
 * proposal-validator — refuses malformed / off-brand / incoherent
 * proposals before they reach the owner approval queue.
 *
 * Two layers:
 *   1. brand-validator — checks `proposed_text` does not contain raw
 *      hex / rgb / inline-style hostility. Uses the spec's brand-lock
 *      lint rules; reproduced inline here so the worker does not take
 *      a runtime dependency on the still-building document-templates
 *      package's public exports.
 *   2. section-coherence — every edit must reference a section_path
 *      seen in the recipe's section library OR be an add_section. The
 *      caller threads the library; tests stub a small one.
 */

import type { ProposedDiff, SectionEdit } from '../types.js';

export interface ValidateProposalInput {
  readonly diff: ProposedDiff;
  readonly known_section_paths: ReadonlyArray<string>;
  readonly available_citation_refs: ReadonlyArray<string>;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// Brand-lint rules (mirror of document-templates/brand-lock).
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /#[0-9a-f]{3,8}\b/gi;
const RGB_COLOR_RE = /\brgba?\(\s*[\d.,\s]+\)/gi;
const HSL_COLOR_RE = /\bhsla?\(\s*[\d.,\s%]+\)/gi;
const INLINE_STYLE_RE = /\sstyle\s*=\s*["'][^"']*["']/gi;

/** Tiny palette mirror — full list lives in `packages/document-templates`. */
const ALLOWED_HEX = new Set<string>([
  '#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8',
  '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e',
  '#082f49', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1',
  '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b',
  '#0f172a', '#22c55e', '#16a34a', '#f59e0b', '#d97706',
  '#ef4444', '#dc2626', '#3b82f6', '#2563eb',
  '#1f3864', '#c45b12',
  '#000000', '#ffffff',
]);

export function lintProposalText(text: string): ReadonlyArray<string> {
  const violations: string[] = [];
  let m: RegExpExecArray | null;

  INLINE_STYLE_RE.lastIndex = 0;
  while ((m = INLINE_STYLE_RE.exec(text)) !== null) {
    violations.push(`inline_style:${m[0].trim().slice(0, 40)}`);
  }

  HEX_COLOR_RE.lastIndex = 0;
  while ((m = HEX_COLOR_RE.exec(text)) !== null) {
    if (!ALLOWED_HEX.has(m[0].toLowerCase())) {
      violations.push(`off_brand_hex:${m[0]}`);
    }
  }

  RGB_COLOR_RE.lastIndex = 0;
  while ((m = RGB_COLOR_RE.exec(text)) !== null) {
    violations.push(`disallowed_color_form:${m[0].slice(0, 40)}`);
  }
  HSL_COLOR_RE.lastIndex = 0;
  while ((m = HSL_COLOR_RE.exec(text)) !== null) {
    violations.push(`disallowed_color_form:${m[0].slice(0, 40)}`);
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Section-coherence rules.
// ---------------------------------------------------------------------------

function coherenceViolations(
  edit: SectionEdit,
  knownSections: ReadonlyArray<string>,
  availableCitations: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const out: string[] = [];
  const known = new Set(knownSections);
  if (edit.kind !== 'add_section' && !known.has(edit.section_path)) {
    out.push(
      `unknown_section_for_${edit.kind}:${edit.section_path}`,
    );
  }
  if (edit.kind === 'add_section' && known.has(edit.section_path)) {
    out.push(`duplicate_add_section:${edit.section_path}`);
  }
  if (edit.kind === 'reorder' && edit.proposed_position === undefined) {
    out.push(`reorder_missing_position:${edit.section_path}`);
  }
  if (
    edit.kind === 'add_citation' &&
    (edit.citation_ref === undefined || edit.citation_ref.length === 0)
  ) {
    out.push(`add_citation_missing_ref:${edit.section_path}`);
  }
  if (edit.citation_ref !== undefined && edit.citation_ref.length > 0) {
    const avail = new Set(availableCitations);
    if (!avail.has(edit.citation_ref)) {
      out.push(
        `citation_ref_not_available:${edit.citation_ref}@${edit.section_path}`,
      );
    }
  }
  if (
    (edit.kind === 'rewrite' || edit.kind === 'add_section') &&
    (edit.proposed_text === undefined || edit.proposed_text.trim().length === 0)
  ) {
    out.push(`${edit.kind}_missing_text:${edit.section_path}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public validator.
// ---------------------------------------------------------------------------

export function validateProposal(
  input: ValidateProposalInput,
): ValidationResult {
  const violations: string[] = [];

  if (input.diff.edits.length === 0) {
    violations.push('empty_edits');
  }
  if (input.diff.summary.trim().length === 0) {
    violations.push('empty_summary');
  }
  if (input.diff.proposed_version <= input.diff.current_version) {
    violations.push(
      `non_monotonic_version:${input.diff.current_version}->${input.diff.proposed_version}`,
    );
  }

  for (const edit of input.diff.edits) {
    if (edit.proposed_text !== undefined) {
      violations.push(...lintProposalText(edit.proposed_text));
    }
    violations.push(
      ...coherenceViolations(
        edit,
        input.known_section_paths,
        input.available_citation_refs,
      ),
    );
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true };
}
