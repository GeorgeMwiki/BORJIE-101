/**
 * ArrearsLadderOrchestrator — types + ports.
 *
 * Wave 28 AGENT ORCHESTRATE.
 *
 * Each tenant-in-arrears case walks a ladder of increasingly firm
 * reminders. If the tenant pays between steps the orchestrator pivots to
 * compensation (cancelling scheduled notices) and closes the ladder.
 *
 * Steps (in order):
 *   1. soft_reminder     — T+5 days, friendly SMS/email
 *   2. firm_reminder     — T+10 days, firm-worded notice
 *   3. final_notice      — T+20 days, final notice + legal warning
 *   4. case_escalation   — escalated to legal / debt-collection partner
 *   5. settlement_offer  — structured settlement (discount or instalment)
 *   6. write_off_decision — write-off vs continue litigation
 *
 * Compensations:
 *   - cancelFirmReminder / cancelFinalNotice / cancelEscalation — if
 *     payment arrives between steps, any scheduled future notice is
 *     cancelled before the ladder transitions to `closed`.
 */

export const ARREARS_LADDER_STEPS = [
  'soft_reminder',
  'firm_reminder',
  'final_notice',
  'case_escalation',
  'settlement_offer',
  'write_off_decision',
] as const;

export type Step = (typeof ARREARS_LADDER_STEPS)[number];

export type RunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'compensated'
  | 'failed';

export type Decision =
  | 'executed'
  | 'auto_approved'
  | 'awaiting_approval'
  | 'approved'
  | 'skipped'
  | 'compensated'
  | 'failed';

export type Trigger = 'cron' | 'manual' | 'resume';

export interface StepRecord {
  readonly id: string;
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
  readonly idempotencyKey: string;
  readonly retryCount: number;
}

export interface RunState {
  readonly id: string;
  readonly tenantId: string;
  readonly leaseId: string;
  readonly tenantPartyId: string;
  readonly outstandingMinor: number;
  readonly currency: string;
  readonly status: RunStatus;
  readonly trigger: Trigger;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly triggeredBy: string;
  readonly lastError: string | null;
  readonly summary: Record<string, unknown>;
  readonly steps: readonly StepRecord[];
}

// Ports ----------------------------------------------------------------

export interface NoticeDispatchPort {
  sendReminder(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly tenantPartyId: string;
    readonly outstandingMinor: number;
    readonly currency: string;
    readonly severity: 'soft' | 'firm' | 'final';
    readonly idempotencyKey: string;
  }): Promise<{ readonly dispatchId: string; readonly scheduledFor: string }>;
  cancelReminder(input: {
    readonly tenantId: string;
    readonly dispatchId: string;
  }): Promise<void>;
}

export interface EscalationPort {
  escalateToLegal(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly outstandingMinor: number;
    readonly idempotencyKey: string;
  }): Promise<{ readonly caseId: string }>;
  rescindEscalation(input: {
    readonly tenantId: string;
    readonly caseId: string;
  }): Promise<void>;
}

export interface SettlementPort {
  createOffer(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly outstandingMinor: number;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly offerId: string;
    readonly discountPct: number;
    readonly instalments: number;
  }>;
}

export interface WriteOffPort {
  recordDecision(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly outstandingMinor: number;
    readonly decision: 'write_off' | 'continue_litigation';
    readonly idempotencyKey: string;
  }): Promise<{ readonly journalEntryId: string | null }>;
}

export interface PaymentLookupPort {
  /** Has the tenant paid since the ladder started? */
  hasSettledSince(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly since: string;
  }): Promise<boolean>;
}

export interface AutonomyPolicyPort {
  getPolicy(tenantId: string): Promise<{
    readonly autonomousModeEnabled: boolean;
    readonly arrears: {
      readonly autoEscalateOverMinor: number;
      readonly autoWriteOffUnderMinor: number;
    };
  }>;
}

export interface EventPort {
  publish(event: {
    readonly type:
      | 'ArrearsLadderStarted'
      | 'ArrearsLadderCompleted'
      | 'ArrearsLadderCompensated'
      | 'ArrearsLadderAwaitingApproval';
    readonly tenantId: string;
    readonly runId: string;
    readonly payload: Record<string, unknown>;
  }): Promise<void>;
}

export interface OrchestratorLogger {
  info(meta: Record<string, unknown>, msg: string): void;
  warn(meta: Record<string, unknown>, msg: string): void;
  error(meta: Record<string, unknown>, msg: string): void;
}

export interface RunStorePort {
  createRun(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly tenantPartyId: string;
    readonly outstandingMinor: number;
    readonly currency: string;
    readonly trigger: Trigger;
    readonly triggeredBy: string;
  }): Promise<RunState>;
  findRunByLease(
    tenantId: string,
    leaseId: string,
  ): Promise<RunState | null>;
  findRunById(runId: string, tenantId: string): Promise<RunState | null>;
  listRuns(tenantId: string, limit: number): Promise<readonly RunState[]>;
  updateRun(
    runId: string,
    tenantId: string,
    patch: Partial<{
      status: RunStatus;
      completedAt: string | null;
      lastError: string | null;
      summary: Record<string, unknown>;
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
    readonly idempotencyKey: string;
    readonly retryCount: number;
  }): Promise<StepRecord>;
  findStep(runId: string, stepName: Step): Promise<StepRecord | null>;
}

export interface ArrearsLadderOrchestratorDeps {
  readonly store: RunStorePort;
  readonly notices: NoticeDispatchPort;
  readonly escalation: EscalationPort;
  readonly settlement: SettlementPort;
  readonly writeOff: WriteOffPort;
  readonly payments: PaymentLookupPort;
  readonly autonomy: AutonomyPolicyPort;
  readonly eventBus: EventPort;
  readonly logger: OrchestratorLogger;
  readonly maxRetries?: number;
  readonly clock?: () => Date;
  readonly idGen?: () => string;
}

export interface TriggerRunInput {
  readonly tenantId: string;
  readonly leaseId: string;
  readonly tenantPartyId: string;
  readonly outstandingMinor: number;
  readonly currency: string;
  readonly trigger: Trigger;
  readonly triggeredBy: string;
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
