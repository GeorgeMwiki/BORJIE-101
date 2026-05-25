/**
 * MonthlyCloseOrchestrator — types + ports.
 *
 * Wave 28 Phase A Agent PhA2.
 *
 * The orchestrator reuses existing platform services through narrow port
 * interfaces (payments/reconciliation, statement generator, disbursement
 * service, notifications). That keeps `@borjie/ai-copilot` free of
 * downstream concrete dependencies while the api-gateway composition root
 * plugs in the real implementations.
 *
 * Steps, in order:
 *   1. freeze_period           — lock the closing window (period_end - 1 month)
 *   2. reconcile_payments      — walk unreconciled payments vs invoices
 *   3. generate_statements     — owner monthly statements
 *   4. compute_kra_mri         — Kenya 7.5% flat withholding CSV line-items
 *   5. compute_disbursements   — gross - MRI - platform fee - maintenance
 *   6. propose_disbursement_batch — auto-run OR queue awaiting_approval
 *   7. email_statements        — notification_dispatch_log path
 *   8. emit_completed_event    — MonthlyCloseCompleted for subscribers
 */

export const MONTHLY_CLOSE_STEPS = [
  'freeze_period',
  'reconcile_payments',
  'generate_statements',
  'compute_kra_mri',
  'compute_disbursements',
  'propose_disbursement_batch',
  'email_statements',
  'emit_completed_event',
] as const;

export type Step = (typeof MONTHLY_CLOSE_STEPS)[number];

export type RunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export type Decision =
  | 'executed'
  | 'auto_approved'
  | 'awaiting_approval'
  | 'approved'
  | 'skipped'
  | 'failed';

export type Trigger = 'cron' | 'manual' | 'resume';

/** Per-step audit record persisted into `monthly_close_run_steps`. */
export interface StepRecord {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly stepName: Step;
  readonly stepIndex: number;
  readonly decision: Decision;
  /** 'system' for autonomous, userId string for manual approvals. */
  readonly actor: string;
  readonly policyRule: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly resultJson: Record<string, unknown>;
  readonly errorMessage: string | null;
}

/** Aggregate run-state persisted into `monthly_close_runs`. */
export interface RunState {
  readonly id: string;
  readonly tenantId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: RunStatus;
  readonly trigger: Trigger;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly triggeredBy: string;
  readonly reconciledPayments: number;
  readonly statementsGenerated: number;
  readonly kraMriTotalMinor: number;
  readonly disbursementTotalMinor: number;
  readonly currency: string | null;
  readonly summary: Record<string, unknown>;
  readonly lastError: string | null;
  readonly steps: readonly StepRecord[];
}

// ---------------------------------------------------------------------------
// Ports — what the orchestrator needs from the outside world
// ---------------------------------------------------------------------------

export interface ReconciliationPort {
  /** Walk the unreconciled payments + match against invoices. */
  reconcileForPeriod(input: {
    readonly tenantId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<{
    readonly reconciled: number;
    readonly unmatched: number;
    readonly grossRentMinor: number;
    readonly currency: string;
  }>;
}

export interface StatementPort {
  /** Generate per-owner monthly statements. One per owner. */
  generateOwnerStatementsForPeriod(input: {
    readonly tenantId: string;
    readonly year: number;
    readonly month: number;
  }): Promise<{
    readonly statements: readonly {
      readonly ownerId: string;
      readonly statementId: string;
      readonly grossRentMinor: number;
      readonly currency: string;
    }[];
  }>;
}

export interface KraMriLineItem {
  readonly ownerId: string;
  readonly grossRentMinor: number;
  readonly withholdingMinor: number;
  readonly currency: string;
}

export interface DisbursementProposal {
  readonly ownerId: string;
  readonly grossRentMinor: number;
  readonly kraMriMinor: number;
  readonly platformFeeMinor: number;
  readonly maintenanceMinor: number;
  readonly netMinor: number;
  readonly currency: string;
  readonly destination: string;
}

export interface DisbursementPort {
  /** Compute the per-owner net payable for the period. */
  computeBreakdown(input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly periodStart: Date;
    readonly periodEnd: Date;
  }): Promise<{
    readonly grossRentMinor: number;
    readonly platformFeeMinor: number;
    readonly maintenanceMinor: number;
    readonly currency: string;
    readonly destination: string;
  }>;
  /** Execute one disbursement — only called when policy approves. */
  executeDisbursement(input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly amountMinor: number;
    readonly currency: string;
    readonly destination: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly disbursementId: string; readonly status: string }>;
}

export interface NotificationPort {
  /** Deliver a statement-ready email. Writes into notification_dispatch_log. */
  sendStatementEmail(input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly statementId: string;
  }): Promise<{ readonly dispatchId: string }>;
}

export interface EventPort {
  publish(event: {
    readonly type: 'MonthlyCloseCompleted' | 'MonthlyCloseAwaitingApproval';
    readonly tenantId: string;
    readonly runId: string;
    readonly payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface AutonomyPolicyPort {
  getPolicy(tenantId: string): Promise<{
    readonly autonomousModeEnabled: boolean;
    readonly finance: {
      readonly autoApproveRefundsMinorUnits: number;
    };
  }>;
}

/**
 * Global withholding-tax dispatch — Wave 28 → Wave Z26 refactor.
 *
 * The orchestrator originally hardcoded Kenya's 7.5% MRI rate in
 * `compute_kra_mri`. Once the `@borjie/compliance-plugins`
 * TaxRegimePort landed (Wave Z), this port lets the orchestrator
 * dispatch per-tenant country so the same step works for any
 * jurisdiction — DE Kapitalertragsteuer, UK NRLS, US state-specific,
 * Singapore 15% non-resident, etc.
 *
 * The `compute_kra_mri` step name is preserved to keep historical
 * DB records readable; the underlying computation is now global.
 */
export interface WithholdingTaxPort {
  /**
   * Compute withholding for a tenant. The callback returns the country
   * code (ISO-3166 alpha-2) the plugin should dispatch on — derived
   * from the tenant's `country` column, the owner's residency, or
   * per-property jurisdiction rules.
   */
  computeForTenantAndOwner(input: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly grossRentMinor: number;
    readonly currency: string;
    readonly period: { readonly year: number; readonly month: number };
  }): Promise<{
    readonly withholdingMinor: number;
    readonly ratePct: number | null;
    readonly regimeLabel: string;
    readonly requiresManualConfig: boolean;
    readonly regulatorRef: string | null;
  }>;
}

/** Persistence port — abstracts the monthly_close_runs / steps tables. */
export interface RunStorePort {
  createRun(input: {
    readonly tenantId: string;
    readonly periodYear: number;
    readonly periodMonth: number;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly trigger: Trigger;
    readonly triggeredBy: string;
  }): Promise<RunState>;
  findRunByPeriod(
    tenantId: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<RunState | null>;
  findRunById(runId: string, tenantId: string): Promise<RunState | null>;
  listRuns(
    tenantId: string,
    limit: number,
  ): Promise<readonly RunState[]>;
  updateRun(
    runId: string,
    tenantId: string,
    patch: Partial<{
      status: RunStatus;
      completedAt: string | null;
      reconciledPayments: number;
      statementsGenerated: number;
      kraMriTotalMinor: number;
      disbursementTotalMinor: number;
      currency: string | null;
      summary: Record<string, unknown>;
      lastError: string | null;
    }>,
  ): Promise<RunState>;
  recordStep(input: {
    readonly runId: string;
    readonly tenantId: string;
    readonly stepName: Step;
    readonly stepIndex: number;
    readonly decision: Decision;
    readonly actor: string;
    readonly policyRule: string | null;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly durationMs: number | null;
    readonly resultJson: Record<string, unknown>;
    readonly errorMessage: string | null;
  }): Promise<StepRecord>;
  findStep(
    runId: string,
    stepName: Step,
  ): Promise<StepRecord | null>;
}

export interface OrchestratorLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  error(meta: Record<string, unknown>, msg: string): void;
}

export interface MonthlyCloseOrchestratorDeps {
  readonly store: RunStorePort;
  readonly reconciliation: ReconciliationPort;
  readonly statements: StatementPort;
  readonly disbursement: DisbursementPort;
  readonly notifications: NotificationPort;
  readonly eventBus: EventPort;
  readonly autonomy: AutonomyPolicyPort;
  readonly logger: OrchestratorLogger;
  /**
   * Global withholding-tax port. Optional — when provided, the
   * orchestrator dispatches per-tenant country for the withholding
   * computation (DE/GB/KE/US/etc. all work). When absent, the flat
   * `kraMriRatePct` fallback is used for backward compatibility with
   * existing tests + the Kenya-first pilot deployments.
   */
  readonly withholdingTax?: WithholdingTaxPort;
  /** Platform fee % applied to gross rent. Defaults to 10%. */
  readonly platformFeePct?: number;
  /**
   * Legacy flat-rate withholding (default 7.5% — Kenya MRI). Used ONLY
   * when `withholdingTax` port is not injected; retained for existing
   * Kenya-pilot deploys + tests that predate the global port. New
   * deployments should wire the `withholdingTax` port so the same
   * orchestrator serves every jurisdiction.
   */
  readonly kraMriRatePct?: number;
  /** Clock injection for deterministic tests. */
  readonly clock?: () => Date;
  /** ID generator for deterministic tests. */
  readonly idGen?: () => string;
}

export interface TriggerRunInput {
  readonly tenantId: string;
  readonly trigger: Trigger;
  readonly triggeredBy: string;
  /** Override the period (today minus 1 month by default). */
  readonly periodYear?: number;
  readonly periodMonth?: number;
}

export interface TriggerRunResult {
  readonly run: RunState;
  readonly resumed: boolean;
}

export interface ApproveStepInput {
  readonly runId: string;
  readonly tenantId: string;
  readonly stepName: Step;
  readonly approverUserId: string;
}
