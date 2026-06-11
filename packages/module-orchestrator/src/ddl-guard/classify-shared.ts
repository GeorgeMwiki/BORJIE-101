/**
 * classify-shared.ts — shared types + helpers for the DDL allowlist
 * statement classifiers. Extracted so each classifier file stays small
 * and the grammar is easy to audit piece-by-piece.
 *
 * Pure. No I/O.
 */

import type { TokenizeResult } from './sql-tokenizer.js';
import {
  isCoreTable,
  isPlainIdentifier,
  isTenantNamespacedTable,
  pgIdentifierLimitError,
  stripSchemaQualifier,
} from './identifier-policy.js';

export type StatementKind =
  | 'create-table'
  | 'create-index'
  | 'rls-do-block'
  | 'comment-only';

export interface ClassifyResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly kind?: StatementKind;
  readonly table?: string;
  /**
   * For a `rls-do-block`, the FULL DO statement text with every stripped
   * dollar-quote/literal/comment placeholder re-expanded to its raw
   * on-disk body. The validator byte-compares this against a freshly
   * built canonical RLS block — so a hand-rolled or tampered DO body can
   * never pass, regardless of any denylist.
   */
  readonly recoveredText?: string;
}

export function rejectStmt(error: string): ClassifyResult {
  return { ok: false, errors: Object.freeze([error]) };
}

/** The identifier wall — namespaced, non-core, plain identifier only. */
export function checkTableIdentifier(
  name: string,
  tenantId: string,
): ClassifyResult {
  if (!isPlainIdentifier(name)) {
    return rejectStmt(`unsafe/quoted table identifier: ${preview(name)}`);
  }
  const bare = stripSchemaQualifier(name);
  if (isCoreTable(bare)) {
    return rejectStmt(`refusing to touch core table: ${bare}`);
  }
  // Over-length identifier wall (defence in depth — the compiler also
  // guards this; the validator never trusts the DDL source).
  const lenErr = pgIdentifierLimitError(bare, 'table name');
  if (lenErr) {
    return rejectStmt(lenErr);
  }
  if (!isTenantNamespacedTable(bare, tenantId)) {
    return rejectStmt(
      `table ${bare} is outside the tenant namespace tenant_mod_${tenantId}_`,
    );
  }
  return { ok: true, errors: [] };
}

/** Split on top-level commas (parens like NUMERIC(18,4) don't break it). */
export function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

/** True when the fragment embeds a stripped COMMENT placeholder. */
export function embedsComment(fragment: string, tok: TokenizeResult): boolean {
  for (const span of tok.stripped) {
    if (
      (span.kind === 'line-comment' || span.kind === 'block-comment') &&
      fragment.includes(span.placeholder.trim())
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve every placeholder back to the EXACT original text the
 * tokenizer stripped, so a legitimate system DEFAULT 'active' is judged
 * on its real value while a smuggled `DEFAULT ''; DROP …'` is restored
 * and then rejected by the closed DEFAULT allowlist.
 */
export function resolvePlaceholders(
  fragment: string,
  tok: TokenizeResult,
): string {
  let out = fragment;
  for (const span of tok.stripped) {
    const token = span.placeholder.trim();
    if (out.includes(token)) {
      out = out.split(token).join(span.raw);
    }
  }
  return out;
}

export function preview(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}
