/**
 * sql-tokenizer.ts — a minimal, dependency-free SQL lexer for the
 * tenant-module DDL guard (Pass 1 — pure security core).
 *
 * It is NOT a general SQL parser. Its single job is to make smuggling
 * provable:
 *
 *   1. Strip `--` line comments and `/* *\/` block comments (nested
 *      block comments included) into opaque placeholders.
 *   2. Strip single-quoted string literals (with '' escapes) and
 *      dollar-quoted ($tag$ ... $tag$) string bodies into opaque
 *      placeholders.
 *   3. Split the residual stream on TOP-LEVEL `;` only (a `;` inside a
 *      literal or a dollar-quoted body is NOT a separator), so a
 *      `'; DROP TABLE ...; --` smuggle becomes a single literal token
 *      and can never masquerade as a second statement.
 *
 * Because every comment and every literal is replaced by a placeholder
 * BEFORE the split, the downstream allowlist validator operates on a
 * stream that contains only the structural SQL skeleton. The validator
 * can then assert that the ONLY things removed were benign (the
 * tokenizer hands back the removed spans so a caller can prove no
 * structural keyword was hidden inside a comment/literal).
 *
 * Pure. No I/O, no env, no Date. Same input → same output.
 */

/** Opaque placeholder kinds the tokenizer substitutes in. */
export type StrippedSpanKind =
  | 'line-comment'
  | 'block-comment'
  | 'single-quote'
  | 'dollar-quote';

export interface StrippedSpan {
  readonly kind: StrippedSpanKind;
  /** Placeholder token that replaced the span in `normalizedSql`. */
  readonly placeholder: string;
  /** The exact original text that was removed (including delimiters). */
  readonly raw: string;
  /**
   * For dollar-quoted spans, the tag between the `$...$` delimiters
   * (empty string for the anonymous `$$` form). Undefined otherwise.
   */
  readonly dollarTag?: string;
}

export interface TokenizeResult {
  /**
   * The full input with every comment + string literal replaced by a
   * placeholder. Whitespace otherwise preserved.
   */
  readonly normalizedSql: string;
  /**
   * `normalizedSql` split on top-level `;`, each entry trimmed, empty
   * entries dropped. This is the canonical statement list the
   * validator classifies.
   */
  readonly statements: ReadonlyArray<string>;
  /** Every comment/literal removed, in source order. */
  readonly stripped: ReadonlyArray<StrippedSpan>;
  /**
   * True when tokenization hit an unterminated comment/literal/dollar
   * body. A structurally-unbalanced input is itself a smuggling signal
   * and the validator hard-rejects on it.
   */
  readonly unterminated: boolean;
}

const PLACEHOLDER_PREFIX = '@DDLGUARD_';
const PLACEHOLDER_SUFFIX = '@';

function placeholderFor(kind: StrippedSpanKind, index: number): string {
  const body = kind.toUpperCase().replace(/-/g, '_');
  return ` ${PLACEHOLDER_PREFIX}${body}_${index}${PLACEHOLDER_SUFFIX} `;
}

/**
 * Detect a dollar-quote opener at position `i`. Returns the full
 * delimiter (e.g. `$$` or `$tag$`) and the tag, or null when `i` is not
 * the start of a valid dollar-quote tag. PostgreSQL tags match
 * `$[A-Za-z_][A-Za-z0-9_]*$` or the anonymous `$$`.
 */
function matchDollarOpener(
  sql: string,
  i: number,
): { readonly delimiter: string; readonly tag: string } | null {
  if (sql[i] !== '$') return null;
  let j = i + 1;
  // Tag chars: first must be letter/underscore; rest alnum/underscore.
  while (j < sql.length) {
    const ch = sql[j] ?? '';
    if (ch === '$') {
      const tag = sql.slice(i + 1, j);
      return { delimiter: sql.slice(i, j + 1), tag };
    }
    const isFirst = j === i + 1;
    const ok = isFirst ? /[A-Za-z_]/.test(ch) : /[A-Za-z0-9_]/.test(ch);
    if (!ok) return null;
    j += 1;
  }
  return null;
}

/**
 * Tokenize a DDL blob: strip comments + literals to placeholders, then
 * split on top-level `;`. Fully deterministic & pure.
 */
export function tokenizeSql(sql: string): TokenizeResult {
  const stripped: StrippedSpan[] = [];
  let out = '';
  let i = 0;
  let unterminated = false;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';

    // ── line comment: -- … to end-of-line ───────────────────────────
    if (ch === '-' && next === '-') {
      let j = i + 2;
      while (j < n && sql[j] !== '\n') j += 1;
      const raw = sql.slice(i, j);
      const placeholder = placeholderFor('line-comment', stripped.length);
      stripped.push({ kind: 'line-comment', placeholder, raw });
      out += placeholder;
      i = j;
      continue;
    }

    // ── block comment: /* … */ (nesting-aware) ──────────────────────
    if (ch === '/' && next === '*') {
      let j = i + 2;
      let depth = 1;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      const terminated = depth === 0;
      if (!terminated) unterminated = true;
      const raw = sql.slice(i, j);
      const placeholder = placeholderFor('block-comment', stripped.length);
      stripped.push({ kind: 'block-comment', placeholder, raw });
      out += placeholder;
      i = j;
      continue;
    }

    // ── single-quoted literal: '…' with '' escape ───────────────────
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2; // escaped quote ''
            continue;
          }
          j += 1; // closing quote
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) unterminated = true;
      const raw = sql.slice(i, j);
      const placeholder = placeholderFor('single-quote', stripped.length);
      stripped.push({ kind: 'single-quote', placeholder, raw });
      out += placeholder;
      i = j;
      continue;
    }

    // ── dollar-quoted body: $tag$ … $tag$ ───────────────────────────
    if (ch === '$') {
      const opener = matchDollarOpener(sql, i);
      if (opener) {
        const close = sql.indexOf(opener.delimiter, i + opener.delimiter.length);
        let j: number;
        if (close === -1) {
          unterminated = true;
          j = n;
        } else {
          j = close + opener.delimiter.length;
        }
        const raw = sql.slice(i, j);
        const placeholder = placeholderFor('dollar-quote', stripped.length);
        stripped.push({
          kind: 'dollar-quote',
          placeholder,
          raw,
          dollarTag: opener.tag,
        });
        out += placeholder;
        i = j;
        continue;
      }
    }

    out += ch;
    i += 1;
  }

  const statements = splitTopLevelStatements(out);

  return Object.freeze({
    normalizedSql: out,
    statements: Object.freeze(statements),
    stripped: Object.freeze(stripped),
    unterminated,
  });
}

/**
 * Split a comment/literal-stripped stream on `;`. Every `;` here is
 * top-level by construction because literals/comments (the only places
 * a `;` could hide) are already placeholders. Trims each statement and
 * drops empties.
 */
function splitTopLevelStatements(normalized: string): string[] {
  return normalized
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Returns true when a placeholder token appears in the given (already
 * normalized) statement text — used by the validator to detect a
 * statement that still embeds a stripped span where one is not allowed.
 */
export function containsPlaceholder(normalizedStatement: string): boolean {
  return normalizedStatement.includes(PLACEHOLDER_PREFIX);
}

/** Expose the placeholder prefix so the validator can scan for it. */
export const DDL_GUARD_PLACEHOLDER_PREFIX = PLACEHOLDER_PREFIX;
