/**
 * Arrears Case domain model
 * Tracks overdue accounts and collection actions
 */

import { z } from 'zod';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  UserId,
  ArrearsCaseId,
  PaymentPlanId,
  EntityMetadata,
  SoftDeletable,
  ISOTimestamp,
} from '../common/types';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const ArrearsStatusSchema = z.enum([
  'open',
  'under_review',
  'payment_plan',
  'collection',
  'legal_action',
  'resolved',
  'written_off',
  'closed',
]);
export type ArrearsStatus = z.infer<typeof ArrearsStatusSchema>;

export const ArrearsSeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]);
export type ArrearsSeverity = z.infer<typeof ArrearsSeveritySchema>;

export const ArrearsActionSchema = z.object({
  id: z.string(),
  actionType: z.string(),
  description: z.string(),
  performedAt: z.string().datetime(),
  performedBy: z.string(),
  outcome: z.string().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ArrearsAction = z.infer<typeof ArrearsActionSchema>;

export const ArrearsCaseSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  paymentPlanId: z.string().optional(),
  
  // Identity
  caseNumber: z.string(),
  
  // Status
  status: ArrearsStatusSchema,
  severity: ArrearsSeveritySchema,
  
  // Amounts
  totalArrearsAmount: z.number(),
  currentBalance: z.number(),
  currency: z.string().default('USD'),
  
  // Age
  oldestInvoiceDate: z.string().datetime(),
  daysOverdue: z.number(),
  
  // Breakdown by age bucket
  ageBucket0to30: z.number().default(0),
  ageBucket31to60: z.number().default(0),
  ageBucket61to90: z.number().default(0),
  ageBucketOver90: z.number().default(0),
  
  // Invoice count
  overdueInvoiceCount: z.number(),
  
  // Actions
  actions: z.array(ArrearsActionSchema).default([]),
  lastActionAt: z.string().datetime().optional(),
  nextActionDue: z.string().datetime().optional(),
  nextActionType: z.string().optional(),
  
  // Assignment
  assignedTo: z.string().optional(),
  assignedAt: z.string().datetime().optional(),
  
  // Contact attempts
  contactAttempts: z.number().default(0),
  lastContactAt: z.string().datetime().optional(),
  lastContactMethod: z.string().optional(),
  lastContactOutcome: z.string().optional(),
  
  // Promises
  promiseToPayDate: z.string().datetime().optional(),
  promiseToPayAmount: z.number().optional(),
  promiseBroken: z.boolean().default(false),
  
  // Resolution
  resolvedAt: z.string().datetime().optional(),
  resolvedBy: z.string().optional(),
  resolutionType: z.string().optional(),
  resolutionNotes: z.string().optional(),
  
  // Write-off
  writtenOffAt: z.string().datetime().optional(),
  writtenOffBy: z.string().optional(),
  writtenOffAmount: z.number().optional(),
  writeOffReason: z.string().optional(),
  
  // Notes
  notes: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ArrearsCaseData = z.infer<typeof ArrearsCaseSchema>;

// ============================================================================
// Arrears Case Interface
// ============================================================================

export interface ArrearsCase extends EntityMetadata, SoftDeletable {
  readonly id: ArrearsCaseId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly paymentPlanId: PaymentPlanId | null;
  
  readonly caseNumber: string;
  
  readonly status: ArrearsStatus;
  readonly severity: ArrearsSeverity;
  
  readonly totalArrearsAmount: number;
  readonly currentBalance: number;
  readonly currency: string;
  
  readonly oldestInvoiceDate: ISOTimestamp;
  readonly daysOverdue: number;
  
  readonly ageBucket0to30: number;
  readonly ageBucket31to60: number;
  readonly ageBucket61to90: number;
  readonly ageBucketOver90: number;
  
  readonly overdueInvoiceCount: number;
  
  readonly actions: readonly ArrearsAction[];
  readonly lastActionAt: ISOTimestamp | null;
  readonly nextActionDue: ISOTimestamp | null;
  readonly nextActionType: string | null;
  
  readonly assignedTo: UserId | null;
  readonly assignedAt: ISOTimestamp | null;
  
  readonly contactAttempts: number;
  readonly lastContactAt: ISOTimestamp | null;
  readonly lastContactMethod: string | null;
  readonly lastContactOutcome: string | null;
  
  readonly promiseToPayDate: ISOTimestamp | null;
  readonly promiseToPayAmount: number | null;
  readonly promiseBroken: boolean;
  
  readonly resolvedAt: ISOTimestamp | null;
  readonly resolvedBy: UserId | null;
  readonly resolutionType: string | null;
  readonly resolutionNotes: string | null;
  
  readonly writtenOffAt: ISOTimestamp | null;
  readonly writtenOffBy: UserId | null;
  readonly writtenOffAmount: number | null;
  readonly writeOffReason: string | null;
  
  readonly notes: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createArrearsCase(
  id: ArrearsCaseId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    caseNumber: string;
    totalArrearsAmount: number;
    oldestInvoiceDate: Date;
    daysOverdue: number;
    overdueInvoiceCount: number;
    currency?: string;
    leaseId?: LeaseId;
    propertyId?: PropertyId;
    unitId?: UnitId;
    notes?: string;
  },
  createdBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  
  // Calculate severity based on days overdue
  let severity: ArrearsSeverity;
  if (data.daysOverdue <= 30) {
    severity = 'low';
  } else if (data.daysOverdue <= 60) {
    severity = 'medium';
  } else if (data.daysOverdue <= 90) {
    severity = 'high';
  } else {
    severity = 'critical';
  }

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    leaseId: data.leaseId ?? null,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    paymentPlanId: null,
    
    caseNumber: data.caseNumber,
    
    status: 'open',
    severity,
    
    totalArrearsAmount: data.totalArrearsAmount,
    currentBalance: data.totalArrearsAmount,
    currency: data.currency ?? 'USD',
    
    oldestInvoiceDate: data.oldestInvoiceDate.toISOString(),
    daysOverdue: data.daysOverdue,
    
    ageBucket0to30: 0,
    ageBucket31to60: 0,
    ageBucket61to90: 0,
    ageBucketOver90: 0,
    
    overdueInvoiceCount: data.overdueInvoiceCount,
    
    actions: [],
    lastActionAt: null,
    nextActionDue: null,
    nextActionType: null,
    
    assignedTo: null,
    assignedAt: null,
    
    contactAttempts: 0,
    lastContactAt: null,
    lastContactMethod: null,
    lastContactOutcome: null,
    
    promiseToPayDate: null,
    promiseToPayAmount: null,
    promiseBroken: false,
    
    resolvedAt: null,
    resolvedBy: null,
    resolutionType: null,
    resolutionNotes: null,
    
    writtenOffAt: null,
    writtenOffBy: null,
    writtenOffAmount: null,
    writeOffReason: null,
    
    notes: data.notes ?? null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function addAction(
  arrearsCase: ArrearsCase,
  action: ArrearsAction,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    actions: [...arrearsCase.actions, action],
    lastActionAt: action.performedAt,
    updatedAt: now,
    updatedBy,
  };
}

export function assignCase(
  arrearsCase: ArrearsCase,
  assignedTo: UserId,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    assignedTo,
    assignedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

export function recordContactAttempt(
  arrearsCase: ArrearsCase,
  method: string,
  outcome: string,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    contactAttempts: arrearsCase.contactAttempts + 1,
    lastContactAt: now,
    lastContactMethod: method,
    lastContactOutcome: outcome,
    updatedAt: now,
    updatedBy,
  };
}

export function recordPromiseToPay(
  arrearsCase: ArrearsCase,
  promiseDate: Date,
  promiseAmount: number,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    promiseToPayDate: promiseDate.toISOString(),
    promiseToPayAmount: promiseAmount,
    promiseBroken: false,
    updatedAt: now,
    updatedBy,
  };
}

export function markPromiseBroken(
  arrearsCase: ArrearsCase,
  updatedBy: UserId
): ArrearsCase {
  return {
    ...arrearsCase,
    promiseBroken: true,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function resolveCase(
  arrearsCase: ArrearsCase,
  resolutionType: string,
  resolutionNotes: string,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    status: 'resolved',
    resolvedAt: now,
    resolvedBy: updatedBy,
    resolutionType,
    resolutionNotes,
    updatedAt: now,
    updatedBy,
  };
}

export function writeOffCase(
  arrearsCase: ArrearsCase,
  writeOffAmount: number,
  reason: string,
  updatedBy: UserId
): ArrearsCase {
  const now = new Date().toISOString();
  return {
    ...arrearsCase,
    status: 'written_off',
    writtenOffAt: now,
    writtenOffBy: updatedBy,
    writtenOffAmount: writeOffAmount,
    writeOffReason: reason,
    currentBalance: arrearsCase.currentBalance - writeOffAmount,
    updatedAt: now,
    updatedBy,
  };
}

export function escalateToLegal(
  arrearsCase: ArrearsCase,
  updatedBy: UserId
): ArrearsCase {
  if (arrearsCase.status === 'resolved' || arrearsCase.status === 'written_off') {
    throw new Error('Cannot escalate resolved or written-off cases');
  }
  return {
    ...arrearsCase,
    status: 'legal_action',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function calculateSeverity(daysOverdue: number, amount: number): ArrearsSeverity {
  if (daysOverdue > 90 || amount > 100000) {
    return 'critical';
  } else if (daysOverdue > 60 || amount > 50000) {
    return 'high';
  } else if (daysOverdue > 30 || amount > 20000) {
    return 'medium';
  }
  return 'low';
}
