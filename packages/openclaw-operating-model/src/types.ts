/**
 * @borjie/openclaw-operating-model — public types
 *
 * Operating-model layer on top of in-flight technical primitives
 * (P56 agent-runtime, P57 mcp, P58 agent-orchestrator, P59 open-coding-agents).
 * Built on injection ports — this package has NO hard deps on those
 * packages, allowing it to be built and tested independently.
 *
 * Based on Jensen Huang's GTC 2026 OpenClaw strategy (P60 research):
 *   1. Context architecture
 *   2. Agent task domains with autonomy ladders
 *   3. Organisational readiness (Chief Agent Officer)
 *
 * Plus NemoClaw governance layer: kill switches, per-tenant policy
 * engine, Agent-as-a-Service primitives.
 */

// ============================================================================
// Autonomy ladders (SAE J3016-inspired, L0..L5)
// ============================================================================

/**
 * Autonomy level for an agent on a particular task domain.
 * Modelled on SAE J3016 (vehicle automation) with deliberate parallels:
 *
 *   - L0 — No autonomy. Human does the work; agent only surfaces info.
 *   - L1 — Suggestions. Agent proposes; human approves each.
 *   - L2 — Partial autonomy. Agent acts on low-stakes; high-stakes need approval.
 *   - L3 — Conditional autonomy. Agent acts within a configured envelope;
 *          escalates exceptions.
 *   - L4 — High autonomy. Agent acts independently; reports periodically.
 *   - L5 — Full autonomy. Agent acts without a human in the loop; only
 *          escalates failures.
 */
export type AutonomyLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'] as const;

/** Risk tier for a task domain. */
export type RiskClass = 'low' | 'med' | 'high' | 'critical';

/** Jurisdiction codes (ISO 3166 alpha-2 in the BORJIE stack). */
export type Jurisdiction = 'TZ' | 'KE' | 'UG' | 'RW' | 'BI' | 'ET' | 'GLOBAL';

/**
 * Per-jurisdiction cap on the maximum permissible autonomy level for a
 * given risk class. Defaults reflect regulator posture (e.g. fully
 * autonomous financial actions are not yet permitted in TZ/KE for
 * "critical" risk-class operations).
 */
export interface JurisdictionAutonomyCap {
  readonly jurisdiction: Jurisdiction;
  readonly riskClass: RiskClass;
  readonly maxLevel: AutonomyLevel;
  readonly rationale: string;
}

// ============================================================================
// Agent task domains
// ============================================================================

/**
 * A task domain is an explicit map of which functions are stable enough
 * to delegate, what level of autonomy each gets, and what the blast
 * radius is when an agent fails systematically. (Pillar 2.)
 */
export interface AgentDomain {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly riskClass: RiskClass;
  readonly defaultAutonomyLevel: AutonomyLevel;
  readonly allowedTools: ReadonlyArray<string>;
  readonly dataAccessScope: ReadonlyArray<string>;
  readonly escalationOwner: string;
  readonly version: string;
}

// ============================================================================
// Agent specs + capability ratings
// ============================================================================

/** Capability rating per (agent, domain, metric) pair, 0..1. */
export interface CapabilityRating {
  readonly agentId: string;
  readonly domainId: string;
  readonly metric: 'precision' | 'recall' | 'cost-efficiency' | 'latency-p95';
  readonly score: number;
  readonly windowDays: number;
  readonly sampleSize: number;
  readonly evaluatedAt: string;
}

/** Public spec for a registered agent. */
export interface AgentSpec {
  readonly agentId: string;
  readonly name: string;
  readonly description: string;
  readonly supportedDomains: ReadonlyArray<string>;
  readonly defaultAutonomyByDomain: ReadonlyMap<string, AutonomyLevel>;
  readonly costPerCallUsdCents: number;
  readonly version: string;
}

// ============================================================================
// Context architecture (Pillar 1)
// ============================================================================

export type ContextSourceKind =
  | 'database'
  | 'document_store'
  | 'knowledge_graph'
  | 'tool'
  | 'webhook';

export type ContextScope = 'global' | 'tenant' | 'user';

export type RefreshPolicy = 'realtime' | 'cached-5m' | 'cached-1h' | 'daily';

/**
 * Definition of a context source the agent may pull from when assembling
 * its working context.
 */
export interface ContextSource {
  readonly id: string;
  readonly name: string;
  readonly kind: ContextSourceKind;
  readonly tenantScope: ContextScope;
  readonly refreshPolicy: RefreshPolicy;
  /** PII-clearance level required to read raw values from this source. */
  readonly piiClearanceRequired: PiiClearanceLevel;
}

export type PiiClearanceLevel = 'none' | 'low' | 'medium' | 'high';

/**
 * Layered agent context. Token-budget aware.
 *
 *   - persistent: org mission, brand voice, constitution clauses
 *   - structured: relevant DB rows, typed records
 *   - retrieved : RAG snippets, knowledge-graph fragments
 *   - ephemeral : current conversation turn(s)
 */
export interface AgentContext {
  readonly agentId: string;
  readonly tenantId: string;
  readonly taskId: string;
  readonly userId?: string | undefined;
  readonly persistent: ReadonlyArray<ContextFragment>;
  readonly structured: ReadonlyArray<ContextFragment>;
  readonly retrieved: ReadonlyArray<ContextFragment>;
  readonly ephemeral: ReadonlyArray<ContextFragment>;
  readonly approxTokens: number;
  readonly budgetTokens: number;
  readonly redactedFragmentIds: ReadonlyArray<string>;
  readonly assembledAt: string;
}

/** One unit of context. */
export interface ContextFragment {
  readonly id: string;
  readonly sourceId: string;
  readonly kind: ContextSourceKind;
  readonly content: string;
  readonly approxTokens: number;
  readonly piiClearanceRequired: PiiClearanceLevel;
}

// ============================================================================
// Policy engine
// ============================================================================

export type PolicyDecisionKind =
  | 'allow'
  | 'deny'
  | 'require_approval'
  | 'escalate';

/**
 * A policy rule expressed in a tiny DSL:
 *   "when <condition> then <decision>"
 * The `condition` is a simple expression evaluated against the action +
 * context. See `policy-engine/parser.ts` for the supported grammar.
 */
export interface PolicyRule {
  readonly id: string;
  readonly when: string;
  readonly then: PolicyDecisionKind;
  readonly reason: string;
  readonly priority: number;
}

export interface PolicyDecision {
  readonly decision: PolicyDecisionKind;
  readonly matchedRuleId: string | null;
  readonly reason: string;
  readonly autonomyLevelInForce: AutonomyLevel;
}

// ============================================================================
// Kill switch
// ============================================================================

export type KillSwitchState = 'active' | 'paused' | 'killed';

export interface KillSwitch {
  readonly scope: 'global' | 'tenant' | 'agent';
  readonly agentId?: string | undefined;
  readonly tenantId?: string | undefined;
  readonly state: KillSwitchState;
  readonly reason: string;
  readonly triggeredBy: string;
  readonly triggeredAt: string;
  readonly expiresAt?: string | undefined;
  readonly autoTriggered: boolean;
}

// ============================================================================
// Decision audit
// ============================================================================

/** Every agent decision must produce an audit record (signed downstream). */
export interface AgentDecisionAudit {
  readonly auditId: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly domainId: string;
  readonly action: string;
  readonly autonomyLevel: AutonomyLevel;
  readonly policyDecision: PolicyDecisionKind;
  readonly outcome: 'success' | 'failure' | 'escalated' | 'blocked';
  readonly costUsdCents: number;
  readonly latencyMs: number;
  readonly correlationId?: string | undefined;
  readonly createdAt: string;
}

// ============================================================================
// Agent registry
// ============================================================================

/**
 * Registry port. Real implementations back this with a database; the
 * default in-memory implementation is suitable for tests.
 */
export interface AgentRegistry {
  registerAgent(spec: AgentSpec): Promise<void>;
  getAgent(agentId: string): Promise<AgentSpec | null>;
  listAgents(): Promise<ReadonlyArray<AgentSpec>>;
  registerDomain(domain: AgentDomain): Promise<void>;
  getDomain(domainId: string): Promise<AgentDomain | null>;
  listDomains(): Promise<ReadonlyArray<AgentDomain>>;
  setAutonomyLevel(args: {
    agentId: string;
    domainId: string;
    tenantId?: string;
    level: AutonomyLevel;
    justification: string;
    setBy: string;
  }): Promise<void>;
  getAutonomyLevel(args: {
    agentId: string;
    domainId: string;
    tenantId?: string;
  }): Promise<AutonomyLevel | null>;
}

// ============================================================================
// Agent-as-a-Service
// ============================================================================

export type AaaSPricingModel =
  | 'per_call'
  | 'per_outcome'
  | 'per_subscription';

export interface AaaSPricing {
  readonly model: AaaSPricingModel;
  /** USD cents per call (for per_call) or per outcome (for per_outcome). */
  readonly unitPriceUsdCents: number;
  /** Monthly subscription price in USD cents (for per_subscription). */
  readonly monthlyUsdCents?: number | undefined;
  /** Bundled units per subscription month (for per_subscription). */
  readonly includedUnits?: number | undefined;
  /** Overage rate per unit beyond `includedUnits` (USD cents). */
  readonly overageUnitPriceUsdCents?: number | undefined;
}

export interface AaaSSla {
  readonly latencyP95Ms: number;
  readonly availabilityPct: number;
  readonly maxResponseSeconds: number;
  readonly refundPolicy: 'none' | 'partial' | 'full';
}

export interface AaaSScope {
  readonly tenantsAllowed: 'self' | 'any' | ReadonlyArray<string>;
  readonly jurisdictions: ReadonlyArray<Jurisdiction>;
  readonly maxConcurrentCalls?: number | undefined;
}

export interface AaaSEndpoint {
  readonly endpointId: string;
  readonly agentId: string;
  readonly domainId: string;
  readonly pricing: AaaSPricing;
  readonly sla: AaaSSla;
  readonly scope: AaaSScope;
  readonly publishedAt: string;
  readonly status: 'live' | 'paused' | 'retired';
}

export interface AaaSCallMetric {
  readonly metricId: string;
  readonly endpointId: string;
  readonly callId: string;
  readonly tenantId: string;
  readonly units: number;
  readonly outcome: 'success' | 'failure' | 'partial';
  readonly costUsdCents: number;
  readonly capturedAt: string;
}

export interface AaaSJobQuote {
  readonly endpointId: string;
  readonly estimatedCostUsdCents: number;
  readonly sla: AaaSSla;
  /** 0..1 — confidence in the quote. */
  readonly confidence: number;
  readonly assumedUnits: number;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface Invoice {
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lineItems: ReadonlyArray<InvoiceLine>;
  readonly subtotalUsdCents: number;
  readonly taxUsdCents: number;
  readonly totalUsdCents: number;
  readonly currency: 'USD';
  readonly generatedAt: string;
}

export interface InvoiceLine {
  readonly endpointId: string;
  readonly agentId: string;
  readonly description: string;
  readonly units: number;
  readonly unitPriceUsdCents: number;
  readonly subtotalUsdCents: number;
}

// ============================================================================
// Chief Agent Officer dashboards
// ============================================================================

export type ComplianceFramework =
  | 'SOC2'
  | 'ISO27001'
  | 'NIST-AI-RMF'
  | 'EU-AI-Act';

export interface ChiefAgentOfficerDashboard {
  readonly orgId: string;
  readonly generatedAt: string;
  readonly widgets: {
    readonly agentsActive: number;
    readonly agentsPaused: number;
    readonly agentsKilled: number;
    readonly decisionsLast24h: number;
    readonly escalationsPending: number;
    readonly monthlySpendUsdCents: number;
    readonly outcomesDeliveredLast30d: number;
    readonly killSwitchReadiness: 'green' | 'amber' | 'red';
    readonly autonomyBreakdown: Readonly<Record<AutonomyLevel, number>>;
  };
}

export interface ComplianceControlMapping {
  readonly controlId: string;
  readonly description: string;
  readonly status: 'satisfied' | 'partial' | 'unsatisfied' | 'na';
  readonly evidence: ReadonlyArray<string>;
}

export interface ComplianceReport {
  readonly orgId: string;
  readonly framework: ComplianceFramework;
  readonly generatedAt: string;
  readonly summary: {
    readonly satisfied: number;
    readonly partial: number;
    readonly unsatisfied: number;
    readonly na: number;
  };
  readonly mappings: ReadonlyArray<ComplianceControlMapping>;
}

export interface RiskHeatmapCell {
  readonly riskClass: RiskClass;
  readonly domainId: string;
  readonly autonomyLevel: AutonomyLevel;
  /** 0..1 normalised heat score. */
  readonly heat: number;
  readonly activeAgents: number;
  readonly decisionsLast24h: number;
}

export interface RiskHeatmap {
  readonly orgId: string;
  readonly generatedAt: string;
  readonly cells: ReadonlyArray<RiskHeatmapCell>;
}

// ============================================================================
// Injection ports — keep coupling loose to in-flight P56/P57/P58/P59 packages
// ============================================================================

/** Audit sink — wire to your existing audit-log package downstream. */
export interface AuditSink {
  emit(record: AgentDecisionAudit): Promise<void>;
}

/** Metering sink — wire to outcomes-metering downstream. */
export interface MeteringSink {
  emit(metric: AaaSCallMetric): Promise<void>;
}

/** Dashboard data store — wire to CAO datastore downstream. */
export interface DashboardSink {
  recordSnapshot(dashboard: ChiefAgentOfficerDashboard): Promise<void>;
}
