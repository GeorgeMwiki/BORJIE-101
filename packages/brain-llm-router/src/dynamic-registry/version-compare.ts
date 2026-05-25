/**
 * Numeric-aware version comparison for model ids.
 *
 * Model ids drift across providers:
 *
 *     claude-opus-4-7
 *     claude-opus-4-8           > 4-7
 *     claude-opus-4-6-20251130  same major+minor, dated build
 *     gpt-5.4-mini              dotted minor
 *     embed-v4.0                v-prefixed semver
 *     eleven_v3                 underscore + v-prefix
 *
 * We need a single deterministic order so the resolver can pick the
 * newest id returned by the provider's `/v1/models` endpoint.
 *
 * Algorithm:
 *   1. Tokenise on `-`, `.`, and `_` (the three separators every
 *      provider uses in practice).
 *   2. Compare element-wise:
 *        - If both tokens are pure digits → numeric compare.
 *        - If one is `v\d+` (semver-style) → strip the leading `v` and
 *          treat as numeric.
 *        - Else → case-insensitive lex compare.
 *   3. If one id runs out of tokens first, the **longer** id wins
 *      (e.g. `claude-opus-4-6-20251130` > `claude-opus-4-6`). That
 *      matches provider convention: dated/patch suffixes are newer
 *      releases of the same base id.
 *
 * The function is pure; no I/O, no logging, no state. Safe to use from
 * the hot path even though the resolver only calls it during L2
 * refresh.
 */

const SEPARATOR_RE = /[-._]+/;
const ALL_DIGITS_RE = /^\d+$/;
const V_PREFIXED_DIGITS_RE = /^v(\d+)$/i;

type Token =
  | { readonly kind: 'num'; readonly value: number; readonly raw: string }
  | { readonly kind: 'str'; readonly value: string };

function tokenise(id: string): ReadonlyArray<Token> {
  return id
    .split(SEPARATOR_RE)
    .filter((s) => s.length > 0)
    .map((segment): Token => {
      if (ALL_DIGITS_RE.test(segment)) {
        return { kind: 'num', value: Number(segment), raw: segment };
      }
      const vMatch = V_PREFIXED_DIGITS_RE.exec(segment);
      if (vMatch && vMatch[1]) {
        return { kind: 'num', value: Number(vMatch[1]), raw: segment };
      }
      return { kind: 'str', value: segment.toLowerCase() };
    });
}

function compareTokens(a: Token, b: Token): -1 | 0 | 1 {
  if (a.kind === 'num' && b.kind === 'num') {
    if (a.value < b.value) return -1;
    if (a.value > b.value) return 1;
    return 0;
  }
  // Mixed kinds: numeric < string is the convention we want — strings
  // are typically alpha-stage tags ("preview", "exp") and should rank
  // **lower** than a plain numeric build. Provider ids in the wild
  // (`gpt-4o-realtime-preview`, `claude-3-5-sonnet-20241022`) follow
  // this implicitly.
  if (a.kind === 'num' && b.kind === 'str') return -1;
  if (a.kind === 'str' && b.kind === 'num') return 1;
  // Both strings.
  const av = (a as { value: string }).value;
  const bv = (b as { value: string }).value;
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

export function compareModelIds(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  const ta = tokenise(a);
  const tb = tokenise(b);
  const max = Math.max(ta.length, tb.length);
  for (let i = 0; i < max; i++) {
    const aToken = ta[i];
    const bToken = tb[i];
    if (aToken === undefined && bToken === undefined) return 0;
    if (aToken === undefined) return -1; // b is longer → newer
    if (bToken === undefined) return 1; // a is longer → newer
    const cmp = compareTokens(aToken, bToken);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

/**
 * Return the highest-ranked id in `ids`. Throws if the array is empty —
 * callers should screen for length first (the resolver does).
 */
export function pickNewest(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) {
    throw new Error('pickNewest: empty id list');
  }
  let best = ids[0]!;
  for (let i = 1; i < ids.length; i++) {
    const candidate = ids[i]!;
    if (compareModelIds(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best;
}
