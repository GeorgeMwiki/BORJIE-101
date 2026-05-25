/**
 * CausalFusion DAG builder.
 *
 * Implements the Amazon-Science AAAI-2026 CausalFusion pattern:
 *
 *   1. Domain priors (the seed library) plus an LLM proposer
 *      generate a candidate DAG: nodes = variables, directed edges
 *      = causal claims, with optional `candidateEdges` the LLM is
 *      unsure about.
 *   2. The Python sidecar (DoWhy) runs the refutation battery
 *      (placebo, bootstrap, unobserved-confounder, optional
 *      conditional-independence) and returns scores in [0, 1].
 *   3. We `kept` the DAG iff every score is ≥ `keepThreshold`.
 *
 * The LLM is injected (port: `LLMClient`); the sidecar is injected
 * (port: `SidecarClient`). Neither is imported here. The function
 * is pure-ish — single side effect is the two awaited calls.
 *
 * Reference:
 *   - https://www.amazon.science/publications/causalfusion-integrating-llms-and-graph-falsification-for-causal-discovery
 */

import type {
  CausalDAG,
  CausalFusionResult,
  HypothesisSeed,
  LLMClient,
  SidecarClient,
} from '../types.js';
import { CausalDAGSchema } from '../types.js';

export interface BuildDagOptions {
  readonly seed: HypothesisSeed;
  /** Opaque pointer into the tenant data lake — passed to sidecar. */
  readonly dataRef: string;
  readonly llm: LLMClient;
  readonly sidecar: SidecarClient;
  /** All four refutation scores must reach this; default 0.5. */
  readonly keepThreshold?: number;
  /** Sidecar URL for tracing; the sidecar instance owns the actual transport. */
  readonly sidecarUrl?: string;
}

const DEFAULT_KEEP_THRESHOLD = 0.5;

/**
 * Ask the LLM for a DAG that respects the seed's variables, then
 * verify it with DoWhy refutation. Returns the verdict.
 */
export async function buildCausalDag(opts: BuildDagOptions): Promise<CausalFusionResult> {
  const { seed, dataRef, llm, sidecar } = opts;
  const keepThreshold = opts.keepThreshold ?? DEFAULT_KEEP_THRESHOLD;

  const dag = await proposeDagViaLlm(seed, llm);

  const refute = await sidecar.refute({
    dag,
    dataRef,
    treatment: seed.suggestedTreatmentVar,
    outcome: seed.suggestedOutcomeVar,
    estimator: seed.suggestedEstimator,
  });

  const kept = passesRefutation(refute.scores, keepThreshold);

  const result: CausalFusionResult = {
    dag,
    refutationScores: refute.scores,
    kept,
    rationale: buildRationale(kept, refute.scores, keepThreshold, refute.diagnostics),
    ...(opts.sidecarUrl !== undefined ? { sidecarUrl: opts.sidecarUrl } : {}),
  };
  return result;
}

/**
 * Test-helper exported intentionally: lets the orchestrator reason
 * about a DAG without re-running the sidecar.
 */
export function passesRefutation(
  scores: Pick<
    CausalFusionResult['refutationScores'],
    'placebo' | 'bootstrap' | 'unobservedConfounder' | 'conditionalIndependence'
  >,
  threshold: number,
): boolean {
  const required: ReadonlyArray<number> = [
    scores.placebo,
    scores.bootstrap,
    scores.unobservedConfounder,
  ];
  if (scores.conditionalIndependence !== undefined) {
    return [...required, scores.conditionalIndependence].every((s) => s >= threshold);
  }
  return required.every((s) => s >= threshold);
}

// ─────────────────────────────────────────────────────────────────────
// LLM-proposer. The prompt is deterministic and replayable — we never
// rely on the LLM picking the variable set; the seed fixes it.
// ─────────────────────────────────────────────────────────────────────

async function proposeDagViaLlm(seed: HypothesisSeed, llm: LLMClient): Promise<CausalDAG> {
  const system =
    'You are a domain-expert causal-inference assistant for a multi-tenant property ' +
    'management platform. Given a hypothesis seed, propose a minimal causal DAG ' +
    'over the listed variables. Return strict JSON only.';

  const prompt = buildDagPrompt(seed);

  const completion = await llm.complete({
    system,
    prompt,
    maxTokens: 1200,
    metadata: { seedId: seed.id, area: seed.area },
  });

  const parsed = parseDagJson(completion.text, seed);
  return parsed;
}

function buildDagPrompt(seed: HypothesisSeed): string {
  return [
    `Hypothesis: ${seed.statement}`,
    `Treatment: ${seed.suggestedTreatmentVar}`,
    `Outcome: ${seed.suggestedOutcomeVar}`,
    `Confounders (priors): ${seed.suggestedConfounders.join(', ') || '(none)'}`,
    `Variables (use exactly these as nodes): ${seed.variables.join(', ')}`,
    '',
    'Return JSON of shape:',
    '{',
    '  "nodes": string[],',
    '  "edges": [{"from": string, "to": string, "rationale": string}],',
    '  "candidateEdges": [{"from": string, "to": string}]',
    '}',
    'Edges must respect domain priors (e.g. rent affects eviction, not vice-versa).',
    'Treatment must have a directed path to Outcome.',
  ].join('\n');
}

function parseDagJson(raw: string, seed: HypothesisSeed): CausalDAG {
  const trimmed = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `CausalFusion DAG builder: LLM returned non-JSON for seed ${seed.id}: ${
        (err as Error).message
      }`,
    );
  }
  const result = CausalDAGSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `CausalFusion DAG builder: schema-invalid DAG for seed ${seed.id}: ${result.error.message}`,
    );
  }
  return result.data;
}

/**
 * LLMs love to wrap JSON in markdown fences. Strip them.
 */
function extractJsonObject(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

function buildRationale(
  kept: boolean,
  scores: CausalFusionResult['refutationScores'],
  threshold: number,
  diagnostics: string,
): string {
  const head = kept
    ? `DAG KEPT — all refutation scores ≥ ${threshold.toFixed(2)}`
    : `DAG DROPPED — at least one refutation score below ${threshold.toFixed(2)}`;
  const detail =
    `placebo=${scores.placebo.toFixed(2)}, ` +
    `bootstrap=${scores.bootstrap.toFixed(2)}, ` +
    `unobservedConfounder=${scores.unobservedConfounder.toFixed(2)}` +
    (scores.conditionalIndependence !== undefined
      ? `, condIndep=${scores.conditionalIndependence.toFixed(2)}`
      : '');
  return `${head}. ${detail}. Sidecar: ${diagnostics}`;
}
