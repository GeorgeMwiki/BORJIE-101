/**
 * Workforce Invitations — owner/admin issues an invite, worker activates.
 *
 * Companion to migration 0086. Workers do NOT self-sign-up: every worker
 * row in `users` (and every `app_metadata.tenant_id` claim on a Supabase
 * principal) must trace back to a `workforce_invitations` row that an
 * authenticated owner / admin / manager issued.
 *
 * Lifecycle:
 *   pending  -> activated   (worker submits {phone, code} on workforce-mobile)
 *   pending  -> expired     (expires_at passes; cron promotes status)
 *   pending  -> revoked     (inviter cancels a pending row before activation)
 *
 * Tenant-isolation: RLS-forced in migration 0086. The api-gateway
 * databaseMiddleware sets the `app.tenant_id` GUC from the JWT, so all
 * authenticated SELECT/INSERT/UPDATE auto-scopes. Activation is an
 * unauthenticated route — it intentionally bypasses the GUC and looks
 * up by (phone_e164, activation_code, status='pending') with a service-
 * role connection.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// workforce_invitations — pending / activated / expired / revoked
// ============================================================================

export const workforceInvitations = pgTable(
  'workforce_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** Owner / admin / manager who issued this invitation. */
    invitedByUserId: text('invited_by_user_id').notNull(),
    /** Optional human-readable label so the inviter recognises the row. */
    fullName: text('full_name'),
    /** ITU-T E.164 phone, leading '+' included. */
    phoneE164: text('phone_e164').notNull(),
    /** 6-digit activation code (random). Text to preserve leading zeros. */
    activationCode: text('activation_code').notNull(),
    /** employee|manager. */
    assignedRole: text('assigned_role').notNull().default('employee'),
    /** Optional site assignment. */
    assignedSiteId: uuid('assigned_site_id'),
    /** JSONB array of certification strings (mining-shift-planner enum). */
    assignedCertifications: jsonb('assigned_certifications')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** TTL. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    /** Supabase user id linked / created on activation. */
    activatedUserId: uuid('activated_user_id'),
    /** pending|activated|expired|revoked. */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hash-chained audit-trail link. */
    hashChainId: uuid('hash_chain_id'),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_workforce_invitations_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
    phoneIdx: index('idx_workforce_invitations_phone').on(
      t.phoneE164,
      t.status,
    ),
    expiresIdx: index('idx_workforce_invitations_expires_at').on(t.expiresAt),
    tenantPhonePendingIdx: uniqueIndex(
      'uq_workforce_invitations_tenant_phone_pending',
    ).on(t.tenantId, t.phoneE164),
  }),
);

export type WorkforceInvitation = typeof workforceInvitations.$inferSelect;
export type NewWorkforceInvitation = typeof workforceInvitations.$inferInsert;
