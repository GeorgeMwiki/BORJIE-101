/**
 * Tenant and Identity Schemas
 * Multi-tenant core tables with RLS support
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Platform-default data-residency region — TZ pilot is the first launch country.
// Per-tenant region overrides this default at admin-console tenant-edit time.
const PLATFORM_DEFAULT_REGION = 'af-south-1';

// ============================================================================
// Enums
// ============================================================================

export const tenantStatusEnum = pgEnum('tenant_status', [
  'active',
  'suspended',
  'pending',
  'trial',
  'cancelled',
]);

export const subscriptionTierEnum = pgEnum('subscription_tier', [
  'starter',
  'professional',
  'enterprise',
  'custom',
]);

// Borjie mining-domain plan tiers (Swahili-named).
// mwanzo    = starter / free trial
// mkulima   = small-scale miner (PML holder)
// mfanyabiashara = trader / dealer
// kampuni   = company (PL/ML holder)
// group     = multi-company holding
export const borjiePlanEnum = pgEnum('borjie_plan', [
  'mwanzo',
  'mkulima',
  'mfanyabiashara',
  'kampuni',
  'group',
]);

// Borjie mining roles.
export const borjieUserRoleEnum = pgEnum('borjie_user_role', [
  'owner',
  'admin',
  'site_manager',
  'supervisor',
  'driver',
  'geologist',
  'stores',
  'qc_officer',
  'buyer',
  'borjie_team',
]);

export const userStatusEnum = pgEnum('user_status', [
  'pending_activation',
  'active',
  'suspended',
  'deactivated',
]);

export const sessionStatusEnum = pgEnum('session_status', [
  'active',
  'expired',
  'revoked',
]);

export const auditEventTypeEnum = pgEnum('audit_event_type', [
  'user.created',
  'user.updated',
  'user.deleted',
  'user.login',
  'user.logout',
  'user.password_changed',
  'tenant.created',
  'tenant.updated',
  'tenant.suspended',
  'role.assigned',
  'role.revoked',
  'permission.granted',
  'permission.revoked',
  'data.accessed',
  'data.modified',
  'data.exported',
]);

// ============================================================================
// Tenants Table
// ============================================================================

export const tenants = pgTable(
  'tenants',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: tenantStatusEnum('status').notNull().default('pending'),
    subscriptionTier: subscriptionTierEnum('subscription_tier').notNull().default('starter'),
    // Borjie mining-domain plan tier. Drives feature gates + AI-agent
    // budgets. Defaults to 'mkulima' (small-scale miner) per DATA_MODEL §1.
    plan: borjiePlanEnum('plan').notNull().default('mkulima'),

    // Contact info
    primaryEmail: text('primary_email').notNull(),
    primaryPhone: text('primary_phone'),
    
    // Address
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    /**
     * ISO-3166-1 alpha-2. Drives currency / phone / KYC via
     * `@borjie/compliance-plugins`. Nullable during rollout — a
     * future migration backfills every row and adds NOT NULL. The
     * legacy 'KE' default was dropped in migration 0034 so tenants
     * without an explicit country fall back to DEFAULT_COUNTRY_ID
     * with a logged warning instead of being silently Kenyan.
     */
    country: text('country'),
    /**
     * Data-residency region (A2b-3 wire #7). Drives KMS-key selection
     * and cross-region SELECT short-circuits. The DB default matches the
     * platform-wide AWS_REGION env-default; the per-tenant region is
     * sourced from jurisdictional-rules.awsRegionDefault at tenant
     * creation. Migration 0158 adds the column + index; admin console
     * updates this per tenant.
     */
    region: text('region').notNull().default(PLATFORM_DEFAULT_REGION),

    // ── Self-signup discriminator + locale beachhead (migration 0085) ──
    /**
     * Discriminator for the owner self-signup flow:
     *   - 'individual': artisanal/single-person owner. No business reg.
     *   - 'business':   registered company (BRELA in TZ). Requires reg
     *                   number + TIN once kyc_status='verified'.
     * Legacy rows default to 'business' so existing seeded tenants
     * (which represent companies) inherit the right semantics.
     */
    accountKind: text('account_kind').notNull().default('business'),
    /**
     * Display currency preference. The platform is multi-currency
     * (CLAUDE.md "Multi-currency, TZS-primary") so this is the user's
     * preferred rendering currency, NOT the contract-leg currency.
     */
    primaryCurrency: text('primary_currency').notNull().default('TZS'),
    /**
     * UI language preference at the tenant level. Used to seed every
     * new user invited into this tenant. Swahili-first per CLAUDE.md.
     * Allowed: sw | en | fr | pt | sw-KE | es | id (migration 0143).
     */
    defaultLanguage: text('default_language').notNull().default('sw'),

    // ── World-scale tenant config (migration 0143, issue #207) ──
    /**
     * ISO-3166-1 alpha-2 — canonical country code the tenant-config
     * service reads. Legacy `country` column is kept untouched for
     * back-compat; new code reads `country_code`. Default 'TZ' so
     * existing rows behave identically.
     */
    countryCode: text('country_code').notNull().default('TZ'),
    /**
     * Active regulator set. Drives the regulator_jurisdictions join,
     * the compliance route surface and the DSR/inspection narrative
     * authority allowlist. Default 'TZ-set' (PCCB / NEMC / EITI / TMAA).
     * Other valid values: KE-set, UG-set, NG-set, ZA-set, AU-set,
     * CL-set, ID-set, generic.
     */
    regulatorSet: text('regulator_set').notNull().default('TZ-set'),
    /**
     * Mineral kinds the tenant is licensed to handle — canonical slugs
     * from the global mineral catalogue (gold, copper, lithium, etc.).
     * Default = TZ-set list per migration 0143; KE / NG / ZA / AU / CL /
     * ID tenants override at signup via tenant-config service.
     */
    allowedMinerals: jsonb('allowed_minerals')
      .$type<ReadonlyArray<string>>()
      .notNull()
      .default([
        'gold',
        'tanzanite',
        'ruby',
        'sapphire',
        'copper',
        'coal',
        'iron-ore',
        'nickel',
        'lithium',
        'graphite',
        'gemstone',
        'diamond',
      ]),

    // ── Scale-tier discriminator (migration 0145) ──
    /**
     * Owner-org size band — Borjie spans ANY mining scale from a 1-worker
     * artisanal pit to a 5,000-worker industrial group. The wizard
     * auto-detects this from (workerCount, siteCount, mineralCount,
     * crossBorder) at signup; admins may override it later.
     *
     *   t1_artisanal     1-5 workers
     *   t2_cooperative   5-50 workers
     *   t3_midtier       50-500 workers
     *   t4_industrial    500-5000 workers
     *   t5_multi_country multi-tenant cross-border group
     *
     * Drives:
     *   - default tab set (packages/owner-os-tabs/src/scale-defaults)
     *   - Mr. Mwikila persona register (brain-teach prompts)
     *   - orchestration flow depth (services/.../orchestration/scale-flows)
     *   - billing-tier hint (marketing surface — not billing logic)
     */
    scaleTier: text('scale_tier').notNull().default('t1_artisanal'),
    /**
     * Raw signal tuple the wizard captured — kept so a recomputer can
     * upgrade the tier later without re-prompting the owner. Shape:
     *   { workerCount, siteCount, mineralCount, crossBorder, computedAt }
     */
    scaleSignals: jsonb('scale_signals').notNull().default({}),

    // ── KYC atoms (migration 0085) ──
    /** PML / PL / ML number (TZ mining licence). Voluntary at signup. */
    miningLicenceNumber: text('mining_licence_number'),
    /** BRELA company registration number. Business-kind only. */
    businessRegistrationNumber: text('business_registration_number'),
    /** TIN (TZ tax identification number). Required for businesses. */
    taxId: text('tax_id'),
    /** VAT number. Business-kind only, optional. */
    vatNumber: text('vat_number'),
    /** Bank account IBAN. Business-kind only, optional. */
    bankAccountIban: text('bank_account_iban'),
    /** NIDA national-ID number. Individual-kind only, voluntary. */
    nationalIdNumber: text('national_id_number'),
    /** Emergency / next-of-kin contact. Individual-kind only. */
    kinContact: jsonb('kin_contact'),
    /**
     * KYC lifecycle:
     *   - unverified: signup complete, no atoms cleared
     *   - partial:    some atoms cleared (e.g. NIDA but no biometric)
     *   - verified:   all required atoms cleared per account_kind
     */
    kycStatus: text('kyc_status').notNull().default('unverified'),
    /**
     * Array of atom slugs that the compliance-plugins have cleared.
     * Append-only at the application layer; the migration's CHECK
     * constraint enforces the verified-state invariant.
     */
    kycAtomsCompleted: jsonb('kyc_atoms_completed').notNull().default([]),

    // ── Daily-brief cadence + delivery (migration 0092) ──
    /**
     * Cron-driven cadence selector for the AI daily brief.
     * Format: 'off' OR 'daily_HH:MM_tz' (HH:MM in Africa/Dar_es_Salaam).
     * The `daily-brief-cron` worker parses HH:MM and fires the brief
     * once per local-day per tenant. DB CHECK constraint enforces shape.
     */
    dailyBriefCadence: text('daily_brief_cadence')
      .notNull()
      .default('daily_06:00_tz'),
    /**
     * Channels the worker should dispatch the brief on. Subset of
     * ['email','sms','slack']. Email default — sms / slack opt-in.
     * Per-channel adapters live in `services/api-gateway/src/services/
     * notification-dispatch/`.
     */
    dailyBriefChannels: jsonb('daily_brief_channels')
      .$type<ReadonlyArray<'email' | 'sms' | 'slack'>>()
      .notNull()
      .default(['email']),
    /**
     * Recipients for the brief — one envelope per row.
     * `[{userId, email, phone, slackHandle}, ...]`.
     * The cron resolves each recipient against its enabled channels;
     * missing handles per channel are recorded as `skipped` in the
     * dispatch ledger so the operator can see the gap.
     */
    dailyBriefRecipients: jsonb('daily_brief_recipients')
      .$type<
        ReadonlyArray<{
          readonly userId?: string;
          readonly email?: string;
          readonly phone?: string;
          readonly slackHandle?: string;
        }>
      >()
      .notNull()
      .default([]),

    // Settings
    settings: jsonb('settings').default({}),
    billingSettings: jsonb('billing_settings').default({}),

    // Usage tracking
    maxUsers: integer('max_users').default(5),
    maxProperties: integer('max_properties').default(10),
    maxUnits: integer('max_units').default(100),
    currentUsers: integer('current_users').default(0),
    currentProperties: integer('current_properties').default(0),
    currentUnits: integer('current_units').default(0),

    // Trial
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    
    // Soft delete
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    slugIdx: uniqueIndex('tenants_slug_idx').on(table.slug),
    statusIdx: index('tenants_status_idx').on(table.status),
    createdAtIdx: index('tenants_created_at_idx').on(table.createdAt),
    countryIdx: index('tenants_country_idx').on(table.country),
    accountKindIdx: index('tenants_account_kind_idx').on(table.accountKind),
    kycStatusIdx: index('tenants_kyc_status_idx').on(table.kycStatus),
    countryAccountKindIdx: index('tenants_country_account_kind_idx').on(
      table.country,
      table.accountKind,
    ),
    scaleTierIdx: index('tenants_scale_tier_idx').on(table.scaleTier),
  })
);

// ============================================================================
// Organizations Table (for hierarchical tenant structure)
// ============================================================================

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    level: integer('level').notNull().default(0),
    path: text('path').notNull(), // Materialized path for hierarchy queries
    isActive: boolean('is_active').notNull().default(true),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    tenantIdx: index('organizations_tenant_idx').on(table.tenantId),
    codeIdx: uniqueIndex('organizations_code_tenant_idx').on(table.tenantId, table.code),
    parentIdx: index('organizations_parent_idx').on(table.parentId),
    pathIdx: index('organizations_path_idx').on(table.path),
  })
);

// ============================================================================
// Users Table
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organizations.id),
    
    // Identity
    email: text('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    
    // Profile
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    
    // Status
    status: userStatusEnum('status').notNull().default('pending_activation'),
    isOwner: boolean('is_owner').notNull().default(false),

    // Borjie mining-domain role. Drives mobile-app screen routing.
    miningRole: borjieUserRoleEnum('mining_role').notNull().default('owner'),
    /**
     * HR onboarding gate (migration 0134, issue #193 chain L-A).
     * pending | active | rejected | suspended.
     * Activation flips this to 'pending'; manager approval flips to
     * 'active' and decrements the source opening's count_needed.
     */
    workforceStatus: text('workforce_status').notNull().default('pending'),
    // TZ National Identification Authority ID verified via Smile ID.
    nidaId: text('nida_id'),
    // Irreversible biometric template hash (fingerprint) for non-repudiable sign-off.
    biometricTemplateHash: text('biometric_template_hash'),
    // Preferred UI language. Default 'sw' (Kiswahili) — Borjie is sw-first.
    // UNIV-4: column default = TZ launch beachhead (sw); future jurisdictions write their own value from jurisdiction-profile installed language packs (en-GB, en-US, de, pt-BR, etc.). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    preferredLang: text('preferred_lang').notNull().default('sw'),
    
    // Security
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: text('mfa_secret'),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    
    // Invitation
    invitationToken: text('invitation_token'),
    invitationExpiresAt: timestamp('invitation_expires_at', { withTimezone: true }),
    invitedBy: text('invited_by'),
    
    // Activity tracking
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip'),
    
    // Preferences
    preferences: jsonb('preferences').default({}),
    timezone: text('timezone').default('UTC'),
    locale: text('locale').default('en'),
    
    // Timestamps
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    tenantIdx: index('users_tenant_idx').on(table.tenantId),
    emailTenantIdx: uniqueIndex('users_email_tenant_idx').on(table.tenantId, table.email),
    orgIdx: index('users_org_idx').on(table.organizationId),
    statusIdx: index('users_status_idx').on(table.status),
    invitationTokenIdx: uniqueIndex('users_invitation_token_idx').on(table.invitationToken),
  })
);

// ============================================================================
// Roles Table
// ============================================================================

export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    permissions: jsonb('permissions').notNull().default([]),
    isSystem: boolean('is_system').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    updatedBy: text('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: text('deleted_by'),
  },
  (table) => ({
    tenantIdx: index('roles_tenant_idx').on(table.tenantId),
    nameTenantIdx: uniqueIndex('roles_name_tenant_idx').on(table.tenantId, table.name),
    systemIdx: index('roles_system_idx').on(table.isSystem),
  })
);

// ============================================================================
// User Roles Junction Table
// ============================================================================

export const userRoles = pgTable(
  'user_roles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    assignedBy: text('assigned_by'),
  },
  (table) => ({
    userRoleIdx: uniqueIndex('user_roles_user_role_idx').on(table.userId, table.roleId),
    tenantIdx: index('user_roles_tenant_idx').on(table.tenantId),
  })
);

// ============================================================================
// Sessions Table
// ============================================================================

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    
    // Session info
    status: sessionStatusEnum('status').notNull().default('active'),
    ipAddress: text('ip_address').notNull(),
    userAgent: text('user_agent'),
    deviceInfo: jsonb('device_info').default({}),
    
    // Security
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    revokedBy: text('revoked_by'),
  },
  (table) => ({
    tenantIdx: index('sessions_tenant_idx').on(table.tenantId),
    userIdx: index('sessions_user_idx').on(table.userId),
    statusIdx: index('sessions_status_idx').on(table.status),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
  })
);

// ============================================================================
// Audit Events Table (append-only)
// ============================================================================

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    
    // Event info
    eventType: auditEventTypeEnum('event_type').notNull(),
    action: text('action').notNull(),
    description: text('description'),
    
    // Actor
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    actorName: text('actor_name'),
    actorType: text('actor_type').notNull().default('user'),
    
    // Target
    targetType: text('target_type'),
    targetId: text('target_id'),
    
    // Context
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    sessionId: text('session_id'),
    
    // Data
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    metadata: jsonb('metadata').default({}),
    
    // Timestamp (immutable)
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('audit_events_tenant_idx').on(table.tenantId),
    eventTypeIdx: index('audit_events_event_type_idx').on(table.eventType),
    actorIdx: index('audit_events_actor_idx').on(table.actorId),
    targetIdx: index('audit_events_target_idx').on(table.targetType, table.targetId),
    occurredAtIdx: index('audit_events_occurred_at_idx').on(table.occurredAt),
  })
);

// ============================================================================
// Relations
// ============================================================================

export const tenantsRelations = relations(tenants, ({ many }) => ({
  organizations: many(organizations),
  users: many(users),
  roles: many(roles),
  sessions: many(sessions),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [organizations.tenantId],
    references: [tenants.id],
  }),
  parent: one(organizations, {
    fields: [organizations.parentId],
    references: [organizations.id],
    relationName: 'orgHierarchy',
  }),
  children: many(organizations, { relationName: 'orgHierarchy' }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
  userRoles: many(userRoles),
  sessions: many(sessions),
}));

export const rolesRelations = relations(roles, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [roles.tenantId],
    references: [tenants.id],
  }),
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  tenant: one(tenants, {
    fields: [userRoles.tenantId],
    references: [tenants.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [sessions.tenantId],
    references: [tenants.id],
  }),
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));
