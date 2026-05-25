/**
 * Sub-MD base — scoped, reversible task-contracts that ride INSIDE the
 * MD (Mind-of-Domain) kernel. NOT autonomous juniors.
 *
 * Per R3 framing: a sub-MD is the smallest unit of automated
 * cognitive labor that the MD can hand off, observe, and reclaim.
 * Sub-MDs run a four-stage pipeline:
 *
 *   1. OBSERVE   — listen to the event-bus for in-scope events
 *   2. MAP       — turn raw events into a ProcessGraph (state machine)
 *   3. REDESIGN  — LLM proposes optimisations on the graph
 *   4. AUTOMATE  — compile the redesign into Skill + cron + monitor
 *
 * The MD always closes the loop; the sub-MD never auto-promotes its
 * redesigns to production. Every artefact lands in a draft state and
 * is gated by the MD's policy / four-eye / approval flow.
 *
 * Reliability framing: 0.85^10 ≈ 0.20. We optimise for *single-step
 * task quality*, never for unbounded multi-step autonomy. A sub-MD
 * that touches 10 things is broken into 10 reversible single-step
 * contracts, not collapsed into one autonomous loop.
 */

import type { PersonaIdentity } from '../../identity.js';
import type { RiskTier } from '../../risk-tier.js';

// ─────────────────────────────────────────────────────────────────────
// Scope + context
// ─────────────────────────────────────────────────────────────────────

/**
 * The (tenantId, ownerId?, propertyId?) bubble a sub-MD lives in. A
 * sub-MD that fires outside its scope is a kernel bug; the base
 * dispatcher refuses cross-scope events.
 */
export interface ScopeFilter {
  readonly tenantId: string;
  readonly ownerId?: string;
  readonly propertyIds?: ReadonlyArray<string>;
}

export interface SubMdContext {
  readonly scope: ScopeFilter;
  /** Epoch ms; injected so the pipeline is deterministic in tests. */
  readonly nowMs: number;
  /** Audit + decision-trace correlation id. */
  readonly correlationId: string;
  /** Stable budget caps inherited from the parent MD. */
  readonly budget: SubMdBudget;
  /** LLM port — caller injects production / fake. Sub-MDs never
   *  reach into a global module. */
  readonly llm: SubMdLlmPort;
  /** Optional event-bus port — production wires NATS / Redis; tests
   *  inject an async iterable. */
  readonly events?: SubMdEventPort;
}

export interface SubMdBudget {
  readonly maxObservedEvents: number;
  readonly maxLlmCallsPerStage: number;
  readonly maxAutomationArtifacts: number;
}

export const DEFAULT_SUB_MD_BUDGET: Readonly<SubMdBudget> = Object.freeze({
  maxObservedEvents: 500,
  maxLlmCallsPerStage: 3,
  maxAutomationArtifacts: 1,
});

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

export interface SubMdLlmPort {
  /** Single-shot text generation. Sub-MDs never stream. */
  generate(args: {
    readonly system: string;
    readonly user: string;
    readonly maxTokens?: number;
  }): Promise<{ readonly text: string }>;
}

export interface SubMdEventPort {
  /**
   * Async iterable of in-scope events. Caller filters by topic
   * BEFORE handing them to the sub-MD — defense-in-depth.
   */
  subscribe(args: {
    readonly topic: string;
    readonly scope: ScopeFilter;
    readonly limit: number;
  }): AsyncIterable<ObservedEvent>;
}

// ─────────────────────────────────────────────────────────────────────
// Stage data types
// ─────────────────────────────────────────────────────────────────────

export interface ObservedEvent {
  readonly id: string;
  readonly topic: string;
  readonly tenantId: string;
  readonly occurredAtMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ProcessGraphNode {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly avgDwellMs?: number;
}

export interface ProcessGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
  readonly avgTransitionMs?: number;
}

export interface ProcessGraph {
  readonly nodes: ReadonlyArray<ProcessGraphNode>;
  readonly edges: ReadonlyArray<ProcessGraphEdge>;
  readonly slaBreaches: ReadonlyArray<{
    readonly nodeId: string;
    readonly breachedCount: number;
  }>;
  readonly observationCount: number;
}

export interface RedesignProposal {
  readonly summary: string;
  readonly steps: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly expectedImpact: string;
  }>;
  /** The sub-MD's best estimate of post-change metric; recorded so
   *  the closed-loop outcome-recorder can compare to actual. */
  readonly predicted: PredictedOutcome;
}

export interface AutomationArtifact {
  readonly skillName: string;
  readonly cronExpression?: string;
  readonly monitorThresholds: Readonly<Record<string, number>>;
  readonly hookNames: ReadonlyArray<string>;
  readonly draftStatus: 'draft' | 'review-requested';
}

export interface PredictedOutcome {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
}

export interface ActualOutcome {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly recordedAtMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// The sub-MD contract
// ─────────────────────────────────────────────────────────────────────

export interface SubMd {
  readonly name: string;
  readonly persona: PersonaIdentity;
  readonly scope: ScopeFilter;
  readonly toolBelt: ReadonlyArray<string>;
  readonly riskTier: RiskTier;

  observe(ctx: SubMdContext): AsyncIterable<ObservedEvent>;
  map(events: ReadonlyArray<ObservedEvent>, ctx: SubMdContext): Promise<ProcessGraph>;
  redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal>;
  automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact>;
  recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Tier tag for telemetry. Tier-A means reversible, human-checkable
 * task-contracts; this is the only tier sub-MDs ship in today.
 */
export type SubMdTier = 'A' | 'B' | 'C';

export interface SubMdMeta {
  readonly tier: SubMdTier;
  readonly evidenceCitation: string;
}

export function freezeBudget(b: Partial<SubMdBudget>): SubMdBudget {
  return Object.freeze({
    ...DEFAULT_SUB_MD_BUDGET,
    ...b,
  });
}

/**
 * Defensive guard — confirm an event is in scope before the sub-MD
 * handles it. Returns a structured reject so callers don't throw
 * on hot paths.
 */
export function eventInScope(
  evt: ObservedEvent,
  scope: ScopeFilter,
): { ok: true } | { ok: false; reason: string } {
  if (evt.tenantId !== scope.tenantId) {
    return { ok: false, reason: `cross-tenant event ${evt.id}` };
  }
  return { ok: true };
}
