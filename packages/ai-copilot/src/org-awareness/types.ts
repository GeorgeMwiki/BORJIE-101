/**
 * Org-awareness types.
 *
 * The Organizational Awareness layer lets an admin literally talk to the
 * tenant's operation: "where are our bottlenecks?", "how has our arrears
 * ratio changed since we adopted the platform?", "which vendor is slowest?"
 * Mr. Mwikila answers with precise, evidence-backed, tenant-specific
 * numbers — computed from the three tables below.
 *
 * Every interface is strictly multi-tenant: tenantId is always the first
 * argument.
 */

export type ProcessKind =
  | 'maintenance_case'
  | 'lease_renewal'
  | 'arrears_case'
  | 'payment_reconcile'
  | 'approval_decision'
  | 'tender_bid'
  | 'inspection'
  | 'letter_generation'
  | 'training_completion';

export type ActorKind = 'human' | 'system' | 'ai' | 'vendor' | 'tenant';

export type ProcessVariant =
  | 'standard'
  | 'emergency'
  | 'stuck_path'
  | 'fast_path';

export interface ProcessObservationInput {
  readonly tenantId: string;
  readonly processKind: ProcessKind;
  readonly processInstanceId: string;
  readonly stage: string;
  readonly previousStage?: string | undefined;
  readonly actorKind: ActorKind;
  readonly actorId?: string | undefined;
  readonly variant?: ProcessVariant | undefined;
  readonly isReopen?: boolean | undefined;
  readonly isStuck?: boolean | undefined;
  readonly durationMsFromPrevious?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly observedAt?: Date | undefined;
}

export interface ProcessObservation extends ProcessObservationInput {
  readonly id: string;
  readonly variant: ProcessVariant;
  readonly isReopen: boolean;
  readonly isStuck: boolean;
  readonly observedAt: Date;
}

export interface StageStats {
  readonly stage: string;
  readonly sampleSize: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly varianceMs: number;
}

export interface ProcessStats {
  readonly tenantId: string;
  readonly processKind: ProcessKind;
  readonly totalObservations: number;
  readonly distinctInstances: number;
  readonly reopenRate: number;
  readonly stuckInstances: number;
  readonly variantDistribution: Readonly<
    Record<ProcessVariant, number>
  >;
  readonly stages: readonly StageStats[];
  readonly computedAt: string;
}

export type BottleneckKind =
  | 'chronic_slow'
  | 'high_variance'
  | 'stalled_handoff'
  | 'high_reopen_rate'
  | 'queue_depth_rising';

export type BottleneckSeverity = 'P1' | 'P2' | 'P3';
export type BottleneckStatus = 'open' | 'resolved' | 'snoozed';

export interface BottleneckEvidence {
  readonly p50Ms?: number;
  readonly p95Ms?: number;
  readonly reopenRate?: number;
  readonly sampleSize?: number;
  readonly stalledForMs?: number;
  readonly queueDepth?: number;
  readonly notes?: readonly string[];
}

export interface Bottleneck {
  readonly id: string;
  readonly tenantId: string;
  readonly processKind: ProcessKind;
  readonly stage: string;
  readonly bottleneckKind: BottleneckKind;
  readonly severity: BottleneckSeverity;
  readonly status: BottleneckStatus;
  readonly evidence: BottleneckEvidence;
  readonly suggestedRemediation?: string;
  readonly firstDetectedAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt?: string;
  readonly cooldownUntil?: string;
}

export interface NewBottleneckInput {
  readonly tenantId: string;
  readonly processKind: ProcessKind;
  readonly stage: string;
  readonly bottleneckKind: BottleneckKind;
  readonly severity: BottleneckSeverity;
  readonly evidence: BottleneckEvidence;
  readonly suggestedRemediation?: string;
}

export type ImprovementMetric =
  | 'occupancy_rate'
  | 'arrears_ratio'
  | 'avg_days_to_collect'
  | 'avg_maintenance_resolution_hours'
  | 'renewal_rate'
  | 'avg_vacancy_duration_days'
  | 'compliance_breach_count'
  | 'avg_lease_drafting_hours'
  | 'operator_hours_saved_estimate';

export type PeriodKind = 'weekly' | 'monthly';

export interface ImprovementSnapshotInput {
  readonly tenantId: string;
  readonly metric: ImprovementMetric;
  readonly periodKind: PeriodKind;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly value: number;
  readonly sampleSize?: number;
  readonly confidenceLow?: number;
  readonly confidenceHigh?: number;
  readonly isBaseline?: boolean;
  readonly evidence?: Record<string, unknown>;
}

export interface ImprovementSnapshot extends ImprovementSnapshotInput {
  readonly id: string;
  readonly sampleSize: number;
  readonly isBaseline: boolean;
  readonly createdAt: string;
}

export interface ImprovementDelta {
  readonly metric: ImprovementMetric;
  readonly baselineValue: number;
  readonly currentValue: number;
  readonly absoluteChange: number;
  readonly percentChange: number;
  readonly direction: 'up' | 'down' | 'flat';
  readonly isBetter: boolean;
  readonly confidenceLow?: number | undefined;
  readonly confidenceHigh?: number | undefined;
  readonly baselinePeriodStart: string;
  readonly currentPeriodStart: string;
}

export interface ImprovementReport {
  readonly tenantId: string;
  readonly baselineKind: 'borjie_start' | 'explicit' | 'none';
  readonly generatedAt: string;
  readonly deltas: readonly ImprovementDelta[];
  readonly summary: string;
}

export interface ProcessObservationStore {
  append(input: ProcessObservationInput): Promise<ProcessObservation>;
  list(
    tenantId: string,
    processKind?: ProcessKind,
    limit?: number,
  ): Promise<readonly ProcessObservation[]>;
  listByInstance(
    tenantId: string,
    processKind: ProcessKind,
    processInstanceId: string,
  ): Promise<readonly ProcessObservation[]>;
}

export interface BottleneckStore {
  upsertOpen(input: NewBottleneckInput): Promise<Bottleneck>;
  listOpen(tenantId: string): Promise<readonly Bottleneck[]>;
  resolve(tenantId: string, bottleneckId: string): Promise<void>;
  snooze(
    tenantId: string,
    bottleneckId: string,
    until: Date,
  ): Promise<void>;
}

export interface ImprovementSnapshotStore {
  upsert(input: ImprovementSnapshotInput): Promise<ImprovementSnapshot>;
  listForMetric(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<readonly ImprovementSnapshot[]>;
  getBaseline(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<ImprovementSnapshot | null>;
  getLatest(
    tenantId: string,
    metric: ImprovementMetric,
  ): Promise<ImprovementSnapshot | null>;
}
