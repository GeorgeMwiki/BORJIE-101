/**
 * Postgres-backed TenantIdentity Repository
 *
 * Implements persistence for the global cross-org identity table. Phone is
 * the canonical key — all lookups go through the normalized form.
 *
 * Merge is transactional: on `merge(primaryId, duplicateId)` we move every
 * membership row from the duplicate to the primary, flag the duplicate as
 * DEACTIVATED + merged_into_id = primary, and commit atomically. Uniqueness
 * on `(tenantIdentityId, organizationId)` in `org_memberships` means a
 * pre-existing membership on the primary wins; the duplicate's copy is
 * dropped rather than re-parented.
 */

import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  tenantIdentities,
  orgMemberships,
} from '@borjie/database';
import type {
  ISOTimestamp,
  TenantIdentity,
  TenantIdentityId,
  TenantIdentityStatus,
} from '@borjie/domain-models';
import type { UserProfile } from '@borjie/domain-models';

export interface TenantIdentityRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  delete?: (...args: unknown[]) => any;
  transaction: <T>(fn: (tx: TenantIdentityRepositoryClient) => Promise<T>) => Promise<T>;
}

/** Input accepted by `create` — the repo fills id/createdAt/status. */
export interface CreateTenantIdentityInput {
  readonly phoneNormalized: string;
  readonly phoneCountryCode: string;
  readonly email?: string | null;
  readonly emailVerified?: boolean;
  readonly profile: UserProfile;
}

/** Partial update input — undefined fields are left untouched. */
export interface UpdateTenantIdentityInput {
  readonly email?: string | null;
  readonly emailVerified?: boolean;
  readonly profile?: UserProfile;
  readonly status?: TenantIdentityStatus;
  readonly lastActivityAt?: ISOTimestamp;
}

function rowToIdentity(row: {
  id: string;
  phoneNormalized: string;
  phoneCountryCode: string;
  email: string | null;
  emailVerified: boolean;
  profile: unknown;
  status: string;
  createdAt: Date | string;
  lastActivityAt: Date | string | null;
}): TenantIdentity {
  const createdAt =
    row.createdAt instanceof Date
      ? (row.createdAt.toISOString() as ISOTimestamp)
      : (row.createdAt as ISOTimestamp);
  const lastActivityAt =
    row.lastActivityAt == null
      ? null
      : row.lastActivityAt instanceof Date
        ? (row.lastActivityAt.toISOString() as ISOTimestamp)
        : (row.lastActivityAt as ISOTimestamp);
  return {
    id: row.id as unknown as TenantIdentityId,
    phoneNormalized: row.phoneNormalized,
    phoneCountryCode: row.phoneCountryCode,
    email: row.email,
    emailVerified: row.emailVerified,
    profile: (row.profile ?? {}) as UserProfile,
    status: row.status as TenantIdentityStatus,
    createdAt,
    lastActivityAt,
  };
}

export class PostgresTenantIdentityRepository {
  constructor(private readonly db: TenantIdentityRepositoryClient) {}

  async findByPhone(
    phoneNormalized: string,
    _countryCode: string
  ): Promise<TenantIdentity | null> {
    const rows = await this.db
      .select()
      .from(tenantIdentities)
      .where(eq(tenantIdentities.phoneNormalized, phoneNormalized))
      .limit(1);
    const row = rows[0];
    return row ? rowToIdentity(row) : null;
  }

  async findById(id: TenantIdentityId): Promise<TenantIdentity | null> {
    const rows = await this.db
      .select()
      .from(tenantIdentities)
      .where(eq(tenantIdentities.id, id as unknown as string))
      .limit(1);
    const row = rows[0];
    return row ? rowToIdentity(row) : null;
  }

  async create(input: CreateTenantIdentityInput): Promise<TenantIdentity> {
    const id = `tid_${randomUUID()}`;
    const values = {
      id,
      phoneNormalized: input.phoneNormalized,
      phoneCountryCode: input.phoneCountryCode,
      email: input.email ?? null,
      emailVerified: input.emailVerified ?? false,
      profile: input.profile as unknown as Record<string, unknown>,
      status: 'ACTIVE' as const,
    };
    const inserted = await this.db
      .insert(tenantIdentities)
      .values(values)
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error(
        'PostgresTenantIdentityRepository.create: insert returned no row'
      );
    }
    return rowToIdentity(row);
  }

  async update(
    id: TenantIdentityId,
    patch: UpdateTenantIdentityInput
  ): Promise<TenantIdentity> {
    // Immutable patch — caller's intent is expressed as a fresh object per
    // coding-style rules.
    const set: Record<string, unknown> = {};
    if (patch.email !== undefined) set.email = patch.email;
    if (patch.emailVerified !== undefined)
      set.emailVerified = patch.emailVerified;
    if (patch.profile !== undefined)
      set.profile = patch.profile as unknown as Record<string, unknown>;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.lastActivityAt !== undefined)
      set.lastActivityAt = new Date(patch.lastActivityAt);

    if (Object.keys(set).length === 0) {
      // nosemgrep: missing-tenant-id-arg reason: self-call inside the repository's own update — the underlying `findById` is the tenant-identity table; `id` IS the key. Tenant scope is one of the columns and the caller verifies it.
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error(
          `PostgresTenantIdentityRepository.update: identity ${id} not found`
        );
      }
      return existing;
    }

    const updated = await this.db
      .update(tenantIdentities)
      .set(set)
      .where(eq(tenantIdentities.id, id as unknown as string))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error(
        `PostgresTenantIdentityRepository.update: identity ${id} not found`
      );
    }
    return rowToIdentity(row);
  }

  /**
   * Merge `duplicateId` into `primaryId`. Atomic:
   *  1. Locate memberships on the duplicate.
   *  2. For each: if the primary already has a membership in the same
   *     organization, drop the duplicate's row (uniqueness would block
   *     re-parenting anyway). Otherwise re-parent by updating
   *     tenant_identity_id to the primary.
   *  3. Mark the duplicate DEACTIVATED and record merged_into_id.
   */
  async merge(
    primaryId: TenantIdentityId,
    duplicateId: TenantIdentityId
  ): Promise<TenantIdentity> {
    if (primaryId === duplicateId) {
      throw new Error(
        'PostgresTenantIdentityRepository.merge: primaryId === duplicateId'
      );
    }
    return this.db.transaction(async (tx) => {
      const primaryRows = await tx
        .select()
        .from(tenantIdentities)
        .where(eq(tenantIdentities.id, primaryId as unknown as string))
        .limit(1);
      if (primaryRows.length === 0) {
        throw new Error(
          `PostgresTenantIdentityRepository.merge: primary ${primaryId} not found`
        );
      }
      const duplicateRows = await tx
        .select()
        .from(tenantIdentities)
        .where(eq(tenantIdentities.id, duplicateId as unknown as string))
        .limit(1);
      if (duplicateRows.length === 0) {
        throw new Error(
          `PostgresTenantIdentityRepository.merge: duplicate ${duplicateId} not found`
        );
      }

      const primaryMembershipRows = await tx
        .select({ organizationId: orgMemberships.organizationId })
        .from(orgMemberships)
        .where(
          eq(orgMemberships.tenantIdentityId, primaryId as unknown as string)
        );
      const primaryOrgIds = new Set<string>(
        primaryMembershipRows.map((r: { organizationId: string }) => r.organizationId)
      );

      const duplicateMemberships = await tx
        .select()
        .from(orgMemberships)
        .where(
          eq(orgMemberships.tenantIdentityId, duplicateId as unknown as string)
        );

      const idsToDrop: string[] = [];
      const idsToReparent: string[] = [];
      for (const row of duplicateMemberships) {
        if (primaryOrgIds.has(row.organizationId)) {
          idsToDrop.push(row.id);
        } else {
          idsToReparent.push(row.id);
        }
      }

      if (idsToDrop.length > 0) {
        await tx
          .update(orgMemberships)
          .set({ status: 'LEFT', leftAt: new Date() })
          .where(inArray(orgMemberships.id, idsToDrop));
      }
      if (idsToReparent.length > 0) {
        await tx
          .update(orgMemberships)
          .set({ tenantIdentityId: primaryId as unknown as string })
          .where(inArray(orgMemberships.id, idsToReparent));
      }

      await tx
        .update(tenantIdentities)
        .set({
          status: 'DEACTIVATED',
          mergedIntoId: primaryId as unknown as string,
        })
        .where(eq(tenantIdentities.id, duplicateId as unknown as string));

      const refreshed = await tx
        .select()
        .from(tenantIdentities)
        .where(eq(tenantIdentities.id, primaryId as unknown as string))
        .limit(1);
      return rowToIdentity(refreshed[0]);
    });
  }

  /** Touch last_activity_at to NOW(). Non-blocking audit helper. */
  async touchActivity(id: TenantIdentityId): Promise<void> {
    await this.db
      .update(tenantIdentities)
      .set({ lastActivityAt: sql`NOW()` })
      .where(eq(tenantIdentities.id, id as unknown as string));
  }
}
