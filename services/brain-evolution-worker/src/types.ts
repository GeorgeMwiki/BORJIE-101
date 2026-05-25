/**
 * Brain Evolution Worker — shared types.
 *
 * Sleep-time consolidator (Letta pattern, Packer et al. 2024; cf. Harvey
 * "6x task-completion lift" 2025; Anthropic "dreaming" pattern 2025):
 * after each day, re-read the day's interaction traces, reflect on what
 * worked, extract memory deltas, and rewrite the persistent memory blocks
 * the brain consults at the next wake.
 *
 * The brain's memory model in BORJIE spans three Letta-style blocks:
 *
 *   - core_memory_blocks   — persona, human, preferences, project text
 *                            (per tenant + user + persona).
 *   - kernel_memory_semantic — extracted facts: "user prefers Swahili
 *                              greetings", "property P-12 is 95% occupied"
 *                              (per tenant, optionally per user).
 *   - ai_semantic_memories   — long-lived embedded conversational memory
 *                              (per tenant, optionally per persona).
 *
 * The worker is wire-agnostic: storage, LLM proposers, the constitution
 * verifier, and the event emitter are all ports the composition root
 * supplies. This file is the contract everything else depends on.
 */

/**
 * The three persistent memory surfaces the worker can rewrite. Names map
 * to the database schemas:
 *   - 'core'      → core_memory_blocks
 *   - 'semantic'  → kernel_memory_semantic
 *   - 'embedded'  → ai_semantic_memories
 */
export type MemoryBlockKind = 'core' | 'semantic' | 'embedded';

/**
 * Sub-kind for `core` blocks (mirrors core_memory_blocks.block_kind:
 * 'persona' | 'human' | 'preferences' | 'project').
 */
export type CoreBlockSubKind = 'persona' | 'human' | 'preferences' | 'project';

/**
 * Single interaction trace pulled from the trace store for a tenant's
 * day. Sources include `kernel_memory_episodic`, `kernel_action_audit`,
 * `ai_audit_chain`, and the Wave-2 `kernel_cot_reservoir`. The worker
 * doesn't care which source: the trace contract is uniform.
 *
 * `outcome` is the worker's reflection target — what did the brain do,
 * did it succeed, did it get corrected by a human, did the user disengage.
 */
export interface InteractionTrace {
  readonly traceId: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly personaId: string | null;
  readonly threadId: string | null;
  readonly capturedAt: string; // ISO timestamp
  /** 'user-message' | 'agent-action' | 'tool-call' | 'tool-result' | 'feedback' */
  readonly kind: string;
  /** Human-readable one-liner. */
  readonly summary: string;
  /** Structured detail (action tag, tool name, payload digest). */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Outcome marker: 'success' | 'failure' | 'corrected' | 'abandoned' | null. */
  readonly outcome: string | null;
}

/**
 * Reflection — the output of the multi-LLM jury for a single tenant's
 * day. Captures what worked, what didn't, and what should change. The
 * worker stores the raw reflection alongside the resulting deltas so
 * operators can audit the "why" later.
 */
export interface ReflectionResult {
  readonly tenantId: string;
  readonly windowStart: string; // ISO
  readonly windowEnd: string; // ISO
  readonly traceCount: number;
  /** Free-text synthesis from the multi-LLM jury. */
  readonly synthesis: string;
  /** What patterns repeated and worked well. */
  readonly worked: ReadonlyArray<string>;
  /** What patterns failed or were human-corrected. */
  readonly failed: ReadonlyArray<string>;
  /** New patterns observed for the first time. */
  readonly novel: ReadonlyArray<string>;
  /** Jaccard agreement across jury proposers, [0,1]. */
  readonly agreement: number;
  /** True when jury agreement was below threshold — escalate to human. */
  readonly escalate: boolean;
}

/**
 * A single proposed change to a memory block. Deltas are computed from a
 * reflection and then funnelled through the constitution review gate.
 *
 * `idempotencyKey` is hashed from (tenantId, blockKind, target identifier,
 * deltaContent). Re-running the same day's reflection produces the same
 * key, so the writer skips already-applied deltas — that's the worker's
 * idempotency contract.
 */
export interface MemoryDelta {
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly blockKind: MemoryBlockKind;
  /** For core blocks: which sub-kind. Null for semantic/embedded. */
  readonly coreSubKind: CoreBlockSubKind | null;
  /** For core blocks: user / persona scope. Null for tenant-wide. */
  readonly userId: string | null;
  readonly personaId: string | null;
  /** For semantic facts: the canonical key. */
  readonly semanticKey: string | null;
  /** Action tag the constitution verifier matches against. */
  readonly actionTag: string;
  /** The proposed new content (text or JSON-serialisable value). */
  readonly content: string;
  /** Confidence from the reflection synthesizer, [0,1]. */
  readonly confidence: number;
  /** Rationale the brain cites in its decision trace. */
  readonly rationale: string;
}

/**
 * Outcome of running a delta through the review gate. `applied=true`
 * means the delta passed every check and was written; `applied=false`
 * with `escalated=true` means it was queued for human review.
 */
export interface DeltaApplicationResult {
  readonly idempotencyKey: string;
  readonly applied: boolean;
  readonly escalated: boolean;
  readonly skippedReason: string | null;
  /** Clause ids the verifier reported as violations (empty when clean). */
  readonly violations: ReadonlyArray<string>;
}

/**
 * The end-of-night report the worker emits per tenant. Surfaces in the
 * admin portal so operators can review what the brain learned overnight.
 */
export interface BrainEvolutionReport {
  readonly tenantId: string;
  readonly runId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly tracesRead: number;
  readonly deltasProposed: number;
  readonly deltasApplied: number;
  readonly deltasEscalated: number;
  readonly deltasBlocked: number;
  readonly agreement: number;
  readonly escalateOverall: boolean;
  readonly synthesisExcerpt: string;
  readonly applications: ReadonlyArray<DeltaApplicationResult>;
  readonly emittedAt: string;
}

/**
 * Worker-wide logger shape. Mirrors `consolidation-worker`'s
 * `WorkerLogger` so composition wiring stays consistent across the two
 * sleep-time workers.
 */
export interface BrainWorkerLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Per-tenant aggregated run result returned by the orchestrator. The
 * scheduler aggregates these across tenants for the daily summary.
 */
export interface TenantRunResult {
  readonly tenantId: string;
  readonly status: 'ok' | 'skipped' | 'error';
  readonly tracesRead: number;
  readonly deltasApplied: number;
  readonly deltasEscalated: number;
  readonly deltasBlocked: number;
  readonly errorMessage: string | null;
  readonly report: BrainEvolutionReport | null;
}
