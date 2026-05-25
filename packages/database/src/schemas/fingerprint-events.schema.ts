/**
 * Fingerprint events — immutable biometric sign-off log.
 *
 * Per DATA_MODEL.md §3.5. One row per successful biometric sign-off
 * (shift report close, cash hand-over, document attest, etc.). Rows are
 * append-only — no UPDATE, no DELETE.
 *
 * Geometry: PostGIS `geography(POINT, 4326)` for the device location at
 * sign-off. GeoJSON string at ORM boundary.
 *
 * `biometric_hash` is an irreversible hash of the fingerprint template
 * at sign-off — used to prove the same finger signed, never to
 * reconstruct the print.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';

export const fingerprintEvents = pgTable(
  'fingerprint_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Optional — the document this fingerprint attests to. */
    documentId: text('document_id'),
    /**
     * Irreversible hash (sha256(template || tenant_salt)). Used to prove
     * the same finger signed across events; cannot reconstruct the print.
     */
    biometricHash: text('biometric_hash').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** PostGIS POINT — device location at sign-off. GeoJSON string. */
    geo: text('geo'),
    /** Device attestation blob (TEE / SafetyNet / DeviceCheck). */
    deviceAttestation: jsonb('device_attestation').notNull().default({}),
    /** What the user was signing — 'shift_report'|'cash_payout'|'attendance'|... */
    signedFor: text('signed_for').notNull(),
    /** Loose link back to the entity being attested (e.g. shift_report id). */
    subjectId: text('subject_id'),
    subjectKind: text('subject_kind'),
    attributes: jsonb('attributes').notNull().default({}),
  },
  (t) => ({
    tenantIdx: index('fingerprint_events_tenant_idx').on(t.tenantId),
    userIdx: index('fingerprint_events_user_idx').on(t.userId),
    signedAtIdx: index('fingerprint_events_signed_at_idx').on(t.tenantId, t.signedAt),
    subjectIdx: index('fingerprint_events_subject_idx').on(t.subjectKind, t.subjectId),
    docIdx: index('fingerprint_events_doc_idx').on(t.documentId),
  }),
);

export type FingerprintEvent = typeof fingerprintEvents.$inferSelect;
export type NewFingerprintEvent = typeof fingerprintEvents.$inferInsert;
