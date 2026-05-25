/**
 * Postgres-backed Tenant Group Repository (Wave 3).
 *
 * Implements TenantGroupRepository against `tenant_groups` (migration 0017).
 * Member archival is additive (sets archivedAt on the relevant member inside
 * the JSONB members blob); members are never deleted.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §7.
 */

import { and, eq } from 'drizzle-orm';
import { tenantGroups } from './sublease.schema.js';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type {
  TenantGroup,
  TenantGroupId,
  TenantGroupMember,
  TenantGroupRole,
} from './tenant-group.js';
import { asTenantGroupId } from './tenant-group.js';
import type { TenantGroupRepository } from './sublease-service.js';
import type { LeaseId, CustomerId } from '../index.js';

export interface PostgresTenantGroupRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

export class PostgresTenantGroupRepository implements TenantGroupRepository {
  constructor(private readonly db: PostgresTenantGroupRepositoryClient) {}

  async findByPrimaryLease(
    leaseId: LeaseId,
    tenantId: TenantId
  ): Promise<TenantGroup | null> {
    const rows = await this.db
      .select()
      .from(tenantGroups)
      .where(
        and(
          eq(tenantGroups.primaryLeaseId, leaseId as unknown as string),
          eq(tenantGroups.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToEntity(row) : null;
  }

  async create(entity: TenantGroup): Promise<TenantGroup> {
    await this.db.insert(tenantGroups).values(entityToRow(entity));
    return entity;
  }

  async update(entity: TenantGroup): Promise<TenantGroup> {
    await this.db
      .update(tenantGroups)
      .set(entityToRow(entity))
      .where(
        and(
          eq(tenantGroups.id, entity.id as unknown as string),
          eq(tenantGroups.tenantId, entity.tenantId as unknown as string)
        )
      );
    return entity;
  }

  // -------------------------------------------------------------------------
  // Amendment operations (Wave 3) — additive findByLease / addMember /
  // archiveMember. Members are never deleted.
  // -------------------------------------------------------------------------

  async findByLease(
    leaseId: LeaseId,
    tenantId: TenantId
  ): Promise<TenantGroup | null> {
    return this.findByPrimaryLease(leaseId, tenantId);
  }

  async addMember(
    groupId: TenantGroupId,
    tenantId: TenantId,
    member: TenantGroupMember,
    actor: UserId
  ): Promise<TenantGroup | null> {
    const rows = await this.db
      .select()
      .from(tenantGroups)
      .where(
        and(
          eq(tenantGroups.id, groupId as unknown as string),
          eq(tenantGroups.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) return null;
    const entity = rowToEntity(existing);
    const nextMembers = [...entity.members, member];
    const updated: TenantGroup = {
      ...entity,
      members: nextMembers,
      updatedAt: new Date().toISOString() as ISOTimestamp,
      updatedBy: actor,
    };
    await this.update(updated);
    return updated;
  }

  async archiveMember(
    groupId: TenantGroupId,
    tenantId: TenantId,
    customerId: CustomerId,
    role: TenantGroupRole,
    actor: UserId
  ): Promise<TenantGroup | null> {
    const rows = await this.db
      .select()
      .from(tenantGroups)
      .where(
        and(
          eq(tenantGroups.id, groupId as unknown as string),
          eq(tenantGroups.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const existing = rows[0];
    if (!existing) return null;
    const entity = rowToEntity(existing);
    const now = new Date().toISOString() as ISOTimestamp;
    const nextMembers = entity.members.map((m) =>
      m.customerId === customerId && m.role === role && !m.archivedAt
        ? { ...m, archivedAt: now }
        : m
    );
    const updated: TenantGroup = {
      ...entity,
      members: nextMembers,
      updatedAt: now,
      updatedBy: actor,
    };
    await this.update(updated);
    return updated;
  }
}

function entityToRow(entity: TenantGroup): Record<string, unknown> {
  const createdAt =
    typeof entity.createdAt === 'string' ? new Date(entity.createdAt) : entity.createdAt;
  const updatedAt =
    typeof entity.updatedAt === 'string' ? new Date(entity.updatedAt) : entity.updatedAt;
  return {
    id: entity.id as unknown as string,
    tenantId: entity.tenantId as unknown as string,
    primaryLeaseId: entity.primaryLeaseId as unknown as string,
    members: entity.members,
    effectiveFrom: entity.effectiveFrom ? new Date(entity.effectiveFrom) : null,
    effectiveTo: entity.effectiveTo ? new Date(entity.effectiveTo) : null,
    createdAt,
    updatedAt,
    createdBy: entity.createdBy as unknown as string,
    updatedBy: entity.updatedBy as unknown as string,
  };
}

function rowToEntity(row: any): TenantGroup {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt;
  const effectiveFrom =
    row.effectiveFrom instanceof Date
      ? row.effectiveFrom.toISOString()
      : row.effectiveFrom;
  const effectiveTo =
    row.effectiveTo instanceof Date ? row.effectiveTo.toISOString() : row.effectiveTo;
  const members: readonly TenantGroupMember[] = Array.isArray(row.members)
    ? row.members
    : [];
  return {
    id: asTenantGroupId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    primaryLeaseId: row.primaryLeaseId as unknown as LeaseId,
    members,
    effectiveFrom: effectiveFrom ? (effectiveFrom as ISOTimestamp) : undefined,
    effectiveTo: effectiveTo ? (effectiveTo as ISOTimestamp) : undefined,
    createdAt: createdAt as ISOTimestamp,
    updatedAt: updatedAt as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}
