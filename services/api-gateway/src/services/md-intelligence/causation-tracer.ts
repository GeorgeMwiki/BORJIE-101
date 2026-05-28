/**
 * Causation tracer — given a present-tense symptom (e.g. "production
 * is 12% under target this month"), walk UPSTREAM the signal graph to
 * surface the most likely root causes.
 *
 * Algorithm (pure, deterministic):
 *
 *   1. Resolve the symptom to a node id (the `symptomNode`).
 *   2. BFS inbound edges up to `maxDepth` hops (default 3).
 *   3. Score each visited node by:
 *        cumulativeStrength = product of edge strengths on the path
 *        timeWindow = sum of lagDays on the path
 *   4. Only keep CAUSAL or COMPOSITE edges in the BFS (correlational
 *      edges are surfaced separately by the correlation engine).
 *   5. Optionally apply a `presenceProbe(nodeId, scope)` to require the
 *      candidate cause to be LIT on the tenant. Unlit causes are
 *      filtered out so we never fabricate a chain.
 *   6. Rank surviving causes by `cumulativeStrength`, return the top
 *      `limit` with their full path back to the symptom.
 *
 * Caller contract:
 *   trace({ symptom, scope, probe?, limit?, maxDepth? }) →
 *     { symptomNode, chain: CausalChain[] }
 *
 * Each `CausalChain` is a list of edges from root → symptom in
 * upstream → downstream order so the FE can render them as an
 * inline_workflow.
 */

import {
  SIGNAL_EDGES,
  inboundEdges,
  type SignalEdge,
} from './signal-graph';

export interface CausationScope {
  readonly tenantId: string;
  readonly siteId?: string;
}

export type PresenceProbe = (nodeId: string, scope: CausationScope) => Promise<boolean>;

export interface CausalStep {
  readonly from: string;
  readonly to: string;
  readonly strength: number;
  readonly lagDays: number;
  readonly rationale: string;
  readonly kind: SignalEdge['kind'];
}

export interface CausalChain {
  readonly rootCause: string;
  readonly steps: ReadonlyArray<CausalStep>;
  readonly cumulativeStrength: number;
  readonly cumulativeLagDays: number;
  readonly confidence: number;
}

export interface TraceResult {
  readonly symptomNode: string;
  readonly chains: ReadonlyArray<CausalChain>;
  readonly maxDepth: number;
}

export interface TraceInput {
  readonly symptom: string;
  readonly scope: CausationScope;
  readonly probe?: PresenceProbe;
  readonly limit?: number;
  readonly maxDepth?: number;
}

const DEFAULT_LIMIT = 3;
const DEFAULT_MAX_DEPTH = 3;
const ALWAYS_PRESENT_PROBE: PresenceProbe = async () => true;

/**
 * Walk upstream from a symptom to surface root causes.
 *
 * Designed for the brain to render an inline_workflow ("root cause
 * chain"). Confidence is `cumulativeStrength` clamped to 0..1, so the
 * FE can render a confidence chip per chain.
 */
export async function trace(input: TraceInput): Promise<TraceResult> {
  const symptomNode = input.symptom;
  const probe = input.probe ?? ALWAYS_PRESENT_PROBE;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (!nodeExists(symptomNode)) {
    return Object.freeze({
      symptomNode,
      chains: Object.freeze([]),
      maxDepth,
    });
  }

  const chains: CausalChain[] = [];
  const queue: Array<{ node: string; path: SignalEdge[] }> = [
    { node: symptomNode, path: [] },
  ];
  const visited = new Set<string>([symptomNode]);

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;

    const depth = next.path.length;
    if (depth >= maxDepth) continue;

    const inbound = inboundEdges(next.node);
    for (const e of inbound) {
      if (e.kind === 'correlational') continue;

      const upstreamNode = e.to === next.node ? e.from : e.to;
      if (upstreamNode === next.node) continue;
      if (visited.has(upstreamNode)) continue;
      visited.add(upstreamNode);

      const newPath = [...next.path, e];
      const present = await probe(upstreamNode, input.scope).catch(() => false);

      if (present) {
        chains.push(buildChain(upstreamNode, symptomNode, newPath));
      }

      if (depth + 1 < maxDepth) {
        queue.push({ node: upstreamNode, path: newPath });
      }
    }
  }

  chains.sort((a, b) => b.cumulativeStrength - a.cumulativeStrength);
  const ranked = chains.slice(0, limit);

  return Object.freeze({
    symptomNode,
    chains: Object.freeze(ranked.map((c) => Object.freeze(c))),
    maxDepth,
  });
}

function buildChain(
  rootCause: string,
  symptom: string,
  edges: ReadonlyArray<SignalEdge>,
): CausalChain {
  const ordered = orderUpstreamToDownstream(edges, rootCause, symptom);

  let cumulativeStrength = 1;
  let cumulativeLag = 0;
  const steps: CausalStep[] = ordered.map((e) => {
    cumulativeStrength *= e.strength;
    cumulativeLag += e.lagDays;
    return Object.freeze({
      from: e.from,
      to: e.to,
      strength: e.strength,
      lagDays: e.lagDays,
      rationale: e.rationale,
      kind: e.kind,
    });
  });

  return Object.freeze({
    rootCause,
    steps: Object.freeze(steps),
    cumulativeStrength: Math.min(1, cumulativeStrength),
    cumulativeLagDays: cumulativeLag,
    confidence: Math.min(1, cumulativeStrength),
  });
}

function orderUpstreamToDownstream(
  edges: ReadonlyArray<SignalEdge>,
  start: string,
  end: string,
): ReadonlyArray<SignalEdge> {
  // BFS order in `trace()` collects edges symptom → upstream. To render
  // upstream → downstream we walk from `start` and pick the edge whose
  // `to` (or `from` for bidirectional) advances us.
  const remaining = [...edges];
  const out: SignalEdge[] = [];
  let cursor = start;
  while (remaining.length > 0 && cursor !== end) {
    const idx = remaining.findIndex(
      (e) =>
        e.from === cursor ||
        (e.direction === 'bidirectional' && e.to === cursor),
    );
    if (idx < 0) break;
    const e = remaining.splice(idx, 1)[0]!;
    out.push(e);
    cursor = e.from === cursor ? e.to : e.from;
  }
  return out;
}

function nodeExists(nodeId: string): boolean {
  for (const e of SIGNAL_EDGES) {
    if (e.from === nodeId || e.to === nodeId) return true;
  }
  return false;
}
