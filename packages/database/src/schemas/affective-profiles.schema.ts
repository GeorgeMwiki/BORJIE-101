/**
 * affective_profiles — durable theory-of-mind accumulator store.
 *
 * Long-format per-(tenant_id, user_id, dimension) rows carrying the running
 * [0,1] affective score the kernel mixes into the persona directive. Backs the
 * pluggable DB store in
 * packages/central-intelligence/src/kernel/theory-of-mind.ts; the in-memory Map
 * stays the hot cache + fail-safe fallback, this table gives it restart- and
 * multi-replica-safe durability.
 *
 * FORCE ROW LEVEL SECURITY + tenant-isolation on `app.current_tenant_id` +
 * service-role bypass live in migration 0372_affective_profiles.sql (RLS is not
 * expressible in drizzle-orm — the migration is the source of truth for it).
 *
 * `tenant_id` is TEXT to match every other tenant-scoped table so the GUC
 * comparison is a direct text equality. `value` is numeric(4,3) in [0,1];
 * `expiresAt` carries the 24h TTL so an expired profile reads as absent.
 *
 * Standalone schema module (NOT re-exported from schemas/index.ts here — the
 * shared barrel is reconciled separately).
 */

import {
  pgTable,
  text,
  numeric,
  integer,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

/** The five affective dimensions tracked per (tenant, user). */
export const AFFECTIVE_DIMENSIONS = [
  'frustration',
  'comprehension',
  'anxiety',
  'trust',
  'urgency',
] as const;

export type AffectiveDimension = (typeof AFFECTIVE_DIMENSIONS)[number];

export const affectiveProfiles = pgTable(
  'affective_profiles',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    dimension: text('dimension').notNull(),
    value: numeric('value', { precision: 4, scale: 3 }).notNull(),
    turns: integer('turns').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      columns: [t.tenantId, t.userId, t.dimension],
      name: 'affective_profiles_pk',
    }),
    tenantUserIdx: index('affective_profiles_tenant_user_idx').on(
      t.tenantId,
      t.userId,
      t.expiresAt,
    ),
  }),
);

export type AffectiveProfileRow = typeof affectiveProfiles.$inferSelect;
export type NewAffectiveProfileRow = typeof affectiveProfiles.$inferInsert;
