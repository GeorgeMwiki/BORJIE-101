/**
 * Notice domain model
 * Represents formal notices sent to tenants/customers
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  CustomerId,
  LeaseId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  NoticeType,
  NoticeTypeSchema,
  NoticeStatus,
  NoticeStatusSchema,
  CurrencyCode,
  CurrencyCodeSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type NoticeId = Brand<string, 'NoticeId'>;
export type CaseId = Brand<string, 'CaseId'>;

export function asNoticeId(id: string): NoticeId {
  return id as NoticeId;
}

// ============================================================================
// Notice Zod Schema
// ============================================================================

export const NoticeAttachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().url(),
  type: z.string(),
  size: z.number().optional(),
});
export type NoticeAttachment = z.infer<typeof NoticeAttachmentSchema>;

export const NoticeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  propertyId: z.string().nullable(),
  unitId: z.string().nullable(),
  customerId: z.string().nullable(),
  leaseId: z.string().nullable(),
  caseId: z.string().nullable(),
  
  // Identification
  noticeNumber: z.string(),
  
  // Classification
  noticeType: NoticeTypeSchema,
  status: NoticeStatusSchema,
  
  // Content
  subject: z.string(),
  content: z.string(),
  
  // Template
  templateId: z.string().nullable(),
  templateVersion: z.string().nullable(),
  templateVariables: z.record(z.string(), z.unknown()).default({}),
  
  // Financial
  amountDue: z.number().nullable(),
  currency: CurrencyCodeSchema.default('USD'),
  
  // Dates
  issueDate: z.string().datetime(),
  effectiveDate: z.string().datetime().nullable(),
  expiryDate: z.string().datetime().nullable(),
  complianceDeadline: z.string().datetime().nullable(),
  noticePeriodDays: z.number().nullable(),
  
  // Legal compliance
  legalReference: z.string().nullable(),
  jurisdictionCode: z.string().nullable(),
  isLegallyRequired: z.boolean().default(false),
  
  // Approval workflow
  requiresApproval: z.boolean().default(false),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.string().nullable(),
  rejectedAt: z.string().datetime().nullable(),
  rejectedBy: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  
  // Scheduling
  scheduledSendAt: z.string().datetime().nullable(),
  
  // Sending
  sentAt: z.string().datetime().nullable(),
  sentBy: z.string().nullable(),
  sentVia: z.array(z.string()).default([]),
  
  // Document
  documentUrl: z.string().url().nullable(),
  documentHash: z.string().nullable(),
  
  // Attachments
  attachments: z.array(NoticeAttachmentSchema).default([]),
  
  // Acknowledgment
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedBy: z.string().nullable(),
  acknowledgmentMethod: z.string().nullable(),
  
  // Voiding
  voidedAt: z.string().datetime().nullable(),
  voidedBy: z.string().nullable(),
  voidReason: z.string().nullable(),
  
  // Follow-up
  followUpDate: z.string().datetime().nullable(),
  followUpNotes: z.string().nullable(),
  followUpNoticeId: z.string().nullable(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type NoticeData = z.infer<typeof NoticeSchema>;

// ============================================================================
// Notice Interface
// ============================================================================

export interface Notice extends EntityMetadata {
  readonly id: NoticeId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly customerId: CustomerId | null;
  readonly leaseId: LeaseId | null;
  readonly caseId: CaseId | null;
  
  readonly noticeNumber: string;
  
  readonly noticeType: NoticeType;
  readonly status: NoticeStatus;
  
  readonly subject: string;
  readonly content: string;
  
  readonly templateId: string | null;
  readonly templateVersion: string | null;
  readonly templateVariables: Record<string, unknown>;
  
  readonly amountDue: number | null;
  readonly currency: CurrencyCode;
  
  readonly issueDate: ISOTimestamp;
  readonly effectiveDate: ISOTimestamp | null;
  readonly expiryDate: ISOTimestamp | null;
  readonly complianceDeadline: ISOTimestamp | null;
  readonly noticePeriodDays: number | null;
  
  readonly legalReference: string | null;
  readonly jurisdictionCode: string | null;
  readonly isLegallyRequired: boolean;
  
  readonly requiresApproval: boolean;
  readonly approvedAt: ISOTimestamp | null;
  readonly approvedBy: UserId | null;
  readonly rejectedAt: ISOTimestamp | null;
  readonly rejectedBy: UserId | null;
  readonly rejectionReason: string | null;
  
  readonly scheduledSendAt: ISOTimestamp | null;
  
  readonly sentAt: ISOTimestamp | null;
  readonly sentBy: UserId | null;
  readonly sentVia: readonly string[];
  
  readonly documentUrl: string | null;
  readonly documentHash: string | null;
  
  readonly attachments: readonly NoticeAttachment[];
  
  readonly acknowledgedAt: ISOTimestamp | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgmentMethod: string | null;
  
  readonly voidedAt: ISOTimestamp | null;
  readonly voidedBy: UserId | null;
  readonly voidReason: string | null;
  
  readonly followUpDate: ISOTimestamp | null;
  readonly followUpNotes: string | null;
  readonly followUpNoticeId: NoticeId | null;
  
  readonly metadata: Record<string, unknown>;
  
  // Soft delete
  readonly deletedAt: ISOTimestamp | null;
  readonly deletedBy: UserId | null;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createNotice(
  id: NoticeId,
  data: {
    tenantId: TenantId;
    noticeNumber: string;
    noticeType: NoticeType;
    subject: string;
    content: string;
    propertyId?: PropertyId;
    unitId?: UnitId;
    customerId?: CustomerId;
    leaseId?: LeaseId;
    caseId?: CaseId;
    templateId?: string;
    templateVersion?: string;
    templateVariables?: Record<string, unknown>;
    amountDue?: number;
    currency?: CurrencyCode;
    effectiveDate?: Date;
    expiryDate?: Date;
    complianceDeadline?: Date;
    noticePeriodDays?: number;
    legalReference?: string;
    jurisdictionCode?: string;
    isLegallyRequired?: boolean;
    requiresApproval?: boolean;
    scheduledSendAt?: Date;
    attachments?: NoticeAttachment[];
  },
  createdBy: UserId
): Notice {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    customerId: data.customerId ?? null,
    leaseId: data.leaseId ?? null,
    caseId: data.caseId ?? null,
    
    noticeNumber: data.noticeNumber,
    
    noticeType: data.noticeType,
    status: data.requiresApproval ? 'pending_approval' : 'draft',
    
    subject: data.subject,
    content: data.content,
    
    templateId: data.templateId ?? null,
    templateVersion: data.templateVersion ?? null,
    templateVariables: data.templateVariables ?? {},
    
    amountDue: data.amountDue ?? null,
    currency: data.currency ?? 'USD',
    
    issueDate: now,
    effectiveDate: data.effectiveDate?.toISOString() ?? null,
    expiryDate: data.expiryDate?.toISOString() ?? null,
    complianceDeadline: data.complianceDeadline?.toISOString() ?? null,
    noticePeriodDays: data.noticePeriodDays ?? null,
    
    legalReference: data.legalReference ?? null,
    jurisdictionCode: data.jurisdictionCode ?? null,
    isLegallyRequired: data.isLegallyRequired ?? false,
    
    requiresApproval: data.requiresApproval ?? false,
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectionReason: null,
    
    scheduledSendAt: data.scheduledSendAt?.toISOString() ?? null,
    
    sentAt: null,
    sentBy: null,
    sentVia: [],
    
    documentUrl: null,
    documentHash: null,
    
    attachments: data.attachments ?? [],
    
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgmentMethod: null,
    
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    
    followUpDate: null,
    followUpNotes: null,
    followUpNoticeId: null,
    
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

export function approveNotice(notice: Notice, approvedBy: UserId): Notice {
  if (notice.status !== 'pending_approval') {
    throw new Error('Can only approve notices pending approval');
  }
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'approved',
    approvedAt: now,
    approvedBy,
    updatedAt: now,
    updatedBy: approvedBy,
  };
}

export function rejectNotice(
  notice: Notice,
  reason: string,
  rejectedBy: UserId
): Notice {
  if (notice.status !== 'pending_approval') {
    throw new Error('Can only reject notices pending approval');
  }
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'cancelled',
    rejectedAt: now,
    rejectedBy,
    rejectionReason: reason,
    updatedAt: now,
    updatedBy: rejectedBy,
  };
}

export function scheduleNotice(
  notice: Notice,
  sendAt: Date,
  updatedBy: UserId
): Notice {
  if (notice.status !== 'draft' && notice.status !== 'approved') {
    throw new Error('Can only schedule draft or approved notices');
  }
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'scheduled',
    scheduledSendAt: sendAt.toISOString(),
    updatedAt: now,
    updatedBy,
  };
}

export function sendNotice(
  notice: Notice,
  channels: string[],
  sentBy: UserId
): Notice {
  if (!['draft', 'approved', 'scheduled'].includes(notice.status)) {
    throw new Error('Can only send draft, approved, or scheduled notices');
  }
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'sent',
    sentAt: now,
    sentBy,
    sentVia: channels,
    updatedAt: now,
    updatedBy: sentBy,
  };
}

export function markDelivered(notice: Notice, updatedBy: UserId): Notice {
  if (notice.status !== 'sent') {
    throw new Error('Can only mark sent notices as delivered');
  }
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'delivered',
    updatedAt: now,
    updatedBy,
  };
}

export function recordAcknowledgment(
  notice: Notice,
  acknowledgedBy: string,
  method: string,
  updatedBy: UserId
): Notice {
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'acknowledged',
    acknowledgedAt: now,
    acknowledgedBy,
    acknowledgmentMethod: method,
    updatedAt: now,
    updatedBy,
  };
}

export function voidNotice(
  notice: Notice,
  reason: string,
  voidedBy: UserId
): Notice {
  const now = new Date().toISOString();
  return {
    ...notice,
    status: 'voided',
    voidedAt: now,
    voidedBy,
    voidReason: reason,
    updatedAt: now,
    updatedBy: voidedBy,
  };
}

export function setDocumentUrl(
  notice: Notice,
  url: string,
  hash: string | undefined,
  updatedBy: UserId
): Notice {
  const now = new Date().toISOString();
  return {
    ...notice,
    documentUrl: url,
    documentHash: hash ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function isExpired(notice: Notice): boolean {
  if (!notice.expiryDate) return false;
  return new Date(notice.expiryDate) < new Date();
}

export function isComplianceDeadlinePassed(notice: Notice): boolean {
  if (!notice.complianceDeadline) return false;
  return new Date(notice.complianceDeadline) < new Date();
}

export function canBeSent(notice: Notice): boolean {
  return ['draft', 'approved', 'scheduled'].includes(notice.status);
}

export function generateNoticeNumber(
  tenantCode: string,
  noticeType: NoticeType,
  sequenceNumber: number
): string {
  const typePrefix = noticeType.slice(0, 3).toUpperCase();
  const year = new Date().getFullYear().toString().slice(-2);
  const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  const paddedSequence = sequenceNumber.toString().padStart(4, '0');
  return `${tenantCode}-N${typePrefix}-${year}${month}${paddedSequence}`;
}
