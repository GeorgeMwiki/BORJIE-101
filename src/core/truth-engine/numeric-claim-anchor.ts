/**
 * Numeric Claim Anchor — Post-Generation Validator
 *
 * Final-mile defence for the "AI never invents a number" invariant. Where the
 * truth-engine's prompt-side layer (claim-store + prompt-assembler) makes sure
 * the model SEES verified numbers, this module makes sure the model only
 * EMITS numbers it had a verified anchor for.
 *
 * Anthropic-reviewer note (2026-04-30, pre-pilot fix-C): the credit-officer
 * persona used to ship hardcoded BoT capital ratios, AML thresholds, VAT
 * thresholds and LTV ceilings as static prose. Even after fix-A removed those
 * figures from the prompt, the underlying model has memorised them. This
 * validator is the safety net: scan generated text for any numeric token,
 * and unless the truth-engine has a verified claim with that exact figure
 * (within tolerance), redact it to "[BANK TO CONFIRM]". The caller (chat
 * pipeline or voice path) decides whether to abort, auto-redact, or trigger
 * a research hop.
 *
 * Design principles:
 *   - Pure async function, no I/O on the input string itself (immutable).
 *   - No mutation: returns new strings; original `text` is untouched.
 *   - Heuristic skip-list for borrower-supplied figures ("you said TZS 5M",
 *     "yako ni TZS 12M", "uliyosema") so we do not flag the borrower's own
 *     numbers as unanchored.
 *   - Percentage matching uses ±0.5 absolute-point tolerance (e.g. "12%" is
 *     anchored by a verified claim numericValue=12). Currency matching is
 *     exact on the integer amount after stripping commas.
 *   - Never throws on truth-engine failure: a DB error fails-closed (treat
 *     all numbers as unanchored) so the redacted output is still safe.
 *
 * 2026-04-30 H4 hardening pass:
 *   - NFKC-normalise input first so fullwidth `％`, `＄`, fullwidth digits
 *     fold to ASCII before regexes run.
 *   - Extended PERCENT_REGEX to accept `％` (fullwidth), `pct`, `pp`, `bps`,
 *     `‰` (per mille), and `basis points` so the model can't smuggle a
 *     regulatory figure through unit-name variants.
 *   - Extended CURRENCY_REGEX to accept `Sh`, `USD`, `$` in addition to
 *     `TZS` / `TSh`.
 *   - Added Swahili financial stop-word context: when `riba`, `deni`,
 *     `dhamana`, `mtaji`, or `mkopo wangu` appears within the matching
 *     window, the figure's regulatory interpretation is suspect. We log
 *     the case but do NOT auto-redact — the borrower may simply be
 *     stating their own loan / interest / collateral situation.
 *   - Ratio regex unchanged but documented as `\d+\s*:\s*\d+` form.
 *   - Tolerance bands per type are PRESERVED (existing logic).
 *
 * @module core/truth-engine/numeric-claim-anchor
 */

import { createLogger } from "@/lib/logger";

import { searchFreshClaims } from "./claim-store";
import type { TruthClaimRow } from "./types";

const log = createLogger("NumericClaimAnchor");

// ============================================================================
// Public types
// ============================================================================

export interface UnanchoredFigure {
  readonly figure: string; // e.g. "12%" or "TZS 10,000,000"
  readonly context: string; // ~80-char window around the match
  readonly reason: "no_verified_claim" | "search_failed" | "outside_tolerance";
}

export interface NumericAnchorResult {
  readonly safe: boolean; // false = at least one unanchored figure
  readonly unanchored: readonly UnanchoredFigure[];
  readonly redactedText: string; // unanchored figures replaced with "[BANK TO CONFIRM]"
  readonly anchoredCount: number;
  readonly scannedCount: number;
}

export type AnchorJurisdiction = "TZ" | "GLOBAL";

// ============================================================================
// Internals
// ============================================================================

/**
 * Tolerance for percentage matching. A model emitting "12.3%" against a
 * verified claim of numericValue=12 would still anchor; "13.5%" would not.
 */
const PERCENT_TOLERANCE = 0.5;

/** Context window (chars on each side of a numeric match) included in the report. */
const CONTEXT_WINDOW = 40;

/**
 * Heuristic phrases that mark the figure as borrower-supplied rather than
 * AI-asserted. Lower-cased match. Any of these appearing in the preceding
 * window short-circuits the anchor check.
 */
const BORROWER_OWNED_PHRASES: readonly string[] = [
  "you said",
  "you mentioned",
  "you told me",
  "the borrower's",
  "the borrower said",
  "the borrower mentioned",
  "your monthly",
  "your reported",
  "your revenue",
  "your income",
  "your expenses",
  "your turnover",
  "your business",
  "your salary",
  "your equity",
  "your investment",
  "your savings",
  "your loan",
  "your collateral",
  "your valuation",
  // Swahili equivalents
  "uliyosema",
  "ulinieleza",
  "uliniambia",
  "yako ni",
  "yako ya",
  "biashara yako",
  "kipato chako",
  "mapato yako",
];

/**
 * Numeric token kinds we extract.
 *
 *   - "percent"   : "12%", "12.5 %", "12 percent"
 *   - "currency"  : "TZS 10,000,000", "TZS 10M", "TSh 5,000"
 *   - "ratio"     : "1:5", "2:1"
 *
 * Day-counts and bare integers are intentionally NOT scanned: too noisy (the
 * model frequently writes "step 3 of 7" or "7 days" in non-regulatory
 * contexts). The persona layer pushes the model to defer for those anyway.
 */
type NumericKind = "percent" | "currency" | "ratio";

interface NumericMatch {
  readonly raw: string; // exact substring as it appears in source text
  readonly kind: NumericKind;
  readonly numericValue: number; // for currency, the TZS amount; for percent, the percentage
  readonly start: number; // index in source text
  readonly end: number;
}

/**
 * H4: extended unit list. Includes ASCII `%`, fullwidth `％`, prose
 * `percent`, `pct`, percentage-point `pp`, basis-point variants
 * (`bps`, `basis point[s]`), and per-mille `‰`. The capture group is
 * the numeric value (always interpreted as a percentage; bps gets
 * scaled below in {@link parsePercent}).
 */
const PERCENT_REGEX =
  /(\d+(?:\.\d+)?)\s*(%|％|percent|pct|pp|‰|bps|basis\s*points?)\b/gi;

/**
 * H4: currency regex now also accepts `Sh`, `USD`, and bare `$`. The
 * leading group is the currency token (we don't currently distinguish
 * — all anchored to TZS in the claim store — but capturing it makes
 * the regex easier to read and future-proof).
 */
const CURRENCY_REGEX =
  /(TZS|TSh|Sh|USD|\$)\s*([\d,]+(?:\.\d+)?)\s*(M|million|K|thousand|B|billion)?\b/gi;

/**
 * Ratio: `1:5`, `2 : 1`, also the `x` form (`1.25x`). Matches a
 * numeric pair separated by `:` or `x` (case-insensitive on x).
 */
const RATIO_REGEX = /\b(\d+(?:\.\d+)?)\s*[:x]\s*(\d+(?:\.\d+)?)\b/gi;

/**
 * H4: Swahili financial stop-words. When one appears within the
 * preceding context window, the regulatory interpretation of the
 * figure is suspect — the borrower is likely talking about their own
 * loan / interest / collateral, not a regulator-mandated number. We
 * log the case for review but do NOT auto-redact.
 */
const SWAHILI_FINANCIAL_STOPWORDS: ReadonlyArray<string> = [
  "riba", // interest
  "deni", // debt
  "dhamana", // collateral / guarantee
  "mtaji", // capital
  "mkopo wangu", // my loan
];

function parseCurrency(rawDigits: string, suffix?: string): number {
  const stripped = rawDigits.replace(/,/g, "");
  const base = Number.parseFloat(stripped);
  if (Number.isNaN(base)) return Number.NaN;
  const s = (suffix ?? "").toLowerCase();
  if (s === "m" || s === "million") return base * 1_000_000;
  if (s === "k" || s === "thousand") return base * 1_000;
  if (s === "b" || s === "billion") return base * 1_000_000_000;
  return base;
}

/**
 * H4: convert a percent-family unit token to a percentage value. The
 * captured numeric value (e.g. `12`) is multiplied / divided so that
 * the FINAL `numericValue` we hand to the anchor check is always in
 * "percent" units regardless of how the model wrote it.
 *
 *   `12%`         -> 12
 *   `12％`        -> 12 (NFKC fold drops to ASCII before this fires)
 *   `12 percent`  -> 12
 *   `12 pct`      -> 12
 *   `200 bps`     -> 2     (basis points: divide by 100)
 *   `5 ‰`         -> 0.5   (per mille: divide by 10)
 *   `1.5 pp`      -> 1.5   (percentage point — same scale as %)
 *
 * Unknown unit string falls back to the bare numeric value.
 */
function parsePercentValue(raw: number, unit: string | undefined): number {
  const u = (unit ?? "").trim().toLowerCase();
  if (u === "bps" || u === "basis point" || u === "basis points") {
    return raw / 100;
  }
  if (u === "‰") {
    return raw / 10;
  }
  // %, ％, percent, pct, pp — all already in percent units.
  return raw;
}

/**
 * Extract all numeric tokens from `text`. Returns a sorted, non-overlapping
 * list (longest match wins on overlap, currency > ratio > percent).
 */
function extractNumericTokens(text: string): readonly NumericMatch[] {
  const found: NumericMatch[] = [];

  for (const m of text.matchAll(CURRENCY_REGEX)) {
    if (m.index === undefined) continue;
    // H4: capture indices shifted — m[1] is the currency token,
    // m[2] is the digit string, m[3] is the optional scale suffix.
    const numericValue = parseCurrency(m[2] ?? "", m[3]);
    if (Number.isNaN(numericValue)) continue;
    found.push({
      raw: m[0],
      kind: "currency",
      numericValue,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  for (const m of text.matchAll(PERCENT_REGEX)) {
    if (m.index === undefined) continue;
    const rawValue = Number.parseFloat(m[1] ?? "");
    if (Number.isNaN(rawValue)) continue;
    // H4: normalise bps / per-mille / pp / pct / ％ to plain percent
    // units before the anchor check so 200bps is comparable to a
    // verified claim numericValue=2.
    const numericValue = parsePercentValue(rawValue, m[2]);
    found.push({
      raw: m[0],
      kind: "percent",
      numericValue,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  for (const m of text.matchAll(RATIO_REGEX)) {
    if (m.index === undefined) continue;
    const left = Number.parseFloat(m[1] ?? "");
    const right = Number.parseFloat(m[2] ?? "");
    if (Number.isNaN(left) || Number.isNaN(right) || right === 0) continue;
    found.push({
      raw: m[0],
      kind: "ratio",
      numericValue: left / right,
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Sort by start, then resolve overlaps by preferring longer (richer) matches
  const sorted = [...found].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.end - b.start - (a.end - a.start);
  });

  const result: NumericMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

/**
 * Decide whether the figure was supplied by the borrower (skip anchor check)
 * by looking at the ~60-char window IMMEDIATELY PRECEDING the match for a
 * pronouny / quote phrase. Lower-cased and Unicode-tolerant.
 */
function isBorrowerSupplied(text: string, matchStart: number): boolean {
  const windowStart = Math.max(0, matchStart - 60);
  const before = text.slice(windowStart, matchStart).toLowerCase();
  return BORROWER_OWNED_PHRASES.some((phrase) => before.includes(phrase));
}

/**
 * Compute a context window for reporting unanchored figures.
 */
function contextSlice(text: string, start: number, end: number): string {
  const a = Math.max(0, start - CONTEXT_WINDOW);
  const b = Math.min(text.length, end + CONTEXT_WINDOW);
  return text.slice(a, b).replace(/\s+/g, " ").trim();
}

/**
 * Check whether any verified claim contains the same numeric value within
 * tolerance. Returns true if anchored, false otherwise.
 */
function isAnchoredByClaim(
  match: NumericMatch,
  claims: readonly TruthClaimRow[],
): boolean {
  for (const claim of claims) {
    if (claim.numeric_value === null) continue;

    if (match.kind === "percent") {
      if (
        Math.abs(claim.numeric_value - match.numericValue) <= PERCENT_TOLERANCE
      ) {
        return true;
      }
    } else if (match.kind === "currency") {
      // Exact match on the integer amount (commas already stripped); allow
      // 0.1% relative tolerance for very large numbers (rounding noise).
      const tolerance = Math.max(1, Math.abs(claim.numeric_value) * 0.001);
      if (Math.abs(claim.numeric_value - match.numericValue) <= tolerance) {
        return true;
      }
    } else {
      // Ratio: tolerance ±0.05 on the divided value (e.g. 1.25x ± 0.05).
      if (Math.abs(claim.numeric_value - match.numericValue) <= 0.05) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Replace each unanchored figure with a redaction marker, scanning the source
 * text right-to-left so earlier match indexes remain valid.
 */
function redact(text: string, unanchored: readonly NumericMatch[]): string {
  if (unanchored.length === 0) return text;
  const sorted = [...unanchored].sort((a, b) => b.start - a.start);
  let out = text;
  for (const m of sorted) {
    out = `${out.slice(0, m.start)}[BANK TO CONFIRM]${out.slice(m.end)}`;
  }
  return out;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Post-generation numeric anchor check.
 *
 * Scans `text` for percentage / currency / ratio tokens, and for each one that
 * is NOT clearly attributed to the borrower, requires a verified truth_claim
 * (jurisdiction-scoped) whose numeric_value matches within tolerance.
 *
 * Unanchored figures are redacted to "[BANK TO CONFIRM]" in the returned
 * `redactedText`. The original `text` is never mutated.
 *
 * Fail-closed: if the truth-engine search throws or returns nothing for a
 * numeric token, that token is treated as unanchored. The result is safe to
 * surface to the user (model emits no number it cannot back).
 */
export async function anchorNumericClaims(
  text: string,
  jurisdiction: AnchorJurisdiction,
): Promise<NumericAnchorResult> {
  // H4: NFKC normalise FIRST so fullwidth `％`, `＄` etc. fold to their
  // ASCII equivalents before any regex runs. Scanning offsets stay
  // consistent because we use the normalised text everywhere downstream
  // (extraction, borrower-supplied detection, redact) — never mix raw
  // and normalised offsets.
  const normalised = text.normalize("NFKC");
  const matches = extractNumericTokens(normalised);

  if (matches.length === 0) {
    return {
      safe: true,
      unanchored: [],
      redactedText: normalised,
      anchoredCount: 0,
      scannedCount: 0,
    };
  }

  // Fetch verified claims once for the jurisdiction. The store already filters
  // to status='verified' AND fresh next_refresh_at, so anything we get back is
  // citable. Pull a generous batch — the schema-side numeric uniqueness keeps
  // this small in practice (typical ~50 numeric claims per jurisdiction).
  let verifiedClaims: readonly TruthClaimRow[] = [];
  let searchFailed = false;
  try {
    verifiedClaims = await searchFreshClaims({
      jurisdiction,
      limit: 200,
    });
  } catch {
    searchFailed = true;
  }

  const unanchoredMatches: NumericMatch[] = [];
  const unanchoredReports: UnanchoredFigure[] = [];

  for (const match of matches) {
    if (isBorrowerSupplied(normalised, match.start)) {
      // Skip: figure is part of a quoted borrower utterance, not an AI assertion.
      continue;
    }

    // H4: Swahili financial stop-word context. When a `riba` / `deni`
    // / `dhamana` / `mtaji` / `mkopo wangu` appears within the
    // preceding window, the regulatory interpretation is suspect — the
    // borrower may be discussing their own loan / interest /
    // collateral. Log for review but do NOT auto-redact: anchored
    // claims still anchor; unanchored ones still get [BANK TO CONFIRM].
    if (hasSwahiliFinancialContext(normalised, match.start)) {
      log.info("Swahili financial context near figure (review)", {
        figure: match.raw.trim(),
        context: contextSlice(normalised, match.start, match.end),
      });
    }

    if (searchFailed) {
      unanchoredMatches.push(match);
      unanchoredReports.push({
        figure: match.raw.trim(),
        context: contextSlice(normalised, match.start, match.end),
        reason: "search_failed",
      });
      continue;
    }

    if (!isAnchoredByClaim(match, verifiedClaims)) {
      unanchoredMatches.push(match);
      unanchoredReports.push({
        figure: match.raw.trim(),
        context: contextSlice(normalised, match.start, match.end),
        reason: "no_verified_claim",
      });
    }
  }

  const redactedText = redact(normalised, unanchoredMatches);
  const scannedCount = matches.length;
  const anchoredCount = scannedCount - unanchoredMatches.length;

  return {
    safe: unanchoredMatches.length === 0,
    unanchored: unanchoredReports,
    redactedText,
    anchoredCount,
    scannedCount,
  };
}

/**
 * H4: returns true if any Swahili financial stop-word appears in the
 * 80-char window preceding the match. Used to flag (but NOT redact)
 * figures whose regulatory interpretation is suspect. Lower-cased
 * substring match — token boundaries aren't required because the
 * stop-words are reasonably specific Swahili lexemes.
 */
function hasSwahiliFinancialContext(text: string, matchStart: number): boolean {
  const windowStart = Math.max(0, matchStart - 80);
  const before = text.slice(windowStart, matchStart).toLowerCase();
  return SWAHILI_FINANCIAL_STOPWORDS.some((sw) => before.includes(sw));
}
