/**
 * Move-Out Checklist
 *
 * Captures the four steps required when a tenant vacates a unit:
 *
 *   1. Final inspection (condition report reference)
 *   2. Utility meter readings (electricity / water / gas)
 *   3. Deposit reconciliation (deductions vs refund)
 *   4. Residency-proof letter generation
 *
 * The checklist is a value object. Each step is tracked as
 * `pending | in_progress | completed | skipped` so the UI can render progress
 * without loading the full lease aggregate. The service is deliberately thin
 * — persistence and notifications are delegated upwards.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';

export type MoveOutStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped';

export interface MoveOutStepState {
  readonly status: MoveOutStepStatus;
  readonly completedAt: ISOTimestamp | null;
  readonly completedBy: UserId | null;
  readonly notes: string | null;
}

export interface UtilityReading {
  readonly utility: 'electricity' | 'water' | 'gas' | 'other';
  readonly meterReading: number;
  readonly unit: string;
  readonly readingDate: ISOTimestamp;
}

export interface MoveOutChecklist {
  readonly leaseId: string;
  readonly tenantId: TenantId;
  readonly finalInspection: MoveOutStepState & {
    readonly conditionReportId: string | null;
  };
  readonly utilityReadings: MoveOutStepState & {
    readonly readings: readonly UtilityReading[];
  };
  readonly depositReconciliation: MoveOutStepState & {
    readonly totalDeposit: number;
    readonly totalDeductions: number;
    readonly refundAmount: number;
    readonly currency: string;
  };
  readonly residencyProofLetter: MoveOutStepState & {
    readonly documentId: string | null;
  };
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export const MoveOutError = {
  CHECKLIST_NOT_FOUND: 'CHECKLIST_NOT_FOUND',
  INVALID_STEP: 'INVALID_STEP',
  INVALID_INPUT: 'INVALID_INPUT',
} as const;

export type MoveOutErrorCode = (typeof MoveOutError)[keyof typeof MoveOutError];

export interface MoveOutErrorResult {
  code: MoveOutErrorCode;
  message: string;
}

function pendingStep(): MoveOutStepState {
  return {
    status: 'pending',
    completedAt: null,
    completedBy: null,
    notes: null,
  };
}

export function createMoveOutChecklist(params: {
  leaseId: string;
  tenantId: TenantId;
  currency: string;
  totalDeposit: number;
}): MoveOutChecklist {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    leaseId: params.leaseId,
    tenantId: params.tenantId,
    finalInspection: { ...pendingStep(), conditionReportId: null },
    utilityReadings: { ...pendingStep(), readings: [] },
    depositReconciliation: {
      ...pendingStep(),
      totalDeposit: params.totalDeposit,
      totalDeductions: 0,
      refundAmount: params.totalDeposit,
      currency: params.currency,
    },
    residencyProofLetter: { ...pendingStep(), documentId: null },
    createdAt: now,
    updatedAt: now,
  };
}

export interface MoveOutRepository {
  findByLeaseId(
    leaseId: string,
    tenantId: TenantId,
  ): Promise<MoveOutChecklist | null>;
  save(checklist: MoveOutChecklist): Promise<MoveOutChecklist>;
}

export class MoveOutChecklistService {
  constructor(private readonly repo: MoveOutRepository) {}

  async completeFinalInspection(
    leaseId: string,
    tenantId: TenantId,
    conditionReportId: string,
    inspectorId: UserId,
    notes?: string,
  ): Promise<Result<MoveOutChecklist, MoveOutErrorResult>> {
    const checklist = await this.repo.findByLeaseId(leaseId, tenantId);
    if (!checklist) {
      return this.fail('CHECKLIST_NOT_FOUND', 'Move-out checklist missing');
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: MoveOutChecklist = {
      ...checklist,
      finalInspection: {
        status: 'completed',
        completedAt: now,
        completedBy: inspectorId,
        notes: notes ?? null,
        conditionReportId,
      },
      updatedAt: now,
    };
    const saved = await this.repo.save(updated);
    return { success: true, data: saved } as Result<
      MoveOutChecklist,
      MoveOutErrorResult
    >;
  }

  async recordUtilityReadings(
    leaseId: string,
    tenantId: TenantId,
    readings: UtilityReading[],
    completedBy: UserId,
  ): Promise<Result<MoveOutChecklist, MoveOutErrorResult>> {
    if (readings.length === 0) {
      return this.fail('INVALID_INPUT', 'At least one reading required');
    }
    const checklist = await this.repo.findByLeaseId(leaseId, tenantId);
    if (!checklist) {
      return this.fail('CHECKLIST_NOT_FOUND', 'Move-out checklist missing');
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: MoveOutChecklist = {
      ...checklist,
      utilityReadings: {
        status: 'completed',
        completedAt: now,
        completedBy,
        notes: null,
        readings,
      },
      updatedAt: now,
    };
    const saved = await this.repo.save(updated);
    return { success: true, data: saved } as Result<
      MoveOutChecklist,
      MoveOutErrorResult
    >;
  }

  async reconcileDeposit(
    leaseId: string,
    tenantId: TenantId,
    totalDeductions: number,
    completedBy: UserId,
    notes?: string,
  ): Promise<Result<MoveOutChecklist, MoveOutErrorResult>> {
    if (totalDeductions < 0) {
      return this.fail('INVALID_INPUT', 'Deductions cannot be negative');
    }
    const checklist = await this.repo.findByLeaseId(leaseId, tenantId);
    if (!checklist) {
      return this.fail('CHECKLIST_NOT_FOUND', 'Move-out checklist missing');
    }
    if (totalDeductions > checklist.depositReconciliation.totalDeposit) {
      return this.fail(
        'INVALID_INPUT',
        'Deductions exceed deposit',
      );
    }
    const refund =
      checklist.depositReconciliation.totalDeposit - totalDeductions;
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: MoveOutChecklist = {
      ...checklist,
      depositReconciliation: {
        ...checklist.depositReconciliation,
        status: 'completed',
        completedAt: now,
        completedBy,
        notes: notes ?? null,
        totalDeductions,
        refundAmount: refund,
      },
      updatedAt: now,
    };
    const saved = await this.repo.save(updated);
    return { success: true, data: saved } as Result<
      MoveOutChecklist,
      MoveOutErrorResult
    >;
  }

  async issueResidencyProofLetter(
    leaseId: string,
    tenantId: TenantId,
    documentId: string,
    completedBy: UserId,
  ): Promise<Result<MoveOutChecklist, MoveOutErrorResult>> {
    const checklist = await this.repo.findByLeaseId(leaseId, tenantId);
    if (!checklist) {
      return this.fail('CHECKLIST_NOT_FOUND', 'Move-out checklist missing');
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: MoveOutChecklist = {
      ...checklist,
      residencyProofLetter: {
        status: 'completed',
        completedAt: now,
        completedBy,
        notes: null,
        documentId,
      },
      updatedAt: now,
    };
    const saved = await this.repo.save(updated);
    return { success: true, data: saved } as Result<
      MoveOutChecklist,
      MoveOutErrorResult
    >;
  }

  isCompleted(checklist: MoveOutChecklist): boolean {
    return (
      checklist.finalInspection.status === 'completed' &&
      checklist.utilityReadings.status === 'completed' &&
      checklist.depositReconciliation.status === 'completed' &&
      checklist.residencyProofLetter.status === 'completed'
    );
  }

  private fail<T>(
    code: MoveOutErrorCode,
    message: string,
  ): Result<T, MoveOutErrorResult> {
    return { success: false, error: { code, message } } as Result<
      T,
      MoveOutErrorResult
    >;
  }
}
