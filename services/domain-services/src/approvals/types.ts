/**
 * Approval Workflow Domain Types
 * For approving: large maintenance costs, lease exceptions, refunds, discounts
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
} from '@borjie/domain-models';

/** Branded ID for approval request */
export type ApprovalRequestId = string & { __brand: 'ApprovalRequestId' };
export function asApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId;
}

// ============================================================================
// Approval Types
// ============================================================================

export const APPROVAL_TYPES = [
  'maintenance_cost',
  'lease_exception',
  'refund',
  'discount',
  'payment_flexibility',
] as const;

export type ApprovalType = (typeof APPROVAL_TYPES)[number];

// ============================================================================
// Approval Status
// ============================================================================

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'escalated',
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// ============================================================================
// Approval Request Details (type-specific payload)
// ============================================================================

export interface MaintenanceCostDetails {
  readonly workOrderId: string;
  readonly amount: number;
  readonly currency: string;
  readonly description: string;
  readonly vendorId?: string;
}

export interface LeaseExceptionDetails {
  readonly leaseId: string;
  readonly exceptionType: string; // e.g. 'early_termination', 'pet_allowance', 'subletting'
  readonly description: string;
  readonly effectiveFrom?: ISOTimestamp;
  readonly effectiveTo?: ISOTimestamp;
}

export interface RefundDetails {
  readonly paymentId: string;
  readonly amount: number;
  readonly currency: string;
  readonly reason: string;
  readonly customerId: string;
}

export interface DiscountDetails {
  readonly amount: number;
  readonly currency: string;
  readonly discountType: string; // e.g. 'goodwill', 'promotional', 'referral'
  readonly description: string;
  readonly leaseId?: string;
  readonly validUntil?: ISOTimestamp;
}

export interface PaymentFlexibilityDetails {
  readonly customerId: string;
  readonly leaseId: string;
  readonly requestedArrangement:
    | 'payment_plan'
    | 'grace_period_extension'
    | 'late_fee_waiver'
    | 'partial_payment_acceptance'
    | 'deferral';
  readonly amount: number;
  readonly currency: string;
  readonly durationDays: number;
  readonly reason: string;
  readonly riskScore?: number;
}

export type ApprovalRequestDetails =
  | MaintenanceCostDetails
  | LeaseExceptionDetails
  | RefundDetails
  | DiscountDetails
  | PaymentFlexibilityDetails;

// ============================================================================
// Approval Request Entity
// ============================================================================

export interface ApprovalRequest {
  readonly id: ApprovalRequestId;
  readonly tenantId: TenantId;
  readonly type: ApprovalType;
  readonly status: ApprovalStatus;
  readonly requesterId: UserId;
  readonly approverId: UserId | null;
  readonly escalatedToUserId: UserId | null;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly justification: string;
  readonly details: ApprovalRequestDetails;
  readonly comments: string | null;
  readonly rejectionReason: string | null;
  readonly escalationReason: string | null;
  readonly approvedAt: ISOTimestamp | null;
  readonly rejectedAt: ISOTimestamp | null;
  readonly escalatedAt: ISOTimestamp | null;
  readonly timeoutAt: ISOTimestamp | null;
  readonly approvalLevel: number;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Approval Policy
// ============================================================================

export interface ApprovalThreshold {
  readonly minAmount: number;
  readonly maxAmount: number | null;
  readonly requiredRole: string;
  readonly approvalLevel: number;
}

export interface AutoApproveRule {
  readonly maxAmount: number;
  readonly maxAmountCurrency: string;
  readonly appliesToRoles: readonly string[];
}

export interface ApprovalLevel {
  readonly level: number;
  readonly requiredRole: string;
  readonly timeoutHours: number;
  readonly escalateToRole: string | null;
}

export interface ApprovalPolicy {
  readonly tenantId: TenantId;
  readonly type: ApprovalType;
  readonly thresholds: readonly ApprovalThreshold[];
  readonly autoApproveRules: readonly AutoApproveRule[];
  readonly approvalChain: readonly ApprovalLevel[];
  readonly defaultTimeoutHours: number;
  readonly autoEscalateToRole: string | null;
  readonly updatedAt: ISOTimestamp;
  readonly updatedBy: UserId;
}

// ============================================================================
// Approval History Filters
// ============================================================================

export interface ApprovalHistoryFilters {
  readonly type?: ApprovalType;
  readonly status?: ApprovalStatus;
  readonly requesterId?: UserId;
  readonly approverId?: UserId;
  readonly fromDate?: ISOTimestamp;
  readonly toDate?: ISOTimestamp;
  readonly minAmount?: number;
  readonly maxAmount?: number;
}
