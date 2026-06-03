/**
 * cross-provider-auditor/claim-extract — pull the primary numeric claim from a
 * model response.
 *
 * Ported from LITFIN `cross-provider-auditor.ts:extractPrimaryClaim`, made
 * currency-neutral: we capture whatever ISO-like currency token / symbol the
 * text uses (3-letter code or a leading symbol) WITHOUT privileging any one
 * currency, honouring Borjie's "never hard-code TZS/USD/…" rule. The auditor
 * only cares about the numeric magnitude + a unit label for divergence math.
 *
 * Pure module: regex + arithmetic, no I/O, never throws.
 */

export interface ExtractedClaim {
  /** The raw matched substring (for the audit excerpt). */
  readonly text: string;
  /** Normalised numeric magnitude (scale-suffix applied), or null. */
  readonly numeric: number | null;
  /** Unit label: an ISO/symbol currency token, 'percent', or null. */
  readonly unit: string | null;
}

// A leading currency symbol OR a 3-letter ISO-style code, then a number, then
// an optional magnitude suffix. We do NOT enumerate specific currencies — any
// 3-letter uppercase token or common symbol qualifies, so no currency is
// hard-coded into the decision path.
const MONEY_RE =
  /(?:\b([A-Z]{3})\b|([$£€]))\s?([\d][\d,]*(?:\.\d+)?)\s?(million|billion|thousand|bn|m|k)?/;

const PERCENT_RE = /([\d]{1,3}(?:\.\d+)?)\s?%/;

function scaleMultiplier(suffix?: string): number {
  if (!suffix) return 1;
  const s = suffix.toLowerCase();
  if (s === 'thousand' || s === 'k') return 1_000;
  if (s === 'million' || s === 'm') return 1_000_000;
  if (s === 'billion' || s === 'bn') return 1_000_000_000;
  return 1;
}

/**
 * Extract the first monetary or percentage figure from a response, with the
 * scale suffix applied. Returns null when no numeric claim is present.
 */
export function extractPrimaryClaim(response: string | null | undefined): ExtractedClaim | null {
  if (!response) return null;

  const money = MONEY_RE.exec(response);
  if (money) {
    const unit = money[1] ?? money[2] ?? null;
    const rawNum = Number.parseFloat((money[3] ?? '').replace(/,/g, ''));
    const multiplier = scaleMultiplier(money[4]);
    return {
      text: money[0].trim(),
      numeric: Number.isFinite(rawNum) ? rawNum * multiplier : null,
      unit: unit ? unit.toUpperCase() : null,
    };
  }

  const percent = PERCENT_RE.exec(response);
  if (percent) {
    const rawNum = Number.parseFloat(percent[1] ?? '');
    return {
      text: percent[0].trim(),
      numeric: Number.isFinite(rawNum) ? rawNum : null,
      unit: 'percent',
    };
  }

  return null;
}

export interface ClaimComparison {
  /** Agreement score in [0,1] (1 = identical / both absent). */
  readonly agreement: number;
  /** True when the two claims diverge beyond tolerance. */
  readonly diverged: boolean;
  /** Categorical reason, or null when not diverged. */
  readonly kind: 'numeric_mismatch' | 'one_missing' | 'contradictory' | null;
}

/**
 * Compare two extracted claims. `tolerance` is the fractional numeric
 * divergence threshold (0.05 = 5%). Pure, never throws.
 */
export function compareClaims(
  a: ExtractedClaim | null,
  b: ExtractedClaim | null,
  tolerance: number,
): ClaimComparison {
  if (!a && !b) return { agreement: 1, diverged: false, kind: null };
  if (!a || !b) return { agreement: 0, diverged: true, kind: 'one_missing' };

  if (a.numeric === null || b.numeric === null) {
    // Text-only comparison.
    const same = a.text.toLowerCase() === b.text.toLowerCase();
    return {
      agreement: same ? 1 : 0.5,
      diverged: !same,
      kind: same ? null : 'contradictory',
    };
  }

  const larger = Math.max(Math.abs(a.numeric), Math.abs(b.numeric));
  if (larger === 0) return { agreement: 1, diverged: false, kind: null };

  const diff = Math.abs(a.numeric - b.numeric) / larger;
  const agreement = Math.max(0, 1 - diff);
  const diverged = diff > tolerance;
  return { agreement, diverged, kind: diverged ? 'numeric_mismatch' : null };
}
