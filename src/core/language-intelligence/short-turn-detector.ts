/**
 * Short-turn language detector (GlotLID / UniLID contract shim).
 *
 * GlotLID (Kargaran et al., 2023) + UniLID (2024) outperform fastText
 * / CLD3 on low-resource languages and on short turns (≤ 5 tokens).
 * UniLID hits 70 % accuracy on 5-sample inputs across 200+ languages.
 *
 * We cannot ship the GlotLID weights inside the repo, so this module
 * is a high-recall lexicon + script-based detector that matches
 * GlotLID's contract:
 *
 *   detect(text) -> { lang, confidence, alternates }
 *
 * The primary detector (`language-detector.ts`) is tuned for sentence
 * inputs; this module is the short-turn complement. It is the lookup
 * the brain's per-turn pipeline should call when token count ≤ 5.
 *
 * Languages covered:
 *   - en (English)
 *   - sw (Standard Kiswahili)
 *   - mas-tz (Maa / Maasai)
 *   - suk-tz (Sukuma)
 *   - cha-tz (Chaga)
 *   - heh-tz (Hehe)
 *   - hay-tz (Haya)
 *   - nym-tz (Nyamwezi)
 *   - bez-tz (Bena)
 *
 * Confidence interpretation:
 *   - 0.95+ : exact dictionary hit OR script match for distinctive
 *             feature (e.g. multiple SW affix matches).
 *   - 0.7-0.95 : single-vocab match + plausible affix.
 *   - 0.4-0.7 : window vote / fallback; not high-recall.
 *   - 0.0-0.4 : effectively "unknown" (we still emit a best guess).
 *
 * The detector is PURE: no DB calls, no network, deterministic per
 * input. Designed to drop in to the chat hot path.
 */

import {
  tagDialects,
  dialectToLangCode,
  type Dialect,
} from "@/core/borjie-ai/learning/language-acquisition/dialect-tagger";

// ────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────

export type ShortTurnLang =
  | "en"
  | "sw"
  | "mas-tz"
  | "suk-tz"
  | "cha-tz"
  | "heh-tz"
  | "hay-tz"
  | "nym-tz"
  | "bez-tz"
  | "und";

export interface AlternateLang {
  readonly lang: ShortTurnLang;
  readonly confidence: number;
}

export interface ShortTurnDetection {
  readonly lang: ShortTurnLang;
  readonly confidence: number;
  readonly alternates: ReadonlyArray<AlternateLang>;
}

// ────────────────────────────────────────────────────────────────────
// Hand-tuned lexicons for the short-turn case (≤ 5 tokens).
//
// These OVERLAP intentionally with the main detector. The short-turn
// case is precisely where one token's worth of signal must carry the
// decision; the dictionary is therefore tighter than the main vocab.
// ────────────────────────────────────────────────────────────────────

const SW_HIGH_SIGNAL = new Set<string>([
  "habari",
  "shikamoo",
  "mambo",
  "ndiyo",
  "hapana",
  "asante",
  "tafadhali",
  "naomba",
  "ninahitaji",
  "biashara",
  "mkopo",
  "fedha",
  "pesa",
  "kazi",
  "ninajua",
  "sijui",
  "sawa",
  "pole",
  "karibu",
  "kwaheri",
  "nimeshindwa",
  "nataka",
  "naweza",
  "yangu",
  "wangu",
  "kwako",
  "kwangu",
  "vipi",
  "mzima",
  "salama",
  "marahaba",
  "hodi",
  "kalibuni",
  "natafuta",
  "nitalipa",
  "nilipie",
  "kulipa",
  "milioni",
  "elfu",
  "laki",
  "ndiyo",
  "kuhusu",
  "kwenye",
  "wapi",
  "wewe",
  "mimi",
  "yeye",
  "sisi",
  "ninyi",
  "wao",
]);

const EN_HIGH_SIGNAL = new Set<string>([
  "hello",
  "hi",
  "thanks",
  "please",
  "yes",
  "no",
  "loan",
  "balance",
  "payment",
  "money",
  "credit",
  "debit",
  "withdraw",
  "deposit",
  "interest",
  "rate",
  "monthly",
  "yearly",
  "account",
  "transfer",
  "approved",
  "declined",
  "amount",
  "what",
  "where",
  "when",
  "why",
  "how",
  "okay",
  "sorry",
  "goodbye",
  "morning",
  "afternoon",
  "evening",
  "today",
  "tomorrow",
  "yesterday",
]);

// SW productive affixes — used for backoff when no vocab hit.
const SW_PREFIXES = ["ni", "ku", "wa", "ma", "ki", "vi", "tu", "mu", "u", "m"];
const SW_SUFFIXES = [
  "ni",
  "ji",
  "ko",
  "mo",
  "po",
  "yo",
  "lo",
  "wa",
  "ji",
  "zi",
];

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Detect the language of a short turn (≤ ~5 tokens). For longer
 * inputs the main `language-detector.ts` is more accurate.
 *
 * Returns the best guess plus up to 3 ranked alternates. When no
 * signal is present, returns `{ lang: "und", confidence: 0, ... }`.
 */
export function detect(text: string): ShortTurnDetection {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return { lang: "und", confidence: 0, alternates: [] };
  }

  // Score each language candidate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
  const scores: Record<ShortTurnLang, number> = {
    en: 0,
    sw: 0,
    "mas-tz": 0,
    "suk-tz": 0,
    "cha-tz": 0,
    "heh-tz": 0,
    "hay-tz": 0,
    "nym-tz": 0,
    "bez-tz": 0,
    und: 0,
  };

  // ── EN / SW dictionary hits ────────────────────────────────────────
  for (const t of tokens) {
    if (SW_HIGH_SIGNAL.has(t)) scores.sw += 1.0;
    if (EN_HIGH_SIGNAL.has(t)) scores.en += 1.0;

    // SW affix backoff — half weight to avoid drowning out exact hits.
    if (!SW_HIGH_SIGNAL.has(t) && !EN_HIGH_SIGNAL.has(t)) {
      if (hasSwAffix(t)) scores.sw += 0.4;
    }
  }

  // ── Dialect dictionary hits via the shared tagger ──────────────────
  const dialectMatches = tagDialects(tokens, 0.6);
  for (const m of dialectMatches) {
    const code = dialectToLangCode(m.dialect) as ShortTurnLang;
    scores[code] = (scores[code] ?? 0) + m.confidence;
  }

  // ── Aggregate into ranked alternates ──────────────────────────────
  const ranked = (Object.entries(scores) as Array<[ShortTurnLang, number]>)
    .filter(([lang, s]) => lang !== "und" && s > 0)
    .map(([lang, s]) => ({ lang, score: s }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { lang: "und", confidence: 0, alternates: [] };
  }

  // Convert raw scores to confidences in [0, 1].
  // Single-token short turns get a softer max so the floor is meaningful.
  const totalScore = ranked.reduce((acc, r) => acc + r.score, 0);
  const denom = Math.max(totalScore, 1.0);
  const confidences = ranked.map((r) => ({
    lang: r.lang,
    confidence: clamp(r.score / denom, 0, 1),
  }));

  const top = confidences[0];
  const alternates = confidences
    .slice(1, 4)
    .map((c) => ({ lang: c.lang, confidence: c.confidence }));

  return {
    lang: top.lang,
    confidence: top.confidence,
    alternates,
  };
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}'\s\d]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function hasSwAffix(token: string): boolean {
  if (token.length < 4) return false;
  const prefix = SW_PREFIXES.find(
    (p) => token.startsWith(p) && token.length > p.length + 2,
  );
  const suffix = SW_SUFFIXES.find(
    (s) => token.endsWith(s) && token.length > s.length + 2,
  );
  return Boolean(prefix && suffix);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Type guard helper: tests if a string is one of the supported
 * dialect codes (mas-tz, suk-tz, etc.). Exported for downstream
 * callers that route based on dialect tag.
 */
export function isDialectLangCode(
  lang: string,
): lang is Exclude<ShortTurnLang, "en" | "sw" | "und"> {
  return (
    lang === "mas-tz" ||
    lang === "suk-tz" ||
    lang === "cha-tz" ||
    lang === "heh-tz" ||
    lang === "hay-tz" ||
    lang === "nym-tz" ||
    lang === "bez-tz"
  );
}

/** Re-export for downstream callers that want to map Dialect -> ShortTurnLang. */
export type { Dialect };
