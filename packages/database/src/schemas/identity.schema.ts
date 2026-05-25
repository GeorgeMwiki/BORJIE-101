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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants, organizations, users } from './tenant.schema.js';

// ============================================================================
// Enums
// ============================================================================

export const tenantIdentityStatusEnum = pgEnum('tenant_identity_status', [
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]);

export const orgMembershipStatusEnum = pgEnum('org_membership_status', [
  'ACTIVE',
  'LEFT',
  'BLOCKED',
]);

// ============================================================================
// tenant_identities — cross-org identity principal
// ============================================================================

export const tenantIdentities = pgTable(
  'tenant_identities',
  {
    id: text('id').primaryKey(),
    // ITU-T E.164 normalized phone (digits only, no '+')
    phoneNormalized: text('phone_normalized').notNull(),
    // ISO 3166-1 alpha-2 country code used for normalization
    phoneCountryCode: text('phone_country_code').notNull(),
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
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: orgMembershipStatusEnum('status').notNull().default('ACTIVE'),
    nickname: text('nickname'),
    joinedViaInviteCode: text('joined_via_invite_code'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Audit fields for leave / block operations
    leftAt: timestamp('left_at', { withTimezone: true }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockReason: text('block_reason'),
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
// Relations
// ============================================================================

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
