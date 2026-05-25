/**
 * Plan-and-Execute orchestration — public types.
 *
 * The 2026 SOTA replacement for sequential ReAct loops. A planner LLM
 * proposes a DAG of subtasks; workers execute leaves in parallel; a
 * re-planner re-evaluates after every batch; a verifier confirms the
 * goal was reached. Every step + decision lands in an audit trail.
 *
 * Cited 92% task completion + 3.6× speedup vs sequential ReAct in
 * n1n.ai's 2026 benchmark
 * (see `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md`).
 *
 * Multi-LLM synthesis (3-LLM agreement) is mandatory for the planner,
 * the re-planner, and the verifier — these are the high-stakes decision
 * points where a single model's first-plausible answer is the worst
 * trap to fall into. Worker execution is single-shot because the
 * tool's own contract is the ground truth.
 *
 * Pure types only — no runtime, no I/O. The runtime ports
 * (`StepExecutor`, `MultiLlmSynthesizer`, `AuditSink`) are injected at
 * runtime by the central-intelligence kernel so this module compiles
 * stand-alone and stays test-friendly.
 */

// ─────────────────────────────────────────────────────────────────────
// EvidenceCitation — every claim, every plan, every verification
// outcome MUST cite the source it was grounded in. This is non-
// negotiable for liability in the property-management domain (see
// `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md` §8).
//
// `freshnessMs` records how stale the source was at decision time.
// A `freshnessMs` of `null` means the citation is from a tool whose
// freshness is not tracked (in-process compute, etc).
// ─────────────────────────────────────────────────────────────────────

export interface EvidenceCitation {
  /** Stable identifier for the upstream source (e.g. 'mpesa', 'graph'). */
  readonly source: string;
  /**
   * Reference inside the source (transaction id, graph node id, doc
   * anchor, etc). Opaque to this module — only the audit trail reads
   * it back out.
   */
  readonly ref: string;
  /**
   * Age in milliseconds at the time the citation was attached.
   * `null` for sources without a meaningful freshness signal.
   */
  readonly freshnessMs: number | null;
  /** Optional human-readable label the audit UI renders. */
  readonly label?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Step — a single node in the plan DAG. Each step names exactly ONE
// tool from the existing tool registry plus a JSON-encoded input the
// worker will pass through. No tool reimplementation lives in this
// module by design.
// ─────────────────────────────────────────────────────────────────────

export type StepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface Step {
  readonly id: string;
  /** Human-readable phrase the audit log + UI render. */
  readonly description: string;
  /** Name of the tool to invoke. Must exist in the injected registry. */
  readonly toolName: string;
  /** Input the worker passes to the tool. Schema is the tool's contract. */
  readonly input: unknown;
  /**
   * Estimated cost in arbitrary units (e.g. tokens, ms, USD). The
   * scheduler uses it to balance parallel batches. `null` means the
   * planner did not estimate.
   */
  readonly estimatedCost: number | null;
  /** Citations the planner used to justify proposing THIS step. */
  readonly citations: ReadonlyArray<EvidenceCitation>;
}

// ─────────────────────────────────────────────────────────────────────
// Plan — a typed bundle of `steps` + `deps` ([from, to] edges meaning
// `from` must complete before `to` starts). The DAG layer below
// validates that no cycles exist.
// ─────────────────────────────────────────────────────────────────────

export interface Plan {
  /** Stable identifier; rotates on re-plan. */
  readonly id: string;
  /** The user's original goal — kept verbatim for the verifier. */
  readonly goal: string;
  readonly steps: ReadonlyArray<Step>;
  /**
   * Directed edges `[from, to]` denoting `from` must complete before
   * `to` starts. Edges referencing unknown step ids are rejected by
   * the DAG validator.
   */
  readonly deps: ReadonlyArray<readonly [string, string]>;
  /**
   * Citations the planner used to justify the OVERALL plan shape.
   * Step-level citations live on `Step.citations`.
   */
  readonly planCitations: ReadonlyArray<EvidenceCitation>;
  /** ISO-8601 instant the plan was produced (or re-planned). */
  readonly createdAt: string;
  /** Plan generation increments by 1 on every re-plan; starts at 1. */
  readonly generation: number;
}

// ─────────────────────────────────────────────────────────────────────
// ExecutionRecord — the artifact of running a step. Captures the
// tool's success/failure, latency, the worker that picked it up, and
// any citations the tool produced. Always immutable.
// ─────────────────────────────────────────────────────────────────────

export interface ExecutionRecord {
  readonly stepId: string;
  readonly toolName: string;
  readonly status: StepStatus;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly latencyMs: number;
  /** Tool output as returned. Null when the step failed or was skipped. */
  readonly output: unknown;
  /** Error message when `status === 'failed'`. */
  readonly error: string | null;
  /** Citations the TOOL produced (versus the planner's prior citations). */
  readonly citations: ReadonlyArray<EvidenceCitation>;
}

// ─────────────────────────────────────────────────────────────────────
// VerificationResult — what the verifier returns. Either the goal is
// achieved (with cited evidence) or it is not (with the deltas the
// re-planner should resolve).
// ─────────────────────────────────────────────────────────────────────

export interface VerificationDelta {
  readonly description: string;
  /** Optional pointer back to the unmet criterion in the goal. */
  readonly criterion?: string;
}

export interface VerificationResult {
  readonly goalAchieved: boolean;
  /**
   * Confidence in [0, 1] — how strongly the verifier believes the
   * answer above. Triggers a re-verify pass when below the configured
   * threshold even if `goalAchieved === true`.
   */
  readonly confidence: number;
  /** Evidence supporting whichever conclusion was reached. */
  readonly evidence: ReadonlyArray<EvidenceCitation>;
  /**
   * When `goalAchieved === false`, the deltas the re-planner must
   * resolve. Empty array when the goal was achieved.
   */
  readonly deltas: ReadonlyArray<VerificationDelta>;
  /** Human-readable summary the audit log + UI render. */
  readonly summary: string;
}

// ─────────────────────────────────────────────────────────────────────
// AuditEntry — one row in the audit trail. The trail captures every
// step + decision; downstream regulators / operators replay it to
// reconstruct WHY the agent did what it did.
// ─────────────────────────────────────────────────────────────────────

export type AuditEntryKind =
  | 'plan_created'
  | 'plan_replanned'
  | 'batch_started'
  | 'batch_completed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'verification'
  | 'goal_achieved'
  | 'goal_abandoned';

export interface AuditEntry {
  readonly entryId: string;
  readonly kind: AuditEntryKind;
  readonly at: string;
  /** Free-form payload — readers narrow on `kind`. */
  readonly payload: unknown;
}

// ─────────────────────────────────────────────────────────────────────
// Multi-LLM synthesis port. The planner, re-planner, and verifier all
// route through this — it executes the same prompt against ≥3 LLMs
// and surfaces consensus + disagreement signals so the orchestrator
// can either accept, escalate, or re-prompt.
//
// The actual sensor failover + voting logic lives in
// central-intelligence/kernel/debate; this port is the seam.
// ─────────────────────────────────────────────────────────────────────

export interface MultiLlmRequest {
  readonly purpose: 'planner' | 'replanner' | 'verifier';
  readonly system: string;
  readonly userMessage: string;
  /**
   * Minimum number of LLMs that must AGREE for the response to be
   * considered consensus. Defaults to 2-of-3 on the synthesizer.
   */
  readonly minAgreement?: number;
}

export interface MultiLlmResponse {
  /** The synthesised answer (typically JSON the caller parses). */
  readonly text: string;
  /** Number of LLMs queried. */
  readonly modelsQueried: number;
  /** Number of LLMs that produced the consensus answer. */
  readonly modelsAgreed: number;
  /** True when `modelsAgreed >= minAgreement`. */
  readonly converged: boolean;
  /** Per-model verbatim responses, in query order. */
  readonly perModel: ReadonlyArray<{
    readonly modelId: string;
    readonly text: string;
    readonly latencyMs: number;
  }>;
}

export interface MultiLlmSynthesizer {
  synthesize(req: MultiLlmRequest): Promise<MultiLlmResponse>;
}

// ─────────────────────────────────────────────────────────────────────
// StepExecutor — the port the worker-runner calls to actually invoke a
// tool. The real implementation lives in the central-intelligence
// tool-registry; this seam keeps the planning module decoupled.
// ─────────────────────────────────────────────────────────────────────

export interface StepExecutor {
  execute(step: Step): Promise<ExecutionRecord>;
}

// ─────────────────────────────────────────────────────────────────────
// AuditSink — append-only audit trail port. The in-memory
// implementation in `audit-trail.ts` is the default for tests; prod
// wires a persistent sink (Postgres / S3 / Kafka).
// ─────────────────────────────────────────────────────────────────────

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
  list(): Promise<ReadonlyArray<AuditEntry>>;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator config + result — the high-level public API the central-
// intelligence kernel will use to actually run a plan-and-execute loop.
// (Kept in `types.ts` because both planner.ts and replanner.ts reference
// the limits.)
// ─────────────────────────────────────────────────────────────────────

export interface PlanExecuteConfig {
  /** Hard cap on re-plan iterations. Defaults to 3. */
  readonly maxReplans: number;
  /** Hard cap on parallel workers per batch. Defaults to 8. */
  readonly maxParallelism: number;
  /** Verifier confidence threshold for accepting `goalAchieved === true`. */
  readonly verifierConfidenceThreshold: number;
  /** Re-prompt the multi-LLM up to this many times when consensus fails. */
  readonly maxConsensusRetries: number;
}

export const DEFAULT_PLAN_EXECUTE_CONFIG: PlanExecuteConfig = {
  maxReplans: 3,
  maxParallelism: 8,
  verifierConfidenceThreshold: 0.7,
  maxConsensusRetries: 2,
};
