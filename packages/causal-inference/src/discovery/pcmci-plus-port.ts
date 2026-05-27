/**
 * PCMCI+ port — Python sidecar bridge to tigramite.
 *
 * The reference implementation of PCMCI+ (Runge et al., Nature
 * Communications 2019) lives in Python (`tigramite`). Re-
 * implementing PCMCI+ in TypeScript is out of scope for v0.1.0;
 * instead this module marshals a request to an injected Python
 * sidecar port. When the port is absent or returns a "not available"
 * sentinel, the consumer falls back to pairwise Granger.
 *
 * Wire protocol (sidecar payload):
 *
 *   {
 *     "variables": ["fuel_price", "production", "weather"],
 *     "series": [[..n samples..], [..n samples..], [..n samples..]],
 *     "max_lag": 5,
 *     "alpha": 0.05
 *   }
 *
 * Wire protocol (sidecar response):
 *
 *   {
 *     "graph": {
 *        "nodes": [...],
 *        "edges": [{"from": "fuel_price", "to": "production", "lag": 1}, ...]
 *     },
 *     "p_values": { "fuel_price->production@1": 0.003, ... },
 *     "max_lag": 5
 *   }
 *
 * Reference: <https://github.com/jakobrunge/tigramite>; Runge et al.
 * "Inferring causation from time series in Earth system sciences"
 * (Nature Communications 2019).
 *
 * @module @borjie/causal-inference/discovery/pcmci-plus-port
 */

import {
  CausalInferenceError,
  type CausalEdge,
  type CausalGraph,
  type PCMCIResult,
  type PythonSidecarPort,
} from '../types.js';

export interface PcmciPlusOptions {
  /** Maximum lag in periods. Default 3. */
  readonly maxLag?: number;
  /** Significance level for conditional-independence tests. Default 0.05. */
  readonly alpha?: number;
}

export interface PcmciPlusRequest {
  readonly variables: ReadonlyArray<string>;
  readonly series: ReadonlyArray<ReadonlyArray<number>>;
  readonly options?: PcmciPlusOptions;
}

/**
 * Call the tigramite sidecar via `port`. Returns `null` when the port
 * is absent or signals unavailability — callers should then degrade
 * gracefully to pairwise Granger.
 */
export async function runPcmciPlus(
  port: PythonSidecarPort | null,
  request: PcmciPlusRequest,
): Promise<PCMCIResult | null> {
  if (port === null) return null;
  validateRequest(request);
  const response = await port.call({
    kind: 'pcmci-plus',
    payload: {
      variables: request.variables,
      series: request.series,
      max_lag: request.options?.maxLag ?? 3,
      alpha: request.options?.alpha ?? 0.05,
    },
  });
  if (response === null) return null;
  if (!response.ok) {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      `pcmci-plus sidecar error: ${response.error ?? 'unknown'}`,
    );
  }
  return parseResult(response.result ?? {});
}

function validateRequest(req: PcmciPlusRequest): void {
  if (req.variables.length === 0) {
    throw new CausalInferenceError(
      'INVALID_TIME_SERIES',
      'pcmci-plus: empty variables list',
    );
  }
  if (req.variables.length !== req.series.length) {
    throw new CausalInferenceError(
      'INVALID_TIME_SERIES',
      `pcmci-plus: variables length ${req.variables.length} does not match series length ${req.series.length}`,
    );
  }
  const firstSeries = req.series[0];
  if (firstSeries === undefined || firstSeries.length === 0) {
    throw new CausalInferenceError(
      'INVALID_TIME_SERIES',
      'pcmci-plus: empty first series',
    );
  }
  const n = firstSeries.length;
  for (const s of req.series) {
    if (s.length !== n) {
      throw new CausalInferenceError(
        'INVALID_TIME_SERIES',
        'pcmci-plus: ragged series; all variables must have equal sample count',
      );
    }
  }
}

function parseResult(raw: Readonly<Record<string, unknown>>): PCMCIResult {
  const graphRaw = raw['graph'];
  if (graphRaw === undefined || typeof graphRaw !== 'object') {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      'pcmci-plus: malformed sidecar response (missing graph)',
    );
  }
  const graph = graphRaw as Record<string, unknown>;
  const nodesRaw = graph['nodes'];
  if (!Array.isArray(nodesRaw)) {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      'pcmci-plus: malformed sidecar response (graph.nodes not an array)',
    );
  }
  const nodes: string[] = nodesRaw.map((n) => String(n));
  const edgesRaw = graph['edges'];
  if (!Array.isArray(edgesRaw)) {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      'pcmci-plus: malformed sidecar response (graph.edges not an array)',
    );
  }
  const edges: CausalEdge[] = edgesRaw.map((e) => {
    const rec = e as Record<string, unknown>;
    const lagVal = rec['lag'];
    return {
      from: String(rec['from'] ?? ''),
      to: String(rec['to'] ?? ''),
      ...(lagVal !== undefined ? { lag: Number(lagVal) } : {}),
    };
  });
  const pValuesRaw = raw['p_values'];
  const pValues: Record<string, number> = {};
  if (
    pValuesRaw !== undefined &&
    typeof pValuesRaw === 'object' &&
    pValuesRaw !== null
  ) {
    for (const [k, v] of Object.entries(
      pValuesRaw as Record<string, unknown>,
    )) {
      pValues[k] = Number(v);
    }
  }
  const causalGraph: CausalGraph = Object.freeze({
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
  return Object.freeze({
    graph: causalGraph,
    pValues: Object.freeze(pValues),
    maxLag: Number(raw['max_lag'] ?? 0),
  });
}
