/**
 * Onboarding signup persistence — migration 0188.
 *
 * Three tables backing the tenant-signup flow in
 * services/api-gateway/src/routes/onboarding.router.ts (KI-013 closure).
 *
 * Security model: these are PRE-TENANT system tables. Signup creates the
 * tenant row, so there is no `app.current_tenant_id` GUC when these rows
 * are first written. Isolation is enforced by:
 *   (a) UNIQUE(email) on owner_onboarding_credentials — DB-level dedup.
 *   (b) Unguessable 32-byte base64url token — prevents forgery.
 *   (c) bcrypt password_hash — column never returned to the client.
 *   (d) consumed_at on verifications — app enforces one-shot semantics.
 * All three tables still have RLS FORCE-enabled with a permissive
 * service-managed policy (mirrors Supabase auth.* tables).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ─── Table 1: owner_onboarding_credentials ────────────────────────────────────

export const ownerOnboardingCredentials = pgTable(
  'owner_onboarding_credentials',
  {
    /** Logical PK — also serves as the unique tenant anchor. */
    tenantId: text('tenant_id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull(),
    /** Normalized (trim + lower) email. DB UNIQUE constraint enforces dedup. */
    email: text('email').notNull(),
    /** bcrypt hash (cost 10). NEVER returned to the client. */
    passwordHash: text('password_hash').notNull(),
    /** NULL until /verify-email is called. */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Backing the UNIQUE(email) constraint from the migration. */
    emailUq: uniqueIndex('owner_onboarding_credentials_email_key').on(t.email),
    tenantIdx: index('idx_ooc_tenant_id').on(t.tenantId),
  }),
);

export type OwnerOnboardingCredentialRow =
  typeof ownerOnboardingCredentials.$inferSelect;
export type NewOwnerOnboardingCredentialRow =
  typeof ownerOnboardingCredentials.$inferInsert;

// ─── Table 2: onboarding_signup_sessions ─────────────────────────────────────

export const onboardingSignupSessions = pgTable(
  'onboarding_signup_sessions',
  {
    /** One row per tenant. PK + FK → tenants(id) ON DELETE CASCADE. */
    tenantId: text('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    email: text('email').notNull(),
    businessName: text('business_name').notNull(),
    country: text('country').notNull(),
    /** NULL until /verify-email is called. */
    sessionToken: text('session_token'),
    /** jsonb array of OnboardingFlowStep objects. */
    steps: jsonb('steps').notNull(),
    /** 'cashflow' | 'growth' | 'exit' — set by /first-md-chat. */
    intent: text('intent'),
    firstSiteId: text('first_site_id'),
    firstChatThreadId: text('first_chat_thread_id'),
    /** jsonb array of skill slugs suggested by the welcome coordinator. */
    suggestedSkills: jsonb('suggested_skills'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** Partial index — only non-null tokens need fast lookup. */
    sessionTokenIdx: index('idx_oss_session_token').on(t.sessionToken),
  }),
);

export type OnboardingSignupSessionRow =
  typeof onboardingSignupSessions.$inferSelect;
export type NewOnboardingSignupSessionRow =
  typeof onboardingSignupSessions.$inferInsert;

// ─── Table 3: onboarding_email_verifications ─────────────────────────────────

export const onboardingEmailVerifications = pgTable(
  'onboarding_email_verifications',
  {
    /** 32-byte base64url token — the PK is the secret. */
    token: text('token').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    email: text('email').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** NULL = unconsumed. Non-null = consumed. Row kept for audit. */
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
);

export type OnboardingEmailVerificationRow =
  typeof onboardingEmailVerifications.$inferSelect;
export type NewOnboardingEmailVerificationRow =
  typeof onboardingEmailVerifications.$inferInsert;
