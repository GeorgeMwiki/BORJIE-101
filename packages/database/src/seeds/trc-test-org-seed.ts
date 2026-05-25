// @ts-nocheck — import-assertion syntax replaced in TS 5.3+; drizzle 0.36 pgEnum narrowing mirrors demo-org-seed.

/**
 * TRC Corporation — Canonical Test Organization Seed
 *
 * Provisions ONLY the bare scaffold so a real human can sign in and have
 * the AI ("MD") populate every downstream entity through conversation:
 *
 *   - 1 tenant (TRC Corporation, country TZ, currency TZS)
 *   - 1 root organization (TRC Head Office)
 *   - 5 roles (internal_admin, property_manager, estate_manager, owner, customer)
 *   - 5 users, one per role, with deterministic IDs and stable email aliases
 *
 * The seed deliberately writes NO properties, units, leases, payments,
 * maintenance, or transactions. All operational data must be created by
 * the user's first conversation with the MD agent. This guarantees:
 *
 *   - the onboarding pipeline gets exercised end-to-end every release,
 *   - dashboards/widgets/charts render gracefully on empty state,
 *   - the AI's discovery-and-bootstrap loop is the single source of truth.
 *
 * Idempotency:
 *   - Deterministic natural-key IDs (`trc-*`) + `onConflictDoNothing`.
 *
 * Invocation:
 *   SEED_ORG_SEEDS=true DATABASE_URL=... pnpm db:seed --org=trc
 */

import type { DatabaseClient } from '../client.js';
import {
  tenants,
  organizations,
  users,
  roles,
  userRoles,
} from '../schemas/index.js';
import { seedTrcQuestionnaireBaseline } from './trc-questionnaire-baseline.js';
import { seedTrcElasticConfig } from './trc-elastic-config.js';

// ---------------------------------------------------------------------------
// Deterministic IDs — every entity has a stable natural-key id so the seed
// can be re-run safely against any environment.
// ---------------------------------------------------------------------------

export const TRC_TENANT_ID = 'trc-tenant';
export const TRC_ORG_ID = 'trc-org-head-office';

export const TRC_ROLE_IDS = {
  internal_admin: 'trc-role-internal-admin',
  property_manager: 'trc-role-property-manager',
  estate_manager: 'trc-role-estate-manager',
  owner: 'trc-role-owner',
  customer: 'trc-role-customer',
} as const;

export const TRC_USER_IDS = {
  internal_admin: 'trc-user-internal-admin',
  property_manager: 'trc-user-property-manager',
  estate_manager: 'trc-user-estate-manager',
  owner: 'trc-user-owner',
  customer: 'trc-user-customer',
} as const;

// ---------------------------------------------------------------------------
// Role specifications — minimal permission shape; the AI brain narrows
// further via per-action cap evaluation at request time. Permissions kept
// coarse-grained on purpose so policy churn stays in autonomy-governance
// rather than in the seed.
// ---------------------------------------------------------------------------

interface TrcRoleSpec {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly priority: number;
  readonly permissions: readonly string[];
}

const TRC_ROLES: readonly TrcRoleSpec[] = [
  {
    id: TRC_ROLE_IDS.internal_admin,
    name: 'internal_admin',
    displayName: 'Internal Platform Admin',
    description: 'BORJIE staff with cross-tenant admin scope for TRC.',
    priority: 100,
    permissions: ['*'],
  },
  {
    id: TRC_ROLE_IDS.property_manager,
    name: 'property_manager',
    displayName: 'Property Manager',
    description: 'Day-to-day operator: leasing, collections, maintenance, vendors.',
    priority: 70,
    permissions: [
      'property:read',
      'property:write',
      'unit:read',
      'unit:write',
      'lease:read',
      'lease:write',
      'tenant:read',
      'tenant:write',
      'maintenance:read',
      'maintenance:write',
      'payment:read',
      'communication:write',
    ],
  },
  {
    id: TRC_ROLE_IDS.estate_manager,
    name: 'estate_manager',
    displayName: 'Estate Manager',
    description: 'Portfolio-level oversight: approvals, reporting, owner relations.',
    priority: 80,
    permissions: [
      'property:read',
      'property:write',
      'unit:read',
      'lease:read',
      'lease:approve',
      'maintenance:read',
      'maintenance:approve',
      'payment:read',
      'report:read',
      'report:write',
      'owner:read',
      'owner:write',
    ],
  },
  {
    id: TRC_ROLE_IDS.owner,
    name: 'owner',
    displayName: 'Property Owner',
    description: 'Sees only their own portfolio: ROI, statements, advisory.',
    priority: 60,
    permissions: [
      'property:read:own',
      'unit:read:own',
      'lease:read:own',
      'payment:read:own',
      'report:read:own',
      'communication:read:own',
    ],
  },
  {
    id: TRC_ROLE_IDS.customer,
    name: 'customer',
    displayName: 'Tenant / Resident',
    description: 'Pays rent, raises tickets, sees their own lease and notices.',
    priority: 20,
    permissions: [
      'lease:read:own',
      'payment:read:own',
      'payment:write:own',
      'maintenance:read:own',
      'maintenance:write:own',
      'communication:read:own',
      'communication:write:own',
    ],
  },
];

// ---------------------------------------------------------------------------
// User specifications. Emails route to a single test inbox alias to keep
// invitation flows verifiable end-to-end without a per-role mailbox.
// ---------------------------------------------------------------------------

interface TrcUserSpec {
  readonly id: string;
  readonly roleName: keyof typeof TRC_ROLE_IDS;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly isOwner: boolean;
  readonly status: 'active' | 'pending_activation';
}

const TRC_USERS: readonly TrcUserSpec[] = [
  {
    id: TRC_USER_IDS.internal_admin,
    roleName: 'internal_admin',
    firstName: 'TRC',
    lastName: 'PlatformAdmin',
    email: 'trc+admin@borjie.test',
    phone: '+255700000001',
    isOwner: false,
    status: 'active',
  },
  {
    id: TRC_USER_IDS.property_manager,
    roleName: 'property_manager',
    firstName: 'TRC',
    lastName: 'PropertyManager',
    email: 'trc+pm@borjie.test',
    phone: '+255700000002',
    isOwner: false,
    status: 'active',
  },
  {
    id: TRC_USER_IDS.estate_manager,
    roleName: 'estate_manager',
    firstName: 'TRC',
    lastName: 'EstateManager',
    email: 'trc+em@borjie.test',
    phone: '+255700000003',
    isOwner: false,
    status: 'active',
  },
  {
    id: TRC_USER_IDS.owner,
    roleName: 'owner',
    firstName: 'TRC',
    lastName: 'Owner',
    email: 'trc+owner@borjie.test',
    phone: '+255700000004',
    isOwner: true,
    status: 'active',
  },
  {
    id: TRC_USER_IDS.customer,
    roleName: 'customer',
    firstName: 'TRC',
    lastName: 'Tenant',
    email: 'trc+tenant@borjie.test',
    phone: '+255700000005',
    isOwner: false,
    status: 'active',
  },
];

// ---------------------------------------------------------------------------
// Seed runner — one transaction, fully idempotent.
// ---------------------------------------------------------------------------

export async function seedTrcTestOrg(db: DatabaseClient): Promise<void> {
  console.log('[trc] starting seed');

  await db.transaction(async (tx) => {
    const now = new Date();

    // 1. Tenant -----------------------------------------------------------
    await tx
      .insert(tenants)
      .values({
        id: TRC_TENANT_ID,
        name: 'TRC Corporation',
        slug: 'trc',
        status: 'active',
        subscriptionTier: 'enterprise',
        primaryEmail: 'trc+admin@borjie.test',
        primaryPhone: '+255700000000',
        addressLine1: 'TRC Test Headquarters',
        city: 'Dar es Salaam',
        country: 'TZ',
        settings: {
          isTestOrganization: true,
          aiOnboardingMode: 'md_first',
          dataPolicy: 'no_seed_data',
          locale: 'sw-TZ',
          timezone: 'Africa/Dar_es_Salaam',
          currency: 'TZS',
        },
        maxUsers: 50,
        maxProperties: 500,
        maxUnits: 10_000,
        createdBy: 'system-seed-trc',
        updatedBy: 'system-seed-trc',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 2. Organization (head office) ---------------------------------------
    await tx
      .insert(organizations)
      .values({
        id: TRC_ORG_ID,
        tenantId: TRC_TENANT_ID,
        code: 'HQ',
        name: 'TRC Head Office',
        description: 'Root organization for TRC Corporation test tenant.',
        level: 0,
        path: TRC_ORG_ID,
        isActive: true,
        createdBy: 'system-seed-trc',
        updatedBy: 'system-seed-trc',
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // 3. Roles ------------------------------------------------------------
    for (const role of TRC_ROLES) {
      await tx
        .insert(roles)
        .values({
          id: role.id,
          tenantId: TRC_TENANT_ID,
          name: role.name,
          displayName: role.displayName,
          description: role.description,
          permissions: role.permissions as unknown as Record<string, unknown>,
          isSystem: true,
          isActive: true,
          priority: role.priority,
          createdBy: 'system-seed-trc',
          updatedBy: 'system-seed-trc',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }

    // 4. Users + role assignments ----------------------------------------
    for (const user of TRC_USERS) {
      await tx
        .insert(users)
        .values({
          id: user.id,
          tenantId: TRC_TENANT_ID,
          organizationId: TRC_ORG_ID,
          email: user.email,
          phone: user.phone,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName: `${user.firstName} ${user.lastName}`,
          status: user.status,
          isOwner: user.isOwner,
          mfaEnabled: false,
          failedLoginAttempts: 0,
          mustChangePassword: true,
          preferences: {
            onboardingState: 'awaiting_md_conversation',
            adaptiveUiVariant: 'default',
          },
          timezone: 'Africa/Dar_es_Salaam',
          locale: 'sw-TZ',
          activatedAt: user.status === 'active' ? now : null,
          createdBy: 'system-seed-trc',
          updatedBy: 'system-seed-trc',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();

      await tx
        .insert(userRoles)
        .values({
          id: `${user.id}__${TRC_ROLE_IDS[user.roleName]}`,
          userId: user.id,
          roleId: TRC_ROLE_IDS[user.roleName],
          tenantId: TRC_TENANT_ID,
          assignedAt: now,
          assignedBy: 'system-seed-trc',
        })
        .onConflictDoNothing();
    }
  });

  // 5. Intelligence baseline -----------------------------------------------
  // After the scaffold is in place, seed the questionnaire-derived brain
  // memory (semantic facts + core blocks + reflexion lessons) and the
  // elastic-architecture config (tenant.settings.elasticConfig +
  // approval_policies). Both are idempotent — re-running this seed
  // produces no net change. Operational data (properties/units/leases/
  // payments) is STILL not seeded; that contract is preserved.
  const baseline = await seedTrcQuestionnaireBaseline(db);
  const elastic = await seedTrcElasticConfig(db);

  console.log('[trc] seed complete:');
  console.log(`[trc]   tenant=${TRC_TENANT_ID}`);
  console.log(`[trc]   org=${TRC_ORG_ID}`);
  console.log(`[trc]   roles=${TRC_ROLES.length} users=${TRC_USERS.length}`);
  console.log(
    `[trc]   baseline: semantic=${baseline.semanticFactsWritten} core=${baseline.coreBlocksWritten} lessons=${baseline.lessonsWritten}`,
  );
  console.log(
    `[trc]   elastic: config_keys=${elastic.elasticConfigKeys.length} approval_policies=${elastic.approvalPoliciesWritten}`,
  );
  console.log(`[trc]   NOTE: no properties/units/leases/payments seeded —`);
  console.log(`[trc]   all operational data flows from the user's first MD chat.`);
}
