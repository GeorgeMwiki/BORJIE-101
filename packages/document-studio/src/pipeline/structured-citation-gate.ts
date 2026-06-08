/**
 * @borjie/document-studio — structured-document citation gate.
 *
 * The narrative citation verifier (`verifyDocumentCitations`) requires an
 * inline `[ID]` marker within 80 chars of each monetary/statute claim —
 * correct for prose templates (licence application, royalty narrative)
 * where the figure is woven into a sentence.
 *
 * Structured documents (worksheets, tables, spreadsheets) put figures in
 * CELLS, where an inline tag does not belong. For those, the evidence
 * requirement is satisfied differently but just as strictly: every
 * monetary token rendered into the document MUST be COVERED by a citation
 * whose `claim` contains that exact formatted figure. This keeps the
 * "evidence-required AI output" hard rail (every figure has ≥1 evidence
 * id) without forcing tags into table cells.
 *
 * Pure functions, no I/O.
 */

import type { Citation } from '../types.js';

/** Monetary tokens that must be covered (mirror the narrative verifier). */
const MONEY_RE =
  /\b(?:USD|TZS|KES|UGX|NGN|RWF|ZAR)\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g;

export type StructuredCitationVerdict =
  | { readonly ok: true; readonly coveredClaims: number }
  | {
      readonly ok: false;
      readonly missing: ReadonlyArray<{
        readonly fragment: string;
        readonly reason: 'numeric-uncovered';
      }>;
    };

/**
 * Verify every monetary token in `text` is covered by a citation whose
 * `claim` contains that token. Normalises whitespace so `TZS 1,234` in
 * the doc matches a `TZS 1,234` claim regardless of spacing.
 */
export function verifyStructuredCitations(args: {
  readonly text: string;
  readonly citations: ReadonlyArray<Citation>;
}): StructuredCitationVerdict {
  const claimText = args.citations
    .map((c) => normalise(c.claim))
    .join('  ');
  const missing: Array<{ fragment: string; reason: 'numeric-uncovered' }> = [];
  let covered = 0;

  MONEY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = MONEY_RE.exec(args.text)) !== null) {
    const token = normalise(m[0]);
    if (seen.has(token)) continue;
    seen.add(token);
    if (claimText.includes(token)) {
      covered++;
    } else {
      missing.push({ fragment: m[0], reason: 'numeric-uncovered' });
    }
  }

  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, coveredClaims: covered };
}

/** Collapse internal whitespace so spacing differences don't break matches. */
function normalise(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
