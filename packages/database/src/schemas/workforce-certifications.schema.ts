/**
 * Workforce Certifications — Wave WORKFORCE-CERT-EXPIRY.
 *
 * Companion to:
 *   - packages/database/src/migrations/0102_workforce_certifications.sql
 *   - services/api-gateway/src/workers/ica-cert-expiry-cron.ts
 *
 * Two Drizzle tables:
 *
 *   1. workforce_certifications     — per-employee mining certs with
 *                                     an `expires_at` deadline. The
 *                                     cron scans `expires_at <= now()+30d`
 *                                     every 6 hours and auto-creates
 *                                     reminders at 30d / 14d / 3d out.
 *
 *   2. workforce_cert_expiry_reminders — dedup ledger keyed on
 *                                        (tenant_id, cert_id, days_before)
 *                                        so the cron is idempotent.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled on both tables per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const WORKFORCE_CERT_STATUSES = [
  'active',
  'expired',
  'suspended',
  'revoked',
] as const;
export type WorkforceCertStatus = (typeof WORKFORCE_CERT_STATUSES)[number];

export const workforceCertifications = pgTable(
  'workforce_certifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    certCode: text('cert_code').notNull(),
    certName: text('cert_name').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    issuer: text('issuer').notNull(),
    status: text('status').notNull().default('active'),
    documentUrl: text('document_url'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantUserIdx: index('workforce_certifications_tenant_user_idx').on(
      table.tenantId,
      table.userId,
    ),
    tenantExpiryIdx: index('workforce_certifications_tenant_expiry_idx').on(
      table.tenantId,
      table.expiresAt,
    ),
  }),
);

export type WorkforceCertificationRow =
  typeof workforceCertifications.$inferSelect;
export type NewWorkforceCertificationRow =
  typeof workforceCertifications.$inferInsert;

export const workforceCertExpiryReminders = pgTable(
  'workforce_cert_expiry_reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    certId: uuid('cert_id').notNull(),
    daysBefore: integer('days_before').notNull(),
    reminderId: uuid('reminder_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniq: uniqueIndex('workforce_cert_expiry_reminders_uniq').on(
      table.tenantId,
      table.certId,
      table.daysBefore,
    ),
    tenantIdx: index('workforce_cert_expiry_reminders_tenant_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export type WorkforceCertExpiryReminderRow =
  typeof workforceCertExpiryReminders.$inferSelect;
export type NewWorkforceCertExpiryReminderRow =
  typeof workforceCertExpiryReminders.$inferInsert;
