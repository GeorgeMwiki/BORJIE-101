/**
 * Payment Method domain model
 * Represents a saved payment method for a customer
 */

import { z } from 'zod';
import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable } from '../common/types';
import type { CustomerId, PaymentChannel } from './payment-intent';

export type PaymentMethodId = Brand<string, 'PaymentMethodId'>;

export function asPaymentMethodId(id: string): PaymentMethodId {
  return id as PaymentMethodId;
}

export const PaymentMethodTypeSchema = z.enum(['mpesa', 'card', 'bank_account']);

/** Payment method type */
export type PaymentMethodType =
  | 'mpesa'
  | 'card'
  | 'bank_account';

/** Payment method status */
export type PaymentMethodStatus = 'active' | 'expired' | 'disabled';

/**
 * Payment Method entity
 */
export interface PaymentMethod extends EntityMetadata, SoftDeletable {
  readonly id: PaymentMethodId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly type: PaymentMethodType;
  readonly status: PaymentMethodStatus;
  readonly isDefault: boolean;
  readonly displayName: string;
  readonly details: PaymentMethodDetails;
  readonly lastUsedAt: string | null;
}

/** Payment method details (varies by type) */
export type PaymentMethodDetails =
  | MpesaDetails
  | CardDetails
  | BankAccountDetails;

export interface MpesaDetails {
  readonly type: 'mpesa';
  readonly phoneNumber: string; // Masked: +254****1234
  readonly fullPhoneNumber?: never; // Never stored
}

export interface CardDetails {
  readonly type: 'card';
  readonly brand: 'visa' | 'mastercard' | 'amex';
  readonly last4: string;
  readonly expiryMonth: number;
  readonly expiryYear: number;
  readonly fingerprint: string;
}

export interface BankAccountDetails {
  readonly type: 'bank_account';
  readonly bankName: string;
  readonly accountLast4: string;
  readonly accountType: 'checking' | 'savings';
}

/** Create a new M-Pesa payment method */
export function createMpesaMethod(
  id: PaymentMethodId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    phoneNumber: string;
    isDefault?: boolean;
  },
  createdBy: UserId
): PaymentMethod {
  const now = new Date().toISOString();
  const masked = maskPhoneNumber(data.phoneNumber);

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    type: 'mpesa',
    status: 'active',
    isDefault: data.isDefault ?? false,
    displayName: `M-Pesa ${masked}`,
    details: {
      type: 'mpesa',
      phoneNumber: masked,
    },
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Create a new card payment method */
export function createCardMethod(
  id: PaymentMethodId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    brand: 'visa' | 'mastercard' | 'amex';
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    fingerprint: string;
    isDefault?: boolean;
  },
  createdBy: UserId
): PaymentMethod {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    type: 'card',
    status: 'active',
    isDefault: data.isDefault ?? false,
    displayName: `${data.brand.toUpperCase()} ****${data.last4}`,
    details: {
      type: 'card',
      brand: data.brand,
      last4: data.last4,
      expiryMonth: data.expiryMonth,
      expiryYear: data.expiryYear,
      fingerprint: data.fingerprint,
    },
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

function maskPhoneNumber(phone: string): string {
  // Country-neutral masking: keep the first 4 chars (typically +CC or +CCC)
  // and the last 4 digits, masking everything in between. Works for any
  // country prefix — no assumption of +254 / +255.
  if (phone.length < 8) return phone;
  const prefix = phone.slice(0, 4);
  const suffix = phone.slice(-4);
  return `${prefix}****${suffix}`;
}

/** Check if card is expired */
export function isCardExpired(method: PaymentMethod): boolean {
  if (method.details.type !== 'card') return false;
  const now = new Date();
  const expiry = new Date(method.details.expiryYear, method.details.expiryMonth - 1);
  return expiry < now;
}

/** Get channel for payment method */
export function getPaymentChannel(method: PaymentMethod): PaymentChannel {
  switch (method.type) {
    case 'mpesa':
      return 'mpesa';
    case 'card':
      return 'card';
    case 'bank_account':
      return 'bank_transfer';
  }
}
