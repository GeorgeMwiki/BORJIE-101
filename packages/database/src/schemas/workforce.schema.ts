/**
 * Workforce — employees, attendance, cash advances.
 *
 * Per DATA_MODEL.md §3.1. Employees sit BESIDE platform `users` (a user
 * is a portal identity; an employee is an HR record). Attendance is the
 * daily-shift roster signed off by the supervisor; advances are the
 * cash-on-account a worker draws against future wages.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  date,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants, users } from './tenant.schema.js';
import { companies } from './companies.schema.js';
import { sites } from './sites.schema.js';

export const employees = pgTable(
  'employees',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    nidaId: text('nida_id'),
    role: text('role').notNull(),
    /** daily|monthly|production_share. */
    wageBasis: text('wage_basis').notNull().default('daily'),
    wageRateTzs: numeric('wage_rate_tzs', { precision: 12, scale: 2 }),
    /** PML_employee|contractor|pit_holder_worker|casual. */
    employmentType: text('employment_type').notNull().default('casual'),
    /** ISO-3166-1 alpha-2. Drives Local Content tracking. */
    nationality: text('nationality').notNull().default('TZ'),
    status: text('status').notNull().default('active'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('employees_tenant_idx').on(t.tenantId),
    companyIdx: index('employees_company_idx').on(t.companyId),
    siteIdx: index('employees_site_idx').on(t.siteId),
    nidaIdx: index('employees_nida_idx').on(t.nidaId),
    statusIdx: index('employees_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// attendance — daily roster sign-off
// ============================================================================

export const attendance = pgTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    siteId: text('site_id').references(() => sites.id, { onDelete: 'set null' }),
    workDate: date('work_date').notNull(),
    /** day|night. */
    shiftKind: text('shift_kind').notNull().default('day'),
    /** present|absent|sick|leave|terminated_today. */
    status: text('status').notNull().default('present'),
    hoursWorked: numeric('hours_worked', { precision: 5, scale: 2 }),
    /** Supervisor who signed off; FK to users. */
    signedOffByUserId: text('signed_off_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    signedOffAt: timestamp('signed_off_at', { withTimezone: true }),
    /** Fingerprint-event ID that proves sign-off (non-repudiation). */
    signedOffFingerprintEventId: text('signed_off_fingerprint_event_id'),
    notes: text('notes'),
  },
  (t) => ({
    tenantIdx: index('attendance_tenant_idx').on(t.tenantId),
    employeeDateIdx: uniqueIndex('attendance_employee_date_shift_idx').on(
      t.employeeId,
      t.workDate,
      t.shiftKind,
    ),
    siteDateIdx: index('attendance_site_date_idx').on(t.siteId, t.workDate),
  }),
);

// ============================================================================
// advances — cash advances against future wages
// ============================================================================

export const advances = pgTable(
  'advances',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    employeeId: text('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    amountTzs: numeric('amount_tzs', { precision: 18, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('TZS'),
    /** food|fuel|medical|transport|cash|other. */
    reasonKind: text('reason_kind').notNull().default('cash'),
    reasonNote: text('reason_note'),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    issuedByUserId: text('issued_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    repaymentSchedule: jsonb('repayment_schedule').notNull().default({}),
    repaidTzs: numeric('repaid_tzs', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    isClosed: boolean('is_closed').notNull().default(false),
    /** Used to compute weekly outstanding advance per worker. */
    weekStart: date('week_start'),
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    /** Periodic snapshot counters used in advance-cap enforcement. */
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    tenantIdx: index('advances_tenant_idx').on(t.tenantId),
    employeeIdx: index('advances_employee_idx').on(t.employeeId),
    openIdx: index('advances_open_idx').on(t.tenantId, t.isClosed),
    weekIdx: index('advances_week_idx').on(t.employeeId, t.weekStart),
  }),
);

export type Employee = typeof employees.$inferSelect;
export type Attendance = typeof attendance.$inferSelect;
export type Advance = typeof advances.$inferSelect;
