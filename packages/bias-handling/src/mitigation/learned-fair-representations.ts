/**
 * Pre-processing mitigation: **Learned Fair Representations
 * (config-driven projector)**.
 *
 * Zemel et al. ICML 2013 train an encoder that maps features into
 * a latent space where the protected attribute cannot be recovered
 * while preserving utility for downstream tasks. The full encoder
 * requires a trainable model. We ship a deterministic
 * config-driven projector that:
 *   - drops a configurable list of *protected proxy* fields (we
 *     do not learn which — the caller knows their data),
 *   - optionally rounds / bucketises remaining features to reduce
 *     their information content (a la k-anonymity).
 *
 * For a learned encoder, swap this for a Python sidecar via
 * the same `FairRepresentationProjector` interface.
 *
 * Tradeoffs:
 *  - Manual proxy list — risk of missing proxies the model can
 *    still exploit (e.g. zip-code as a proxy for race).
 *  - Bucketising costs utility on continuous features.
 *  - No causal guarantees — use alongside counterfactual
 *    fairness checks (@borjie/fairness-eval) for assurance.
 */

export interface FairRepresentationConfig {
  /** Field names to drop from each row (protected attribute + proxies). */
  readonly dropFields: ReadonlyArray<string>;
  /**
   * Optional per-field bucketisation. Numeric fields only.
   * `bucketSize` is the bin width; e.g. `{ income: 5000 }` will
   * round all incomes down to the nearest 5000.
   */
  readonly bucketise?: Readonly<Record<string, number>>;
}

export interface FairRepresentationProjector {
  project<T extends Record<string, unknown>>(row: T): Record<string, unknown>;
  batch<T extends Record<string, unknown>>(rows: ReadonlyArray<T>): ReadonlyArray<Record<string, unknown>>;
}

export function learnedFairRepresentations(
  config: FairRepresentationConfig,
): FairRepresentationProjector {
  const dropSet = new Set(config.dropFields);
  const buckets = config.bucketise ?? {};
  function project<T extends Record<string, unknown>>(
    row: T,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (dropSet.has(k)) continue;
      const bucket = buckets[k];
      if (bucket !== undefined && typeof v === 'number' && Number.isFinite(v)) {
        out[k] = Math.floor(v / bucket) * bucket;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return {
    project,
    batch(rows) {
      return rows.map((r) => project(r));
    },
  };
}
