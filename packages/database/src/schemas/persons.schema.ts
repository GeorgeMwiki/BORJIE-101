/**
 * Unified Personal Knowledge Base — `persons` + `person_links`.
 *
 * Companion to migration 0088 and `Docs/research/unified-personal-kb.md` §10.
 *
 * One human (Asha) can simultaneously be owner of Mine A, manager of
 * Mine B, employee of Mine C, and buyer for Refiner D. The canonical
 * identity (her name, phone, language preference, life events) lives
 * in the `persons` table; each `person_links` row is one "hat" she
 * wears at one tenant under one Supabase auth principal.
 *
 * RLS posture: NEITHER table has Row Level Security enabled. They are
 * platform-level identity registries (mirroring the precedent of
 * `platform_memory_cells` in `cognitive-memory.schema.ts`). Access is
 * gated above this layer by the api-gateway middleware — typically via
 * the service-role connection for identity-resolution lookups, or by a
 * future `app.current_person_id` GUC predicate.
 *
 * No `tenant_id` column on `persons` by design — a person exists
 * orthogonally to any tenant. `person_links.tenant_id` is the join key
 * back to the canonical tenant boundary.
 */

import {
  pgTable,
  text,
  timestamp,
  uuid,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ============================================================================
// persons — canonical human identity (one row per real human)
// ============================================================================

export const persons = pgTable(
  'persons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * ITU-T E.164 phone, leading '+' included. Borjie's deterministic
     * identity-resolution primary signal — every onboarding flow
     * (workforce-mobile, buyer-mobile, owner-web) captures this.
     */
    primaryPhoneE164: text('primary_phone_e164').notNull().unique(),
    primaryEmail: text('primary_email'),
    displayName: text('display_name').notNull(),
    /**
     * sw|en. CLAUDE.md "Swahili-first" hard rule: default `sw`.
     */
    preferredLanguage: text('preferred_language').notNull().default('sw'),
    /**
     * Affirmative opt-in timestamp for cross-tenant federation.
     * NULL means the person has NOT opted in; tenant memories remain
     * fully siloed. Set when the user confirms the multi-tenant
     * onboarding modal (Docs/research/unified-personal-kb.md §6.2).
     */
    consentUnifiedKbAt: timestamp('consent_unified_kb_at', {
      withTimezone: true,
    }),
    /**
     * Revocation timestamp. Set on one-click un-link; deletes
     * role-private personal memory but keeps the person row.
     */
    consentUnifiedKbRevokedAt: timestamp('consent_unified_kb_revoked_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hash-chained audit-trail link (mirrors workforce_invitations). */
    hashChainId: uuid('hash_chain_id'),
  },
  (t) => ({
    phoneIdx: index('idx_persons_phone').on(t.primaryPhoneE164),
  }),
);

export type PersonRow = typeof persons.$inferSelect;
export type PersonInsert = typeof persons.$inferInsert;

// ============================================================================
// person_links — (person × tenant × supabase_user) join. Many hats per human.
// ============================================================================

export const personLinks = pgTable(
  'person_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    /** Supabase auth.users.id for this hat. */
    supabaseUserId: uuid('supabase_user_id').notNull(),
    /** owner|manager|employee|buyer|admin. */
    roleInTenant: text('role_in_tenant').notNull(),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set on un-link; the row is kept for audit replay. */
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    /** phone-match|manual|sso|sso-merge. */
    linkMethod: text('link_method').notNull().default('phone-match'),
  },
  (t) => ({
    personIdx: index('idx_person_links_person').on(t.personId),
    tenantUserIdx: index('idx_person_links_tenant_user').on(
      t.tenantId,
      t.supabaseUserId,
    ),
    /**
     * One (person, tenant, supabase_user) triple per row. A human cannot
     * be linked to the same tenant twice under the same auth principal.
     */
    personTenantUserUnique: unique('uq_person_links_person_tenant_user').on(
      t.personId,
      t.tenantId,
      t.supabaseUserId,
    ),
  }),
);

export type PersonLinkRow = typeof personLinks.$inferSelect;
export type PersonLinkInsert = typeof personLinks.$inferInsert;
