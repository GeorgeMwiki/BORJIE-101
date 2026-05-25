/**
 * Background intelligence types.
 *
 * The brain runs AMBIENTLY in the background (not only when the user chats).
 * It walks every tenant's data on a schedule, emits structured "insights",
 * and delivers them the next time the user opens a session.
 *
 * The "midnight junior wake-up" pattern: the property-manager arrives in the
 * morning to find Mr. Mwikila has already done a nightly portfolio scan.
 */

export type InsightKind =
  | 'portfolio_health'
  | 'arrears_ladder'
  | 'renewal_proposal'
  | 'far_inspection_reminder'
  | 'compliance_expiry'
  | 'cost_ledger_rollup'
  | 'vendor_performance'
  | 'tenant_health_5ps';

export type InsightSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface EvidenceRef {
  readonly kind: 'property' | 'lease' | 'arrears_case' | 'ticket' | 'inspection' | 'invoice';
  readonly id: string;
}

export interface ActionPlan {
  readonly summary: string;
  readonly steps: readonly string[];
}

export interface BackgroundInsight {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly description: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly actionPlan: ActionPlan;
  readonly createdAt: string;
  readonly acknowledgedAt?: string;
  readonly acknowledgedBy?: string;
  readonly dedupeKey: string;
}

export interface NewBackgroundInsightInput {
  readonly tenantId: string;
  readonly kind: InsightKind;
  readonly severity: InsightSeverity;
  readonly title: string;
  readonly description: string;
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly actionPlan: ActionPlan;
  readonly dedupeKey: string;
}

export interface InsightStore {
  upsert(insight: NewBackgroundInsightInput): Promise<BackgroundInsight>;
  listUnacknowledged(
    tenantId: string,
    limit?: number,
  ): Promise<readonly BackgroundInsight[]>;
  acknowledge(
    insightId: string,
    tenantId: string,
    userId: string,
  ): Promise<void>;
  findByDedupeKey(
    tenantId: string,
    dedupeKey: string,
  ): Promise<BackgroundInsight | null>;
}

export type TaskName =
  | 'portfolio_health_scan'
  | 'arrears_ladder_tick'
  | 'renewal_proposal_generator'
  | 'far_inspection_reminder_sweep'
  | 'compliance_expiry_check'
  | 'cost_ledger_rollup'
  | 'vendor_performance_digest'
  | 'tenant_health_5ps_recompute'
  // Wave-15 wiring-audit extensions — previously orphaned schedulables.
  | 'detect_bottlenecks'
  | 'memory_decay_sweep'
  // Wave-17 — weekly bulk property-grade recompute
  | 'recompute_property_grades'
  // Wave-17 — weekly tenant credit-rating recompute (Sunday 03:00 UTC)
  | 'recompute_tenant_credit_ratings'
  // Wave-26 Agent Z4 — daily per-customer intelligence snapshot (payment
  // risk, churn risk, sentiment, complaints/maintenance signals) persisted
  // into `intelligence_history` for trend lines + retroactive audits.
  | 'recompute_intelligence_history'
  // Wave-28 Phase A Agent PhA2 — monthly bookkeeping close orchestrator.
  // Runs 02:00 UTC on the 1st, iterates per tenant, and walks the 8-step
  // close graph (reconcile → statements → KRA MRI → disbursements → email).
  | 'monthly_close';

export interface ScheduledTaskDefinition {
  readonly name: TaskName;
  readonly cron: string;
  readonly description: string;
  readonly featureFlagKey: string;
  readonly run: TaskRunner;
}

export type TaskRunner = (
  ctx: TaskRunContext,
) => Promise<TaskRunSummary>;

export interface TaskRunContext {
  readonly tenantId: string;
  readonly now: Date;
  readonly store: InsightStore;
}

export interface TaskRunSummary {
  readonly task: TaskName;
  readonly tenantId: string;
  readonly insightsEmitted: number;
  readonly durationMs: number;
  readonly ranAt: string;
}

export interface FeatureFlagProbe {
  isEnabled(tenantId: string, flagKey: string): Promise<boolean>;
}

export interface TenantProvider {
  listActiveTenants(): Promise<readonly string[]>;
}
