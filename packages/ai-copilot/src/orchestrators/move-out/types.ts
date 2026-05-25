/**
 * MoveOutOrchestrator — types + ports.
 *
 * Wave 28 AGENT ORCHESTRATE.
 *
 * Steps (in order):
 *   1. notice_received
 *   2. final_inspection_scheduled
 *   3. inspection_completed
 *   4. damage_assessed
 *   5. deduction_computed
 *   6. refund_calculated
 *   7. refund_issued
 *   8. case_closed
 *
 * Compensations:
 *   - dispute re-opens the case: refund can be reversed + damage
 *     re-assessed. `reopenOnDispute` short-circuits the run into a
 *     `disputed` terminal state so a human can re-drive it.
 */

export const MOVE_OUT_STEPS = [
  'notice_received',
  'final_inspection_scheduled',
  'inspection_completed',
  'damage_assessed',
  'deduction_computed',
  'refund_calculated',
  'refund_issued',
  'case_closed',
] as const;

export type Step = (typeof MOVE_OUT_STEPS)[number];

export type RunStatus =
  | 'running'
  | 'awaiting_approval'
  | 'disputed'
  | 'completed'
  | 'failed';

export type Decision =
  | 'executed'
  | 'auto_approved'
  | 'awaiting_approval'
  | 'approved'
  | 'skipped'
  | 'compensated'
  | 'failed';

export type Trigger = 'manual' | 'cron' | 'resume';

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
  readonly unitId: string;
  readonly depositMinor: number;
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

export interface InspectionPort {
  scheduleInspection(input: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly inspectionId: string; readonly scheduledFor: string }>;
  completeInspection(input: {
    readonly tenantId: string;
    readonly inspectionId: string;
  }): Promise<{ readonly completedAt: string; readonly damageCount: number }>;
}

export interface DamageAssessmentPort {
  assess(input: {
    readonly tenantId: string;
    readonly inspectionId: string;
    readonly idempotencyKey: string;
  }): Promise<{
    readonly assessmentId: string;
    readonly totalDamageMinor: number;
  }>;
  reverseAssessment(input: {
    readonly tenantId: string;
    readonly assessmentId: string;
  }): Promise<void>;
}

export interface DeductionPort {
  compute(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly damageMinor: number;
    readonly depositMinor: number;
    readonly idempotencyKey: string;
  }): Promise<{ readonly deductionMinor: number }>;
}

export interface RefundPort {
  calculate(input: {
    readonly tenantId: string;
    readonly depositMinor: number;
    readonly deductionMinor: number;
  }): Promise<{ readonly refundMinor: number }>;
  issueRefund(input: {
    readonly tenantId: string;
    readonly leaseId: string;
    readonly refundMinor: number;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly refundId: string; readonly status: string }>;
  reverseRefund(input: {
    readonly tenantId: string;
    readonly refundId: string;
  }): Promise<void>;
}

export interface AutonomyPolicyPort {
  getPolicy(tenantId: string): Promise<{
    readonly autonomousModeEnabled: boolean;
    readonly refunds: {
      readonly autoIssueUnderMinor: number;
    };
  }>;
}

export interface DisputePort {
  /** Has the tenant filed a dispute against the deduction? */
  hasActiveDispute(input: {
    readonly tenantId: string;
    readonly leaseId: string;
  }): Promise<boolean>;
}

export interface EventPort {
  publish(event: {
    readonly type:
      | 'MoveOutStarted'
      | 'MoveOutCompleted'
      | 'MoveOutDisputed'
      | 'MoveOutAwaitingApproval';
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
    readonly unitId: string;
    readonly depositMinor: number;
    readonly currency: string;
    readonly trigger: Trigger;
    readonly triggeredBy: string;
  }): Promise<RunState>;
  findRunByLease(tenantId: string, leaseId: string): Promise<RunState | null>;
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

export interface MoveOutOrchestratorDeps {
  readonly store: RunStorePort;
  readonly inspection: InspectionPort;
  readonly damageAssessment: DamageAssessmentPort;
  readonly deduction: DeductionPort;
  readonly refund: RefundPort;
  readonly autonomy: AutonomyPolicyPort;
  readonly disputes: DisputePort;
  readonly eventBus: EventPort;
  readonly logger: OrchestratorLogger;
  readonly maxRetries?: number;
  readonly clock?: () => Date;
  readonly idGen?: () => string;
}

export interface TriggerRunInput {
  readonly tenantId: string;
  readonly leaseId: string;
  readonly unitId: string;
  readonly depositMinor: number;
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
