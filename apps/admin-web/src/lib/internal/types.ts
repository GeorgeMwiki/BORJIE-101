/**
 * Borjie Console internal-surface TypeScript shapes.
 *
 * Mirrors what the api-gateway `/api/v1/mining/internal/*` endpoints
 * return. Domain-specific values (Tanzanian regulator names, mineral
 * commodities, etc.) are part of the live payload — these are the
 * generic carrier types only.
 */

export type TenantPlan = 'Starter' | 'Growth' | 'Enterprise';
export type TenantStatus = 'Active' | 'Trial' | 'Past due' | 'Suspended';

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly commodity: string;
  readonly region: string;
  readonly country: string;
  readonly plan: TenantPlan;
  readonly status: TenantStatus;
  readonly arrUsd: number;
  readonly lastActiveAt: string;
  readonly createdAt: string;
}

export type JuniorStatus = 'Active' | 'Canary' | 'Suspended';

export interface Junior {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly model: string;
  readonly status: JuniorStatus;
}

export type CitationSource = 'Gazette' | 'NEMC' | 'BoT' | 'TMAA' | 'TRA' | 'Mining Commission';

export interface Citation {
  readonly id: string;
  readonly statute: string;
  readonly section: string;
  readonly publishedOn: string;
  readonly source: CitationSource;
  readonly excerpt: string;
}

export interface CorpusEntry {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly status: 'Indexed' | 'Re-ingesting' | 'Superseded';
  readonly bytes: number;
  readonly indexedAt: string;
  readonly chunks: number;
}

export interface AuditEvent {
  readonly id: string;
  readonly at: string;
  readonly tenant: string;
  readonly tenantId: string;
  readonly actor: string;
  readonly action: string;
  readonly target?: string;
}

export type PromptStatus = 'Production' | 'Canary' | 'Archived';

export interface PromptRow {
  readonly id: string;
  readonly juniorId: string;
  readonly junior: string;
  readonly version: string;
  readonly gepaScore: number;
  readonly status: PromptStatus;
  readonly promotedAt: string;
  readonly body: string;
}

export interface DecisionLogRow {
  readonly id: string;
  readonly at: string;
  readonly tenantId: string;
  readonly tenant: string;
  readonly juniorId: string;
  readonly junior: string;
  readonly mode: 'Recommend' | 'Auto-act' | 'Advise';
  readonly decision: string;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly confidence: number;
}

export interface SloMetric {
  readonly juniorId: string;
  readonly junior: string;
  readonly p50ms: number;
  readonly p95ms: number;
  readonly p99ms: number;
  readonly errorRatePct: number;
  readonly spendUsd: number;
  readonly requestVolume24h: number;
  readonly sparkline: ReadonlyArray<number>;
}

export type RegulatorStage = 'incoming' | 'reviewing' | 'approved' | 'pushed';

export interface RegulatorChange {
  readonly id: string;
  readonly source: CitationSource;
  readonly title: string;
  readonly stage: RegulatorStage;
  readonly ageHours: number;
}

export type ComplianceSeverity = 'Low' | 'Medium' | 'High';

export interface ComplianceItem {
  readonly id: string;
  readonly tenantId: string;
  readonly tenant: string;
  readonly summary: string;
  readonly severity: ComplianceSeverity;
  readonly waitingHours: number;
}

export type PromotionKind = 'Prompt' | 'Model' | 'Corpus';

export interface PromotionRow {
  readonly id: string;
  readonly kind: PromotionKind;
  readonly subject: string;
  readonly promotedAt: string;
  readonly canRevert: boolean;
  readonly promotedBy: string;
}

export type SwitchState = 'OK' | 'DEGRADED' | 'HALT';

export interface KillswitchRow {
  readonly juniorId: string;
  readonly junior: string;
  readonly state: SwitchState;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface TicketRow {
  readonly id: string;
  readonly tenant: string;
  readonly subject: string;
  readonly slaHoursLeft: number;
  readonly csat: number | null;
}

export interface FlagRow {
  readonly key: string;
  readonly description: string;
  readonly rolloutPct: number;
  readonly tenantScopes: ReadonlyArray<string>;
}
