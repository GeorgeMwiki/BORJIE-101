/**
 * Workforce Openings — owner posts a job opening; manager / Mwikila
 * drafts invitations from the row.
 *
 * Companion to migration 0134. Closes HR onboarding chain L-A
 * (issue #193). The opening represents a hiring need. An invitation
 * (existing `workforce_invitations` row) traces back via the new
 * `opening_id` column so the count_needed decrement is auditable.
 *
 * Lifecycle:
 *   open    -> filled    (count_needed reaches 0 via manager approvals)
 *   open    -> closed    (owner cancels)
 *   open    -> expired   (expires_at passes; cron promotes status)
 *
 * Tenant-isolation: RLS FORCE-enabled in migration 0134.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

export const workforceOpenings = pgTable(
  'workforce_openings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** Owner who posted the opening. */
    createdByUserId: text('created_by_user_id').notNull(),
    /** Short human-readable title (e.g. "Crusher Operator — Mwanza Site"). */
    title: text('title').notNull(),
    /** Markdown body; rendered on owner-web + workforce-mobile. */
    descriptionMd: text('description_md').notNull(),
    /** employee | manager — drives the downstream invitation assigned_role. */
    roleRequired: text('role_required').notNull(),
    /** How many activations this opening absorbs before auto-flipping to filled. */
    countNeeded: integer('count_needed').notNull().default(1),
    /** Optional site assignment cascaded onto drafted invitations. */
    assignedSiteId: uuid('assigned_site_id'),
    /** open | filled | closed | expired. */
    status: text('status').notNull().default('open'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_workforce_openings_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
    expiresIdx: index('idx_workforce_openings_expires_at').on(t.expiresAt),
  }),
);

export type WorkforceOpening = typeof workforceOpenings.$inferSelect;
export type NewWorkforceOpening = typeof workforceOpenings.$inferInsert;
