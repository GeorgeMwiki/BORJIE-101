/**
 * Arrears Case domain entity (extends domain-models/financial/arrears-case)
 *
 * This file adds service-layer helpers (projection-friendly snapshots,
 * proposal entities) without mutating the underlying domain model.
 */

// Re-export core domain primitives so consumers of the service have
// one import surface.
import { ArrearsCase as ArrearsCaseModule } from '@borjie/domain-models';

// Re-export types from the ArrearsCase namespace
export type ArrearsCase = ArrearsCaseModule.ArrearsCase;
export type ArrearsCaseData = ArrearsCaseModule.ArrearsCaseData;
export type ArrearsStatus = ArrearsCaseModule.ArrearsStatus;
export type ArrearsSeverity = ArrearsCaseModule.ArrearsSeverity;
export type ArrearsAction = ArrearsCaseModule.ArrearsAction;

// Re-export functions from the ArrearsCase namespace
export const createArrearsCase = ArrearsCaseModule.createArrearsCase;
export const addAction = ArrearsCaseModule.addAction;
export const assignCase = ArrearsCaseModule.assignCase;
export const recordContactAttempt = ArrearsCaseModule.recordContactAttempt;
export const recordPromiseToPay = ArrearsCaseModule.recordPromiseToPay;
export const markPromiseBroken = ArrearsCaseModule.markPromiseBroken;
export const resolveCase = ArrearsCaseModule.resolveCase;
export const writeOffCase = ArrearsCaseModule.writeOffCase;
export const escalateToLegal = ArrearsCaseModule.escalateToLegal;
export const calculateSeverity = ArrearsCaseModule.calculateSeverity;

// ----------------------------------------------------------------------------
// Projection + proposal types used by the arrears service
// ----------------------------------------------------------------------------

export type ArrearsProposalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type ArrearsProposalKind =
  | 'waiver'
  | 'writeoff'
  | 'late_fee'
  | 'adjustment'
  | 'correction';

export interface ArrearsLineProposal {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly arrearsCaseId: string;
  readonly invoiceId: string | null;
  readonly kind: ArrearsProposalKind;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly reason: string;
  readonly evidenceDocIds: readonly string[];
  readonly status: ArrearsProposalStatus;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalNotes: string | null;
  readonly rejectedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  readonly relatedEntryId: string | null;
  readonly balanceBeforeMinorUnits: number | null;
  readonly projectedBalanceAfterMinorUnits: number | null;
  readonly createdAt: string;
}

export interface ArrearsCaseProjection {
  readonly arrearsCaseId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly balanceMinorUnits: number;
  readonly currency: string;
  readonly daysPastDue: number;
  readonly agingBucket: AgingBucket;
  readonly lastLedgerEntryId: string | null;
  readonly replayedEntryCount: number;
  readonly lines: readonly ArrearsProjectionLine[];
  readonly asOf: string;
}

export interface ArrearsProjectionLine {
  readonly invoiceId: string | null;
  readonly description: string;
  readonly chargedMinorUnits: number;
  readonly paidMinorUnits: number;
  readonly adjustmentMinorUnits: number;
  readonly balanceMinorUnits: number;
  readonly firstIncurredAt: string;
  readonly daysPastDue: number;
  readonly agingBucket: AgingBucket;
  readonly sourceEntryIds: readonly string[];
}

export type AgingBucket =
  | 'current'
  | '1-30'
  | '31-60'
  | '61-90'
  | '91-180'
  | '180+';

export function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  if (daysPastDue <= 180) return '91-180';
  return '180+';
}
