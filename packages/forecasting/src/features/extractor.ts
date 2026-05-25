/**
 * FeatureExtractor — builds a FeatureVector for a ForecastScope by
 * composing three sources:
 *
 *   1. tabular  — node attributes from Postgres read-replica via the
 *                 `TabularSource` port
 *   2. graph    — k-hop neighbourhood aggregates from Neo4j/Memgraph
 *                 via the `GraphSource` port
 *   3. temporal — event sequence from the audit trail / heartbeat via
 *                 the `TemporalSource` port, binned into a fixed-length
 *                 tensor
 *
 * The extractor is deterministic, pure, and tenant-scoped at every
 * source call — the AuthContext is passed down and every source must
 * enforce that it never returns data outside the context's tenant.
 *
 * A `featureFingerprint` (sha-256 over the canonicalized feature JSON)
 * is computed alongside the vector. The fingerprint is embedded in
 * every Forecast so we can detect when two forecasts that should be
 * equal actually diverged because their features did.
 */

import type {
  AuthContext,
  FeatureVector,
  ForecastScope,
} from '../types.js';
import { canonicalJSON, sha256Hex } from '../util/hash.js';

export interface TabularSource {
  /** Pull tabular features for the scope. MUST enforce tenant isolation. */
  featuresFor(
    scope: ForecastScope,
    ctx: AuthContext,
  ): Promise<Readonly<Record<string, number>>>;
}

export interface GraphSource {
  /** Pull k-hop neighbourhood aggregates for the scope from the
   *  tenant's subgraph. MUST enforce tenant isolation. */
  neighbourhoodAggregatesFor(
    scope: ForecastScope,
    ctx: AuthContext,
  ): Promise<Readonly<Record<string, number>>>;
}

export interface TemporalSource {
  /** Pull the node's events over the horizon-adjusted lookback window
   *  and bin them into a `[timesteps × channels]` tensor. MUST
   *  enforce tenant isolation and a hard cap on timesteps. */
  sequenceTensorFor(
    scope: ForecastScope,
    ctx: AuthContext,
    timesteps: number,
  ): Promise<ReadonlyArray<ReadonlyArray<number>>>;
}

export interface FeatureExtractorOptions {
  /** Number of temporal bins. Default 52 (weekly bins over a year). */
  readonly timesteps?: number;
  /** Clock for deterministic `generatedAt`. Inject in tests. */
  readonly now?: () => Date;
}

export interface FeatureExtractor {
  extract(scope: ForecastScope, ctx: AuthContext): Promise<FeatureVector>;
  /** The fingerprint that WOULD result for the given feature vector,
   *  absent the generatedAt field. Call-site convenience so we don't
   *  re-implement canonicalization downstream. */
  fingerprint(vector: FeatureVector): string;
}

export interface FeatureExtractorDeps {
  readonly tabular: TabularSource;
  readonly graph: GraphSource;
  readonly temporal: TemporalSource;
}

export function createFeatureExtractor(
  deps: FeatureExtractorDeps,
  opts: FeatureExtractorOptions = {},
): FeatureExtractor {
  const timesteps = opts.timesteps ?? 52;
  const now = opts.now ?? (() => new Date());

  async function extract(scope: ForecastScope, ctx: AuthContext): Promise<FeatureVector> {
    assertTenantMatch(scope, ctx);

    // Parallel fetch — no source depends on another
    const [tabular, graph, temporal] = await Promise.all([
      deps.tabular.featuresFor(scope, ctx),
      deps.graph.neighbourhoodAggregatesFor(scope, ctx),
      deps.temporal.sequenceTensorFor(scope, ctx, timesteps),
    ]);

    assertTensorShape(temporal, timesteps);

    const vector: FeatureVector = {
      scope,
      tabular: Object.freeze({ ...tabular }),
      graph: Object.freeze({ ...graph }),
      temporal: Object.freeze(temporal.map((row) => Object.freeze([...row]))),
      generatedAt: now().toISOString(),
    };
    return Object.freeze(vector);
  }

  function fingerprint(vector: FeatureVector): string {
    // Fingerprint excludes generatedAt so two identical feature sets
    // produce the same hash regardless of when they were built.
    const canon = canonicalJSON({
      scope: vector.scope,
      tabular: vector.tabular,
      graph: vector.graph,
      temporal: vector.temporal,
    });
    return sha256Hex(canon);
  }

  return { extract, fingerprint };
}

// ─────────────────────────────────────────────────────────────────────
// Invariants
// ─────────────────────────────────────────────────────────────────────

function assertTenantMatch(scope: ForecastScope, ctx: AuthContext): void {
  if (ctx.kind !== 'tenant') {
    throw new Error(
      'forecasting: per-node feature extraction requires a tenant AuthContext; received ' + ctx.kind,
    );
  }
  if (scope.tenantId !== ctx.tenantId) {
    throw new Error(
      `forecasting: scope tenantId ${scope.tenantId} does not match auth tenantId ${ctx.tenantId}`,
    );
  }
}

function assertTensorShape(
  temporal: ReadonlyArray<ReadonlyArray<number>>,
  timesteps: number,
): void {
  if (temporal.length === 0) {
    // Empty is OK — represents a brand-new node with no history.
    return;
  }
  if (temporal.length !== timesteps) {
    throw new RangeError(
      `forecasting: temporal tensor has ${temporal.length} timesteps, expected ${timesteps}`,
    );
  }
  const channels = temporal[0]!.length;
  for (let i = 0; i < temporal.length; i += 1) {
    if (temporal[i]!.length !== channels) {
      throw new RangeError(
        `forecasting: temporal tensor row ${i} has ${temporal[i]!.length} channels, expected ${channels}`,
      );
    }
    for (const v of temporal[i]!) {
      if (!Number.isFinite(v)) {
        throw new RangeError('forecasting: temporal tensor contains non-finite value');
      }
    }
  }
}
