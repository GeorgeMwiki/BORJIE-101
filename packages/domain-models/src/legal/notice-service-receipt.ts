/**
 * Notice Service Receipt domain model
 * Records delivery attempts and confirmations for notices
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  DeliveryMethod,
  DeliveryMethodSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type NoticeServiceReceiptId = Brand<string, 'NoticeServiceReceiptId'>;
export type NoticeId = Brand<string, 'NoticeId'>;

export function asNoticeServiceReceiptId(id: string): NoticeServiceReceiptId {
  return id as NoticeServiceReceiptId;
}

// ============================================================================
// Notice Service Receipt Zod Schema
// ============================================================================

export const GpsCoordinatesSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional(),
  timestamp: z.string().datetime(),
});
export type GpsCoordinates = z.infer<typeof GpsCoordinatesSchema>;

export const DeliveryProofSchema = z.object({
  type: z.enum(['signature', 'photo', 'recording', 'screenshot', 'confirmation_code']),
  url: z.string().url(),
  capturedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type DeliveryProof = z.infer<typeof DeliveryProofSchema>;

export const NoticeServiceReceiptSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  noticeId: z.string(),
  
  // Attempt info
  attemptNumber: z.number(),
  deliveryMethod: DeliveryMethodSchema,
  
  // Recipient
  recipientName: z.string().nullable(),
  recipientPhone: z.string().nullable(),
  recipientEmail: z.string().email().nullable(),
  recipientAddress: z.string().nullable(),
  
  // Delivery status
  wasDelivered: z.boolean(),
  deliveredAt: z.string().datetime().nullable(),
  
  // Physical delivery proof
  physicalDeliveryProof: DeliveryProofSchema.nullable(),
  recipientSignature: z.string().url().nullable(),
  recipientIdVerified: z.boolean().default(false),
  recipientIdType: z.string().nullable(),
  recipientIdNumber: z.string().nullable(),
  
  // Electronic delivery proof
  electronicDeliveryProof: z.object({
    messageId: z.string().nullable(),
    deliveryReport: z.record(z.string(), z.unknown()).nullable(),
    readReceipt: z.boolean().nullable(),
    readAt: z.string().datetime().nullable(),
    bounceReason: z.string().nullable(),
  }).nullable(),
  
  // Posted delivery proof
  postedDeliveryProof: z.object({
    photoUrl: z.string().url(),
    witnessName: z.string().nullable(),
    witnessPhone: z.string().nullable(),
    postingLocation: z.string().nullable(),
  }).nullable(),
  
  // Tracking
  trackingNumber: z.string().nullable(),
  carrierName: z.string().nullable(),
  carrierTrackingUrl: z.string().url().nullable(),
  
  // Failure details
  failureReason: z.string().nullable(),
  failureCategory: z.enum([
    'recipient_not_found',
    'refused',
    'address_invalid',
    'technical_error',
    'carrier_failure',
    'other',
  ]).nullable(),
  
  // GPS verification
  gpsCoordinates: GpsCoordinatesSchema.nullable(),
  gpsVerified: z.boolean().default(false),
  
  // Agent/Courier info
  deliveryAgentName: z.string().nullable(),
  deliveryAgentId: z.string().nullable(),
  deliveryAgentPhone: z.string().nullable(),
  
  // Notes
  notes: z.string().nullable(),
  
  // Verification
  isVerified: z.boolean().default(false),
  verifiedAt: z.string().datetime().nullable(),
  verifiedBy: z.string().nullable(),
  
  // Timing
  attemptedAt: z.string().datetime(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type NoticeServiceReceiptData = z.infer<typeof NoticeServiceReceiptSchema>;

// ============================================================================
// Notice Service Receipt Interface
// ============================================================================

export interface NoticeServiceReceipt extends EntityMetadata {
  readonly id: NoticeServiceReceiptId;
  readonly tenantId: TenantId;
  readonly noticeId: NoticeId;
  
  readonly attemptNumber: number;
  readonly deliveryMethod: DeliveryMethod;
  
  readonly recipientName: string | null;
  readonly recipientPhone: string | null;
  readonly recipientEmail: string | null;
  readonly recipientAddress: string | null;
  
  readonly wasDelivered: boolean;
  readonly deliveredAt: ISOTimestamp | null;
  
  readonly physicalDeliveryProof: DeliveryProof | null;
  readonly recipientSignature: string | null;
  readonly recipientIdVerified: boolean;
  readonly recipientIdType: string | null;
  readonly recipientIdNumber: string | null;
  
  readonly electronicDeliveryProof: {
    messageId: string | null;
    deliveryReport: Record<string, unknown> | null;
    readReceipt: boolean | null;
    readAt: ISOTimestamp | null;
    bounceReason: string | null;
  } | null;
  
  readonly postedDeliveryProof: {
    photoUrl: string;
    witnessName: string | null;
    witnessPhone: string | null;
    postingLocation: string | null;
  } | null;
  
  readonly trackingNumber: string | null;
  readonly carrierName: string | null;
  readonly carrierTrackingUrl: string | null;
  
  readonly failureReason: string | null;
  readonly failureCategory: 'recipient_not_found' | 'refused' | 'address_invalid' | 'technical_error' | 'carrier_failure' | 'other' | null;
  
  readonly gpsCoordinates: GpsCoordinates | null;
  readonly gpsVerified: boolean;
  
  readonly deliveryAgentName: string | null;
  readonly deliveryAgentId: string | null;
  readonly deliveryAgentPhone: string | null;
  
  readonly notes: string | null;
  
  readonly isVerified: boolean;
  readonly verifiedAt: ISOTimestamp | null;
  readonly verifiedBy: UserId | null;
  
  readonly attemptedAt: ISOTimestamp;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createNoticeServiceReceipt(
  id: NoticeServiceReceiptId,
  data: {
    tenantId: TenantId;
    noticeId: NoticeId;
    attemptNumber: number;
    deliveryMethod: DeliveryMethod;
    recipientName?: string;
    recipientPhone?: string;
    recipientEmail?: string;
    recipientAddress?: string;
    deliveryAgentName?: string;
    deliveryAgentId?: string;
    deliveryAgentPhone?: string;
    notes?: string;
  },
  createdBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    noticeId: data.noticeId,
    
    attemptNumber: data.attemptNumber,
    deliveryMethod: data.deliveryMethod,
    
    recipientName: data.recipientName ?? null,
    recipientPhone: data.recipientPhone ?? null,
    recipientEmail: data.recipientEmail ?? null,
    recipientAddress: data.recipientAddress ?? null,
    
    wasDelivered: false,
    deliveredAt: null,
    
    physicalDeliveryProof: null,
    recipientSignature: null,
    recipientIdVerified: false,
    recipientIdType: null,
    recipientIdNumber: null,
    
    electronicDeliveryProof: null,
    
    postedDeliveryProof: null,
    
    trackingNumber: null,
    carrierName: null,
    carrierTrackingUrl: null,
    
    failureReason: null,
    failureCategory: null,
    
    gpsCoordinates: null,
    gpsVerified: false,
    
    deliveryAgentName: data.deliveryAgentName ?? null,
    deliveryAgentId: data.deliveryAgentId ?? null,
    deliveryAgentPhone: data.deliveryAgentPhone ?? null,
    
    notes: data.notes ?? null,
    
    isVerified: false,
    verifiedAt: null,
    verifiedBy: null,
    
    attemptedAt: now,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function recordPhysicalDelivery(
  receipt: NoticeServiceReceipt,
  data: {
    proof: DeliveryProof;
    signatureUrl?: string;
    idVerified?: boolean;
    idType?: string;
    idNumber?: string;
    gpsCoordinates?: GpsCoordinates;
  },
  updatedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    wasDelivered: true,
    deliveredAt: now,
    physicalDeliveryProof: data.proof,
    recipientSignature: data.signatureUrl ?? null,
    recipientIdVerified: data.idVerified ?? false,
    recipientIdType: data.idType ?? null,
    recipientIdNumber: data.idNumber ?? null,
    gpsCoordinates: data.gpsCoordinates ?? null,
    gpsVerified: !!data.gpsCoordinates,
    updatedAt: now,
    updatedBy,
  };
}

export function recordElectronicDelivery(
  receipt: NoticeServiceReceipt,
  data: {
    messageId: string;
    deliveryReport?: Record<string, unknown>;
  },
  updatedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    wasDelivered: true,
    deliveredAt: now,
    electronicDeliveryProof: {
      messageId: data.messageId,
      deliveryReport: data.deliveryReport ?? null,
      readReceipt: null,
      readAt: null,
      bounceReason: null,
    },
    updatedAt: now,
    updatedBy,
  };
}

export function recordReadReceipt(
  receipt: NoticeServiceReceipt,
  updatedBy: UserId
): NoticeServiceReceipt {
  if (!receipt.electronicDeliveryProof) {
    throw new Error('No electronic delivery proof exists');
  }
  const now = new Date().toISOString();
  return {
    ...receipt,
    electronicDeliveryProof: {
      ...receipt.electronicDeliveryProof,
      readReceipt: true,
      readAt: now,
    },
    updatedAt: now,
    updatedBy,
  };
}

export function recordPostedDelivery(
  receipt: NoticeServiceReceipt,
  data: {
    photoUrl: string;
    witnessName?: string;
    witnessPhone?: string;
    postingLocation?: string;
    gpsCoordinates?: GpsCoordinates;
  },
  updatedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    wasDelivered: true,
    deliveredAt: now,
    postedDeliveryProof: {
      photoUrl: data.photoUrl,
      witnessName: data.witnessName ?? null,
      witnessPhone: data.witnessPhone ?? null,
      postingLocation: data.postingLocation ?? null,
    },
    gpsCoordinates: data.gpsCoordinates ?? null,
    gpsVerified: !!data.gpsCoordinates,
    updatedAt: now,
    updatedBy,
  };
}

export function recordDeliveryFailure(
  receipt: NoticeServiceReceipt,
  reason: string,
  category: NoticeServiceReceipt['failureCategory'],
  updatedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    wasDelivered: false,
    failureReason: reason,
    failureCategory: category,
    updatedAt: now,
    updatedBy,
  };
}

export function setTrackingInfo(
  receipt: NoticeServiceReceipt,
  trackingNumber: string,
  carrierName: string,
  trackingUrl: string | undefined,
  updatedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    trackingNumber,
    carrierName,
    carrierTrackingUrl: trackingUrl ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function verifyReceipt(
  receipt: NoticeServiceReceipt,
  verifiedBy: UserId
): NoticeServiceReceipt {
  const now = new Date().toISOString();
  return {
    ...receipt,
    isVerified: true,
    verifiedAt: now,
    verifiedBy,
    updatedAt: now,
    updatedBy: verifiedBy,
  };
}

export function isSuccessfulDelivery(receipt: NoticeServiceReceipt): boolean {
  return receipt.wasDelivered && !receipt.failureReason;
}

export function hasReadConfirmation(receipt: NoticeServiceReceipt): boolean {
  return receipt.electronicDeliveryProof?.readReceipt === true;
}

export function hasGpsVerification(receipt: NoticeServiceReceipt): boolean {
  return receipt.gpsVerified && receipt.gpsCoordinates !== null;
}
