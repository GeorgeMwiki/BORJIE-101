/**
 * Head Briefing — Wave 28.
 *
 * Types for the cohesive "first-login head screen" that assembles
 * autonomy activity, pending approvals, escalations, KPI deltas,
 * recommendations, and anomalies into a single curated document the
 * head of estates reads when they walk into the office in the morning.
 *
 * Six sections, one document:
 *   1. overnight         — what the AI did on its own authority
 *   2. pendingApprovals  — what needs a decision
 *   3. escalations       — what the AI surfaced (exception inbox)
 *   4. kpiDeltas         — how the portfolio is trending
 *   5. recommendations   — what the AI would do next
 *   6. anomalies         — what seems off
 *
 * Pure data contract — no runtime logic lives here.
 */

import type { AutonomyDomain } from '../autonomy/types.js';

/** KPI delta pair — current value + signed change over a window. */
export interface KpiDelta {
  readonly value: number;
  readonly delta7d: number;
}

/** KPI delta pair with a 30-day window — used for NOI + satisfaction. */
export interface KpiDelta30d {
  readonly value: number;
  readonly delta30d: number;
}

/** A single notable autonomous action the head should know about. */
export interface NotableAutonomousAction {
  readonly actionId: string;
  readonly domain: AutonomyDomain;
  readonly summary: string;
  readonly confidence: number;
}

/** Summary of overnight autonomous activity. */
export interface OvernightSection {
  readonly totalAutonomousActions: number;
  /** Count of actions bucketed by domain — missing domains are absent. */
  readonly byDomain: Partial<Record<AutonomyDomain, number>>;
  readonly notableActions: readonly NotableAutonomousAction[];
}

/** One approval waiting for the head's decision. */
export interface PendingApprovalItem {
  readonly approvalId: string;
  readonly kind: 'single' | 'standing';
  readonly summary: string;
  readonly urgency: 'low' | 'medium' | 'high';
}

export interface PendingApprovalsSection {
  readonly count: number;
  readonly items: readonly PendingApprovalItem[];
}

/** One escalation that the AI surfaced for human judgement. */
export interface EscalationItem {
  readonly exceptionId: string;
  readonly priority: 'P1' | 'P2' | 'P3';
  readonly summary: string;
  readonly domain: string;
}

export interface EscalationsSection {
  readonly count: number;
  readonly byPriority: {
    readonly P1: number;
    readonly P2: number;
    readonly P3: number;
  };
  readonly items: readonly EscalationItem[];
}

/** Portfolio health snapshot with deltas. */
export interface KpiDeltasSection {
  readonly occupancyPct: KpiDelta;
  readonly collectionsRate: KpiDelta;
  readonly arrearsDays: KpiDelta;
  readonly maintenanceSLA: KpiDelta;
  readonly tenantSatisfaction: KpiDelta30d;
  readonly noi: KpiDelta30d;
}

/** One strategic recommendation the AI is making. */
export interface BriefingRecommendation {
  readonly topic: string;
  readonly summary: string;
  readonly rationale: string;
  readonly confidence: number;
  readonly suggestedAction: string;
}

/** One anomaly observation — the AI noticed something that seems off. */
export interface BriefingAnomaly {
  readonly area: string;
  readonly observation: string;
  readonly possibleCause: string;
  readonly suggestedInvestigation: string;
}

/** The full briefing document returned to the UI/voice layer. */
export interface BriefingDocument {
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly headline: string;
  readonly overnight: OvernightSection;
  readonly pendingApprovals: PendingApprovalsSection;
  readonly escalations: EscalationsSection;
  readonly kpiDeltas: KpiDeltasSection;
  readonly recommendations: readonly BriefingRecommendation[];
  readonly anomalies: readonly BriefingAnomaly[];
}

// ---------------------------------------------------------------------------
// Dependency ports — the composer depends on these interfaces only.
// Concrete implementations (postgres, in-memory, live services) are wired
// by the composition root.
// ---------------------------------------------------------------------------

/** Shape the composer expects for overnight autonomy summaries.
 *  Production wires the AutonomousActionAudit; degraded mode uses a stub. */
export interface OvernightSource {
  readonly summarize: (
    tenantId: string,
    since: Date,
  ) => Promise<OvernightSection>;
}

/** Pending-approvals port. */
export interface PendingApprovalsSource {
  readonly list: (tenantId: string) => Promise<PendingApprovalsSection>;
}

/** Escalations port — wraps the exception inbox. */
export interface EscalationsSource {
  readonly list: (tenantId: string) => Promise<EscalationsSection>;
}

/** KPI source — pulled from data warehouse / live metrics in prod. */
export interface KpiSource {
  readonly fetch: (tenantId: string) => Promise<KpiDeltasSection>;
}

/** Recommendations source — wraps strategic advisor + briefing generator. */
export interface RecommendationsSource {
  readonly list: (
    tenantId: string,
    kpis: KpiDeltasSection,
  ) => Promise<readonly BriefingRecommendation[]>;
}

/** Anomalies source — pattern-mining output or ambient-brain observations. */
export interface AnomaliesSource {
  readonly list: (tenantId: string) => Promise<readonly BriefingAnomaly[]>;
}
