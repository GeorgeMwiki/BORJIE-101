/**
 * Verification Badge domain model
 * Verification badges awarded upon document validation
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';
import { BadgeType, BadgeTypeSchema } from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type VerificationBadgeId = Brand<string, 'VerificationBadgeId'>;
export type IdentityProfileId = Brand<string, 'IdentityProfileId'>;

export function asVerificationBadgeId(id: string): VerificationBadgeId {
  return id as VerificationBadgeId;
}

export function asIdentityProfileId(id: string): IdentityProfileId {
  return id as IdentityProfileId;
}

// ============================================================================
// Zod Schema
// ============================================================================

export const VerificationBadgeSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  identityProfileId: z.string().nullable(),

  badgeType: BadgeTypeSchema,
  isActive: z.boolean().default(true),

  awardedAt: z.string().datetime(),
  awardedBy: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),

  revokedAt: z.string().datetime().nullable(),
  revokedBy: z.string().nullable(),
  revocationReason: z.string().nullable(),

  evidenceDocuments: z.array(z.string()).default([]),
  verificationMethod: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type VerificationBadgeData = z.infer<typeof VerificationBadgeSchema>;

// ============================================================================
// Interface
// ============================================================================

export interface VerificationBadge {
  readonly id: VerificationBadgeId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly identityProfileId: IdentityProfileId | null;

  readonly badgeType: BadgeType;
  readonly isActive: boolean;

  readonly awardedAt: ISOTimestamp;
  readonly awardedBy: UserId | null;
  readonly expiresAt: ISOTimestamp | null;

  readonly revokedAt: ISOTimestamp | null;
  readonly revokedBy: UserId | null;
  readonly revocationReason: string | null;

  readonly evidenceDocuments: readonly string[];
  readonly verificationMethod: string | null;
  readonly metadata: Record<string, unknown>;

  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createVerificationBadge(
  id: VerificationBadgeId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    badgeType: BadgeType;
    identityProfileId?: IdentityProfileId;
    evidenceDocuments?: string[];
    verificationMethod?: string;
    expiresAt?: ISOTimestamp;
    metadata?: Record<string, unknown>;
  },
  awardedBy: UserId
): VerificationBadge {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    identityProfileId: data.identityProfileId ?? null,

    badgeType: data.badgeType,
    isActive: true,

    awardedAt: now,
    awardedBy,
    expiresAt: data.expiresAt ?? null,

    revokedAt: null,
    revokedBy: null,
    revocationReason: null,

    evidenceDocuments: data.evidenceDocuments ?? [],
    verificationMethod: data.verificationMethod ?? null,
    metadata: data.metadata ?? {},

    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function revokeBadge(
  badge: VerificationBadge,
  reason: string,
  revokedBy: UserId
): VerificationBadge {
  const now = new Date().toISOString();
  return {
    ...badge,
    isActive: false,
    revokedAt: now,
    revokedBy,
    revocationReason: reason,
    updatedAt: now,
  };
}

export function renewBadge(
  badge: VerificationBadge,
  newExpiresAt: ISOTimestamp | null,
  updatedBy: UserId
): VerificationBadge {
  const now = new Date().toISOString();
  return {
    ...badge,
    isActive: true,
    expiresAt: newExpiresAt,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    updatedAt: now,
  };
}

export function addEvidenceDocument(
  badge: VerificationBadge,
  documentId: string
): VerificationBadge {
  const now = new Date().toISOString();
  return {
    ...badge,
    evidenceDocuments: [...badge.evidenceDocuments, documentId],
    updatedAt: now,
  };
}

export function isBadgeActive(badge: VerificationBadge): boolean {
  if (!badge.isActive) return false;
  if (badge.revokedAt !== null) return false;
  if (badge.expiresAt !== null && new Date(badge.expiresAt) < new Date()) return false;
  return true;
}

export function isBadgeExpired(badge: VerificationBadge): boolean {
  if (!badge.expiresAt) return false;
  return new Date(badge.expiresAt) < new Date();
}

export function getDaysUntilExpiry(badge: VerificationBadge): number | null {
  if (!badge.expiresAt) return null;
  const now = new Date();
  const expiry = new Date(badge.expiresAt);
  const diffTime = expiry.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function isIdentityBadge(badge: VerificationBadge): boolean {
  return badge.badgeType === 'identity_verified';
}

export function isKycCompleteBadge(badge: VerificationBadge): boolean {
  return badge.badgeType === 'kyc_complete';
}

export function isPremiumBadge(badge: VerificationBadge): boolean {
  return badge.badgeType === 'premium_tenant';
}

/** Get badge display name */
export function getBadgeDisplayName(badgeType: BadgeType): string {
  const displayNames: Record<BadgeType, string> = {
    identity_verified: 'Identity Verified',
    address_verified: 'Address Verified',
    income_verified: 'Income Verified',
    employer_verified: 'Employer Verified',
    references_verified: 'References Verified',
    kyc_complete: 'KYC Complete',
    premium_tenant: 'Premium Tenant',
  };
  return displayNames[badgeType];
}

/** Get badge description */
export function getBadgeDescription(badgeType: BadgeType): string {
  const descriptions: Record<BadgeType, string> = {
    identity_verified: 'Customer identity has been verified through official documents',
    address_verified: 'Customer current address has been verified',
    income_verified: 'Customer income has been verified through documentation',
    employer_verified: 'Customer employment has been verified',
    references_verified: 'Customer references have been verified',
    kyc_complete: 'Full KYC process has been completed successfully',
    premium_tenant: 'Customer has been awarded premium tenant status',
  };
  return descriptions[badgeType];
}

/** Get badge priority for display ordering */
export function getBadgePriority(badgeType: BadgeType): number {
  const priorities: Record<BadgeType, number> = {
    premium_tenant: 1,
    kyc_complete: 2,
    identity_verified: 3,
    income_verified: 4,
    employer_verified: 5,
    address_verified: 6,
    references_verified: 7,
  };
  return priorities[badgeType];
}
