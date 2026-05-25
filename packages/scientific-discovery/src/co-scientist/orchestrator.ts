/**
 * Co-Scientist orchestrator — composes the 6 agents in the canonical
 * Google AI Co-Scientist loop:
 *
 *   1. Generation        — propose hypotheses
 *   2. Reflection        — peer-review each
 *   3. Ranking           — Elo tournament
 *   4. Evolution         — mutate top-k
 *   5. Proximity         — link related priors
 *   6. Meta-review       — synthesise + propose next seeds
 *
 * The orchestrator is the ONLY stateful surface in the package. Every
 * agent is a pure function; the orchestrator holds the run-id, timing,
 * and emits the final aggregated `DiscoveryRun`.
 *
 * Dependencies are injected:
 *   - `llm`     : LLMClient port (use ai-copilot/providers' multi-llm
 *                 synthesizer at the call-site).
 *   - `sidecar` : SidecarClient port (Python sidecar, see
 *                 `sidecar/python-sidecar-spec.md`).
 *
 * References:
 *   - https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/
 *   - Sakana AI Scientist v2 — BFTS pattern (arXiv 2504.08066)
 */

import type {
  CausalFusionResult,
  Hypothesis,
  HypothesisSeed,
  LLMClient,
  Perspective,
  RankedHypothesis,
  SidecarClient,
} from '../types.js';
import { generateHypotheses } from './generation-agent.js';
import { reflectOnHypotheses, type ReflectionVerdict } from './reflection-agent.js';
import { rankHypotheses } from './ranking-agent.js';
import { evolveHypotheses } from './evolution-agent.js';
import { findProximityLinks, type ProximityLink } from './proximity-agent.js';
import { metaReview, type MetaReview } from './meta-review-agent.js';
import { buildCausalDag } from '../causal-fusion/dag-builder.js';

export interface OrchestratorInput {
  readonly runId: string;
  readonly seeds: readonly HypothesisSeed[];
  readonly llm: LLMClient;
  readonly sidecar: SidecarClient;
  /** Anomaly area triggering this run; if undefined the round is "weekly tournament". */
  readonly anomalyArea?: HypothesisSeed['area'];
  readonly perspective?: Perspective;
  /** Archive of prior verified hypotheses for proximity-linking. */
  readonly archive?: readonly Hypothesis[];
  /** Data-lake pointer the sidecar resolves for refutation tests. */
  readonly dataRef: string;
  /** Cap on first-round hypotheses (defaults to seed count, max 8). */
  readonly generationCount?: number;
  /** How many evolution mutations to make per top-K parent (default 2). */
  readonly mutationsPerParent?: number;
  /** ISO timestamp for determinism in tests. */
  readonly now: string;
}

export interface DiscoveryRun {
  readonly runId: string;
  readonly hypotheses: readonly Hypothesis[];
  readonly reflections: readonly ReflectionVerdict[];
  readonly ranked: readonly RankedHypothesis[];
  readonly causalFusion: readonly CausalFusionResult[];
  readonly evolved: readonly Hypothesis[];
  readonly proximityLinks: readonly ProximityLink[];
  readonly metaReview: MetaReview;
}

/**
 * Run one full Co-Scientist round. Single side-effect surface: LLM +
 * sidecar calls via injected ports. No mutation of inputs.
 */
export async function runDiscovery(input: OrchestratorInput): Promise<DiscoveryRun> {
  // 1. Generation
  const hypotheses = await generateHypotheses({
    seeds: input.seeds,
    llm: input.llm,
    ...(input.anomalyArea !== undefined ? { anomalyArea: input.anomalyArea } : {}),
    ...(input.perspective !== undefined ? { perspective: input.perspective } : {}),
    ...(input.generationCount !== undefined ? { count: input.generationCount } : {}),
    runId: input.runId,
    now: input.now,
  });

  // 2. Reflection
  const reflections = await reflectOnHypotheses(hypotheses, input.llm);

  // 3. Ranking via Elo tournament
  const ranked = await rankHypotheses({
    hypotheses,
    llm: input.llm,
  });

  // 4. CausalFusion: for each top hypothesis, propose DAG and refute
  const causalFusion: CausalFusionResult[] = [];
  const TOP_K_FOR_DAG = 3;
  const topForDag = ranked.slice(0, TOP_K_FOR_DAG);
  for (const top of topForDag) {
    const seed = findParentSeed(top.hypothesis, input.seeds);
    if (!seed) continue;
    const fusion = await buildCausalDag({
      seed,
      dataRef: input.dataRef,
      llm: input.llm,
      sidecar: input.sidecar,
    });
    causalFusion.push(fusion);
  }

  // 5. Evolution of top-K winners
  const evolved = await evolveHypotheses({
    ranked,
    llm: input.llm,
    topK: 3,
    mutationsPerParent: input.mutationsPerParent ?? 2,
    runId: input.runId,
    now: input.now,
  });

  // 6. Proximity links — evolved + ranked against the archive
  const archive = input.archive ?? [];
  const proximityLinks = findProximityLinks([...hypotheses, ...evolved], archive);

  // 7. Meta-review
  const meta = await metaReview({
    runId: input.runId,
    ranked,
    reflections,
    proximityLinks,
    llm: input.llm,
  });

  return {
    runId: input.runId,
    hypotheses,
    reflections,
    ranked,
    causalFusion,
    evolved,
    proximityLinks,
    metaReview: meta,
  };
}

function findParentSeed(
  h: Hypothesis,
  seeds: readonly HypothesisSeed[],
): HypothesisSeed | undefined {
  if (!h.parentSeedId) return undefined;
  return seeds.find((s) => s.id === h.parentSeedId);
}
