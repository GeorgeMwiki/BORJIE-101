/**
 * Identity Schema — Cross-Org Tenant Identity
 *
 * Implements the persistence layer for Conflict 2 (Universal Tenant Identity +
 * Multi-Org). Three tables:
 *
 *   - tenant_identities: Global cross-org principal keyed by phone.
 *       One row per real human, independent of any platform tenant.
 *   - org_memberships:   Per-org join record. Links a tenant_identity to an
 *       organization; each row has a 1:1 shadow user row in the platform
 *       tenant's `users` table (via user_id FK).
 *   - invite_codes:      Redeemable tokens that produce memberships atomically.
 *
 * Data-isolation guarantees are preserved because shadow user rows remain
 * tenant-scoped — this module federates LOGIN only, not DATA.
 *
 * See: Docs/analysis/CONFLICT_RESOLUTIONS.md § "Conflict 2".
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { tenants, organizations, users } from './tenant.schema.js';

// ============================================================================
// Enums
// ============================================================================

export const tenantIdentityStatusEnum = pgEnum('tenant_identity_status', [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]);

// Migration 0345 — the pairing state machine. Two pairing modes: (a)
// invite/QR redeem → ACTIVE immediately (org pre-authorized by issuing the
// code); (b) public-discovery request → PENDING → org approves (ACTIVE) or
// rejects (REJECTED). REVOKED = org-initiated end of an ACTIVE membership
// (vs LEFT = member-initiated). Re-request: REJECTED|REVOKED → PENDING.
// BLOCKED stays terminal until the org unblocks.
export const orgMembershipStatusEnum = pgEnum('org_membership_status', [
  'ACTIVE',
  'LEFT',
  'BLOCKED',
  'PENDING',
  'REJECTED',
  'REVOKED',
]);

// Migration 0344 — discriminates the membership so ONE table backs both the
// workforce app (employment|contractor) and the buyer app (buyer_connection),
// plus guest. The audience resolver targets orgScope=connected (buyers) vs a
// workforce role-class as predicates over this column.
export const orgMembershipRelationshipTypeEnum = pgEnum(
  'org_membership_relationship_type',
  ['employment', 'buyer_connection', 'contractor', 'guest']
);

// ============================================================================
// tenant_identities — cross-org identity principal
// ============================================================================

export const tenantIdentities = pgTable(
  'tenant_identities',
  {
    id: text('id').primaryKey(),
    // ITU-T E.164 normalized phone (digits only, no '+'). Migration 0345:
    // NULLABLE — owner-web principals authenticate by email and may carry no
    // phone; the CHECK requires at least one of phone/email.
    phoneNormalized: text('phone_normalized'),
    // ISO 3166-1 alpha-2 country code used for normalization (0345: nullable
    // — annotates the phone; no phone, no code)
    phoneCountryCode: text('phone_country_code'),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    // UserProfile JSON — firstName, lastName, displayName, avatarUrl, phone,
    // timezone, locale.
    profile: jsonb('profile').notNull().default({}),
    status: tenantIdentityStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    // Merge tracking: when this identity is merged into another, record the
    // primary so cross-references can resolve. NULL for independent rows.
    mergedIntoId: text('merged_into_id'),
  },
  (table) => ({
    phoneIdx: uniqueIndex('tenant_identities_phone_idx').on(
      table.phoneNormalized
    ),
    statusIdx: index('tenant_identities_status_idx').on(table.status),
    emailIdx: index('tenant_identities_email_idx').on(table.email),
  })
);

// ============================================================================
// org_memberships — per-org join record (tenantIdentity x organization)
// ============================================================================

export const orgMemberships = pgTable(
  'org_memberships',
  {
    id: text('id').primaryKey(),
    tenantIdentityId: text('tenant_identity_id')
      .notNull()
      .references(() => tenantIdentities.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    platformTenantId: text('platform_tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Shadow user — bridges to the platform tenant's users table so RBAC /
    // audit / data-isolation continue to resolve through the existing pipeline.
    // Migration 0345 (corrected buyer model): NULLABLE, with a CHECK pinning
    // the invariant both ways — buyer_connection rows MUST be NULL (a buyer
    // is an external counterparty and never holds a tenant-insider user);
    // employment|contractor|guest rows MUST carry one WHEN ACTIVE (a PENDING
    // request has none — the shadow user is provisioned at APPROVE time).
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    status: orgMembershipStatusEnum('status').notNull().default('ACTIVE'),
    // Migration 0344 — worker-employment vs buyer-connection discriminator.
    relationshipType: orgMembershipRelationshipTypeEnum('relationship_type')
      .notNull()
      .default('employment'),
    // Migration 0344 — denormalized role-class TARGETING label (from
    // invite_codes.default_role_id at join). Classification only — NOT an
    // authorization grant; authz resolves via the shadow user_id + RLS.
    memberRole: text('member_role'),
    nickname: text('nickname'),
    joinedViaInviteCode: text('joined_via_invite_code'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Audit fields for leave / block operations
    leftAt: timestamp('left_at', { withTimezone: true }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockReason: text('block_reason'),
    // Migration 0345 — approval metadata for pairing mode (b). decided_by is
    // a SOFT users.id reference (no FK) so audit survives user deletion.
    requestedNote: text('requested_note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (table) => ({
    // One ACTIVE-era row per (identity, org). Historical LEFT/BLOCKED rows
    // are allowed to coexist — caller filters on status.
    identityOrgIdx: uniqueIndex('org_memberships_identity_org_idx').on(
      table.tenantIdentityId,
      table.organizationId
    ),
    identityIdx: index('org_memberships_identity_idx').on(table.tenantIdentityId),
    orgIdx: index('org_memberships_org_idx').on(table.organizationId),
    platformTenantIdx: index('org_memberships_platform_tenant_idx').on(
      table.platformTenantId
    ),
    userIdx: index('org_memberships_user_idx').on(table.userId),
    statusIdx: index('org_memberships_status_idx').on(table.status),
    // Migration 0344 — audience-resolver hot paths (partial: only ACTIVE
    // memberships are ever targeted by a role-class / relationship fan).
    orgRelationshipActiveIdx: index('org_memberships_org_relationship_active_idx')
      .on(table.organizationId, table.relationshipType)
      .where(sql`status = 'ACTIVE'`),
    orgMemberRoleActiveIdx: index('org_memberships_org_member_role_active_idx')
      .on(table.organizationId, table.memberRole)
      .where(sql`status = 'ACTIVE'`),
    // Migration 0346 — the approval-queue hot path (org reads its PENDING
    // requests oldest-first).
    orgPendingIdx: index('org_memberships_org_pending_idx')
      .on(table.organizationId, table.joinedAt)
      .where(sql`status = 'PENDING'`),
  })
);

// ============================================================================
// invite_codes — redeemable tokens
// ============================================================================

export const inviteCodes = pgTable(
  'invite_codes',
  {
    code: text('code').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    platformTenantId: text('platform_tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    issuedBy: text('issued_by')
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxRedemptions: integer('max_redemptions'),
    redemptionsUsed: integer('redemptions_used').notNull().default(0),
    defaultRoleId: text('default_role_id').notNull(),
    // Migration 0345 — the relationship this invite GRANTS (org-authored).
    // The redeem path derives the membership relationship from THIS column,
    // never from the redeemer's input (trust-direction fix).
    relationshipType: orgMembershipRelationshipTypeEnum('relationship_type')
      .notNull()
      .default('employment'),
    // InviteAttachmentHints — { propertyId?, unitId? } — optional pre-binding.
    attachmentHints: jsonb('attachment_hints'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
  },
  (table) => ({
    orgIdx: index('invite_codes_org_idx').on(table.organizationId),
    platformTenantIdx: index('invite_codes_platform_tenant_idx').on(
      table.platformTenantId
    ),
    issuedByIdx: index('invite_codes_issued_by_idx').on(table.issuedBy),
    expiresAtIdx: index('invite_codes_expires_at_idx').on(table.expiresAt),
  })
);

// ============================================================================
// identity_auth_principals — Supabase-sub ↔ tenant_identity bridge (0345)
// ============================================================================

/**
 * One human (tenant_identities, keyed on phone) may hold several Supabase
 * auth principals — a phone-OTP sub on mobile, an email sub on web. Every
 * principal resolves to the SAME membership graph through this table.
 * Global cross-tenant spine (no tenant key by design): FORCE RLS with a
 * service-role-only policy — request-scoped sessions never read it directly.
 */
export const identityAuthPrincipals = pgTable(
  'identity_auth_principals',
  {
    id: text('id').primaryKey(),
    tenantIdentityId: text('tenant_identity_id')
      .notNull()
      .references(() => tenantIdentities.id, { onDelete: 'cascade' }),
    supabaseUserId: uuid('supabase_user_id').notNull(),
    // phone-otp | email | sso | person-links-backfill
    authMethod: text('auth_method').notNull().default('phone-otp'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    subIdx: uniqueIndex('identity_auth_principals_sub_idx').on(
      table.supabaseUserId
    ),
    identityIdx: index('identity_auth_principals_identity_idx').on(
      table.tenantIdentityId
    ),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const identityAuthPrincipalsRelations = relations(
  identityAuthPrincipals,
  ({ one }) => ({
    tenantIdentity: one(tenantIdentities, {
      fields: [identityAuthPrincipals.tenantIdentityId],
      references: [tenantIdentities.id],
    }),
  })
);

export const tenantIdentitiesRelations = relations(
  tenantIdentities,
  ({ many }) => ({
    memberships: many(orgMemberships),
  })
);

export const orgMembershipsRelations = relations(orgMemberships, ({ one }) => ({
  tenantIdentity: one(tenantIdentities, {
    fields: [orgMemberships.tenantIdentityId],
    references: [tenantIdentities.id],
  }),
  organization: one(organizations, {
    fields: [orgMemberships.organizationId],
    references: [organizations.id],
  }),
  platformTenant: one(tenants, {
    fields: [orgMemberships.platformTenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [orgMemberships.userId],
    references: [users.id],
  }),
}));

export const inviteCodesRelations = relations(inviteCodes, ({ one }) => ({
  organization: one(organizations, {
    fields: [inviteCodes.organizationId],
    references: [organizations.id],
  }),
  platformTenant: one(tenants, {
    fields: [inviteCodes.platformTenantId],
    references: [tenants.id],
  }),
  issuer: one(users, {
    fields: [inviteCodes.issuedBy],
    references: [users.id],
  }),
}));
