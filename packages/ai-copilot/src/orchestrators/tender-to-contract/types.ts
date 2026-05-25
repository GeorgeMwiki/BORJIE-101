/**
 * TenderToContractOrchestrator — types + ports.
 *
 * Wave 28 AGENT ORCHESTRATE.
 *
 * Steps (in order):
 *   1. requirement_spec       — freeze the scope/budget
 *   2. publish_tender         — post to vendors
 *   3. bids_collected         — freeze the bid window
 *   4. shortlist              — apply scoring + shortlist
 *   5. award                  — designate winner (policy-gated for large award)
 *   6. contract_drafted       — generate draft contract
 *   7. contract_signed        — both parties sign
 *   8. vendor_onboarded       — onboard vendor into the directory
 *
 * Compensations:
 *   - rescind_award is invoked if signing fails (e.g., vendor withdraws).
 *     The orchestrator rolls back the award + reopens the tender.
 */

export const TENDER_STEPS = [
  'requirement_spec',
  'publish_tender',
  'bids_collected',
  'shortlist',
  'award',
  'contract_drafted',
  'contract_signed',
  'vendor_onboarded',
] as const;

export type Step = (typeof TENDER_STEPS)[number];

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
  readonly tenderKey: string;
  readonly scope: string;
  readonly budgetMinor: number;
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

export interface TenderPort {
  publishTender(input: {
    readonly tenantId: string;
    readonly scope: string;
    readonly budgetMinor: number;
    readonly currency: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly tenderId: string; readonly publishedAt: string }>;
  collectBids(input: {
    readonly tenantId: string;
    readonly tenderId: string;
  }): Promise<{
    readonly bids: readonly {
      readonly vendorId: string;
      readonly amountMinor: number;
      readonly score: number;
    }[];
  }>;
  shortlist(input: {
    readonly tenantId: string;
    readonly tenderId: string;
    readonly bids: readonly {
      readonly vendorId: string;
      readonly amountMinor: number;
      readonly score: number;
    }[];
  }): Promise<{
    readonly shortlistedVendorIds: readonly string[];
    readonly topPick: {
      readonly vendorId: string;
      readonly amountMinor: number;
    };
  }>;
}

export interface AwardPort {
  awardContract(input: {
    readonly tenantId: string;
    readonly tenderId: string;
    readonly vendorId: string;
    readonly amountMinor: number;
    readonly idempotencyKey: string;
  }): Promise<{ readonly awardId: string }>;
  rescindAward(input: {
    readonly tenantId: string;
    readonly awardId: string;
  }): Promise<void>;
}

export interface ContractPort {
  draftContract(input: {
    readonly tenantId: string;
    readonly awardId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly contractId: string }>;
  signContract(input: {
    readonly tenantId: string;
    readonly contractId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly signedAt: string }>;
}

export interface VendorOnboardingPort {
  onboardVendor(input: {
    readonly tenantId: string;
    readonly vendorId: string;
    readonly contractId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly vendorProfileId: string }>;
}

export interface AutonomyPolicyPort {
  getPolicy(tenantId: string): Promise<{
    readonly autonomousModeEnabled: boolean;
    readonly procurement: {
      readonly autoAwardUnderMinor: number;
    };
  }>;
}

export interface EventPort {
  publish(event: {
    readonly type:
      | 'TenderStarted'
      | 'TenderAwardSent'
      | 'TenderCompleted'
      | 'TenderCompensated'
      | 'TenderAwaitingApproval';
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
    readonly tenderKey: string;
    readonly scope: string;
    readonly budgetMinor: number;
    readonly currency: string;
    readonly trigger: Trigger;
    readonly triggeredBy: string;
  }): Promise<RunState>;
  findRunByKey(tenantId: string, tenderKey: string): Promise<RunState | null>;
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

export interface TenderToContractOrchestratorDeps {
  readonly store: RunStorePort;
  readonly tender: TenderPort;
  readonly award: AwardPort;
  readonly contract: ContractPort;
  readonly onboarding: VendorOnboardingPort;
  readonly autonomy: AutonomyPolicyPort;
  readonly eventBus: EventPort;
  readonly logger: OrchestratorLogger;
  readonly maxRetries?: number;
  readonly clock?: () => Date;
  readonly idGen?: () => string;
}

export interface TriggerRunInput {
  readonly tenantId: string;
  readonly tenderKey: string;
  readonly scope: string;
  readonly budgetMinor: number;
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
