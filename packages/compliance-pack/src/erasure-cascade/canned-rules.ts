/**
 * Pre-canned erasure rules for the platform's well-known tables.
 *
 * These reflect business decisions:
 *   - `users`, `communications`, `document_uploads`, `field_captures`,
 *     `parcel_metadata_layers`, `leases` — anonymize PII columns
 *     (retain rows for audit / referential integrity).
 *   - `payments` — legal_hold (TZ Income Tax Act § 80, 7-year retention).
 *   - `kernel_action_audit` — anonymize (regulator may need to trace
 *     actions even after subject erasure).
 *
 * Consumers override these by passing their own `ErasureCascadeSpec`;
 * the canned set is a starting point with defensible defaults.
 */

import type { ErasureRule } from '../types.js';

/** 7 years in days, per TZ Income Tax Act § 80. */
const SEVEN_YEARS_DAYS = 7 * 365;

function daysFromNow(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * The 8 canned rules required by the spec.
 *
 * `retentionUntil` for `payments` is computed at call-time, since the
 * "until" date depends on the date the cascade runs.
 */
export function cannedErasureRules(now: Date = new Date()): ReadonlyArray<ErasureRule> {
  return Object.freeze([
    {
      table: 'users',
      strategy: 'anonymize',
      piiColumns: ['email', 'full_name', 'phone', 'national_id', 'address'],
    },
    {
      table: 'leases',
      strategy: 'anonymize',
      piiColumns: ['tenant_full_name', 'tenant_phone', 'tenant_email'],
    },
    {
      table: 'payments',
      strategy: 'legal_hold',
      piiColumns: ['payer_name', 'payer_phone', 'payer_email'],
      retentionReason: 'TZ Income Tax Act § 80 — 7-year retention',
      retentionUntil: daysFromNow(SEVEN_YEARS_DAYS, now),
    },
    {
      table: 'communications',
      strategy: 'pseudonymize',
      piiColumns: ['subject', 'body', 'recipient_email', 'recipient_phone'],
    },
    {
      table: 'document_uploads',
      strategy: 'hard_delete',
      piiColumns: ['original_filename', 'extracted_text'],
    },
    {
      table: 'field_captures',
      strategy: 'anonymize',
      piiColumns: ['captured_by', 'gps_lat', 'gps_lng'],
    },
    {
      table: 'parcel_metadata_layers',
      strategy: 'tombstone',
      piiColumns: ['owner_name', 'occupant_name'],
    },
    {
      table: 'kernel_action_audit',
      strategy: 'anonymize',
      piiColumns: ['actor_email', 'subject_email', 'request_ip'],
    },
  ] satisfies ReadonlyArray<ErasureRule>);
}
