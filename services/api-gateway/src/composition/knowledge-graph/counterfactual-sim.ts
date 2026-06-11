/**
 * Counterfactual intervention simulation over the causal DAG (Wave D).
 *
 * "If we hedge USD now vs in 2 weeks, the difference is ~X."
 * "Pit-3 throughput +15% → runway +N days."
 *
 * Given a causal DAG (built by `causal-dag.ts`'s `buildCausalDag` from the
 * tenant's validated metric series), a `baseline` map of observed metric
 * values, and an `intervention` `{ variable, newValue }`, this module
 * propagates the perturbation along the DAG's directed causal edges (each
 * edge carries a `strength` ∈ 0..1, a signed `sign`, and a `lagDays`) to
 * compute the COUNTERFACTUAL value of a target KPI, then returns the
 * factual value, the counterfactual, the delta (absolute + percentage),
 * the realised propagation path, a confidence, and the list of assumptions
 * each output number rests on (for claim-chipping in the chat Investigation
 * Canvas simulation strip).
 *
 * Backend for:
 *   - `POST /api/v1/mining/causal/simulate` (the consumer route)
 *   - the chat Investigation Canvas "simulation strip" (factual vs
 *     counterfactual, delta propagated to the root KPI).
 *
 * HARD-RULE compliance (CLAUDE.md + WD2 invariants):
 *   - READ-ONLY analysis. This NEVER writes accounting truth, never moves
 *     money, never touches a licence, never actuates. A "commit as plan"
 *     is the consumer route's concern and MUST go through the existing
 *     governed action membrane — never from here.
 *   - HONEST-DEGRADE. An intervention on a metric absent from the DAG, a
 *     target absent from the DAG, an unreachable target (no validated
 *     causal path), or a path whose confidence falls below the floor
 *     returns an EXPLICIT low-confidence / cannot-simulate result. We NEVER
 *     fabricate a number. A wrong counterfactual is worse than an honest
 *     "cannot simulate".
 *   - EVIDENCE / ASSUMPTIONS. Every emitted number carries the assumptions
 *     it depends on (the linear-response assumption, the validated edge
 *     strengths + signs + lags on the propagation path, the baseline
 *     coverage) so the FE can chip each claim back to its premises.
 *   - IMMUTABLE. Pure functions; frozen outputs; no mutation of the DAG,
 *     the baseline, or the intervention.
 *
 * It consumes `buildCausalDag` + the DAG types from `causal-dag.ts` (Wave D
 * sibling). It does NOT redefine the DAG — the DAG's shape (`CausalDag`,
 * `CausalEdge`, `CausalMetric`) is imported as the canonical contract.
 *
 * @module services/api-gateway/src/composition/knowledge-graph/counterfactual-sim
 */

import {
  buildCausalDag,
  ROOT_CAUSE_CONFIDENCE_FLOOR,
  type CausalDag,
  type CausalEdge,
  type CausalMetric,
} from './causal-dag.js';

// Re-export the DAG builder + types so the route only needs this one import
// surface to construct a DAG and simulate over it.
export { buildCausalDag };
export type { CausalDag, CausalEdge, CausalMetric };

// ─────────────────────────────────────────────────────────────────────
// Tunables — all behaviour is parameterised; no magic literals in maths.
// ─────────────────────────────────────────────────────────────────────

/**
 * Confidence floor. A propagation path whose multiplicative edge-strength
 * product falls below this is reported as a cannot-simulate (low
 * confidence) result rather than emitting a number we don't believe. We
 * default to the SAME floor the DAG's root-cause explainer uses
 * (`ROOT_CAUSE_CONFIDENCE_FLOOR`) so simulation and explanation agree on
 * what "too weak to assert" means. Overridable per call.
 */
export const DEFAULT_CONFIDENCE_FLOOR = ROOT_CAUSE_CONFIDENCE_FLOOR;

/** Max hops we will propagate before declaring the target out of reach. */
export const DEFAULT_MAX_DEPTH = 6;

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

/** The perturbation the caller wants to simulate. */
export interface Intervention {
  /** The metric node in the DAG to perturb, e.g. `production_tonnage`. */
  readonly variable: CausalMetric;
  /**
   * The counterfactual value to SET the variable to. The factual value is
   * read from `baseline[variable]`; the delta drives propagation.
   */
  readonly newValue: number;
}

/** Per-call knobs (all optional; sane defaults above). */
export interface SimulateOptions {
  /** Below this multiplicative path-confidence we refuse to emit a number. */
  readonly confidenceFloor?: number;
  /** Max hops to propagate. */
  readonly maxDepth?: number;
}

/** One hop on the realised propagation path (root cause → target KPI). */
export interface PropagationHop {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
  /** Edge strength ∈ 0..1 (the sensitivity multiplier for this hop). */
  readonly strength: number;
  /** Sign of the relationship (+1 same-direction, −1 inverse). */
  readonly sign: 1 | -1;
  /** Typical observed lag from `from` move to `to` move, in days. */
  readonly lagDays: number;
  /** The delta in `from` carried into this hop (counterfactual − factual). */
  readonly inboundDelta: number;
  /** The delta this hop induces in `to` (= inboundDelta × strength × sign). */
  readonly outboundDelta: number;
}

/** Status discriminant — `ok` carries numbers; the rest are honest skips. */
export type SimulationStatus =
  | 'ok'
  | 'variable-not-in-dag'
  | 'target-not-in-dag'
  | 'target-unreachable'
  | 'below-confidence-floor'
  | 'missing-baseline';

/**
 * The simulation result. On `ok` every number is real and carries its
 * `assumptions`. On any other status the numbers are null and `reason`
 * explains the honest degrade — NEVER a fabricated value.
 */
export interface SimulationResult {
  readonly status: SimulationStatus;
  /** The factual value of the TARGET KPI (baseline), or null on degrade. */
  readonly factual: number | null;
  /** The counterfactual value of the TARGET KPI, or null on degrade. */
  readonly counterfactual: number | null;
  /** counterfactual − factual, or null on degrade. */
  readonly deltaAbs: number | null;
  /** Percentage change vs factual (null when factual is 0 or on degrade). */
  readonly deltaPct: number | null;
  /** The realised root-cause → target propagation path (dominant path). */
  readonly propagationPath: ReadonlyArray<PropagationHop>;
  /** Total lag along the path, in days (sum of hop lags). */
  readonly totalLagDays: number | null;
  /** Multiplicative path confidence ∈ 0..1 (null on degrade). */
  readonly confidence: number | null;
  /** Every assumption each number rests on (for claim-chipping). */
  readonly assumptions: ReadonlyArray<string>;
  /** The intervention echoed back (variable + factual + counterfactual). */
  readonly intervention: {
    readonly variable: CausalMetric;
    readonly factualValue: number | null;
    readonly newValue: number;
  };
  /** The target KPI metric this result is about. */
  readonly target: CausalMetric;
  /** Human-readable reason on a degrade; null on `ok`. */
  readonly reason: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Core: simulateIntervention
// ─────────────────────────────────────────────────────────────────────

/**
 * Simulate a counterfactual intervention on `intervention.variable` and
 * propagate its delta to `target` along the DAG's validated causal edges.
 *
 * Propagation model (stated as an assumption, not hidden): a LINEAR local
 * response — the delta entering a node is multiplied by the outbound edge
 * strength AND its sign to give the delta it induces downstream (an inverse
 * edge flips the direction). Strengths compound multiplicatively along a
 * path, whose absolute product is the path confidence. We pick the SINGLE
 * highest-confidence path from the intervened variable to the target (the
 * dominant causal channel); the counterfactual target value is
 * `baseline[target] + (interventionDelta × signedStrengthProduct)`.
 *
 * Honest-degrade returns (numbers null, explicit `status`/`reason`):
 *   - the intervened variable is not a node in the DAG;
 *   - the target is not a node in the DAG;
 *   - no validated causal path connects variable → target within `maxDepth`;
 *   - the best path's confidence is below `confidenceFloor`;
 *   - the baseline lacks the intervened variable's factual value.
 *
 * @param dag           the causal DAG (from `buildCausalDag`).
 * @param baseline      observed factual values keyed by `CausalMetric`.
 * @param intervention  the perturbation `{ variable, newValue }`.
 * @param target        the root KPI metric to read the effect on.
 * @param options       confidence floor + max depth overrides.
 */
export function simulateIntervention(
  dag: CausalDag,
  baseline: Readonly<Partial<Record<CausalMetric, number>>>,
  intervention: Intervention,
  target: CausalMetric,
  options: SimulateOptions = {},
): SimulationResult {
  const confidenceFloor = options.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  const nodes = nodeSet(dag);
  const factualValue = baselineValue(baseline, intervention.variable);

  // ── Honest-degrade gate 1: intervened variable not in the DAG. ──────
  if (!nodes.has(intervention.variable)) {
    return degrade(
      'variable-not-in-dag',
      `'${intervention.variable}' is not a node in the causal DAG; cannot simulate an intervention on an unmodelled variable.`,
      intervention,
      factualValue,
      target,
    );
  }

  // ── Honest-degrade gate 2: target not in the DAG. ───────────────────
  if (!nodes.has(target)) {
    return degrade(
      'target-not-in-dag',
      `Target KPI '${target}' is not a node in the causal DAG; cannot establish an effect path.`,
      intervention,
      factualValue,
      target,
    );
  }

  // ── Honest-degrade gate 3: no factual baseline for the variable. ────
  if (factualValue === null) {
    return degrade(
      'missing-baseline',
      `No baseline (factual) value supplied for '${intervention.variable}'; the delta to propagate is undefined.`,
      intervention,
      null,
      target,
    );
  }

  // Identity intervention (newValue == factual) → zero delta, still ok.
  const interventionDelta = intervention.newValue - factualValue;

  // ── Find the dominant (highest-confidence) causal path. ─────────────
  const best = bestCausalPath(dag, intervention.variable, target, maxDepth);

  // ── Honest-degrade gate 4: target unreachable from the variable. ────
  if (!best) {
    return degrade(
      'target-unreachable',
      `No validated causal path connects '${intervention.variable}' → '${target}' within ${maxDepth} hops; cannot establish how the intervention would reach the KPI.`,
      intervention,
      factualValue,
      target,
    );
  }

  const pathConfidence = best.strengthProduct;

  // ── Honest-degrade gate 5: confidence below the floor. ──────────────
  if (pathConfidence < confidenceFloor) {
    return degrade(
      'below-confidence-floor',
      `The strongest causal path '${intervention.variable}' → '${target}' has confidence ${round(pathConfidence, 3)}, below the floor ${round(confidenceFloor, 3)}; the effect cannot be estimated with sufficient confidence.`,
      intervention,
      factualValue,
      target,
      best.edges,
    );
  }

  // ── Propagate the delta along the dominant path (signed). ───────────
  const hops: PropagationHop[] = [];
  let runningDelta = interventionDelta;
  let totalLag = 0;
  for (const edge of best.edges) {
    const inboundDelta = runningDelta;
    const outboundDelta = inboundDelta * edge.strength * edge.sign;
    totalLag += edge.lagDays;
    hops.push(
      Object.freeze({
        from: edge.from,
        to: edge.to,
        strength: edge.strength,
        sign: edge.sign,
        lagDays: edge.lagDays,
        inboundDelta,
        outboundDelta,
      }),
    );
    runningDelta = outboundDelta;
  }

  const targetHasBaseline = baselineValue(baseline, target) !== null;
  const targetFactual = baselineValue(baseline, target) ?? 0;
  const targetDelta = runningDelta;
  const counterfactual = targetFactual + targetDelta;
  const deltaPct = targetFactual === 0 ? null : (targetDelta / targetFactual) * 100;

  const assumptions = buildAssumptions({
    variable: intervention.variable,
    target,
    edges: best.edges,
    pathConfidence,
    targetHasBaseline,
    interventionDelta,
  });

  return Object.freeze({
    status: 'ok' as const,
    factual: targetFactual,
    counterfactual,
    deltaAbs: targetDelta,
    deltaPct,
    propagationPath: Object.freeze(hops),
    totalLagDays: totalLag,
    confidence: pathConfidence,
    assumptions: Object.freeze(assumptions),
    intervention: Object.freeze({
      variable: intervention.variable,
      factualValue,
      newValue: intervention.newValue,
    }),
    target,
    reason: null,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Path search — dominant (highest |strength| product) causal path.
// ─────────────────────────────────────────────────────────────────────

interface BestPath {
  readonly edges: ReadonlyArray<CausalEdge>;
  /** Product of |edge strengths| along the path (= path confidence). */
  readonly strengthProduct: number;
}

/**
 * Best-first search for the path from `source` → `target` that MAXIMISES
 * the product of edge strengths (= confidence). Because every strength is
 * ≤ 1, extending a path can only shrink the product, so a greedy expansion
 * with a per-node best-product memo finds the optimum without
 * negative-cycle hazards. Bounded by `maxDepth` hops. The DAG is acyclic by
 * construction, so the memo also guarantees termination.
 *
 * Returns null when the target is unreachable from the source within the
 * depth bound — the caller turns that into an honest `target-unreachable`.
 */
function bestCausalPath(
  dag: CausalDag,
  source: CausalMetric,
  target: CausalMetric,
  maxDepth: number,
): BestPath | null {
  if (source === target) {
    // Intervening directly ON the target — a degenerate but valid path:
    // the delta passes through with confidence 1 and zero hops.
    return { edges: [], strengthProduct: 1 };
  }

  const adjacency = outboundAdjacency(dag);

  // Best product found to reach each node, and the edge-path that did it.
  const bestProduct = new Map<CausalMetric, number>([[source, 1]]);
  const bestEdges = new Map<CausalMetric, ReadonlyArray<CausalEdge>>([[source, []]]);

  // Frontier ordered by descending product (greedy best-first).
  let frontier: ReadonlyArray<CausalMetric> = [source];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const nextFrontier = new Set<CausalMetric>();
    for (const node of frontier) {
      const product = bestProduct.get(node) ?? 0;
      const pathToNode = bestEdges.get(node) ?? [];
      const outbound = adjacency.get(node) ?? [];
      for (const edge of outbound) {
        const candidateProduct = product * edge.strength;
        const known = bestProduct.get(edge.to) ?? 0;
        if (candidateProduct > known) {
          bestProduct.set(edge.to, candidateProduct);
          bestEdges.set(edge.to, [...pathToNode, edge]);
          nextFrontier.add(edge.to);
        }
      }
    }
    frontier = Array.from(nextFrontier);
  }

  const edges = bestEdges.get(target);
  const strengthProduct = bestProduct.get(target);
  if (!edges || edges.length === 0 || strengthProduct === undefined) {
    return null;
  }
  return { edges, strengthProduct };
}

// ─────────────────────────────────────────────────────────────────────
// DAG helpers (pure; never mutate the DAG).
// ─────────────────────────────────────────────────────────────────────

/** Set of every metric node id in the DAG (declared nodes ∪ edge endpoints). */
function nodeSet(dag: CausalDag): ReadonlySet<CausalMetric> {
  const set = new Set<CausalMetric>();
  for (const n of dag.nodes) set.add(n.metric);
  for (const e of dag.edges) {
    set.add(e.from);
    set.add(e.to);
  }
  return set;
}

/** Outbound adjacency: metric → its outgoing directed causal edges. */
function outboundAdjacency(
  dag: CausalDag,
): ReadonlyMap<CausalMetric, ReadonlyArray<CausalEdge>> {
  const map = new Map<CausalMetric, CausalEdge[]>();
  for (const e of dag.edges) {
    const list = map.get(e.from);
    if (list) list.push(e);
    else map.set(e.from, [e]);
  }
  return map;
}

/** Read a baseline value for a metric, returning null when absent. */
function baselineValue(
  baseline: Readonly<Partial<Record<CausalMetric, number>>>,
  metric: CausalMetric,
): number | null {
  const v = baseline[metric];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ─────────────────────────────────────────────────────────────────────
// Assumptions — every output number carries its premises (claim-chipping).
// ─────────────────────────────────────────────────────────────────────

function buildAssumptions(args: {
  readonly variable: CausalMetric;
  readonly target: CausalMetric;
  readonly edges: ReadonlyArray<CausalEdge>;
  readonly pathConfidence: number;
  readonly targetHasBaseline: boolean;
  readonly interventionDelta: number;
}): ReadonlyArray<string> {
  const out: string[] = [
    `Linear local response: the effect on '${args.target}' scales proportionally with the size of the intervention on '${args.variable}'.`,
    `Effect flows ONLY along the modelled dominant causal path (${args.edges.length} hop${args.edges.length === 1 ? '' : 's'}); unmodelled channels and feedback loops are excluded.`,
    `Path confidence ${round(args.pathConfidence, 3)} is the multiplicative product of the per-edge validated causal strengths along the path.`,
  ];
  for (const e of args.edges) {
    const dir = e.sign === 1 ? 'same-direction' : 'inverse';
    out.push(
      `Edge '${e.from}' → '${e.to}' holds with strength ${round(e.strength, 3)} (${dir}), confidence ${round(e.confidence, 3)}, support ${e.support} paired observations, and a best-fit lag of ${e.lagDays} day${e.lagDays === 1 ? '' : 's'}.`,
    );
  }
  if (!args.targetHasBaseline) {
    out.push(
      `No baseline value was supplied for the target '${args.target}'; the factual is treated as 0, so the counterfactual is the propagated delta alone (deltaPct is undefined).`,
    );
  }
  if (args.interventionDelta === 0) {
    out.push(
      `The intervention sets the variable to its current factual value (zero delta); the counterfactual equals the factual by construction.`,
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Small pure utilities
// ─────────────────────────────────────────────────────────────────────

function degrade(
  status: Exclude<SimulationStatus, 'ok'>,
  reason: string,
  intervention: Intervention,
  factualValue: number | null,
  target: CausalMetric,
  pathEdges?: ReadonlyArray<CausalEdge>,
): SimulationResult {
  const hops: PropagationHop[] = (pathEdges ?? []).map((e) =>
    Object.freeze({
      from: e.from,
      to: e.to,
      strength: e.strength,
      sign: e.sign,
      lagDays: e.lagDays,
      inboundDelta: 0,
      outboundDelta: 0,
    }),
  );
  return Object.freeze({
    status,
    factual: null,
    counterfactual: null,
    deltaAbs: null,
    deltaPct: null,
    propagationPath: Object.freeze(hops),
    totalLagDays: null,
    confidence: null,
    assumptions: Object.freeze([
      `Honest-degrade: ${reason}`,
      `No counterfactual number is emitted — a fabricated value is worse than an explicit "cannot simulate".`,
    ]),
    intervention: Object.freeze({
      variable: intervention.variable,
      factualValue,
      newValue: intervention.newValue,
    }),
    target,
    reason,
  });
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
