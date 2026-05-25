/**
 * 8-stage sleep-time consolidation — shared types.
 *
 * Each stage exports a single function that takes a typed input and
 * returns a typed output. The orchestrator (`../orchestrator.ts`)
 * chains them sequentially; failure in one stage logs + continues so
 * a single bad cluster doesn't kill the whole tick.
 *
 * All ports here are duck-typed so the worker compiles without a
 * compile-time dependency on `@borjie/database`. The composition
 * root in `../index.ts` is the only place that wires real adapters.
 */

export interface StageLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 01 — Ingest
// ─────────────────────────────────────────────────────────────────────

export interface TraceEntry {
  readonly traceId: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly capturedAt: string;
}

export interface ImplicitSignalEntry {
  readonly id: string;
  readonly traceId: string;
  readonly agentActionId: string | null;
  readonly tenantId: string;
  readonly userId: string;
  readonly surface: string;
  readonly signalType:
    | 'copy'
    | 're-prompt'
    | 'edit-resubmit'
    | 'override'
    | 'abandonment'
    | 'time-to-resolution';
  readonly strength: number;
  readonly emittedAt: string;
}

export interface FeedbackEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly thoughtId: string;
  readonly signal: 'thumbs-up' | 'thumbs-down' | 'correction' | 'flagged';
  readonly correctionText?: string;
  readonly capturedAt: string;
}

export interface IngestBundle {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly traces: ReadonlyArray<TraceEntry>;
  readonly implicitSignals: ReadonlyArray<ImplicitSignalEntry>;
  readonly explicitFeedback: ReadonlyArray<FeedbackEntry>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 02 — Cluster
// ─────────────────────────────────────────────────────────────────────

export interface TraceCluster {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly intentLabel: string;
  readonly traces: ReadonlyArray<TraceEntry>;
  /** Aggregate outcome of the cluster — 'success' / 'failure' / 'mixed'. */
  readonly outcome: 'success' | 'failure' | 'mixed';
  /**
   * Signed score in [-1, 1]:
   *   + thumbs-up / copy / time-to-resolution low contribute positive
   *   - thumbs-down / correction / re-prompt / override / edit-resubmit
   *     / abandonment contribute negative
   */
  readonly score: number;
  readonly signalsInside: number;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 03 — Reflect
// ─────────────────────────────────────────────────────────────────────

export interface ReflectionResult {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly text: string;
  readonly outcome: 'success' | 'failure' | 'mixed';
  /** "draft late-rent reminder Swahili" / "compute prorated charge" / ... */
  readonly intentLabel: string;
}

export interface ReflectionCritic {
  /**
   * Run one critic pass over a cluster. The default implementation
   * (`createStubCritic`) returns a deterministic stub; production
   * wires a Haiku-backed prompt at the composition root.
   */
  reflect(cluster: TraceCluster): Promise<ReflectionResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 04 — Promote
// ─────────────────────────────────────────────────────────────────────

export interface PromotionDecision {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly action: 'promote-skill' | 'prompt-patch' | 'no-op';
  readonly reason: string;
  /** Populated when `action === 'promote-skill'`. */
  readonly skillCandidate?: {
    readonly name: string;
    readonly nlDescription: string;
    readonly toolCallTemplate: unknown;
    readonly codeHash: string;
  };
}

export interface SkillRegistryPort {
  upsertSkill(args: {
    readonly tenantId: string | null;
    readonly name: string;
    readonly nlDescription: string;
    readonly toolCallTemplate: unknown;
    readonly codeHash: string;
    readonly embedding?: ReadonlyArray<number>;
  }): Promise<{ id: string; created: boolean }>;
}

export interface ConsolidationEmbedder {
  embed(text: string): Promise<ReadonlyArray<number>>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 04 — Mem0 ADD/UPDATE/DELETE/NOOP decision port
//
// Optional. When wired AND `MEM0_SEMANTICS_ENABLED=true` is set in
// the environment, the promote stage consults this port before
// upserting a candidate skill so that contradicted (UPDATE),
// duplicated (NOOP), or revoked (DELETE) candidates short-circuit
// out of `SkillRegistryPort.upsertSkill`. The composition root wires
// this to `@borjie/ai-copilot`'s `decideMem0Op` (Park et al.
// 2024 / arXiv 2404.13501). Pure — the decision is computed by the
// adapter; the stage itself stays IO-free.
// ─────────────────────────────────────────────────────────────────────

export interface Mem0CandidateInput {
  readonly factText: string;
  readonly intentLabel: string;
  readonly confidence?: number;
  readonly embedding?: ReadonlyArray<number>;
}

export type Mem0DecisionKind = 'add' | 'update' | 'delete' | 'noop';

export interface Mem0DecisionOutcome {
  readonly kind: Mem0DecisionKind;
  readonly reason: string;
  /** Existing skill row id when kind ∈ {update, delete, noop}. */
  readonly relatedId?: string;
  /** Similarity score when applicable. */
  readonly similarity?: number;
}

export interface Mem0DecisionPort {
  decide(
    candidate: Mem0CandidateInput,
    scope: { readonly tenantId: string | null },
  ): Promise<Mem0DecisionOutcome>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 05 — Decay
// ─────────────────────────────────────────────────────────────────────

export interface SemanticDecayPort {
  decay(args: {
    readonly tenantId: string | null;
    readonly decayPerDay: number;
  }): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 06 — Consolidate
// ─────────────────────────────────────────────────────────────────────

export interface ConsolidateMergeReport {
  readonly tenantId: string | null;
  readonly mergedEntities: number;
  readonly inspectedEntities: number;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 07 — Re-embed
// ─────────────────────────────────────────────────────────────────────

export interface ReEmbedReport {
  readonly tenantId: string | null;
  readonly reEmbeddedCount: number;
  readonly inspectedCount: number;
}

// ─────────────────────────────────────────────────────────────────────
// Stage 08 — Publish
// ─────────────────────────────────────────────────────────────────────

export interface BrainDelta {
  readonly tickId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly skillsPromoted: number;
  readonly promptPatches: number;
  readonly factsDecayed: number;
  readonly entitiesMerged: number;
  readonly factsReEmbedded: number;
  readonly clustersInspected: number;
}

export interface BrainDeltaPublisher {
  publish(delta: BrainDelta): Promise<void>;
}
