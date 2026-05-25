/**
 * Postgres-backed OrgMembership Repository
 *
 * Bridges TenantIdentity to Organization via a per-tenant shadow User row.
 * `create` is a two-phase write: first insert the shadow user, then insert
 * the membership — both within the same transaction so partial failures
 * roll back cleanly.
 *
 * A `UserShadowWriter` port abstracts the shadow-user insert so callers can
 * reuse the project's existing user-creation pipeline (password hash nullable
 * for federated identities; status = ACTIVE; primary_organization_id = the
 * org we're joining).
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { orgMemberships, users, organizations } from '@borjie/database';
import type {
  InviteCode,
  ISOTimestamp,
  OrgMembership,
  OrgMembershipId,
  OrgMembershipStatus,
  OrganizationId,
  RoleId,
  TenantId,
  TenantIdentityId,
  UserId,
} from '@borjie/domain-models';

export interface OrgMembershipRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  transaction: <T>(fn: (tx: OrgMembershipRepositoryClient) => Promise<T>) => Promise<T>;
}

/** Minimal shape used to write the shadow user row. */
export interface ShadowUserInput {
  readonly tenantId: TenantId;
  readonly organizationId: OrganizationId;
  readonly email: string | null;
  readonly phone: string | null;
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * Port for creating the per-tenant shadow user. Kept separate from the
 * membership repo so the project's existing user-creation pipeline can be
 * reused (password hashing rules, RBAC role seeding, etc.).
 */
export interface UserShadowWriter {
  createShadowUser(
    tx: OrgMembershipRepositoryClient,
    input: ShadowUserInput,
    roleId: RoleId
  ): Promise<UserId>;
}

/**
 * Default implementation: writes directly to the users table. Callers that
 * need RBAC role seeding should inject their own implementation.
 */
export class DefaultUserShadowWriter implements UserShadowWriter {
  async createShadowUser(
    tx: OrgMembershipRepositoryClient,
    input: ShadowUserInput,
    _roleId: RoleId
  ): Promise<UserId> {
    const id = `usr_${randomUUID()}`;
    // Shadow rows carry the federated email or a deterministic placeholder
    // when the identity has none yet. `users.email` is NOT NULL per schema.
    const email =
      input.email ??
      `shadow+${id}@identity.borjie.local`;
    await tx.insert(users).values({
      id,
      tenantId: input.tenantId as unknown as string,
      organizationId: input.organizationId as unknown as string,
      email,
      phone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      status: 'active' as const,
    });
    return id as unknown as UserId;
  }
}

function rowToMembership(row: {
  id: string;
  tenantIdentityId: string;
  organizationId: string;
  platformTenantId: string;
  userId: string;
  status: string;
  nickname: string | null;
  joinedViaInviteCode: string | null;
  joinedAt: Date | string;
}): OrgMembership {
  const joinedAt =
    row.joinedAt instanceof Date
      ? (row.joinedAt.toISOString() as ISOTimestamp)
      : (row.joinedAt as ISOTimestamp);
  return {
    id: row.id as unknown as OrgMembershipId,
    tenantIdentityId: row.tenantIdentityId as unknown as TenantIdentityId,
    organizationId: row.organizationId as unknown as OrganizationId,
    platformTenantId: row.platformTenantId as unknown as TenantId,
    userId: row.userId as unknown as UserId,
    status: row.status as OrgMembershipStatus,
    nickname: row.nickname,
    joinedViaInviteCode: (row.joinedViaInviteCode as unknown) as InviteCode | null,
    joinedAt,
  };
}

export interface CreateMembershipInput {
  readonly tenantIdentityId: TenantIdentityId;
  readonly organizationId: OrganizationId;
  readonly roleId: RoleId;
  readonly shadowProfile: Omit<ShadowUserInput, 'tenantId' | 'organizationId'>;
  readonly viaCode?: InviteCode;
  readonly nickname?: string;
}

export class PostgresOrgMembershipRepository {
  constructor(
    private readonly db: OrgMembershipRepositoryClient,
    private readonly shadowWriter: UserShadowWriter = new DefaultUserShadowWriter()
  ) {}

  async findByIdentity(
    identityId: TenantIdentityId
  ): Promise<readonly OrgMembership[]> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        eq(orgMemberships.tenantIdentityId, identityId as unknown as string)
      );
    return rows.map(rowToMembership);
  }

  async findByOrgAndIdentity(
    orgId: OrganizationId,
    identityId: TenantIdentityId
  ): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(
        and(
          eq(
            orgMemberships.tenantIdentityId,
            identityId as unknown as string
          ),
          eq(orgMemberships.organizationId, orgId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToMembership(row) : null;
  }

  async findById(id: OrgMembershipId): Promise<OrgMembership | null> {
    const rows = await this.db
      .select()
      .from(orgMemberships)
      .where(eq(orgMemberships.id, id as unknown as string))
      .limit(1);
    const row = rows[0];
    return row ? rowToMembership(row) : null;
  }

  /**
   * Create a fresh membership and its shadow user atomically.
   * Resolves the organization's platform_tenant_id from the organizations
   * table so callers don't have to thread it through.
   */
  async create(input: CreateMembershipInput): Promise<OrgMembership> {
    return this.db.transaction(async (tx) => {
      const orgRows = await tx
        .select({ id: organizations.id, tenantId: organizations.tenantId })
        .from(organizations)
        .where(eq(organizations.id, input.organizationId as unknown as string))
        .limit(1);
      const orgRow = orgRows[0];
      if (!orgRow) {
        throw new Error(
          `PostgresOrgMembershipRepository.create: organization ${input.organizationId} not found`
        );
      }
      const platformTenantId = orgRow.tenantId as unknown as TenantId;

      const userId = await this.shadowWriter.createShadowUser(
        tx,
        {
          tenantId: platformTenantId,
          organizationId: input.organizationId,
          email: input.shadowProfile.email,
          phone: input.shadowProfile.phone,
          firstName: input.shadowProfile.firstName,
          lastName: input.shadowProfile.lastName,
        },
        input.roleId
      );

      const id = `mem_${randomUUID()}`;
      const inserted = await tx
        .insert(orgMemberships)
        .values({
          id,
          tenantIdentityId: input.tenantIdentityId as unknown as string,
          organizationId: input.organizationId as unknown as string,
          platformTenantId: platformTenantId as unknown as string,
          userId: userId as unknown as string,
          status: 'ACTIVE' as const,
          nickname: input.nickname ?? null,
          joinedViaInviteCode: (input.viaCode as unknown as string) ?? null,
        })
        .returning();
      const row = inserted[0];
      if (!row) {
        throw new Error(
          'PostgresOrgMembershipRepository.create: insert returned no row'
        );
      }
      return rowToMembership(row);
    });
  }

  /** Flip status to LEFT and stamp left_at. Deactivates the shadow user. */
  async leave(id: OrgMembershipId): Promise<OrgMembership> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(orgMemberships)
        .where(eq(orgMemberships.id, id as unknown as string))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error(
          `PostgresOrgMembershipRepository.leave: membership ${id} not found`
        );
      }
      const now = new Date();
      const updated = await tx
        .update(orgMemberships)
        .set({ status: 'LEFT', leftAt: now })
        .where(eq(orgMemberships.id, id as unknown as string))
        .returning();
      await tx
        .update(users)
        .set({ status: 'deactivated' as const })
        .where(eq(users.id, row.userId));
      return rowToMembership(updated[0]);
    });
  }

  /** Flip status to BLOCKED, record reason, deactivate the shadow user. */
  async block(id: OrgMembershipId, reason: string): Promise<OrgMembership> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('PostgresOrgMembershipRepository.block: reason is required');
    }
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(orgMemberships)
        .where(eq(orgMemberships.id, id as unknown as string))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error(
          `PostgresOrgMembershipRepository.block: membership ${id} not found`
        );
      }
      const now = new Date();
      const updated = await tx
        .update(orgMemberships)
        .set({ status: 'BLOCKED', blockedAt: now, blockReason: reason })
        .where(eq(orgMemberships.id, id as unknown as string))
        .returning();
      await tx
        .update(users)
        .set({ status: 'suspended' as const })
        .where(eq(users.id, row.userId));
      return rowToMembership(updated[0]);
    });
  }
}
