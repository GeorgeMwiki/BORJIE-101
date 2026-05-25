/**
 * Payment Plan Agreement domain model
 * Installment payment plans for customers
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { Money } from '../common/money';

export type PaymentPlanId = Brand<string, 'PaymentPlanId'>;

export function asPaymentPlanId(id: string): PaymentPlanId {
  return id as PaymentPlanId;
}

/** Payment plan status */
export type PaymentPlanStatus = 
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'active'
  | 'completed'
  | 'defaulted'
  | 'cancelled';

/** Single installment in a payment plan */
export interface Installment {
  readonly number: number;
  readonly amount: number; // In minor units
  readonly dueDate: ISOTimestamp;
  readonly paidAmount: number;
  readonly paidAt: ISOTimestamp | null;
  readonly status: 'pending' | 'paid' | 'partial' | 'overdue' | 'waived';
}

/**
 * Payment Plan Agreement entity
 * Allows customers to pay off balances in installments
 */
export interface PaymentPlanAgreement extends EntityMetadata, SoftDeletable {
  readonly id: PaymentPlanId;
  readonly tenantId: TenantId;
  readonly customerId: string;
  readonly leaseId: string | null;
  
  // Identity
  readonly planNumber: string;
  
  // Amount
  readonly totalAmount: number; // In minor units
  readonly currency: string;
  
  // Installments
  readonly installments: readonly Installment[];
  
  // Status
  readonly status: PaymentPlanStatus;
  
  // Approval
  readonly approvedAt: ISOTimestamp | null;
  readonly approvedBy: UserId | null;
  
  // Tracking
  readonly paidAmount: number;
  readonly remainingAmount: number;
  readonly nextDueDate: ISOTimestamp | null;
  readonly nextDueAmount: number | null;
  
  // Completion
  readonly completedAt: ISOTimestamp | null;
  
  // Default handling
  readonly defaultedAt: ISOTimestamp | null;
  readonly defaultReason: string | null;
  
  // Terms
  readonly terms: string | null;
  readonly notes: string | null;
}

/** Create a new payment plan */
export function createPaymentPlan(
  id: PaymentPlanId,
  data: {
    tenantId: TenantId;
    customerId: string;
    leaseId?: string;
    planNumber: string;
    totalAmount: number;
    currency?: string;
    installments: Omit<Installment, 'paidAmount' | 'paidAt' | 'status'>[];
    terms?: string;
    notes?: string;
  },
  createdBy: UserId
): PaymentPlanAgreement {
  const now = new Date().toISOString();
  
  const installments: Installment[] = data.installments.map(i => ({
    ...i,
    paidAmount: 0,
    paidAt: null,
    status: 'pending',
  }));
  
  const nextInstallment = installments[0];

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    leaseId: data.leaseId ?? null,
    planNumber: data.planNumber,
    totalAmount: data.totalAmount,
    currency: data.currency ?? 'USD',
    installments,
    status: 'draft',
    approvedAt: null,
    approvedBy: null,
    paidAmount: 0,
    remainingAmount: data.totalAmount,
    nextDueDate: nextInstallment?.dueDate ?? null,
    nextDueAmount: nextInstallment?.amount ?? null,
    completedAt: null,
    defaultedAt: null,
    defaultReason: null,
    terms: data.terms ?? null,
    notes: data.notes ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Approve payment plan */
export function approvePaymentPlan(
  plan: PaymentPlanAgreement,
  approvedBy: UserId
): PaymentPlanAgreement {
  const now = new Date().toISOString();
  return {
    ...plan,
    status: 'approved',
    approvedAt: now,
    approvedBy,
    updatedAt: now,
    updatedBy: approvedBy,
  };
}

/** Activate payment plan */
export function activatePaymentPlan(
  plan: PaymentPlanAgreement,
  updatedBy: UserId
): PaymentPlanAgreement {
  if (plan.status !== 'approved') {
    throw new Error('Payment plan must be approved before activation');
  }
  return {
    ...plan,
    status: 'active',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Record payment against an installment */
export function recordInstallmentPayment(
  plan: PaymentPlanAgreement,
  installmentNumber: number,
  amount: number,
  updatedBy: UserId
): PaymentPlanAgreement {
  const now = new Date().toISOString();
  
  const updatedInstallments = plan.installments.map(i => {
    if (i.number !== installmentNumber) return i;
    
    const newPaidAmount = i.paidAmount + amount;
    let newStatus: Installment['status'] = 'partial';
    
    if (newPaidAmount >= i.amount) {
      newStatus = 'paid';
    } else if (new Date(i.dueDate) < new Date()) {
      newStatus = 'overdue';
    }
    
    return {
      ...i,
      paidAmount: newPaidAmount,
      paidAt: newStatus === 'paid' ? now : i.paidAt,
      status: newStatus,
    };
  });
  
  const newPaidAmount = plan.paidAmount + amount;
  const newRemainingAmount = plan.totalAmount - newPaidAmount;
  
  // Find next unpaid installment
  const nextUnpaid = updatedInstallments.find(i => i.status !== 'paid' && i.status !== 'waived');
  
  // Check if completed
  const isCompleted = newRemainingAmount <= 0;
  
  return {
    ...plan,
    installments: updatedInstallments,
    paidAmount: newPaidAmount,
    remainingAmount: Math.max(0, newRemainingAmount),
    nextDueDate: nextUnpaid?.dueDate ?? null,
    nextDueAmount: nextUnpaid?.amount ?? null,
    status: isCompleted ? 'completed' : plan.status,
    completedAt: isCompleted ? now : plan.completedAt,
    updatedAt: now,
    updatedBy,
  };
}

/** Mark payment plan as defaulted */
export function markAsDefaulted(
  plan: PaymentPlanAgreement,
  reason: string,
  updatedBy: UserId
): PaymentPlanAgreement {
  const now = new Date().toISOString();
  return {
    ...plan,
    status: 'defaulted',
    defaultedAt: now,
    defaultReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

/** Generate payment plan number */
export function generatePaymentPlanNumber(tenantCode: string, year: number, sequence: number): string {
  return `PP-${tenantCode}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Calculate payment plan progress percentage */
export function calculateProgress(plan: PaymentPlanAgreement): number {
  if (plan.totalAmount === 0) return 100;
  return Math.round((plan.paidAmount / plan.totalAmount) * 100);
}

/** Check if any installment is overdue */
export function hasOverdueInstallments(plan: PaymentPlanAgreement): boolean {
  const now = new Date();
  return plan.installments.some(i => 
    i.status !== 'paid' && i.status !== 'waived' && new Date(i.dueDate) < now
  );
}
