/**
 * Clock-In Events — Wave WORKFORCE-CLOCK-IN.
 *
 * Companion to:
 *   - packages/database/src/migrations/0103_biometric_clockin.sql
 *   - services/api-gateway/src/routes/workforce/clock-in.hono.ts
 *
 * One row per (employee, clock-in instant) with biometric provider
 * attestation, pass flag, optional device + geo fix. Powers both the
 * workforce-mobile `expo-local-authentication` flow and the owner-web
 * WebAuthn kiosk. The chat brain reads this table via the tools
 * `workforce.clock_in_query` / `workforce.attendance_status`.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS
 * policy. FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  boolean,
  numeric,
  index,
} from 'drizzle-orm/pg-core';

export const BIOMETRIC_PROVIDERS = [
  'expo_local_auth',
  'webauthn_platform',
  'webauthn_cross_platform',
  'fingerprint_device',
  'face_id',
  'touch_id',
  'pin_fallback',
  'manual_supervisor',
] as const;
export type BiometricProvider = (typeof BIOMETRIC_PROVIDERS)[number];

export const clockInEvents = pgTable(
  'clock_in_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    siteId: uuid('site_id').notNull(),
    clockedInAt: timestamp('clocked_in_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    clockedOutAt: timestamp('clocked_out_at', { withTimezone: true }),
    biometricProvider: text('biometric_provider').notNull(),
    biometricPassed: boolean('biometric_passed').notNull(),
    deviceId: text('device_id'),
    geoLat: numeric('geo_lat', { precision: 10, scale: 7 }),
    geoLng: numeric('geo_lng', { precision: 10, scale: 7 }),
    provenance: jsonb('provenance').notNull().default({ via: 'unknown' }),
    auditHashId: text('audit_hash_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantEmployeeIdx: index('clock_in_events_tenant_employee').on(
      table.tenantId,
      table.employeeId,
      table.clockedInAt,
    ),
    tenantSiteDayIdx: index('clock_in_events_tenant_site_day').on(
      table.tenantId,
      table.siteId,
      table.clockedInAt,
    ),
  }),
);

export type ClockInEvent = typeof clockInEvents.$inferSelect;
export type NewClockInEvent = typeof clockInEvents.$inferInsert;
