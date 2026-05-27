/**
 * DoWhy ATE port — Python sidecar bridge to py-why/dowhy.
 *
 * For arbitrary causal graphs with multiple confounders, the four-
 * step (model -> identify -> estimate -> refute) pipeline of DoWhy
 * is the reference. We do not re-implement DoWhy in TypeScript;
 * instead this port marshals a payload to a Python sidecar.
 *
 * When the port is absent (null) or returns a sentinel, the caller
 * is expected to fall back to a pure-TS estimator (DiD or back-door
 * regression).
 *
 * Wire protocol (sidecar payload):
 *
 *   {
 *     "graph": { "nodes": [...], "edges": [...] },
 *     "treatment": "shift_schedule",
 *     "outcome": "incident_rate",
 *     "data": { "shift_schedule": [...], "incident_rate": [...], ... },
 *     "method": "backdoor.linear_regression"
 *   }
 *
 * Wire protocol (sidecar response):
 *
 *   {
 *     "ate": 1.23,
 *     "ci_low": 0.45,
 *     "ci_high": 2.01,
 *     "se": 0.39,
 *     "n": 500,
 *     "identification": "backdoor"
 *   }
 *
 * Reference: <https://github.com/py-why/dowhy>; Azure AI Causal
 * Inference (<https://learn.microsoft.com/en-us/azure/machine-learning/concept-causal-inference>).
 *
 * @module @borjie/causal-inference/estimate/dowhy-port
 */

import {
  CausalInferenceError,
  type CausalGraph,
  type IdentificationStrategy,
  type PythonSidecarPort,
  type TreatmentEffect,
} from '../types.js';

export interface DowhyEstimateRequest {
  readonly graph: CausalGraph;
  readonly treatment: string;
  readonly outcome: string;
  readonly data: Readonly<Record<string, ReadonlyArray<number>>>;
  /** Estimation method (DoWhy method string). Default "backdoor.linear_regression". */
  readonly method?: string;
}

export async function runDowhyAte(
  port: PythonSidecarPort | null,
  request: DowhyEstimateRequest,
): Promise<TreatmentEffect | null> {
  if (port === null) return null;
  if (request.graph.nodes.length === 0) {
    throw new CausalInferenceError(
      'INVALID_PANEL',
      'dowhy: empty graph',
    );
  }
  if (!request.graph.nodes.includes(request.treatment)) {
    throw new CausalInferenceError(
      'UNKNOWN_NODE',
      `dowhy: treatment "${request.treatment}" not in graph nodes`,
    );
  }
  if (!request.graph.nodes.includes(request.outcome)) {
    throw new CausalInferenceError(
      'UNKNOWN_NODE',
      `dowhy: outcome "${request.outcome}" not in graph nodes`,
    );
  }
  const response = await port.call({
    kind: 'dowhy-ate',
    payload: {
      graph: {
        nodes: request.graph.nodes,
        edges: request.graph.edges,
      },
      treatment: request.treatment,
      outcome: request.outcome,
      data: request.data,
      method: request.method ?? 'backdoor.linear_regression',
    },
  });
  if (response === null) return null;
  if (!response.ok) {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      `dowhy sidecar error: ${response.error ?? 'unknown'}`,
    );
  }
  return parseAteResponse(
    response.result ?? {},
    request.treatment,
    request.outcome,
  );
}

function parseAteResponse(
  raw: Readonly<Record<string, unknown>>,
  treatment: string,
  outcome: string,
): TreatmentEffect {
  const ate = Number(raw['ate'] ?? NaN);
  const ciLow = Number(raw['ci_low'] ?? NaN);
  const ciHigh = Number(raw['ci_high'] ?? NaN);
  if (!Number.isFinite(ate) || !Number.isFinite(ciLow) || !Number.isFinite(ciHigh)) {
    throw new CausalInferenceError(
      'SIDECAR_UNAVAILABLE',
      'dowhy: malformed sidecar response (missing/non-numeric ate/ci_low/ci_high)',
    );
  }
  const identRaw = String(raw['identification'] ?? 'backdoor');
  const allowed: ReadonlyArray<IdentificationStrategy> = [
    'backdoor',
    'frontdoor',
    'did',
    'synthetic-control',
    'rd',
    'granger',
    'pcmci-plus',
  ];
  const identification: IdentificationStrategy = allowed.includes(
    identRaw as IdentificationStrategy,
  )
    ? (identRaw as IdentificationStrategy)
    : 'backdoor';
  const seRaw = raw['se'];
  const nRaw = raw['n'];
  return Object.freeze({
    treatment,
    outcome,
    identification,
    estimate: ate,
    ciLow,
    ciHigh,
    ...(seRaw !== undefined ? { standardError: Number(seRaw) } : {}),
    sampleSize: Number(nRaw ?? 0),
  });
}
