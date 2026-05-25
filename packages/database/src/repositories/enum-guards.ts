/**
 * Enum guards for repository status filters.
 *
 * Bug fix A-BUG-DEEP #9: previously the repositories used
 *   `someString as unknown as typeof column.$inferType`
 * to satisfy drizzle's pgEnum literal narrowing. That double-cast
 * silently accepted any string at runtime, which meant a caller passing
 * an invalid status (e.g. mis-typed "actv" instead of "active") would
 * silently return zero rows instead of failing loudly.
 *
 * These guards validate the input against the enum literal union before
 * the cast reaches drizzle, mirroring the pattern in
 * `services/payments-ledger/src/__tests__/webhook-tenant-resolution.test.ts`
 * which validates webhook-derived tenant claims before passing to repos.
 */

export const LEASE_STATUS_VALUES = [
  'draft',
  'pending_approval',
  'approved',
  'active',
  'expiring_soon',
  'expired',
  'terminated',
  'renewed',
  'cancelled',
] as const;
export type LeaseStatus = (typeof LEASE_STATUS_VALUES)[number];

export const CUSTOMER_STATUS_VALUES = [
  'prospect',
  'applicant',
  'approved',
  'active',
  'former',
  'blacklisted',
] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS_VALUES)[number];

export const USER_STATUS_VALUES = [
  'pending_activation',
  'active',
  'suspended',
  'deactivated',
] as const;
export type UserStatus = (typeof USER_STATUS_VALUES)[number];

export const DOCUMENT_STATUS_VALUES = [
  'pending_upload',
  'uploaded',
  'processing',
  'ocr_complete',
  'validated',
  'rejected',
  'expired',
  'archived',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number];

export const DOCUMENT_TYPE_VALUES = [
  'national_id',
  'passport',
  'driving_license',
  'work_permit',
  'residence_permit',
  'utility_bill',
  'bank_statement',
  'employment_letter',
  'lease_agreement',
  'move_in_report',
  'move_out_report',
  'maintenance_photo',
  'receipt',
  'notice',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPE_VALUES)[number];

/**
 * Validate that `value` is a member of the literal union `values`.
 * Throws `Error` with code `ENUM_VALUE_INVALID` on mismatch so callers
 * surface a 400 instead of an empty result set.
 */
function assertEnumMember<T extends string>(
  fieldName: string,
  values: readonly T[],
  value: string,
): T {
  if (!(values as readonly string[]).includes(value)) {
    const err = new Error(
      `${fieldName}_INVALID: expected one of [${values.join(', ')}], got "${value}"`,
    );
    (err as { code?: string }).code = 'ENUM_VALUE_INVALID';
    throw err;
  }
  return value as T;
}

export function assertLeaseStatus(value: string): LeaseStatus {
  return assertEnumMember('lease_status', LEASE_STATUS_VALUES, value);
}
export function assertCustomerStatus(value: string): CustomerStatus {
  return assertEnumMember('customer_status', CUSTOMER_STATUS_VALUES, value);
}
export function assertUserStatus(value: string): UserStatus {
  return assertEnumMember('user_status', USER_STATUS_VALUES, value);
}
export function assertDocumentStatus(value: string): DocumentStatus {
  return assertEnumMember('document_status', DOCUMENT_STATUS_VALUES, value);
}
export function assertDocumentType(value: string): DocumentType {
  return assertEnumMember('document_type', DOCUMENT_TYPE_VALUES, value);
}

export function assertLeaseStatuses(values: readonly string[]): LeaseStatus[] {
  return values.map(assertLeaseStatus);
}
export function assertCustomerStatuses(values: readonly string[]): CustomerStatus[] {
  return values.map(assertCustomerStatus);
}
