/**
 * Bayesian decider — per spec §7.
 *
 * Beta-Binomial conjugate model for binary outcomes (conversion or
 * not). Each variant has a prior Beta(1, 1) (uniform); posterior
 * after `samples` observations with `conversions` successes is
 * Beta(1 + conversions, 1 + samples - conversions).
 *
 * For two variants A and B, the win-probability P(p_B > p_A) is
 * computed via Monte Carlo sampling (10k draws) — adequate for the
 * traffic volumes seen at campaign scale and avoids dependency on
 * a heavyweight stats library.
 */

export interface VariantStat {
  readonly id: string;
  readonly samples: number;
  readonly conversions: number;
}

export interface DecisionInput {
  readonly variants: ReadonlyArray<VariantStat>;
  readonly min_sample_size: number;
  readonly significance_alpha: number;
  readonly monte_carlo_samples?: number;
}

export interface DecisionResult {
  readonly variant_id: string;
  readonly bayes_posterior: number;
  readonly is_winner: boolean;
}

const DEFAULT_MC_SAMPLES = 10_000;
const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;

/**
 * Compute per-variant posterior win-probability vs. all others.
 * Returns one result per variant with `bayes_posterior` ∈ [0,1] and
 * `is_winner = bayes_posterior >= (1 - alpha)` when min samples met.
 */
export function decideWinner(input: DecisionInput): ReadonlyArray<DecisionResult> {
  if (input.variants.length === 0) {
    return Object.freeze([]);
  }
  const mc = input.monte_carlo_samples ?? DEFAULT_MC_SAMPLES;
  const draws = input.variants.map((v) => sampleBeta(v, mc));

  const totalSamples = input.variants.reduce((s, v) => s + v.samples, 0);
  const eligible = totalSamples >= input.min_sample_size;
  const threshold = 1 - input.significance_alpha;

  const results: Array<DecisionResult> = [];
  for (let i = 0; i < input.variants.length; i++) {
    const myDraws = draws[i];
    if (myDraws === undefined) {
      continue;
    }
    let wins = 0;
    for (let s = 0; s < mc; s++) {
      let isMax = true;
      const me = myDraws[s] ?? 0;
      for (let j = 0; j < input.variants.length; j++) {
        if (j === i) continue;
        const other = draws[j]?.[s] ?? 0;
        if (other > me) {
          isMax = false;
          break;
        }
      }
      if (isMax) {
        wins += 1;
      }
    }
    const posterior = wins / mc;
    const variant = input.variants[i];
    if (variant === undefined) {
      continue;
    }
    results.push({
      variant_id: variant.id,
      bayes_posterior: posterior,
      is_winner: eligible && posterior >= threshold,
    });
  }
  return Object.freeze(results);
}

/**
 * Draw `count` samples from Beta(alpha, beta) using the
 * Marsaglia-Tsang ratio-of-gammas method via two gamma draws.
 */
function sampleBeta(v: VariantStat, count: number): ReadonlyArray<number> {
  const alpha = PRIOR_ALPHA + v.conversions;
  const beta = PRIOR_BETA + Math.max(0, v.samples - v.conversions);
  const out: Array<number> = [];
  for (let i = 0; i < count; i++) {
    const ga = sampleGamma(alpha);
    const gb = sampleGamma(beta);
    out.push(ga / (ga + gb));
  }
  return out;
}

/**
 * Marsaglia-Tsang gamma sampler for shape >= 1; for shape < 1 uses
 * Ahrens-Dieter Stuart's boosting trick.
 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = randomNormal();
    let v = 1 + c * x;
    while (v <= 0) {
      x = randomNormal();
      v = 1 + c * x;
    }
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
}

function randomNormal(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
