/**
 * NBA (Next-Best-Action) — shared types.
 *
 * The NBA engine ranks possible business actions by Impact x Confidence x Ease (ICE),
 * Reach x Impact x Confidence / Effort (RICE), Weighted Shortest Job First (WSJF),
 * and Eisenhower urgency/importance quadrants.
 *
 * All public types are read-only to align with the project's immutability policy.
 * No runtime side-effects on import.
 *
 * @module features/central-command/md/nba/types
 */

// ---------------------------------------------------------------------------
// Action domain + catalog
// ---------------------------------------------------------------------------

/** High-level domain a business action targets. */
export type ActionDomain =
  | "sales"
  | "ops"
  | "hr"
  | "finance"
  | "customer-success"
  | "compliance"
  | "learning"
  | "marketing"
  | "product";

/** Effort buckets approximate person-days. */
export type EffortBucket = "trivial" | "small" | "medium" | "large" | "epic";

/** Typed business-action template — pure data, no side effects. */
export interface ActionTemplate {
  readonly id: string;
  readonly domain: ActionDomain;
  readonly title: string;
  readonly description: string;
  /** Baseline Impact score 0..10 before contextual lift. */
  readonly baselineImpact: number;
  /** Baseline Ease score 0..10 (10 = trivial, 0 = epic). */
  readonly baselineEase: number;
  /** Baseline Confidence 0..1 the action will deliver impact. */
  readonly baselineConfidence: number;
  /** Approximate audience reach (people, customers, units). */
  readonly baselineReach: number;
  /** Effort estimate in person-days for WSJF / RICE math. */
  readonly effortPersonDays: number;
  readonly effortBucket: EffortBucket;
  /** Triggers (signals from snapshot) that make this action relevant. */
  readonly triggers: readonly ActionTrigger[];
  /** Tags for grouping in the UI. */
  readonly tags: readonly string[];
}

/**
 * Predicate over a BusinessSnapshot — pure boolean check used by
 * the catalog filter step before scoring.
 */
export type ActionTriggerKind =
  | "nps-drop"
  | "csat-drop"
  | "pipeline-stalled"
  | "lead-aging"
  | "contract-expiring"
  | "employee-1on1-overdue"
  | "complaint-open"
  | "new-hire-onboarding"
  | "cash-runway-low"
  | "invoice-overdue"
  | "supplier-renewal-due"
  | "kpi-off-target"
  | "training-completion-low"
  | "compliance-deadline"
  | "always";

export interface ActionTrigger {
  readonly kind: ActionTriggerKind;
  readonly threshold?: number;
}

// ---------------------------------------------------------------------------
// Business snapshot — input to ranking
// ---------------------------------------------------------------------------

export interface CustomerSignal {
  readonly customerId: string;
  readonly name: string;
  readonly npsScore?: number;
  readonly csatScore?: number;
  readonly lastContactDaysAgo: number;
  readonly openComplaints: number;
  readonly arrUsd?: number;
}

export interface EmployeeSignal {
  readonly employeeId: string;
  readonly name: string;
  readonly daysSinceLast1on1: number;
  readonly engagementScore?: number;
  readonly isNewHire: boolean;
  readonly daysInRole: number;
}

export interface PipelineSignal {
  readonly leadId: string;
  readonly stage: string;
  readonly daysInStage: number;
  readonly valueUsd: number;
  readonly probability: number; // 0..1
}

export interface SupplierSignal {
  readonly supplierId: string;
  readonly name: string;
  readonly contractExpiresInDays: number;
  readonly criticality: "low" | "medium" | "high";
  readonly annualSpendUsd: number;
}

export interface FinanceSignal {
  readonly cashUsd: number;
  readonly monthlyBurnUsd: number;
  readonly overdueInvoicesCount: number;
  readonly overdueAmountUsd: number;
}

export interface ComplianceSignal {
  readonly obligationId: string;
  readonly description: string;
  readonly dueInDays: number;
  readonly status: "open" | "in-progress" | "submitted";
}

export interface LearningSignal {
  readonly employeeId: string;
  readonly trackName: string;
  readonly completionPercent: number; // 0..100
}

export interface OwnerSentiment {
  /** -1..1 sentiment across recent owner messages (1 = positive). */
  readonly score: number;
  /** Topics the owner mentioned recently. */
  readonly recentTopics: readonly string[];
}

export interface OwnerStyle {
  /** "bias-to-action" | "deliberate" | "data-driven" | "people-first". */
  readonly preferredMode:
    | "bias-to-action"
    | "deliberate"
    | "data-driven"
    | "people-first";
  /** Weight 0..1 applied to ease-leaning actions. */
  readonly easeBias: number;
  /** Weight 0..1 applied to impact-leaning actions. */
  readonly impactBias: number;
}

export interface BusinessSnapshot {
  readonly orgId: string;
  readonly generatedAt: string;
  readonly customers: readonly CustomerSignal[];
  readonly employees: readonly EmployeeSignal[];
  readonly pipeline: readonly PipelineSignal[];
  readonly suppliers: readonly SupplierSignal[];
  readonly finance: FinanceSignal;
  readonly compliance: readonly ComplianceSignal[];
  readonly learning: readonly LearningSignal[];
  readonly ownerSentiment?: OwnerSentiment;
  readonly ownerStyle?: OwnerStyle;
}

// ---------------------------------------------------------------------------
// Scoring outputs
// ---------------------------------------------------------------------------

export interface IceScore {
  readonly impact: number; // 0..10
  readonly confidence: number; // 0..1
  readonly ease: number; // 0..10
  readonly ice: number; // impact * confidence * ease
}

export interface RiceScore {
  readonly reach: number;
  readonly impact: number; // 0..10
  readonly confidence: number; // 0..1
  readonly effortPersonDays: number;
  readonly rice: number; // reach * impact * confidence / effort
}

export interface WsjfScore {
  readonly userBusinessValue: number; // 0..10
  readonly timeCriticality: number; // 0..10
  readonly riskReductionOpportunityEnablement: number; // 0..10
  readonly jobSize: number; // person-days
  readonly costOfDelay: number; // sum of three values
  readonly wsjf: number; // costOfDelay / jobSize
}

export type EisenhowerQuadrant =
  | "do-now" // urgent + important
  | "schedule" // important + not urgent
  | "delegate" // urgent + not important
  | "drop"; // not urgent + not important

export interface EisenhowerScore {
  readonly urgent: boolean;
  readonly important: boolean;
  readonly quadrant: EisenhowerQuadrant;
  readonly urgencyScore: number; // 0..10
  readonly importanceScore: number; // 0..10
}

/** A ranked action prepared for the MD orchestrator. */
export interface RankedAction {
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly domain: ActionDomain;
  readonly ice: IceScore;
  readonly rice: RiceScore;
  readonly wsjf: WsjfScore;
  readonly eisenhower: EisenhowerScore;
  /** Composite rank score used to sort; higher = better. */
  readonly compositeScore: number;
  /** Subject this action targets (customer id, supplier id, etc.). */
  readonly subjectRef?: string;
  /** Strategy tag explaining why this was suggested. */
  readonly rationale: string;
}

/** Public contract that NbaService satisfies; matches the MD orchestrator brief. */
export interface NbaServicePort {
  rankActions(
    snapshot: BusinessSnapshot,
    k: number,
  ): Promise<readonly RankedAction[]>;
  getNextLowHangingFruit(
    snapshot: BusinessSnapshot,
  ): Promise<RankedAction | null>;
  getNextHighImpact(snapshot: BusinessSnapshot): Promise<RankedAction | null>;
  getDailyAgenda(snapshot: BusinessSnapshot): Promise<readonly RankedAction[]>;
}

/** Strategy a ranker uses when sorting candidate actions. */
export type RankingStrategy = "ice" | "rice" | "wsjf" | "composite";

/** Bound an action template to a concrete subject from the snapshot. */
export interface ActionCandidate {
  readonly template: ActionTemplate;
  /** Subject reference if the action targets one specific entity. */
  readonly subjectRef?: string;
  /** Lifts applied by signal severity (e.g. lower NPS = higher impact). */
  readonly contextualImpactLift: number;
  readonly contextualConfidenceLift: number;
  readonly contextualUrgencyLift: number;
  /** Reason this candidate was generated. */
  readonly reason: string;
}
