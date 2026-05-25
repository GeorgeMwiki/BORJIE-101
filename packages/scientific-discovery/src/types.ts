/**
 * @borjie/scientific-discovery — public types.
 *
 * Pure contracts. No runtime, no I/O, no LLM imports.
 *
 * Implements the SOTA-2026 Scientific Discovery stack documented in
 * `.audit/litfin-sota-2026-05-23/13-scientific-discovery.md`:
 *
 *   - Hypothesis      — a single causal claim with treatment/outcome/confounders
 *   - HypothesisSeed  — a templated starting point from the 25-item seed library
 *   - CausalDAG       — LLM-proposed DAG, the input to refutation
 *   - RefutationScores — DoWhy placebo / bootstrap / unobserved-confounder tests
 *   - CausalFusionResult — combined output of the CausalFusion (AAAI 2026) loop
 *   - Evidence        — a typed signal that supports / refutes a hypothesis
 *   - EloScore        — Co-Scientist ranking-agent pairwise tournament state
 *   - DiscoveryCard   — what the admin portal renders
 *
 * Architectural references:
 *   - Google AI Co-Scientist (Nature, 2025): generate / reflect / rank / evolve /
 *     proximity / meta-review six-agent loop.
 *     https://research.google/blog/accelerating-scientific-breakthroughs-with-an-ai-co-scientist/
 *   - Sakana AI Scientist v2 (arXiv 2504.08066): best-first tree search.
 *   - CausalFusion (Amazon Science, AAAI 2026): LLM-proposes-DAG + graph-falsification.
 *   - Stanford STORM (https://github.com/stanford-oval/storm): perspective-guided
 *     question-asking with persona personae.
 *
 * Every public surface is exported here; nothing else.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Domain areas — the 5 buckets the seed library is organised into.
// Each maps to a folder under `seed-library/`.
// ─────────────────────────────────────────────────────────────────────

export const DISCOVERY_AREAS = [
  'vacancy',
  'arrears',
  'maintenance',
  'pricing',
  'churn',
] as const;

export type DiscoveryArea = (typeof DISCOVERY_AREAS)[number];

// ─────────────────────────────────────────────────────────────────────
// STORM perspectives — 8 personas. Each persona owns ~3 seeds. The
// generation agent rotates through these so no hypothesis-pool is ever
// myopic to a single role.
// ─────────────────────────────────────────────────────────────────────

export const PERSPECTIVES = [
  'owner',
  'tenant',
  'vendor',
  'caretaker',
  'auditor',
  'regulator',
  'underwriter',
  'diaspora_investor',
] as const;

export type Perspective = (typeof PERSPECTIVES)[number];

// ─────────────────────────────────────────────────────────────────────
// Hypothesis seed (template) — what the seed-library exports.
// ─────────────────────────────────────────────────────────────────────

export const HypothesisSeedSchema = z.object({
  /** Stable id e.g. `vacancy-01`. */
  id: z.string().min(1),
  /** Discovery area bucket. */
  area: z.enum(DISCOVERY_AREAS),
  /** One-sentence English statement, present tense. */
  statement: z.string().min(8),
  /** Variables touched by the hypothesis (used to seed the DAG). */
  variables: z.array(z.string().min(1)).min(2),
  /** The candidate causal "treatment" variable. */
  suggestedTreatmentVar: z.string().min(1),
  /** The outcome the treatment is hypothesised to move. */
  suggestedOutcomeVar: z.string().min(1),
  /** Variables to control for (priors from domain knowledge). */
  suggestedConfounders: z.array(z.string().min(1)).default([]),
  /** Suggested effect estimator. Free-form — the sidecar resolves it. */
  suggestedEstimator: z
    .enum([
      'dowhy_linear',
      'dml',
      'causal_forest',
      'causalpy_synthetic_control',
      'causalpy_its',
      'pcmciplus',
    ])
    .default('dowhy_linear'),
  /** STORM persona that owns the question. */
  owningPerspective: z.enum(PERSPECTIVES),
  /** Optional jurisdictions — leave empty for "everywhere". */
  jurisdictions: z.array(z.string().min(2)).optional(),
  /** Free-form tags (district, segment, anomaly-class). */
  tags: z.array(z.string()).default([]),
});

export type HypothesisSeed = z.infer<typeof HypothesisSeedSchema>;

// ─────────────────────────────────────────────────────────────────────
// Hypothesis — what the Generation agent emits (an instantiation of a
// seed, or a brand-new claim). Carries provenance so we can later
// trace why the system asked this question.
// ─────────────────────────────────────────────────────────────────────

export const HypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(8),
  area: z.enum(DISCOVERY_AREAS),
  owningPerspective: z.enum(PERSPECTIVES),
  treatment: z.string().min(1),
  outcome: z.string().min(1),
  confounders: z.array(z.string()),
  /** Seed id this descended from, or null if novel. */
  parentSeedId: z.string().nullable(),
  /** If born from `EvolutionAgent`, the parent hypothesis id. */
  parentHypothesisId: z.string().nullable(),
  /** ISO timestamp, optional — orchestrator fills it. */
  createdAt: z.string().optional(),
});

export type Hypothesis = z.infer<typeof HypothesisSchema>;

// ─────────────────────────────────────────────────────────────────────
// Causal DAG — LLM-proposed. The sidecar treats it as a candidate;
// refutation tests then decide whether it survives.
// ─────────────────────────────────────────────────────────────────────

export const CausalDAGSchema = z.object({
  nodes: z.array(z.string().min(1)).min(2),
  /** Directed edges (from → to). */
  edges: z.array(
    z.object({
      from: z.string().min(1),
      to: z.string().min(1),
      /** Optional plain-English rationale produced by the LLM. */
      rationale: z.string().optional(),
    }),
  ),
  /** Edges the LLM is *unsure* about — sidecar tests them first. */
  candidateEdges: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
      }),
    )
    .default([]),
});

export type CausalDAG = z.infer<typeof CausalDAGSchema>;

// ─────────────────────────────────────────────────────────────────────
// Refutation results — what the Python sidecar returns from DoWhy.
// All scores in [0, 1]; higher = the DAG survived that test more
// confidently.
// ─────────────────────────────────────────────────────────────────────

export const RefutationScoresSchema = z.object({
  placebo: z.number().min(0).max(1),
  bootstrap: z.number().min(0).max(1),
  unobservedConfounder: z.number().min(0).max(1),
  /** Optional conditional-independence test score. */
  conditionalIndependence: z.number().min(0).max(1).optional(),
});

export type RefutationScores = z.infer<typeof RefutationScoresSchema>;

// ─────────────────────────────────────────────────────────────────────
// CausalFusion result — combined DAG + refutation + verdict.
// ─────────────────────────────────────────────────────────────────────

export const CausalFusionResultSchema = z.object({
  dag: CausalDAGSchema,
  refutationScores: RefutationScoresSchema,
  /** True iff *all* scores ≥ threshold (default 0.5 per CausalFusion paper). */
  kept: z.boolean(),
  /** Plain-text reason the system kept or dropped this DAG. */
  rationale: z.string().min(4),
  /** Where the sidecar lives (env var). */
  sidecarUrl: z.string().optional(),
});

export type CausalFusionResult = z.infer<typeof CausalFusionResultSchema>;

// ─────────────────────────────────────────────────────────────────────
// Evidence — anything that supports / refutes a hypothesis. Surfaced
// in the DiscoveryCard's "evidence chips".
// ─────────────────────────────────────────────────────────────────────

export type EvidenceKind =
  | 'refutation_passed'
  | 'refutation_failed'
  | 'cohort_signal'
  | 'time_series_lag'
  | 'expert_prior'
  | 'related_study';

export interface Evidence {
  readonly kind: EvidenceKind;
  readonly summary: string;
  /** Strength score in [0, 1]. */
  readonly strength: number;
  /** Optional source — paper DOI, KG triple id, etc. */
  readonly sourceRef?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Elo tournament — Ranking agent state.
// ─────────────────────────────────────────────────────────────────────

export interface EloEntry {
  readonly hypothesisId: string;
  readonly rating: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
}

export interface RankedHypothesis {
  readonly hypothesis: Hypothesis;
  readonly elo: EloEntry;
}

// ─────────────────────────────────────────────────────────────────────
// Discovery Card — the admin portal's render contract.
// ─────────────────────────────────────────────────────────────────────

export interface DiscoveryCard {
  readonly id: string;
  readonly title: string;
  readonly hypothesis: Hypothesis;
  readonly dag: CausalDAG;
  readonly refutation: RefutationScores;
  readonly evidence: readonly Evidence[];
  readonly elo: EloEntry;
  /** Plain-English suggested action. */
  readonly recommendedAction: string;
  /** Risk score in [0, 1] — 0 = safe to roll out, 1 = block. */
  readonly riskScore: number;
  /** Perspective owning this card. */
  readonly perspective: Perspective;
  /** ISO timestamp. */
  readonly createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────
// LLM client port — injected so the orchestrator never imports a
// provider directly. Compose with @borjie/ai-copilot/providers
// (multi-llm-synthesizer) at the call-site, not here.
// ─────────────────────────────────────────────────────────────────────

export interface LLMCompletionRequest {
  readonly prompt: string;
  /** System message; the persona/role for this turn. */
  readonly system?: string;
  /** Hard cap on tokens — orchestrator enforces budget. */
  readonly maxTokens?: number;
  /** Free-form metadata for tracing — orchestrator fills it. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface LLMCompletionResponse {
  readonly text: string;
}

export interface LLMClient {
  complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

// ─────────────────────────────────────────────────────────────────────
// Sidecar client port — injected so we can mock it in tests. Real
// impl POSTs to the FastAPI service spec'd in
// `sidecar/python-sidecar-spec.md`.
// ─────────────────────────────────────────────────────────────────────

export interface SidecarRefuteRequest {
  readonly dag: CausalDAG;
  /** Opaque pointer into the tenant data lake — sidecar resolves it. */
  readonly dataRef: string;
  /** Treatment / outcome variable names for DoWhy. */
  readonly treatment: string;
  readonly outcome: string;
  readonly estimator: HypothesisSeed['suggestedEstimator'];
}

export interface SidecarRefuteResponse {
  readonly scores: RefutationScores;
  /** Free-text from the sidecar (DoWhy stdout snippet). */
  readonly diagnostics: string;
}

export interface SidecarPcmciRequest {
  readonly variables: readonly string[];
  readonly dataRef: string;
  /** Max lag (months) to search. */
  readonly tauMax: number;
}

export interface SidecarPcmciResponse {
  /** Discovered DAG (possibly cyclic in lag-space; sidecar normalises). */
  readonly dag: CausalDAG;
  /** Per-edge p-values, parallel to dag.edges. */
  readonly pValues: readonly number[];
}

export interface SidecarClient {
  refute(req: SidecarRefuteRequest): Promise<SidecarRefuteResponse>;
  pcmciplus(req: SidecarPcmciRequest): Promise<SidecarPcmciResponse>;
  health(): Promise<{ ok: boolean; version: string }>;
}
