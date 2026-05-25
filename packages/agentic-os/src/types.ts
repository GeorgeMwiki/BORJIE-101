/**
 * @borjie/agentic-os — public types
 *
 * The meta-synthesis layer that composes brain + agent runtime +
 * orchestrator + MCP + open-coding patterns + OpenClaw model +
 * constitution + knowledge-graph into a single brain-first,
 * goal-directed, constitutionally-guarded, observation-and-trust-
 * calibrated runtime.
 *
 * Design tenets:
 *
 *   - PURE TYPES. No side-effects at import time.
 *   - IMMUTABLE STATE. Every transition returns a NEW object.
 *   - DUCK-TYPED PORTS. In-flight P55..P61 packages are referenced via
 *     minimal local interfaces — no workspace deps.
 *   - BRAIN-FIRST. Every request flows brain → agent.
 *   - GOAL-DIRECTED. Agents pursue goals, not commands.
 *   - CONSTITUTIONAL. Every action passes preflight.
 *   - OBSERVED + LEARNED-FROM. Every state change emits Observation.
 *   - TRUST-CALIBRATED. Autonomy ceiling tracks track record.
 *
 * Source-of-truth references (10+ cited in
 * `Docs/AGENTIC_OS_SYNTHESIS_2026-05-24.md`):
 *
 *   - Anthropic "Building Effective Agents" (2024) — composable patterns
 *   - OpenAI Swarm (Apr 2025) — handoff-based multi-agent
 *   - LangGraph 0.5 (2026) — stateful goal-directed graphs
 *   - DeepMind SIMA (2024) — generalist goal-conditioned policies
 *   - Anthropic Constitutional AI v3 (2024) — preflight + critique
 *   - Sutton & Barto RL (2nd ed) — observation + reward shaping
 *   - HippoRAG (NeurIPS 2024) — hippocampus-style memory consolidation
 *   - Microsoft GraphRAG (2024-2026) — community-summarised KG retrieval
 *   - Voyager (Wang et al. 2023) — capability registry + skill promotion
 *   - SAE J3016 (autonomy ladders) — risk-bounded autonomy ceilings
 *   - Apollo Research o3 covert-action study (2025) — pre-flight gates
 *   - OpenAI Deliberative Alignment (Dec 2024) — cite-and-reason-from
 *   - Jensen Huang GTC 2026 OpenClaw keynote — operating-model layer
 *   - Klarna autonomy-decay incident post-mortem (2025) — trust calibration
 */

// ============================================================================
// Common scalar aliases
// ============================================================================

/** ISO 3166-1 alpha-2 jurisdiction codes plus the global fallback. */
export type Jurisdiction = 'TZ' | 'KE' | 'UG' | 'RW' | 'BI' | 'ET' | 'NG' | 'ZA' | 'GLOBAL';

/** SAE J3016-inspired autonomy ladder (mirrors openclaw-operating-model). */
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

/** Risk class for actions + domains. */
export type RiskClass = 'low' | 'med' | 'high' | 'critical';

/** Outcome polarity used in trust calibration + judges. */
export type ActionOutcome = 'success' | 'partial' | 'failure' | 'escalated';

/** Channel a request arrived on. */
export type RequestChannel = 'http' | 'voice' | 'email' | 'sms' | 'webhook' | 'in-app' | 'webhook-internal';

// ============================================================================
// RequestEnvelope — the universal inbound shape
// ============================================================================

/**
 * Every inbound request from any channel is normalised into this shape
 * before it hits the brain-first gateway. Channel adapters (HTTP routes,
 * voice handlers, email parsers) are thin shells that produce envelopes.
 */
export interface RequestEnvelope {
  /** Stable correlation id — same across the entire goal lifecycle. */
  readonly requestId: string;
  /** Channel the request arrived on. */
  readonly channel: RequestChannel;
  /** Tenant scope — required for every multi-tenant operation. */
  readonly tenantId: string;
  /** Authenticated user id, if any. */
  readonly userId?: string;
  /** Jurisdiction inferred from tenant or explicit. */
  readonly jurisdiction: Jurisdiction;
  /** Free-form natural-language intent (the user's words). */
  readonly utterance: string;
  /** Optional structured payload from the channel. */
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Wall-clock when the request arrived. */
  readonly receivedAt: string;
  /** Caller-supplied metadata (for telemetry). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ============================================================================
// IntentClassification — what the brain decided the user wants
// ============================================================================

/**
 * The brain reads the envelope and returns this. Drives routing,
 * goal composition, and capability lookup.
 */
export interface IntentClassification {
  /** Primary intent — domain-namespaced (e.g. `lease.renew`, `maintenance.report`). */
  readonly primary: string;
  /** Secondary intents the user may also want addressed. */
  readonly secondary: ReadonlyArray<string>;
  /** Confidence in [0,1]. */
  readonly confidence: number;
  /** Free-text rationale — auditable. */
  readonly rationale: string;
  /** Suggested domain (matches AgentDomain.id). */
  readonly suggestedDomain: string;
  /** Risk class the brain estimates. */
  readonly riskClass: RiskClass;
  /** Entities extracted from the utterance (e.g. `{ unitId: 'U-42' }`). */
  readonly entities: Readonly<Record<string, unknown>>;
}

// ============================================================================
// Goal + SubGoal — goal-directed execution
// ============================================================================

/**
 * A goal is the brain's interpretation of what success looks like for
 * this request. Goals have explicit success criteria and a deadline so
 * agents can self-evaluate.
 */
export interface Goal {
  readonly id: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly intent: IntentClassification;
  /** Human-readable headline (e.g. "Renew tenant Anna's lease for 12 months"). */
  readonly headline: string;
  /**
   * Structured success criteria. Each must be verifiable post-hoc.
   * Example: `{ id: 'lease-signed', check: 'lease.state == active' }`.
   */
  readonly successCriteria: ReadonlyArray<SuccessCriterion>;
  /** Hard deadline ISO timestamp. */
  readonly deadline?: string;
  /** Scope hints — which tenant, unit, lease, etc. */
  readonly scope: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface SuccessCriterion {
  readonly id: string;
  readonly check: string;
  readonly weight: number;
}

/**
 * A sub-goal is a partitioned slice of a goal assigned to one capable
 * agent. Sub-goals compose linearly OR in parallel (`dependsOn`).
 */
export interface SubGoal {
  readonly id: string;
  readonly parentGoalId: string;
  readonly description: string;
  readonly assignedAgentId: string;
  readonly capabilityId: string;
  readonly dependsOn: ReadonlyArray<string>;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface SubGoalResult {
  readonly subGoalId: string;
  readonly outcome: ActionOutcome;
  readonly output: unknown;
  readonly reason: string;
  readonly latencyMs: number;
  readonly costUsdCents: number;
  readonly completedAt: string;
}

export interface GoalResult {
  readonly goalId: string;
  readonly outcome: ActionOutcome;
  readonly subGoalResults: ReadonlyArray<SubGoalResult>;
  readonly successCriteriaMet: ReadonlyArray<string>;
  readonly successCriteriaMissed: ReadonlyArray<string>;
  readonly totalLatencyMs: number;
  readonly totalCostUsdCents: number;
  readonly completedAt: string;
}

// ============================================================================
// CapabilityDeclaration — agents declare what they can do
// ============================================================================

/**
 * Capability declarations describe the contract an agent fulfils. The
 * registry matches `IntentClassification.suggestedDomain` + the
 * capability `id` to candidate agents.
 */
export interface CapabilityDeclaration {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** JSON-schema for the call inputs. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /** JSON-schema for the call outputs. */
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Side-effect tier — drives capability gating + audit. */
  readonly sideEffects: RiskClass;
  /** Median USD-cent cost per call (for budget routing). */
  readonly costEstimateUsdCents: number;
  /** Median latency in ms (for SLO routing). */
  readonly latencyEstimateMs: number;
  /** Scope tags required to invoke (e.g. `tenant:lease:write`). */
  readonly requiredScope: ReadonlyArray<string>;
  /** Jurisdictions where this capability is offered. */
  readonly jurisdictions: ReadonlyArray<Jurisdiction>;
  /** Schema version. */
  readonly version: string;
}

export interface RegisteredCapability {
  readonly agentId: string;
  readonly capability: CapabilityDeclaration;
  readonly registeredAt: string;
}

export interface AgentMatch {
  readonly agentId: string;
  readonly capabilityId: string;
  /** Composite ranking score in [0,1]. */
  readonly score: number;
  /** Components feeding into `score`. */
  readonly breakdown: {
    readonly trustScore: number;
    readonly capabilityFit: number;
    readonly costPenalty: number;
    readonly latencyPenalty: number;
    readonly autonomyHeadroom: number;
  };
}

export interface DryRunReport {
  readonly capabilityId: string;
  readonly estimatedCostUsdCents: number;
  readonly estimatedLatencyMs: number;
  readonly inputsValid: boolean;
  readonly warnings: ReadonlyArray<string>;
  readonly forecastedSideEffects: ReadonlyArray<string>;
}

// ============================================================================
// TrustScore — Bayesian capability rating
// ============================================================================

export interface TrustScore {
  readonly agentId: string;
  readonly capabilityId: string;
  /** Bayesian posterior mean — start at the prior, updates per outcome. */
  readonly meanSuccessRate: number;
  /** Total observed samples. */
  readonly sampleSize: number;
  /** Recency-weighted success rate (last 30 outcomes). */
  readonly recentSuccessRate: number;
  /** ISO timestamp of last update — drives decay. */
  readonly lastUpdatedAt: string;
  /** Recommended autonomy ceiling given this score. */
  readonly recommendedCeiling: AutonomyLevel;
}

export interface TrustOutcome {
  readonly agentId: string;
  readonly capabilityId: string;
  readonly outcome: ActionOutcome;
  /** 0..1 — caller's confidence in the labelling. */
  readonly confidence: number;
  readonly observedAt: string;
}

// ============================================================================
// ConstitutionalCheck — pre-flight gate output
// ============================================================================

export type PreflightDecision = 'allow' | 'block' | 'escalate';

export interface ConstitutionalCheck {
  readonly decision: PreflightDecision;
  /** Clause ids that fired (e.g. `C01-EVICTION-NOTICE`). */
  readonly firedClauses: ReadonlyArray<string>;
  /** Free-text rationale — surfaced in audit. */
  readonly rationale: string;
  /** Jurisdiction overlay actually applied. */
  readonly appliedJurisdiction: Jurisdiction;
  /** When `escalate`: workflow run id created for human review. */
  readonly escalatedRunId?: string;
  readonly checkedAt: string;
}

// ============================================================================
// Observation + Reflection — the learning loop
// ============================================================================

export type ObservationKind =
  | 'request-received'
  | 'intent-classified'
  | 'goal-composed'
  | 'subgoal-assigned'
  | 'capability-invoked'
  | 'capability-result'
  | 'preflight-decision'
  | 'goal-completed'
  | 'handoff'
  | 'negotiation-resolved'
  | 'kg-update'
  | 'autonomy-change'
  | 'error';

export interface Observation {
  readonly id: string;
  readonly kind: ObservationKind;
  readonly tenantId: string;
  readonly agentId?: string;
  readonly goalId?: string;
  readonly subGoalId?: string;
  /** State snapshot BEFORE the action (small + JSON-serialisable). */
  readonly before?: unknown;
  /** State snapshot AFTER the action. */
  readonly after?: unknown;
  readonly outcome?: ActionOutcome;
  readonly detail: string;
  readonly at: string;
}

export interface ReflectionUpdate {
  readonly agentId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly observationCount: number;
  readonly outcomesByKind: Readonly<Record<ActionOutcome, number>>;
  /** Brain-summarised narrative of how the agent did. */
  readonly summary: string;
  /** Concrete improvements proposed for next iteration. */
  readonly proposedImprovements: ReadonlyArray<string>;
  /** Whether trust should be adjusted (and how). */
  readonly trustAdjustments: ReadonlyArray<{
    readonly capabilityId: string;
    readonly delta: number;
    readonly rationale: string;
  }>;
  readonly generatedAt: string;
}

// ============================================================================
// NegotiationRound — when agents disagree
// ============================================================================

export interface AgentPosition {
  readonly agentId: string;
  /** What the agent proposes to do. */
  readonly proposal: string;
  /** Why — auditable. */
  readonly rationale: string;
  /** Self-confidence in [0,1]. */
  readonly confidence: number;
}

export interface JudgeVerdict {
  readonly judgeId: string;
  readonly winnerAgentId: string | null;
  readonly rubricScores: Readonly<Record<string, number>>;
  readonly rationale: string;
}

export interface NegotiationRound {
  readonly id: string;
  readonly positions: ReadonlyArray<AgentPosition>;
  readonly verdicts: ReadonlyArray<JudgeVerdict>;
  /** Aggregated winner id, or null if escalated to human. */
  readonly winnerAgentId: string | null;
  readonly outcome: 'resolved' | 'escalated';
  /** Workflow run id created when escalated. */
  readonly escalatedRunId?: string;
  readonly resolvedAt: string;
}

// ============================================================================
// LivingKGUpdate — real-time knowledge graph mutation
// ============================================================================

export interface KGTripleDelta {
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly op: 'add' | 'retract';
}

export interface LivingKGUpdate {
  readonly id: string;
  readonly tenantId: string;
  readonly triggeredByAgentId: string;
  readonly triggeredByActionId: string;
  readonly deltas: ReadonlyArray<KGTripleDelta>;
  /** Downstream facts re-derived as consequences of this update. */
  readonly propagatedDeltas: ReadonlyArray<KGTripleDelta>;
  readonly recordedAt: string;
}

export interface EnrichedContext {
  readonly goalId: string;
  /** Subgraph fragments relevant to the goal. */
  readonly fragments: ReadonlyArray<{
    readonly subjectId: string;
    readonly predicate: string;
    readonly objectId: string;
    readonly score: number;
  }>;
  readonly approxTokens: number;
  readonly assembledAt: string;
}

// ============================================================================
// RoutingDecision — what brain-first gateway produces
// ============================================================================

export interface RoutingDecision {
  readonly requestId: string;
  readonly intent: IntentClassification;
  readonly chosenAgent: AgentMatch | null;
  readonly fallbackUsed: boolean;
  readonly rationale: string;
  readonly routedAt: string;
}

// ============================================================================
// Brain port — narrow contract over packages/agent-orchestrator + brain
// ============================================================================

/**
 * Minimal duck-typed brain port. Only what agentic-os needs. Implementers
 * can wrap `packages/agent-orchestrator BrainPort` or
 * `packages/central-intelligence kernel.router`.
 */
export interface BrainPort {
  /** Classify intent from a request envelope. */
  classifyIntent(args: {
    readonly envelope: RequestEnvelope;
  }): Promise<IntentClassification>;

  /** Compose a goal from an intent + envelope. */
  composeGoal(args: {
    readonly envelope: RequestEnvelope;
    readonly intent: IntentClassification;
  }): Promise<Goal>;

  /** Decompose a goal into a set of subgoals across capable agents. */
  decomposeGoal(args: {
    readonly goal: Goal;
    readonly candidates: ReadonlyArray<AgentMatch>;
  }): Promise<ReadonlyArray<SubGoal>>;

  /** Reflect on an agent's recent trajectory. */
  reflect(args: {
    readonly agentId: string;
    readonly observations: ReadonlyArray<Observation>;
  }): Promise<ReflectionUpdate>;
}

// ============================================================================
// Agent registry port — duck-typed over openclaw + agent-orchestrator
// ============================================================================

export interface AgentSummary {
  readonly agentId: string;
  readonly name: string;
  readonly supportedDomains: ReadonlyArray<string>;
  readonly defaultAutonomyByDomain: ReadonlyMap<string, AutonomyLevel>;
}

export interface AgentRegistryPort {
  getAgent(agentId: string): Promise<AgentSummary | null>;
  listAgents(): Promise<ReadonlyArray<AgentSummary>>;
  getAutonomyLevel(args: {
    readonly agentId: string;
    readonly domainId: string;
    readonly tenantId?: string;
  }): Promise<AutonomyLevel | null>;
}

// ============================================================================
// Capability registry port (internal to this package — exported)
// ============================================================================

export interface CapabilityRegistryPort {
  register(args: {
    readonly agentId: string;
    readonly capability: CapabilityDeclaration;
  }): Promise<void>;
  list(): Promise<ReadonlyArray<RegisteredCapability>>;
  findByCapabilityId(capabilityId: string): Promise<ReadonlyArray<RegisteredCapability>>;
  findByDomain(domainHint: string): Promise<ReadonlyArray<RegisteredCapability>>;
  findCapable(args: {
    readonly capabilityId: string;
    readonly tenantId: string;
    readonly jurisdiction: Jurisdiction;
    readonly autonomyLevel: AutonomyLevel;
  }): Promise<ReadonlyArray<RegisteredCapability>>;
}

// ============================================================================
// Constitution port (duck-typed over packages/autonomy-governance)
// ============================================================================

export interface ConstitutionClauseSummary {
  readonly id: string;
  readonly severity: 'refuse' | 'warn' | 'inform';
  readonly jurisdictions: ReadonlyArray<Jurisdiction>;
  readonly appliesTo: ReadonlyArray<string>;
}

export interface ConstitutionPort {
  /** Check a candidate action against the constitution. */
  evaluate(args: {
    readonly action: string;
    readonly actionTags: ReadonlyArray<string>;
    readonly jurisdiction: Jurisdiction;
    readonly context: Readonly<Record<string, unknown>>;
  }): Promise<{
    readonly decision: PreflightDecision;
    readonly firedClauses: ReadonlyArray<ConstitutionClauseSummary>;
    readonly rationale: string;
  }>;
}

// ============================================================================
// Workflow engine port (duck-typed over packages/workflow-engine)
// ============================================================================

export interface WorkflowEnginePort {
  /** Open a new workflow run for human approval. Returns the run id. */
  openApprovalRun(args: {
    readonly tenantId: string;
    readonly kind: string;
    readonly initiatedByAgentId: string;
    readonly subject: string;
    readonly proposedAction: Readonly<Record<string, unknown>>;
    readonly reason: string;
  }): Promise<{ readonly runId: string }>;
}

// ============================================================================
// Knowledge graph port (duck-typed over packages/knowledge-graph)
// ============================================================================

export interface KGPort {
  applyDeltas(args: {
    readonly tenantId: string;
    readonly deltas: ReadonlyArray<KGTripleDelta>;
  }): Promise<void>;
  fetchSubgraph(args: {
    readonly tenantId: string;
    readonly subjectIds: ReadonlyArray<string>;
    readonly maxDepth: number;
  }): Promise<
    ReadonlyArray<{
      readonly subjectId: string;
      readonly predicate: string;
      readonly objectId: string;
    }>
  >;
}

// ============================================================================
// Observation store port
// ============================================================================

export interface ObservationStorePort {
  emit(observation: Observation): Promise<void>;
  list(args: {
    readonly agentId?: string;
    readonly tenantId?: string;
    readonly goalId?: string;
    readonly sinceIso?: string;
    readonly untilIso?: string;
  }): Promise<ReadonlyArray<Observation>>;
}

// ============================================================================
// Trust store port
// ============================================================================

export interface TrustStorePort {
  recordOutcome(outcome: TrustOutcome): Promise<void>;
  getScore(args: {
    readonly agentId: string;
    readonly capabilityId: string;
  }): Promise<TrustScore | null>;
  list(): Promise<ReadonlyArray<TrustScore>>;
}

// ============================================================================
// MCP port (duck-typed over packages/mcp)
// ============================================================================

export interface MCPPort {
  /** Whether MCP host exposes a given tool name. */
  hasTool(name: string): Promise<boolean>;
}

// ============================================================================
// Audio port (duck-typed over packages/audio-capture)
// ============================================================================

export interface AudioPort {
  /** Stub for voice channel — transcribe utterance to text. */
  transcribe(args: { readonly mediaRef: string }): Promise<string>;
}

// ============================================================================
// OpenClaw operating-model port
// ============================================================================

export interface OpenClawPort {
  /** Resolve autonomy ceiling for (jurisdiction × risk). */
  capForJurisdiction(args: {
    readonly jurisdiction: Jurisdiction;
    readonly riskClass: RiskClass;
  }): Promise<AutonomyLevel>;
}

// ============================================================================
// Errors
// ============================================================================

export class GoalDecompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoalDecompositionError';
  }
}

export class CapabilityNotFoundError extends Error {
  public readonly capabilityId: string;
  constructor(capabilityId: string) {
    super(`capability not found: ${capabilityId}`);
    this.name = 'CapabilityNotFoundError';
    this.capabilityId = capabilityId;
  }
}

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

// ============================================================================
// Pure helpers
// ============================================================================

export function nowIso(): string {
  return new Date().toISOString();
}

export function autonomyToInt(level: AutonomyLevel): number {
  return Number.parseInt(level.slice(1), 10);
}

export function intToAutonomy(n: number): AutonomyLevel {
  const clamped = Math.max(0, Math.min(5, Math.round(n)));
  return (`L${clamped}` as AutonomyLevel);
}

export function minAutonomy(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return autonomyToInt(a) <= autonomyToInt(b) ? a : b;
}
