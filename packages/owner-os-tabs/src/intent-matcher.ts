/**
 * Deterministic intent matcher.
 *
 * Scores every registered descriptor against the owner's last message
 * + the most recent brain reply + the owner context. Used by:
 *
 *   1. The "Suggested for now" ambient banner — top candidate above a
 *      configurable threshold renders as a click-to-spawn chip.
 *   2. The "+" menu — secondary sort key when the owner has typed a
 *      filter query.
 *
 * Pure function. No I/O. No LLM call. Runs on every keystroke without
 * blocking — keep the work O(descriptors × keywords). Today's registry
 * has ~20 descriptors with ~10 keywords each so each call is ~200
 * string scans on a single lower-cased haystack.
 *
 * Scoring (additive, capped at 1.0):
 *
 *   + 0.25 — any keyword hit (per descriptor, not per hit)
 *   + 0.10 — extra keyword hits beyond the first (max +0.30)
 *   + 0.20 — any regex pattern hit
 *   + comboBoost.boost — when ALL phrases in a combo are present
 *   + 0.15 — context match (siteId / licenceId / employeeId mentioned)
 *
 * The ranking is stable: ties break by union-order so the same input
 * always returns descriptors in the same order.
 */

import type {
  OwnerOSIntentMatchers,
  OwnerOSTabContext,
  OwnerOSTabDescriptor,
} from './types.js';
import { listSpawnableTabs } from './registry.js';

export interface IntentMatchInput {
  /** The owner's most recent message. May be empty. */
  readonly userMessage?: string;
  /** The most recent brain reply text (post-citation cleanup). */
  readonly brainReply?: string;
  /** Optional owner context — used to boost site/licence-scoped matches. */
  readonly ownerContext?: Readonly<OwnerOSTabContext>;
  /**
   * Optional explicit filter query from the "+" menu search box. When
   * provided, ranking falls back to a substring scan of `labelEn` +
   * `descriptionEn` and the LLM-scoring is skipped.
   */
  readonly filterQuery?: string;
}

export interface IntentMatch {
  readonly descriptor: OwnerOSTabDescriptor;
  /** Final score in [0, 1]. Higher = stronger match. */
  readonly score: number;
  /** Human-readable reason — sourced for the banner / "+" hover. */
  readonly reason: string;
}

const KEYWORD_FIRST_HIT_WEIGHT = 0.25;
const KEYWORD_EXTRA_HIT_WEIGHT = 0.1;
const KEYWORD_EXTRA_MAX = 0.3;
const PATTERN_HIT_WEIGHT = 0.2;
const CONTEXT_HIT_WEIGHT = 0.15;

function buildHaystack(input: IntentMatchInput): string {
  return [input.userMessage ?? '', input.brainReply ?? '']
    .join(' ')
    .toLowerCase();
}

function countKeywordHits(
  matchers: OwnerOSIntentMatchers,
  haystack: string,
): number {
  let n = 0;
  for (const kw of matchers.keywords) {
    if (haystack.includes(kw.toLowerCase())) n += 1;
  }
  return n;
}

function anyPatternHit(
  matchers: OwnerOSIntentMatchers,
  haystack: string,
): boolean {
  if (!matchers.patterns) return false;
  for (const pat of matchers.patterns) {
    if (pat.test(haystack)) return true;
  }
  return false;
}

function comboBoost(
  matchers: OwnerOSIntentMatchers,
  haystack: string,
): number {
  if (!matchers.comboBoost) return 0;
  let boost = 0;
  for (const combo of matchers.comboBoost) {
    const allPresent = combo.phrases.every((p) =>
      haystack.includes(p.toLowerCase()),
    );
    if (allPresent) boost += combo.boost;
  }
  return boost;
}

function contextScore(
  descriptor: OwnerOSTabDescriptor,
  ctx: Readonly<OwnerOSTabContext> | undefined,
  haystack: string,
): number {
  if (!ctx) return 0;
  // Generic context-presence boost: if the descriptor's brief slices
  // overlap with what the owner is talking about, give a small lift.
  // (Cheap heuristic — descriptors that don't surface site/licence
  // scoping don't benefit.)
  let s = 0;
  if (ctx.siteId && haystack.includes('site')) s += CONTEXT_HIT_WEIGHT;
  if (ctx.licenceId && (haystack.includes('licence') || haystack.includes('pml') || haystack.includes('ml'))) {
    s += CONTEXT_HIT_WEIGHT;
  }
  // Cap context contribution at 0.30.
  return Math.min(s, 0.3);
  void descriptor;
}

function scoreOne(
  descriptor: OwnerOSTabDescriptor,
  haystack: string,
  ctx: Readonly<OwnerOSTabContext> | undefined,
): { readonly score: number; readonly hits: number } {
  const hits = countKeywordHits(descriptor.intentMatchers, haystack);
  let score = 0;
  if (hits > 0) {
    score += KEYWORD_FIRST_HIT_WEIGHT;
    score += Math.min(
      (hits - 1) * KEYWORD_EXTRA_HIT_WEIGHT,
      KEYWORD_EXTRA_MAX,
    );
  }
  if (anyPatternHit(descriptor.intentMatchers, haystack)) {
    score += PATTERN_HIT_WEIGHT;
  }
  score += comboBoost(descriptor.intentMatchers, haystack);
  score += contextScore(descriptor, ctx, haystack);
  return { score: Math.min(score, 1), hits };
}

function reasonFor(
  descriptor: OwnerOSTabDescriptor,
  hits: number,
  locale: 'en' | 'sw',
): string {
  if (hits === 0) {
    return locale === 'sw'
      ? descriptor.descriptionSw
      : descriptor.descriptionEn;
  }
  const label = locale === 'sw' ? descriptor.labelSw : descriptor.labelEn;
  return locale === 'sw'
    ? `Mada inalingana na ${label}`
    : `Conversation touches ${label}`;
}

/**
 * Rank every registered descriptor by intent score. Returns descriptors
 * with score > 0, sorted descending by score. When `filterQuery` is
 * supplied, ranking is by substring match against label/description and
 * the LLM-scoring layer is skipped (the "+" menu uses this).
 */
export function matchIntent(
  input: IntentMatchInput,
  options: { readonly locale?: 'en' | 'sw' } = {},
): ReadonlyArray<IntentMatch> {
  const descriptors = listSpawnableTabs();
  const locale = options.locale ?? 'en';

  if (input.filterQuery && input.filterQuery.trim().length > 0) {
    const q = input.filterQuery.trim().toLowerCase();
    const matched = descriptors
      .map((d) => {
        const hay = [
          d.labelEn,
          d.labelSw,
          d.descriptionEn,
          d.descriptionSw,
          d.type,
        ]
          .join(' ')
          .toLowerCase();
        const idx = hay.indexOf(q);
        if (idx < 0) {
          return { descriptor: d, score: 0, reason: '' };
        }
        // Prefix matches score higher.
        const score = idx === 0 ? 0.9 : 0.6;
        return {
          descriptor: d,
          score,
          reason: reasonFor(d, 1, locale),
        };
      })
      .filter((m) => m.score > 0);
    return matched.sort((a, b) => b.score - a.score);
  }

  const haystack = buildHaystack(input);
  if (haystack.trim().length === 0) return [];

  const ranked: IntentMatch[] = [];
  for (const d of descriptors) {
    const { score, hits } = scoreOne(d, haystack, input.ownerContext);
    if (score > 0) {
      ranked.push({
        descriptor: d,
        score,
        reason: reasonFor(d, hits, locale),
      });
    }
  }
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * Convenience — return the single top match above the threshold, or
 * null. The ambient "Suggested for now" banner calls this directly.
 */
export function topIntent(
  input: IntentMatchInput,
  options: { readonly threshold?: number; readonly locale?: 'en' | 'sw' } = {},
): IntentMatch | null {
  const threshold = options.threshold ?? 0.4;
  const opts: { readonly locale?: 'en' | 'sw' } =
    options.locale !== undefined ? { locale: options.locale } : {};
  const ranked = matchIntent(input, opts);
  const top = ranked[0];
  if (!top || top.score < threshold) return null;
  return top;
}
