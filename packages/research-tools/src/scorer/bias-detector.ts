/**
 * Bias / quality flag detector.
 *
 * Rule-based — fast, deterministic, auditable. The Scorer consumes
 * these flags to apply caps + warnings; the Synthesizer propagates
 * them into citation chips so the owner sees the warning.
 *
 * Detection rules (no LLM call):
 *   - opinion          — opinion / editorial / op-ed / "in my view" /
 *                        "I believe" patterns OR opinion-section URL.
 *   - paid_promotion   — sponsored / promoted / partner-content /
 *                        affiliate-disclosure markers.
 *   - unverified       — generic-blog or forum class with no by-line,
 *                        date, or institutional affiliation.
 *   - ai_generated     — markers for ChatGPT-/Claude-/Gemini-style
 *                        boilerplate, "As an AI language model",
 *                        "I do not have access to real-time" etc.
 *   - sponsored        — synonym channel for paid_promotion when the
 *                        URL itself carries `?utm_campaign=sponsored`
 *                        or similar.
 *   - press_release    — PR-newswire / businesswire / globenewswire.
 *   - syndicated       — "originally appeared on" / "republished from"
 *                        markers.
 *   - low_authority    — URL has no SSL, hostname is an IP, or path
 *                        contains `/blog/` with no other authority signal.
 *   - stale            — content explicitly tagged as archive / legacy.
 *
 * @module @borjie/research-tools/scorer/bias-detector
 */

import type { BiasFlag } from '../types.js';

// ---------------------------------------------------------------------------
// Pattern tables — adjust here, not in callers
// ===========================================================================

const OPINION_CONTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bin my (view|opinion)\b/i,
  /\b(I|we) believe\b/i,
  /\beditorial board\b/i,
  /\bop[-\s]?ed\b/i,
  /\bcommentary\b/i,
  /\bcolumn(ist)?\b/i,
];

const OPINION_URL_PATTERNS: ReadonlyArray<RegExp> = [
  /\/(opinion|editorial|op[-_]?ed|commentary|column)s?\//i,
];

const PAID_PROMOTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsponsored content\b/i,
  /\bsponsored post\b/i,
  /\bpaid (partnership|promotion|advertisement)\b/i,
  /\bpartner content\b/i,
  /\bbranded content\b/i,
  /\bin partnership with\b/i,
  /\baffiliate disclosure\b/i,
  /\bthis post (was|is) sponsored\b/i,
];

const SPONSORED_URL_PATTERNS: ReadonlyArray<RegExp> = [
  /[?&]utm_campaign=sponsored/i,
  /\/sponsored\//i,
  /\/partner-content\//i,
];

const PRESS_RELEASE_HOST_HINTS: ReadonlyArray<string> = [
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
  'newswire.com',
  'einpresswire.com',
  'prweb.com',
];

const PRESS_RELEASE_CONTENT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bfor immediate release\b/i,
  /\bpress release\b/i,
  /\babout\s+us\b/i,
];

const SYNDICATED_PATTERNS: ReadonlyArray<RegExp> = [
  /\boriginally (appeared|published) (on|at|in)\b/i,
  /\brepublished (from|by)\b/i,
  /\bsyndicated (from|by)\b/i,
  /\bvia\s+\w+\.com\b/i,
];

const AI_GENERATED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bas an AI (language model|assistant)\b/i,
  /\bI (do|don'?t) have access to real[-\s]?time\b/i,
  /\bI (cannot|can'?t) (browse|access) (the )?(internet|web)\b/i,
  /\bI'?m (just )?an AI\b/i,
  /\bI'?m a language model\b/i,
  /\bMy (knowledge|training data) (cutoff|cut[-\s]?off)\b/i,
  /\bgenerated (by|with) (ChatGPT|GPT[-\s]?[0-9]|Claude|Gemini|Bard|Llama)\b/i,
  /\bthis article was (written|generated) by AI\b/i,
];

const STALE_PATTERNS: ReadonlyArray<RegExp> = [
  /\barchive(d)?\b.*\bcontent\b/i,
  /\blegacy (article|page)\b/i,
  /\bno longer (updated|maintained)\b/i,
];

// ---------------------------------------------------------------------------
// Public surface
// ===========================================================================

export interface BiasDetectInput {
  readonly uri: string;
  readonly content: string;
  /** Optional author by-line — if absent we lean toward `unverified`. */
  readonly author?: string;
  /** Optional published-at — if absent we lean toward `unverified`. */
  readonly published_at?: string;
  /** Optional source class — if `forum` / `generic_blog` and no
   *  by-line, we add `unverified`. */
  readonly source_class_hint?: string;
}

/**
 * Detect all applicable flags. Returns a deduplicated, deterministic
 * order (matches the BIAS_FLAGS const order in types.ts).
 */
export function detectBiasFlags(input: BiasDetectInput): ReadonlyArray<BiasFlag> {
  const flags = new Set<BiasFlag>();

  const text = input.content ?? '';
  const uri = input.uri ?? '';

  // opinion
  if (
    matchesAny(text, OPINION_CONTENT_PATTERNS) ||
    matchesAny(uri, OPINION_URL_PATTERNS)
  ) {
    flags.add('opinion');
  }

  // paid_promotion
  if (matchesAny(text, PAID_PROMOTION_PATTERNS)) {
    flags.add('paid_promotion');
  }

  // sponsored — separate channel for URL-level sponsor markers
  if (matchesAny(uri, SPONSORED_URL_PATTERNS)) {
    flags.add('sponsored');
    flags.add('paid_promotion');
  }

  // press_release
  const host = extractHostname(uri);
  if (host && PRESS_RELEASE_HOST_HINTS.some((h) => host.endsWith(h))) {
    flags.add('press_release');
  } else if (matchesAny(text, PRESS_RELEASE_CONTENT_PATTERNS)) {
    flags.add('press_release');
  }

  // syndicated
  if (matchesAny(text, SYNDICATED_PATTERNS)) {
    flags.add('syndicated');
  }

  // ai_generated
  if (matchesAny(text, AI_GENERATED_PATTERNS)) {
    flags.add('ai_generated');
  }

  // stale (textual marker — recency-based decay is in the scorer itself)
  if (matchesAny(text, STALE_PATTERNS)) {
    flags.add('stale');
  }

  // low_authority — no SSL OR IP-only host
  if (uri.length > 0) {
    if (uri.startsWith('http://')) {
      flags.add('low_authority');
    }
    if (host && /^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      flags.add('low_authority');
    }
  }

  // unverified — generic_blog / forum with no author + no date
  if (
    (input.source_class_hint === 'generic_blog' ||
      input.source_class_hint === 'forum') &&
    !input.author &&
    !input.published_at
  ) {
    flags.add('unverified');
  }

  // Preserve deterministic order matching the BIAS_FLAGS const.
  const ordered: ReadonlyArray<BiasFlag> = [
    'opinion',
    'paid_promotion',
    'unverified',
    'ai_generated',
    'sponsored',
    'press_release',
    'syndicated',
    'low_authority',
    'stale',
  ];
  return ordered.filter((f) => flags.has(f));
}

// ---------------------------------------------------------------------------
// Helpers
// ===========================================================================

function matchesAny(text: string, patterns: ReadonlyArray<RegExp>): boolean {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

function extractHostname(uri: string): string | null {
  try {
    const u = new URL(uri);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
