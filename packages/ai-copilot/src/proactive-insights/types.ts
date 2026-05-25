/**
 * Proactive insights types (per-session).
 *
 * These are "while you're here, you might want to\u2026" nudges Mr. Mwikila
 * generates from the current session context. Distinct from
 * background-intelligence (which runs ambiently) and from
 * proactive-alert-engine (which handles portfolio-scale alerts): this is
 * per-session predictive nudges.
 */

export type InsightCategory =
  | 'arrears_followup'
  | 'renewal_opportunity'
  | 'maintenance_escalation'
  | 'compliance_reminder'
  | 'inspection_followup'
  | 'vendor_swap'
  | 'tenant_satisfaction'
  | 'workflow_unblock';

export type InsightPriority = 'low' | 'medium' | 'high' | 'critical';

export interface InsightContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: 'owner' | 'manager' | 'tenant' | 'admin' | 'agent';
  readonly currentPage: string;
  readonly currentEntities?: Readonly<Record<string, string>>;
  readonly openArrearsCases?: number;
  readonly leasesExpiring90?: number;
  readonly overdueTickets?: number;
  readonly expiringCompliance?: number;
  readonly lastStallAt?: string;
}

export interface ProactiveInsight {
  readonly id: string;
  readonly category: InsightCategory;
  readonly priority: InsightPriority;
  readonly title: string;
  readonly body: string;
  readonly cta?: {
    readonly label: string;
    readonly action: string;
  };
  readonly expiresAt?: string;
}

export interface SessionInsightState {
  readonly shownInsightIds: readonly string[];
  readonly dismissedInsightIds: readonly string[];
  readonly dismissedCategories: readonly {
    readonly category: InsightCategory;
    readonly dismissedAt: string;
  }[];
  readonly insightsShownThisSession: number;
  readonly lastInsightShownAt?: string;
  readonly criticalInsightsShownToday: number;
}

export interface InsightRule {
  readonly id: string;
  readonly category: InsightCategory;
  readonly description: string;
  evaluate(ctx: InsightContext): ProactiveInsight | null;
}
