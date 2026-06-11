/**
 * Modality arbiter — types (COG-07 / AUT-14, the Wave-B keystone).
 *
 * The arbiter classifies a consequential brain turn into exactly ONE of
 * eight CLOSED output modalities, then routes. The eight are a `const`
 * union; an unrecognised classifier output FAILS CLOSED to `chat` (the
 * always-safe, zero-side-effect modality) and records a telemetry reason.
 *
 * Everything the arbiter needs from the world (embedder, skill/flow
 * retrieval, per-flow autonomy posture, the rail-composed autonomy
 * decider, the body-change syscall, the loop runner) is an INJECTED PORT
 * so this package stays decoupled from `@borjie/autonomy-governance`,
 * `@borjie/mutation-authority`, and `@borjie/loop-runner`. The api-gateway
 * composition root binds the concrete adapters.
 *
 * Immutability rule: every field is `readonly`.
 *
 * @module kernel/orchestrator/modality-arbiter-types
 */

import type { Decision } from './decision.js';

// ─────────────────────────────────────────────────────────────────────
// The eight modalities — the CLOSED output set.
// ─────────────────────────────────────────────────────────────────────

/**
 * The eight output modalities, in registry order. `loop` is a sub-kind of
 * `workflow` carried on `ModalityVerdict.loopKind`; it is NOT a separate
 * top-level modality so the closed-set arithmetic stays at eight.
 *
 * `forecast` is a generative ARTIFACT modality (calibrated, advisory
 * time-series) — it joins `document` / `media` as an engine-backed output
 * the modality executor routes to the forecast engine, then surfaces as a
 * proposal through the existing portal-genui `tab_proposal` channel. Like
 * the other artifact modalities it is staged/low-consequence and never
 * mutates a surface without owner approval.
 */
export const MODALITIES = [
  'chat',
  'tab',
  'document',
  'media',
  'forecast',
  'action',
  'skill',
  'workflow',
] as const;

export type Modality = (typeof MODALITIES)[number];

/** Type guard — true iff `value` is one of the eight closed modalities. */
export function isModality(value: unknown): value is Modality {
  return (
    typeof value === 'string' &&
    (MODALITIES as ReadonlyArray<string>).includes(value)
  );
}

/**
 * Standing/recurring loop kinds (mirrors `@borjie/loop-runner`
 * `LoopKind`). A `workflow` verdict carrying a `loopKind` routes to the
 * loop-runner rather than the bounded workflow-engine.
 */
export const LOOP_KINDS = [
  'reactive',
  'tab_tick',
  'deep_research',
  'autonomous_24_7',
  'recipe_lifecycle',
] as const;

export type LoopKind = (typeof LOOP_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────
// Reversibility / consequence statics carried per modality.
// ─────────────────────────────────────────────────────────────────────

/** Mirrors `@borjie/autonomy-governance` `Reversibility`. */
export type Reversibility = 'reversible' | 'staged' | 'irreversible';

/** Mirrors `@borjie/autonomy-governance` `ConsequenceTier` (subset used). */
export type ConsequenceTier =
  | 'trivial'
  | 'low'
  | 'moderate'
  | 'high'
  | 'severe';

// ─────────────────────────────────────────────────────────────────────
// Autonomy decider port — the rail-composed continuous controller.
//
// The arbiter NEVER re-implements gating. It assembles the inputs and
// calls this port (bound in composition to `composeWithRail(decideAutonomy
// (...), railVerdict)` from `@borjie/autonomy-governance`). The output is
// ADDITIVE and may only ESCALATE: a rail-GATED modality stays gated; the
// arbiter may turn a rail-ALLOWED modality INTO a gate, never the reverse.
// ─────────────────────────────────────────────────────────────────────

export type AutonomyDecision = 'auto' | 'gate' | 'four_eyes';

export interface AutonomyDeciderInput {
  /** Conformally-calibrated confidence (0..1) from the kernel vector. */
  readonly calibratedConfidence: number;
  readonly consequenceTier: ConsequenceTier;
  readonly reversibility: Reversibility;
  /** Per-flow / ad-hoc delegation ceiling. */
  readonly mandate: 'observer' | 'approver' | 'consultant' | 'collaborator' | 'operator';
  /** Live re-gating signals (escalate-only). */
  readonly situationFlags?: {
    readonly novelCounterparty?: boolean;
    readonly regimeShift?: boolean;
    readonly driftTowardSovereign?: boolean;
    readonly anomalyDetected?: boolean;
    readonly defectionProbeHit?: boolean;
    readonly offHours?: boolean;
    readonly capSlowdown?: boolean;
    readonly irreversibilityBudgetExhausted?: boolean;
    readonly counterfactualConcern?: boolean;
  };
  /**
   * Whether the underlying rail (policy-gate / inviolable / HIGH-risk
   * literal prefix) has ALREADY gated this action. When `true` the
   * decider MUST return at least `gate` — rail-gate always wins.
   */
  readonly railGated?: boolean;
}

export interface AutonomyDeciderOutput {
  readonly decision: AutonomyDecision;
  /** Audit-grade reasons; never empty. */
  readonly reasons: ReadonlyArray<string>;
  readonly gatedBy:
    | null
    | 'consequence'
    | 'confidence'
    | 'mandate'
    | 'situation'
    | 'rail';
}

/** Injected, rail-composed autonomy decider. Pure-async. */
export type AutonomyDeciderPort = (
  input: AutonomyDeciderInput,
) => AutonomyDeciderOutput | Promise<AutonomyDeciderOutput>;

// ─────────────────────────────────────────────────────────────────────
// Retrieval ports — skill / flow / recipe nearest-neighbour.
// ─────────────────────────────────────────────────────────────────────

export interface RetrievedSkill {
  readonly skillId: string;
  /** Cosine SIMILARITY in [0,1] (1 = identical). The arbiter compares ≥ τ. */
  readonly score: number;
  readonly humanReviewed: boolean;
  readonly status: 'active' | 'retired' | 'shadow';
  /** Whether selecting this skill would persist/register a NEW capability. */
  readonly persistsNewCapability?: boolean;
}

export interface SkillRetrieverPort {
  retrieve(args: {
    readonly intentEmbedding: ReadonlyArray<number>;
    readonly topK: number;
  }): Promise<ReadonlyArray<RetrievedSkill>>;
}

export interface RetrievedFlow {
  readonly flowId: string;
  readonly score: number;
  /** When set, this flow is a STANDING loop → routes to the loop-runner. */
  readonly loopKind?: LoopKind;
  /** Whether selecting this flow would persist/register a NEW capability. */
  readonly persistsNewCapability?: boolean;
}

export interface FlowRetrieverPort {
  retrieve(args: {
    readonly intentEmbedding: ReadonlyArray<number>;
    readonly topK: number;
  }): Promise<ReadonlyArray<RetrievedFlow>>;
}

/** A static descriptor vector for a tab / document / media / forecast recipe. */
export interface ModalityDescriptor {
  readonly modality: 'tab' | 'document' | 'media' | 'forecast';
  readonly recipeId: string;
  readonly embedding: ReadonlyArray<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Per-flow autonomy posture port — reads `flow_autonomy_prefs` (0308).
// ─────────────────────────────────────────────────────────────────────

export interface FlowPosture {
  readonly mandate:
    | 'observer'
    | 'approver'
    | 'consultant'
    | 'collaborator'
    | 'operator';
  readonly riskCeiling?: ConsequenceTier;
  readonly amountThreshold?: number;
}

export interface FlowPosturePort {
  /** Resolve the standing posture for a flow id (or the synthetic default). */
  posture(args: {
    readonly tenantId: string | null;
    readonly flowId: string;
  }): Promise<FlowPosture>;
}

// ─────────────────────────────────────────────────────────────────────
// Body-change syscall port (EA-04 / `@borjie/mutation-authority`).
//
// The META-RAIL: any modality that GROWS capability (registers/persists a
// new skill / tab / workflow) MUST route its persistence through the
// unified body-change syscall. The arbiter NEVER writes a registry row
// directly — it emits an intent the body-change executor authorizes.
// ─────────────────────────────────────────────────────────────────────

export interface BodyChangeRequest {
  readonly kind: 'register_skill' | 'spawn_tab' | 'register_workflow';
  readonly tenantId: string | null;
  readonly subjectId: string;
  readonly reason: string;
}

export interface BodyChangeVerdict {
  readonly authorized: boolean;
  readonly reason: string;
}

export interface BodyChangePort {
  authorizeBodyChange(req: BodyChangeRequest): Promise<BodyChangeVerdict>;
}

// ─────────────────────────────────────────────────────────────────────
// Loop-runner port — wires the orphan `@borjie/loop-runner`.
// ─────────────────────────────────────────────────────────────────────

export interface LoopRunnerPort {
  runLoop(args: {
    readonly flowId: string;
    readonly loopKind: LoopKind;
    readonly tenantId: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly loopRunId: string }>;
}

// ─────────────────────────────────────────────────────────────────────
// Tier-2 LLM tie-break port — single cheap label call, budget-guarded.
// ─────────────────────────────────────────────────────────────────────

export interface LlmTieBreakPort {
  classify(args: {
    readonly intentText: string;
    readonly candidates: ReadonlyArray<Modality>;
    /** Single-language directive (EN/SW purity — no mixing in any output). */
    readonly languageDirective?: string;
  }): Promise<{ readonly modality: Modality; readonly reason: string }>;
}

// ─────────────────────────────────────────────────────────────────────
// Embedder port (mirrors the kernel `EmbedderPort`).
// ─────────────────────────────────────────────────────────────────────

export interface ArbiterEmbedderPort {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

// ─────────────────────────────────────────────────────────────────────
// Arbiter deps + verdict.
// ─────────────────────────────────────────────────────────────────────

export interface ModalityArbiterDeps {
  readonly embedder: ArbiterEmbedderPort;
  readonly skillRetriever?: SkillRetrieverPort;
  readonly flowRetriever?: FlowRetrieverPort;
  readonly recipeDescriptors?: ReadonlyArray<ModalityDescriptor>;
  readonly llmTieBreak?: LlmTieBreakPort;
  readonly autonomyDecider?: AutonomyDeciderPort;
  readonly flowPosturePort?: FlowPosturePort;
  readonly bodyChangePort?: BodyChangePort;
  readonly loopRunner?: LoopRunnerPort;
  /**
   * Cosine-similarity threshold τ above which a Tier-1 nearest-neighbour
   * match wins outright. Default `DEFAULT_MODALITY_TAU` (0.85, the SOTA
   * hybrid threshold). 0 < topScore < τ falls through to the Tier-2 LLM.
   */
  readonly tau?: number;
  /** Nearest-neighbour fan-out (default 5). */
  readonly topK?: number;
  readonly logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/** Which cascade tier produced the verdict (telemetry). */
export type ArbiterTier = 'tier0' | 'tier1' | 'tier2' | 'fail-closed';

export interface ModalityVerdict {
  readonly modality: Modality;
  /** Set when `modality === 'skill'`. */
  readonly skillId?: string;
  /** Set when `modality === 'workflow'`. */
  readonly flowId?: string;
  /** Set when a `workflow` verdict is a STANDING loop. */
  readonly loopKind?: LoopKind;
  /** Set for tab/document/media — which recipe matched. */
  readonly recipeId?: string;
  /** Cosine similarity of the winning Tier-1 match (0 when none). */
  readonly score: number;
  /** Which tier decided. */
  readonly tier: ArbiterTier;
  /** Human-readable, single-language reason (telemetry + audit). */
  readonly reason: string;
  /** Rail-composed autonomy verdict for the chosen modality. */
  readonly autonomy?: AutonomyDeciderOutput;
  /** True when the meta-rail body-change syscall authorized persistence. */
  readonly bodyChangeAuthorized?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Classify input.
// ─────────────────────────────────────────────────────────────────────

export interface ModalityArbiterInput {
  /** The turn's natural-language intent (the user's request). */
  readonly intentText: string;
  /** The Decision the LLM router already emitted (the arbiter post-classifies). */
  readonly decision: Decision;
  /** Tenant id for RLS-scoped retrieval (null = platform / global). */
  readonly tenantId: string | null;
  /** Conformally-calibrated confidence from the kernel `ConfidenceVector`. */
  readonly calibratedConfidence: number;
  /** Live re-gating signals (escalate-only). */
  readonly situationFlags?: AutonomyDeciderInput['situationFlags'];
  /**
   * Whether the underlying rail has already gated this turn (policy-gate /
   * inviolable / HIGH-risk literal prefix). Propagated so the autonomy
   * verdict cannot relax a rail-gate.
   */
  readonly railGated?: boolean;
  /** Single-language directive — EN/SW purity in any emitted reason text. */
  readonly languageDirective?: string;
}

export interface ModalityArbiter {
  classify(input: ModalityArbiterInput): Promise<ModalityVerdict>;
}
