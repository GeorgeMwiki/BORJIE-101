/**
 * Driver letter acknowledgements — durable offline-field-capture sink.
 *
 * One row per driver-letter acknowledgement flushed from the workforce-mobile
 * offline queue to `/api/v1/mining/driver-letter-acks`
 * (services/api-gateway/src/routes/mining/field-capture.hono.ts). `id` is the
 * deterministic rowId derived from (tenant, Idempotency-Key) so an at-least-once
 * re-flush collides on the PK and is no-op'd via ON CONFLICT DO NOTHING.
 *
 * tenant_id / user_id come from the authenticated context (never the body's
 * advisory userId). The domain fields (letter_id / driver_id / site_id / geo /
 * attributes) come from the request body.
 *
 * Tenant-scoped via the canonical `app.current_tenant_id` GUC RLS policy +
 * a service-role bypass for an out-of-band reconciliation/export cron
 * (CLAUDE.md hard rule). FORCE RLS is enabled at the DB level.
 *
 * Companion files:
 *   - packages/database/src/migrations/0362_driver_letter_acks.sql
 *   - services/api-gateway/src/routes/mining/field-capture.hono.ts (the sink)
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const driverLetterAcks = pgTable(
  'driver_letter_acks',
  {
    /** Deterministic rowId from (tenant, Idempotency-Key) — at-least-once dedupe. */
    id: text('id').primaryKey(),
    /** Tenant scope. Bound by RLS via `app.current_tenant_id` GUC. */
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Acknowledging principal — taken from auth, never the body. */
    userId: text('user_id').notNull(),
    /** The driver letter being acknowledged. */
    letterId: text('letter_id'),
    /** The driver the acknowledgement is for. */
    driverId: text('driver_id'),
    /** The site the acknowledgement was captured at. */
    siteId: text('site_id'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Device location at acknowledgement (GeoJSON string). */
    geo: text('geo'),
    attributes: jsonb('attributes').notNull().default({}),
  },
  (t) => ({
    tenantIdx: index('idx_driver_letter_acks_tenant').on(t.tenantId),
    tenantLetterIdx: index('idx_driver_letter_acks_tenant_letter').on(
      t.tenantId,
      t.letterId,
    ),
  }),
);

export type DriverLetterAck = typeof driverLetterAcks.$inferSelect;
export type NewDriverLetterAck = typeof driverLetterAcks.$inferInsert;
