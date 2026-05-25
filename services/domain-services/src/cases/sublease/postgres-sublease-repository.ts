/**
 * Postgres-backed Sublease Request Repository (Wave 3).
 *
 * Implements SubleaseRequestRepository against `sublease_requests`
 * (migration 0017). Tenant-isolated on every read/write.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §7.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { subleaseRequests } from './sublease.schema.js';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type {
  SubleaseRequest,
  SubleaseRequestId,
  SubleaseRequestStatus,
  RentResponsibility,
} from './sublease-request.js';
import { asSubleaseRequestId } from './sublease-request.js';
import type { SubleaseRequestRepository } from './sublease-service.js';
import type { LeaseId, CustomerId } from '../index.js';

export interface PostgresSubleaseRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

export class PostgresSubleaseRepository implements SubleaseRequestRepository {
  constructor(private readonly db: PostgresSubleaseRepositoryClient) {}

  async findById(
    id: SubleaseRequestId,
    tenantId: TenantId
  ): Promise<SubleaseRequest | null> {
    const rows = await this.db
      .select()
      .from(subleaseRequests)
      .where(
        and(
          eq(subleaseRequests.id, id as unknown as string),
          eq(subleaseRequests.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToEntity(row) : null;
  }

  async findByLease(
    leaseId: LeaseId,
    tenantId: TenantId
  ): Promise<readonly SubleaseRequest[]> {
    const rows = await this.db
      .select()
      .from(subleaseRequests)
      .where(
        and(
          eq(subleaseRequests.parentLeaseId, leaseId as unknown as string),
          eq(subleaseRequests.tenantId, tenantId as unknown as string)
        )
      );
    return rows.map(rowToEntity);
  }

  async create(entity: SubleaseRequest): Promise<SubleaseRequest> {
    await this.db.insert(subleaseRequests).values(entityToRow(entity));
    return entity;
  }

  async update(entity: SubleaseRequest): Promise<SubleaseRequest> {
    await this.db
      .update(subleaseRequests)
      .set(entityToRow(entity))
      .where(
        and(
          eq(subleaseRequests.id, entity.id as unknown as string),
          eq(subleaseRequests.tenantId, entity.tenantId as unknown as string)
        )
      );
    return entity;
  }

  // -------------------------------------------------------------------------
  // Amendment operations (Wave 3)
  // -------------------------------------------------------------------------

  async updateStatus(
    id: SubleaseRequestId,
    tenantId: TenantId,
    status: SubleaseRequestStatus,
    actor: UserId
  ): Promise<void> {
    await this.db
      .update(subleaseRequests)
      .set({
        status,
        updatedAt: new Date(),
        updatedBy: actor as unknown as string,
      })
      .where(
        and(
          eq(subleaseRequests.id, id as unknown as string),
          eq(subleaseRequests.tenantId, tenantId as unknown as string)
        )
      );
  }

  async listByLease(
    leaseId: LeaseId,
    tenantId: TenantId
  ): Promise<readonly SubleaseRequest[]> {
    return this.findByLease(leaseId, tenantId);
  }

  async listPending(tenantId: TenantId): Promise<readonly SubleaseRequest[]> {
    const rows = await this.db
      .select()
      .from(subleaseRequests)
      .where(
        and(
          eq(subleaseRequests.tenantId, tenantId as unknown as string),
          inArray(subleaseRequests.status, ['pending'])
        )
      );
    return rows.map(rowToEntity);
  }
}

function entityToRow(entity: SubleaseRequest): Record<string, unknown> {
  const createdAt =
    typeof entity.createdAt === 'string' ? new Date(entity.createdAt) : entity.createdAt;
  const updatedAt =
    typeof entity.updatedAt === 'string' ? new Date(entity.updatedAt) : entity.updatedAt;
  return {
    id: entity.id as unknown as string,
    tenantId: entity.tenantId as unknown as string,
    parentLeaseId: entity.parentLeaseId as unknown as string,
    requestedBy: entity.requestedBy as unknown as string,
    subtenantCandidateId: (entity.subtenantCandidateId as unknown as string) ?? null,
    reason: entity.reason ?? null,
    startDate: entity.startDate ? new Date(entity.startDate) : null,
    endDate: entity.endDate ? new Date(entity.endDate) : null,
    rentResponsibility: entity.rentResponsibility,
    splitPercent: entity.splitPercent ?? null,
    status: entity.status,
    approvalRequestId: entity.approvalRequestId ?? null,
    createdAt,
    updatedAt,
    createdBy: entity.createdBy as unknown as string,
    updatedBy: entity.updatedBy as unknown as string,
  };
}

function rowToEntity(row: any): SubleaseRequest {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt;
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt;
  const startDate =
    row.startDate instanceof Date ? row.startDate.toISOString() : row.startDate;
  const endDate =
    row.endDate instanceof Date ? row.endDate.toISOString() : row.endDate;
  return {
    id: asSubleaseRequestId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    parentLeaseId: row.parentLeaseId as unknown as LeaseId,
    requestedBy: row.requestedBy as unknown as CustomerId,
    subtenantCandidateId: row.subtenantCandidateId
      ? (row.subtenantCandidateId as unknown as CustomerId)
      : undefined,
    reason: row.reason ?? undefined,
    startDate: startDate ? (startDate as ISOTimestamp) : undefined,
    endDate: endDate ? (endDate as ISOTimestamp) : undefined,
    rentResponsibility: (row.rentResponsibility ?? 'primary_tenant') as RentResponsibility,
    splitPercent: row.splitPercent ?? undefined,
    status: (row.status ?? 'pending') as SubleaseRequestStatus,
    approvalRequestId: row.approvalRequestId ?? undefined,
    createdAt: createdAt as ISOTimestamp,
    updatedAt: updatedAt as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}
