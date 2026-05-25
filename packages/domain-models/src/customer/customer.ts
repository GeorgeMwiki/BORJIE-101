/**
 * Customer domain model
 * Represents a tenant/renter in the system
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { CustomerId } from '../payments/payment-intent';

export type { CustomerId } from '../payments/payment-intent';
export { asCustomerId } from '../payments/payment-intent';

/** Customer status */
export type CustomerStatus = 'active' | 'inactive' | 'pending_verification' | 'blacklisted';

/** ID document type */
export type IdDocumentType = 'national_id' | 'passport' | 'drivers_license' | 'alien_id';

/** Emergency contact */
export interface EmergencyContact {
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  readonly email: string | null;
}

/** Customer profile */
export interface CustomerProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly alternatePhone: string | null;
  readonly dateOfBirth: ISOTimestamp | null;
  readonly idDocumentType: IdDocumentType | null;
  readonly idDocumentNumber: string | null; // Encrypted
  readonly nationality: string | null;
  readonly occupation: string | null;
  readonly employer: string | null;
  readonly avatarUrl: string | null;
}

/**
 * Customer entity
 */
export interface Customer extends EntityMetadata, SoftDeletable {
  readonly id: CustomerId;
  readonly tenantId: TenantId;
  readonly userId: UserId | null; // Link to auth user
  readonly customerNumber: string; // e.g., "CUST-2024-0001"
  readonly status: CustomerStatus;
  readonly profile: CustomerProfile;
  readonly emergencyContacts: readonly EmergencyContact[];
  readonly kycVerified: boolean;
  readonly kycVerifiedAt: ISOTimestamp | null;
  readonly notes: string | null;
  readonly tags: readonly string[];
  readonly preferredLanguage: string;
  readonly communicationPreferences: CommunicationPreferences;
}

/** Communication preferences */
export interface CommunicationPreferences {
  readonly email: boolean;
  readonly sms: boolean;
  readonly push: boolean;
  readonly whatsapp: boolean;
}

/** Create a new customer */
export function createCustomer(
  id: CustomerId,
  data: {
    tenantId: TenantId;
    customerNumber: string;
    profile: CustomerProfile;
    userId?: UserId;
    emergencyContacts?: EmergencyContact[];
    preferredLanguage?: string;
    notes?: string;
  },
  createdBy: UserId
): Customer {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    userId: data.userId ?? null,
    customerNumber: data.customerNumber,
    status: 'pending_verification',
    profile: data.profile,
    emergencyContacts: data.emergencyContacts ?? [],
    kycVerified: false,
    kycVerifiedAt: null,
    notes: data.notes ?? null,
    tags: [],
    preferredLanguage: data.preferredLanguage ?? 'en',
    communicationPreferences: {
      email: true,
      sms: true,
      push: true,
      whatsapp: false,
    },
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Verify customer KYC */
export function verifyCustomer(
  customer: Customer,
  updatedBy: UserId
): Customer {
  const now = new Date().toISOString();
  return {
    ...customer,
    status: 'active',
    kycVerified: true,
    kycVerifiedAt: now,
    updatedAt: now,
    updatedBy,
  };
}

/** Update customer profile */
export function updateProfile(
  customer: Customer,
  profile: Partial<CustomerProfile>,
  updatedBy: UserId
): Customer {
  return {
    ...customer,
    profile: { ...customer.profile, ...profile },
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Blacklist customer */
export function blacklistCustomer(
  customer: Customer,
  reason: string,
  updatedBy: UserId
): Customer {
  return {
    ...customer,
    status: 'blacklisted',
    notes: customer.notes ? `${customer.notes}\n\nBlacklisted: ${reason}` : `Blacklisted: ${reason}`,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Get full name */
export function getFullName(customer: Customer): string {
  return `${customer.profile.firstName} ${customer.profile.lastName}`;
}

/** Generate customer number */
export function generateCustomerNumber(year: number, sequence: number): string {
  return `CUST-${year}-${String(sequence).padStart(4, '0')}`;
}
