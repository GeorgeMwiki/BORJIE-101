/**
 * Correlation detector — nightly belief × outcome Pearson pass.
 *
 * For each (sector, region, metric) cell, compute Pearson r between a numeric
 * belief's central value and an anonymised estate-outcome series. Surface
 * findings where:
 *
 *     |r| > R_THRESHOLD (0.4) AND p < P_THRESHOLD (0.05) AND n >= minSampleSize (30)
 *
 * The belief-engine never reads the outcome warehouse directly — the caller
 * injects an `outcomeFetcher` + the belief list (or a `BeliefStorePort`). The
 * Pearson + p-value math is PURE and exported for tests.
 *
 * Ported from LITFIN litfin-ai/learning/correlation-detector.ts (re-skinned:
 * borrower → estate outcomes; no default/credit metrics baked in — the metric
 * name is whatever the injected fetcher returns).
 */

import type {
  Belief,
  BeliefDomain,
  BeliefStorePort,
  CorrelationFinding,
} from './types.js';

export const DEFAULT_MIN_SAMPLE = 30;
export const R_THRESHOLD = 0.4;
export const P_THRESHOLD = 0.05;

export interface OutcomeRow {
  readonly sector: string | null;
  readonly region: string | null;
  readonly metric: string;
  readonly value: number;
}

/** Injected outcome source — returns anonymised estate-outcome rows. */
export type OutcomeFetcher = () => Promise<ReadonlyArray<OutcomeRow>>;

export interface FindCorrelationsArgs {
  readonly domain?: BeliefDomain;
  readonly minSampleSize?: number;
  readonly now?: () => number;
}

export interface FindCorrelationsDeps {
  readonly store: BeliefStorePort;
  readonly outcomeFetcher: OutcomeFetcher;
}

/**
 * Run the nightly pass. Returns the findings (also handed back so the caller
 * can persist them to `correlation_findings`). Degrades to `[]` when there
 * are no numeric beliefs or no outcomes.
 */
export async function findCorrelations(
  args: FindCorrelationsArgs,
  deps: FindCorrelationsDeps,
): Promise<ReadonlyArray<CorrelationFinding>> {
  const minSample = args.minSampleSize ?? DEFAULT_MIN_SAMPLE;
  const domain = args.domain ?? 'sector-economics';
  const nowIso = new Date((args.now ?? Date.now)()).toISOString();

  const beliefs = await deps.store.listByDomain(domain, 500);
  const numericBeliefs = beliefs.filter(hasNumericValue);
  if (numericBeliefs.length === 0) return [];

  const outcomes = await deps.outcomeFetcher();
  if (outcomes.length === 0) return [];

  const grouped = groupOutcomes(outcomes);
  const findings: CorrelationFinding[] = [];

  for (const [cellKey, rows] of grouped.entries()) {
    if (rows.length < minSample) continue;
    const [sector, region, metric] = cellKey.split('|');
    const outcomeSeries = rows.map((r) => r.value);

    for (const belief of numericBeliefs) {
      const beliefSeries = projectBeliefAsSeries(belief, rows.length);
      if (beliefSeries.length !== outcomeSeries.length) continue;
      const { r, p } = pearson(beliefSeries, outcomeSeries);
      if (
        Number.isFinite(r) &&
        Number.isFinite(p) &&
        Math.abs(r) > R_THRESHOLD &&
        p < P_THRESHOLD
      ) {
        findings.push({
          id: '',
          sector: sector || null,
          region: region || null,
          beliefSubject: belief.subject,
          outcomeMetric: metric,
          r,
          p,
          n: rows.length,
          summary: summariseFinding(belief, sector, region, metric, r, p, rows.length),
          generatedAt: nowIso,
        });
      }
    }
  }
  return findings;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hasNumericValue(b: Belief): boolean {
  if (b.value.kind === 'scalar' && typeof b.value.scalar === 'number') {
    return true;
  }
  return (
    b.value.kind === 'range' &&
    typeof b.value.rangeMin === 'number' &&
    typeof b.value.rangeMax === 'number'
  );
}

function projectBeliefAsSeries(b: Belief, n: number): number[] {
  const v =
    b.value.kind === 'scalar'
      ? (b.value.scalar ?? 0)
      : ((b.value.rangeMin ?? 0) + (b.value.rangeMax ?? 0)) / 2;
  return new Array<number>(n).fill(v);
}

function groupOutcomes(
  rows: ReadonlyArray<OutcomeRow>,
): Map<string, OutcomeRow[]> {
  const map = new Map<string, OutcomeRow[]>();
  for (const r of rows) {
    const key = `${r.sector ?? ''}|${r.region ?? ''}|${r.metric}`;
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }
  return map;
}

export interface PearsonResult {
  readonly r: number;
  readonly p: number;
}

/**
 * Pearson r + two-sided p-value (Fisher z-transform → normal approximation).
 * PURE + exported for tests.
 */
export function pearson(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
): PearsonResult {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return { r: NaN, p: 1 };
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return { r: 0, p: 1 };
  const r = num / denom;
  if (Math.abs(r) >= 1) return { r, p: 0 };
  const z = Math.atanh(Math.max(-0.9999, Math.min(0.9999, r))) * Math.sqrt(n - 3);
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return { r, p };
}

function mean(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Abramowitz & Stegun 26.2.17 — error < 7.5e-8. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const cdf =
    1 -
    d *
      (0.31938153 * t -
        0.356563782 * t * t +
        1.781477937 * t * t * t -
        1.821255978 * t * t * t * t +
        1.330274429 * t * t * t * t * t);
  return z >= 0 ? cdf : 1 - cdf;
}

function summariseFinding(
  belief: Belief,
  sector: string,
  region: string,
  metric: string,
  r: number,
  p: number,
  n: number,
): string {
  const dir = r > 0 ? 'positively' : 'negatively';
  const where = [sector, region].filter(Boolean).join(' / ') || 'platform-wide';
  return `Belief '${belief.subject}' correlates ${dir} (r=${r.toFixed(2)}, p=${p.toFixed(3)}) with '${metric}' in ${where} (n=${n}).`;
}
