/**
 * R7 — the REAL `LocalePurePort` for the proof-carrying membrane.
 *
 * The gatekeeper's `locale-pure` invariant asserts the assembled reply is
 * single-language under the turn's ACTIVE locale (CLAUDE.md: `en` default,
 * `sw` toggle, ZERO EN/SW mixing — never mirror the user's input language,
 * never code-switch). The composition root previously wired this port as
 * `localePure: () => true` — a NO-OP, so no post-generation language guard
 * existed on chat output: a code-switching model passed the membrane clean.
 *
 * This module builds a real detector the composition root can wire instead.
 * It reads the final reply text + active locale off `action.payload` and runs
 * a HIGH-PRECISION, dependency-free whole-word marker heuristic — the same
 * shape the live genUI admission policy uses at its sync persist chokepoint.
 * It is deliberately conservative: it flags only an UNAMBIGUOUS wrong-language
 * signal under the active locale (distinctly-Swahili function words in an `en`
 * reply, or ≥2 distinctly-English function words in a `sw` reply), so a normal
 * single-language reply with the odd proper noun / borrowing is never flagged.
 *
 * The port returns `true` when the reply is PURE (the invariant is satisfied)
 * and `false` when it is mixed — matching the `LocalePurePort` contract the
 * gatekeeper consumes (`safeBool(() => deps.localePure(action))`). The
 * gatekeeper records `false` as an UNSATISFIED `locale-pure` invariant, which
 * its caller surfaces as a divergence / flag — it does NOT throw, so a normal
 * reply is never hard-crashed.
 *
 * Design rules honoured: pure + deterministic (no per-call state), immutable
 * (returns a new boolean), no `console.log`, no hardcoded BCP-47 locale
 * literals in logic (the locale rides on the action payload).
 *
 * @module @borjie/central-intelligence/kernel/membrane/locale-pure
 */

import type { GatekeeperAction, LocalePurePort } from './gatekeeper.js';

/** The active locales the absolute single-language toggle governs. */
export type ActiveLocale = 'en' | 'sw';

/**
 * Payload keys the detector reads off {@link GatekeeperAction.payload}. The
 * composition root stamps the final assembled reply + the turn's active locale
 * here so the membrane can certify the rendered output, not the prompt.
 */
export const LOCALE_PURE_PAYLOAD_TEXT_KEY = 'replyText' as const;
export const LOCALE_PURE_PAYLOAD_LOCALE_KEY = 'locale' as const;

/**
 * Distinctly-Swahili function words (whole-word). None are English words, so a
 * single whole-word hit in an `en` reply is a genuine Swahili intrusion under
 * the absolute zero-mixing law.
 */
const SWAHILI_MARKERS: ReadonlySet<string> = new Set([
  'na', 'ya', 'wa', 'kwa', 'kwenye', 'katika', 'ni', 'za', 'la', 'cha', 'vya',
  'kuhusu', 'tarehe', 'malipo', 'jina', 'idadi', 'jumla', 'tovuti', 'angalia',
  'ripoti', 'hapa', 'sasa', 'mwezi', 'mwaka', 'siku', 'wewe', 'yako', 'hii',
  'habari', 'karibu', 'asante', 'tena', 'pole', 'samahani',
]);

/** Distinctly-English function words (whole-word). */
const ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  'the', 'and', 'of', 'for', 'with', 'your', 'this', 'that', 'from', 'are',
  'view', 'report', 'date', 'amount', 'total', 'name', 'number', 'please',
  'welcome', 'hello', 'thanks', 'sorry',
]);

/** Lowercase whole-word tokens (letters only), apostrophes folded out. */
function tokenize(text: string): ReadonlyArray<string> {
  return text
    .toLowerCase()
    .replace(/['’`]/g, '')
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
 * TRUE when `text` violates `locale` purity (a code-switch / wrong-language
 * intrusion). Conservative thresholds: an `en` reply flags any distinctly-
 * Swahili token (these never occur in English); a `sw` reply tolerates one
 * stray English token (technical borrowings like "PDF") before flagging two
 * or more. Exported so callers / tests can reuse the raw decision.
 */
export function isLocaleImpure(text: string, locale: ActiveLocale): boolean {
  if (typeof text !== 'string' || text.trim().length < 3) return false;
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;

  const swHits = countHits(tokens, SWAHILI_MARKERS);
  const enHits = countHits(tokens, ENGLISH_MARKERS);

  if (locale === 'sw') return enHits >= 2 && enHits > swHits;
  // Default + `en`: any distinctly-Swahili token is an intrusion.
  return swHits >= 1 && swHits >= enHits;
}

function resolveLocale(value: unknown): ActiveLocale {
  return value === 'sw' ? 'sw' : 'en';
}

/**
 * Build the REAL `LocalePurePort`. Returns `true` (PURE / invariant satisfied)
 * for a single-language reply, `false` (MIXED) for a code-switched one. When
 * the payload carries no reply text it returns `true` — there is nothing to
 * certify, and absent evidence must not block a normal turn (the membrane is
 * refuse-by-default only on REQUIRED-and-checkable invariants; an unpopulated
 * text dimension is not a violation). Never throws.
 */
export function createLocalePurePort(): LocalePurePort {
  return (action: GatekeeperAction): boolean => {
    const payload = action.payload;
    if (!payload) return true;
    const text = payload[LOCALE_PURE_PAYLOAD_TEXT_KEY];
    if (typeof text !== 'string' || text.trim().length === 0) return true;
    const locale = resolveLocale(payload[LOCALE_PURE_PAYLOAD_LOCALE_KEY]);
    return !isLocaleImpure(text, locale);
  };
}
