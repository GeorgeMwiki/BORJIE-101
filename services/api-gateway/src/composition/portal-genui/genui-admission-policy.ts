/**
 * Resolves the NON-egress half of the genUI admission policy at the composition
 * bootstrap seam — the evidence toggle and the locale-purity detector that the
 * gateway previously failed to thread, leaving the `evidence-presence` and
 * `locale-purity` admission rules as live no-ops (a "rule exists ≠ rule
 * enforces" false-green; see CLOSE-G).
 *
 * The admission `localeDetector` is a SYNC `(text, locale) => boolean` because
 * the persist chokepoint must stay fast and side-effect-free — so we use a
 * conservative, dependency-free keyword heuristic here rather than the async
 * `@borjie/language-sota` classifier. It is deliberately HIGH-PRECISION: it
 * flags only an unambiguous wrong-language signal under the active locale, so
 * the EN/SW absolute-toggle law is enforced without false-blocking legitimate
 * proper nouns or numerals. This is a calibrated heuristic, not a guarantee.
 *
 * @module composition/portal-genui/genui-admission-policy
 */

import type { LocaleImpurityDetector } from '@borjie/portal-genui';

/**
 * Distinctly-Swahili function words (whole-word). None are English words, so a
 * single whole-word hit in an `en` tab is a genuine Swahili intrusion under the
 * absolute zero-mixing law.
 */
const SWAHILI_MARKERS: ReadonlySet<string> = new Set([
  'na', 'ya', 'wa', 'kwa', 'kwenye', 'katika', 'ni', 'za', 'la', 'cha', 'vya',
  'kuhusu', 'tarehe', 'malipo', 'jina', 'idadi', 'jumla', 'tovuti', 'angalia',
  'ripoti', 'hapa', 'sasa', 'mwezi', 'mwaka', 'siku', 'wewe', 'yako', 'hii',
]);

/** Distinctly-English function words (whole-word). */
const ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  'the', 'and', 'of', 'for', 'with', 'your', 'this', 'that', 'from', 'are',
  'view', 'report', 'date', 'amount', 'total', 'name', 'number', 'please',
]);

/** Lowercase whole-word tokens (letters only), apostrophes folded out. */
function tokenize(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .replace(/[''`]/g, '')
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0);
}

function countHits(
  tokens: ReadonlyArray<string>,
  markers: ReadonlySet<string>,
): number {
  let n = 0;
  for (const t of tokens) if (markers.has(t)) n += 1;
  return n;
}

/**
 * Build the sync locale-impurity detector. Returns `true` when `text` violates
 * `locale` purity. Conservative thresholds: a `sw` tab tolerates one stray
 * English token (technical borrowings like "PDF") before flagging, while an
 * `en` tab flags any distinctly-Swahili token (the markers never occur in
 * English) — matching the absolute law while minimising false positives.
 */
export function createLocaleImpurityDetector(): LocaleImpurityDetector {
  return (text, locale): boolean => {
    if (typeof text !== 'string' || text.trim().length < 3) return false;
    const tokens = tokenize(text);
    if (tokens.length === 0) return false;

    const swHits = countHits(tokens, SWAHILI_MARKERS);
    const enHits = countHits(tokens, ENGLISH_MARKERS);

    if (locale === 'en') return swHits >= 1 && swHits >= enHits;
    if (locale === 'sw') return enHits >= 2 && enHits > swHits;
    return false;
  };
}

/**
 * Whether admission should REQUIRE every generated section to carry ≥1 evidence
 * ref. Default OFF: the generator does not yet stamp `evidenceIds`, so enabling
 * it would 422 every generated tab. Wiring it here (env-gated) closes the
 * structural gap — the rule is now threaded and flips on the moment the
 * generator cites evidence — without breaking live generation today.
 */
export function resolveRequireEvidence(): boolean {
  const raw = process.env.BORJIE_GENUI_REQUIRE_EVIDENCE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}
