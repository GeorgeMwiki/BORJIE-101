/**
 * Twin-network counterfactual reasoning — pure TypeScript.
 *
 * For a structural causal model (SCM) with assignment functions
 * { Y_i := f_i(pa_i, U_i) } and observed values for some endogenous
 * variables, the counterfactual question
 *
 *   "What would Y have been if X had been set to x*?"
 *
 * is answered via the three-step abduction-action-prediction
 * procedure:
 *
 *  1. ABDUCTION — given observed values, infer the exogenous noises
 *     U_i that explain them.
 *  2. ACTION — replace the assignment of X with the constant x* (the
 *     "twin" graph).
 *  3. PREDICTION — propagate the abducted U_i through the modified
 *     SCM and read Y.
 *
 * This module implements a deterministic version: each f_i is
 * supplied as a TypeScript function taking parent values and the
 * exogenous noise. For linear-Gaussian SCMs the noises are
 * Y_observed - f_i(pa_i, 0); for general invertible f_i the caller
 * supplies an inverter. Default behaviour: subtractive noises.
 *
 * For Mr. Mwikila: "if Supervisor Mbembe had been on duty that night,
 * would the incident have happened?". The factual outcome
 * (incident=1) conditions the noise; the action sets supervisor=Mbembe;
 * the prediction returns the counterfactual incident indicator.
 *
 * Reference: Pearl, J. — Causality (2nd ed., 2009), Chapter 7.
 *
 * @module @borjie/causal-inference/counterfactual/twin-network
 */

import {
  CausalInferenceError,
  type CausalGraph,
  type Counterfactual,
} from '../types.js';

export interface StructuralEquation {
  readonly variable: string;
  readonly parents: ReadonlyArray<string>;
  /**
   * Assignment function: returns f(pa_values, noise). For linear SCMs
   * f(pa, U) = sum_i w_i * pa_i + U.
   */
  readonly assign: (
    parentValues: Readonly<Record<string, number>>,
    noise: number,
  ) => number;
}

export interface StructuralCausalModel {
  readonly graph: CausalGraph;
  readonly equations: ReadonlyArray<StructuralEquation>;
  /**
   * Optional exogenous-noise inverter. Default: noise = Y_observed -
   * f(pa, 0). Override for non-additive SCMs.
   */
  readonly invertNoise?: (
    eq: StructuralEquation,
    parentValues: Readonly<Record<string, number>>,
    observedValue: number,
  ) => number;
}

export interface CounterfactualQuery {
  /** Free-text label of the question. */
  readonly question: string;
  /** Factual observation of all endogenous variables. */
  readonly observed: Readonly<Record<string, number>>;
  /** Intervention: variable -> do-value. */
  readonly intervention: Readonly<Record<string, number>>;
  /** Outcome variable of interest. */
  readonly outcome: string;
}

/**
 * Run the abduction-action-prediction procedure.
 */
export function twinNetworkCounterfactual(
  scm: StructuralCausalModel,
  query: CounterfactualQuery,
): Counterfactual {
  // Sanity checks.
  if (!scm.graph.nodes.includes(query.outcome)) {
    throw new CausalInferenceError(
      'UNKNOWN_NODE',
      `twin-network: outcome "${query.outcome}" not in graph`,
    );
  }
  for (const v of Object.keys(query.observed)) {
    if (!scm.graph.nodes.includes(v)) {
      throw new CausalInferenceError(
        'UNKNOWN_NODE',
        `twin-network: observed variable "${v}" not in graph`,
      );
    }
  }
  for (const v of Object.keys(query.intervention)) {
    if (!scm.graph.nodes.includes(v)) {
      throw new CausalInferenceError(
        'UNKNOWN_NODE',
        `twin-network: intervened variable "${v}" not in graph`,
      );
    }
  }
  const order = topologicalOrder(scm.graph);

  // ABDUCTION: infer noise for each endogenous variable from the
  // observed values + parents.
  const noises = new Map<string, number>();
  const inverter =
    scm.invertNoise ??
    ((eq, pv, y) => y - eq.assign(pv, 0));
  for (const variable of order) {
    const observed = query.observed[variable];
    if (observed === undefined) continue;
    const eq = scm.equations.find((e) => e.variable === variable);
    if (eq === undefined) continue;
    const parentValues: Record<string, number> = {};
    for (const p of eq.parents) {
      const pv = query.observed[p];
      if (pv === undefined) {
        throw new CausalInferenceError(
          'INVALID_PANEL',
          `twin-network: parent "${p}" of "${variable}" missing from observed values`,
        );
      }
      parentValues[p] = pv;
    }
    noises.set(variable, inverter(eq, parentValues, observed));
  }

  // ACTION + PREDICTION: traverse the topological order, substituting
  // intervened values, otherwise re-evaluating from parents + noise.
  const values = new Map<string, number>();
  for (const variable of order) {
    const intervened = query.intervention[variable];
    if (intervened !== undefined) {
      values.set(variable, intervened);
      continue;
    }
    const eq = scm.equations.find((e) => e.variable === variable);
    if (eq === undefined) {
      // No structural equation -> treat as exogenous; reuse observed value if present.
      const obs = query.observed[variable];
      if (obs !== undefined) values.set(variable, obs);
      continue;
    }
    const parentValues: Record<string, number> = {};
    for (const p of eq.parents) {
      const v = values.get(p);
      if (v === undefined) {
        throw new CausalInferenceError(
          'INVALID_PANEL',
          `twin-network: parent "${p}" of "${variable}" not yet evaluated; topological order issue`,
        );
      }
      parentValues[p] = v;
    }
    const noise = noises.get(variable) ?? 0;
    values.set(variable, eq.assign(parentValues, noise));
  }

  const cf = values.get(query.outcome);
  if (cf === undefined) {
    throw new CausalInferenceError(
      'UNKNOWN_NODE',
      `twin-network: outcome "${query.outcome}" was not evaluated`,
    );
  }
  const factual = query.observed[query.outcome] ?? cf;
  return Object.freeze({
    query: query.question,
    observed: Object.freeze({ ...query.observed }),
    intervention: Object.freeze({ ...query.intervention }),
    counterfactualOutcome: cf,
    factualOutcome: factual,
  });
}

/**
 * Kahn's algorithm topological order. Throws on cycles.
 */
function topologicalOrder(graph: CausalGraph): ReadonlyArray<string> {
  const indeg = new Map<string, number>();
  for (const v of graph.nodes) indeg.set(v, 0);
  for (const e of graph.edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [v, d] of indeg) {
    if (d === 0) queue.push(v);
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    order.push(cur);
    for (const e of graph.edges) {
      if (e.from !== cur) continue;
      const newDeg = (indeg.get(e.to) ?? 0) - 1;
      indeg.set(e.to, newDeg);
      if (newDeg === 0) queue.push(e.to);
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new CausalInferenceError(
      'CYCLE_DETECTED',
      'twin-network: SCM graph contains a cycle',
    );
  }
  return order;
}
