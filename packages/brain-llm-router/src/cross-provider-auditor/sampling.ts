/**
 * cross-provider-auditor/sampling — decide whether a response gets a second
 * opinion.
 *
 * Ported from LITFIN `cross-provider-auditor.ts:shouldSampleForAudit`, re-skinned
 * to mining intents. High-stakes numeric/regulatory intents (royalty, pricing,
 * grade, licence, tax) are audited 100%; advisory numeric intents at 25%; an
 * opt-in 5% baseline for everything else.
 *
 * Predictability at 100% is safe because the audit runs AFTER the user receives
 * their reply (it is a reliability net, not a runtime gate), so it cannot be
 * gamed.
 *
 * Pure module. `random` is injectable for deterministic tests.
 */

export const DEFAULT_SAMPLE_RATE = 0.05;
export const ADVISORY_SAMPLE_RATE = 0.25;
export const FULL_SAMPLE_RATE = 1.0;

/**
 * Per-intent sample rate. Mining-domain numeric/regulatory intents are pinned
 * at 100%; softer numeric/advisory intents at 25%. Intent labels describe the
 * *claim type*, never a currency, so nothing currency-specific is encoded.
 */
export const SAMPLE_RATE_BY_INTENT: Readonly<Record<string, number>> = Object.freeze({
  // 100% — numbers that could misstate money, law, or assay
  royalty_query: FULL_SAMPLE_RATE,
  pricing_query: FULL_SAMPLE_RATE,
  rate_query: FULL_SAMPLE_RATE,
  fee_query: FULL_SAMPLE_RATE,
  tax_query: FULL_SAMPLE_RATE,
  regulatory_query: FULL_SAMPLE_RATE,
  licence_query: FULL_SAMPLE_RATE,
  threshold_query: FULL_SAMPLE_RATE,
  grade_query: FULL_SAMPLE_RATE,
  assay_query: FULL_SAMPLE_RATE,
  forex_query: FULL_SAMPLE_RATE,
  // 25% — softer numeric / advisory claims
  benchmark_query: ADVISORY_SAMPLE_RATE,
  commodity_query: ADVISORY_SAMPLE_RATE,
  production_estimate_query: ADVISORY_SAMPLE_RATE,
  // 5% baseline — anything that opts in via `default`
  default: DEFAULT_SAMPLE_RATE,
});

/**
 * Resolve the configured sample rate for an intent. Unknown intents return 0
 * (never audited) UNLESS `treatUnknownAsDefault` is set.
 */
export function sampleRateForIntent(intent: string, treatUnknownAsDefault = false): number {
  const rate = SAMPLE_RATE_BY_INTENT[intent];
  if (rate !== undefined) return rate;
  return treatUnknownAsDefault ? DEFAULT_SAMPLE_RATE : 0;
}

export interface SampleDecisionOptions {
  /** Force a second opinion regardless of intent (e.g. response contains a number on a flagged tenant). */
  readonly forceNumeric?: boolean;
  /** Map unknown intents to the 5% baseline instead of never-audit. */
  readonly treatUnknownAsDefault?: boolean;
  /** Injectable RNG for tests. Default Math.random. */
  readonly random?: () => number;
}

/**
 * Decide whether to run the cross-provider audit for a response.
 * `forceNumeric` pins to 100% (used when the first response actually contains a
 * numeric/regulatory claim, mirroring LITFIN's fast-path).
 */
export function shouldSampleForAudit(intent: string, opts: SampleDecisionOptions = {}): boolean {
  if (opts.forceNumeric) return true;
  const rate = sampleRateForIntent(intent, opts.treatUnknownAsDefault ?? false);
  if (rate <= 0) return false;
  if (rate >= FULL_SAMPLE_RATE) return true;
  const random = opts.random ?? Math.random;
  return random() < rate;
}
