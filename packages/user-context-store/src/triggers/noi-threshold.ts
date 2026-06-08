/**
 * NOI materiality-threshold derivation for the `owner.noi_down_*` trigger.
 *
 * PURE — no IO, no clock, no mutation. Given an owner's portfolio and
 * preferences, decide the percentage drop in portfolio NOI that should
 * count as "materially down" for THIS owner, and (when the upstream
 * downturn signal carries a measured magnitude) decide whether the
 * observed drop clears that bar.
 *
 * Source of the threshold, in strict precedence order:
 *
 *   1. TENANT-CONFIGURED — `owner.preferences.noiMaterialDropPct`, a
 *      number in (0, 100] the owner (or their tenant admin) explicitly
 *      set. Validated with zod; an out-of-range / non-numeric value is
 *      ignored and we fall through.
 *
 *   2. COHORT-DERIVED — computed from the owner's OWN per-property NOI
 *      cohort (`properties[].noiAnnualized`). We use the cohort's
 *      coefficient of variation (relative standard deviation) as a
 *      tenant-specific notion of "normal swing", halved so the bar sits
 *      at roughly one standard-deviation-equivalent of relative
 *      dispersion, then clamped to a sane band. A portfolio whose
 *      properties earn wildly different NOI tolerates a larger drop
 *      before it is "abnormal"; a tight, uniform portfolio flags
 *      smaller drops. Requires at least {@link MIN_COHORT_SIZE}
 *      properties with a positive NOI so the statistic is meaningful.
 *
 *   3. CONSERVATIVE DOCUMENTED FALLBACK — only when there is neither a
 *      valid configured value NOR enough cohort data to derive one. We
 *      fall back to {@link FALLBACK_MATERIAL_DROP_PCT}, the long-standing
 *      real-estate materiality convention this rule was historically
 *      named after (`owner.noi_down_10pct`). This is the ONLY magic
 *      number, it is documented as a convention rather than presented as
 *      a measured truth, and it is the floor of the cohort-derived band.
 */
import { z } from 'zod';
import type { OwnerProfile } from '../types.js';

/**
 * Minimum number of positive per-property NOI data points before the
 * cohort statistic is trustworthy. With fewer points the standard
 * deviation is dominated by noise, so we decline to derive and fall
 * back instead.
 */
export const MIN_COHORT_SIZE = 3;

/**
 * Conservative, documented fallback drop percentage. NOT a measured
 * portfolio value — it is the industry materiality convention the rule
 * was named for, used only when no tenant config and no cohort exist.
 */
export const FALLBACK_MATERIAL_DROP_PCT = 10;

/**
 * Lower / upper clamp for the cohort-derived threshold so dispersion
 * outliers can never produce an absurd bar (e.g. 0.1% or 90%). The
 * lower bound equals the documented fallback so the cohort path is
 * always at least as conservative as the convention.
 */
export const MIN_DERIVED_DROP_PCT = FALLBACK_MATERIAL_DROP_PCT;
export const MAX_DERIVED_DROP_PCT = 35;

/** Where a configured threshold came from — surfaced for transparency. */
export type ThresholdSource = 'configured' | 'cohort' | 'fallback';

export interface NoiThreshold {
  /** Percentage drop in portfolio NOI that counts as material, in (0, 100]. */
  readonly dropPct: number;
  /** Provenance of {@link dropPct} — never fabricated as "measured". */
  readonly source: ThresholdSource;
  /** Number of positive per-property NOI points the cohort stat used (0 if none). */
  readonly cohortSize: number;
}

/**
 * Zod schema for the per-owner configured override. Lives in
 * `preferences.noiMaterialDropPct`. Anything failing this is ignored.
 */
const ConfiguredThresholdSchema = z
  .number()
  .finite()
  .gt(0)
  .lte(100);

/**
 * Zod schema for an upstream-measured drop magnitude (percentage points
 * the portfolio NOI fell). Optional — many upstream signals only assert
 * "down" without a number.
 */
const MeasuredDropSchema = z.number().finite().gte(0).lte(100);

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Read the owner-configured override, if present and valid.
 */
function readConfiguredDropPct(profile: OwnerProfile): number | undefined {
  const raw = profile.preferences?.['noiMaterialDropPct'];
  const parsed = ConfiguredThresholdSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Derive a per-portfolio threshold from the dispersion of the owner's
 * own per-property NOI. Returns `undefined` when the cohort is too
 * small to be meaningful.
 */
function deriveCohortDropPct(
  noiValues: ReadonlyArray<number>,
): number | undefined {
  if (noiValues.length < MIN_COHORT_SIZE) return undefined;
  const n = noiValues.length;
  const mean = noiValues.reduce((s, v) => s + v, 0) / n;
  if (mean <= 0) return undefined;
  const variance =
    noiValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  // Coefficient of variation as a percentage = relative dispersion.
  const coefficientOfVariationPct = (stdDev / mean) * 100;
  // Half the relative dispersion ≈ a one-σ-equivalent materiality bar.
  const derived = coefficientOfVariationPct / 2;
  return clamp(derived, MIN_DERIVED_DROP_PCT, MAX_DERIVED_DROP_PCT);
}

/**
 * Resolve the NOI materiality threshold for an owner, following the
 * configured → cohort → fallback precedence documented above.
 */
export function resolveNoiThreshold(profile: OwnerProfile): NoiThreshold {
  const noiValues = profile.properties
    .map((p) => p.noiAnnualized)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);

  const configured = readConfiguredDropPct(profile);
  if (configured !== undefined) {
    return { dropPct: configured, source: 'configured', cohortSize: noiValues.length };
  }

  const cohort = deriveCohortDropPct(noiValues);
  if (cohort !== undefined) {
    return { dropPct: cohort, source: 'cohort', cohortSize: noiValues.length };
  }

  return {
    dropPct: FALLBACK_MATERIAL_DROP_PCT,
    source: 'fallback',
    cohortSize: noiValues.length,
  };
}

/**
 * Parse a measured drop magnitude (percentage points) from an upstream
 * downturn signal's free-form `evidence` string, when present. Looks for
 * the first `NN%` or `NN.N%` token. Returns `undefined` when no parseable
 * magnitude is found — callers then treat the signal as "down, magnitude
 * unknown".
 */
export function parseMeasuredDropPct(evidence: string | undefined): number | undefined {
  if (!evidence) return undefined;
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(evidence);
  if (!match) return undefined;
  const parsed = MeasuredDropSchema.safeParse(Number(match[1]));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Decide whether an observed downturn clears the resolved threshold.
 *
 * - If the upstream provided a measured drop, the trigger fires only
 *   when that drop meets/exceeds the resolved bar — no fabricated number.
 * - If no magnitude was measured, the presence of the upstream "down"
 *   signal is itself the evidence; the resolved threshold then only
 *   informs the user-facing copy. We surface the trigger so the owner
 *   can investigate, exactly as before, but now the copy is honest about
 *   the bar and its provenance.
 */
export function noiDownIsMaterial(args: {
  readonly threshold: NoiThreshold;
  readonly measuredDropPct: number | undefined;
}): boolean {
  if (args.measuredDropPct === undefined) return true;
  return args.measuredDropPct >= args.threshold.dropPct;
}
