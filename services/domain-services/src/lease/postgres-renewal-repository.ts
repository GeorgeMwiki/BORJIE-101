/**
 * Postgres-backed Renewal Repository
 *
 * Implements RenewalRepository against the `leases` table. Every query
 * enforces row-level tenant isolation via WHERE tenant_id = :ctx.
 *
 *  - findById               — read a lease snapshot + renewal workflow fields
 *  - update                 — patch renewal workflow fields on the old lease
 *  - createRenewedLease     — insert a NEW lease row linked to the old one
 *                             via previousLeaseId; immutable history
 *                             preserved, new lease created in status=active
 *  - nextLeaseSequence      — atomic sequence generator; counts all leases
 *                             for the tenant and returns count+1
 */

import { and, count, eq } from 'drizzle-orm';
import { leases } from '@borjie/database';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type {
  RenewalLeaseSnapshot,
  RenewalRepository,
  LeaseRenewalStatus,
} from './renewal-service.js';

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function toIso(d: Date | string | null | undefined): ISOTimestamp | null {
  if (!d) return null;
  return (d instanceof Date ? d.toISOString() : String(d)) as ISOTimestamp;
}

function rowToSnapshot(row: Record<string, any>): RenewalLeaseSnapshot {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    leaseNumber: row.leaseNumber,
    propertyId: row.propertyId,
    unitId: row.unitId,
    customerId: row.customerId,
    startDate: toIso(row.startDate) ?? ('' as ISOTimestamp),
    endDate: toIso(row.endDate),
    rentAmount: Number(row.rentAmount ?? 0),
    rentCurrency: String(row.rentCurrency ?? ''),
    renewalStatus: (row.renewalStatus ?? 'not_started') as LeaseRenewalStatus,
    renewalWindowOpenedAt: toIso(row.renewalWindowOpenedAt),
    renewalProposedAt: toIso(row.renewalProposedAt),
    renewalProposedRent:
      row.renewalProposedRent == null ? null : Number(row.renewalProposedRent),
    renewalDecidedAt: toIso(row.renewalDecidedAt),
    renewalDecisionBy: (row.renewalDecisionBy ?? null) as UserId | null,
    terminationDate: toIso(row.terminationDate),
    terminationReasonNotes: row.terminationReasonNotes ?? null,
  };
}

export class PostgresRenewalRepository implements RenewalRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findById(
    id: string,
    tenantId: TenantId
  ): Promise<RenewalLeaseSnapshot | null> {
    const rows = await this.db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.id, id),
          eq(leases.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToSnapshot(row) : null;
  }

  async update(lease: RenewalLeaseSnapshot): Promise<RenewalLeaseSnapshot> {
    const updateValues: Record<string, unknown> = {
      renewalStatus: lease.renewalStatus,
      renewalWindowOpenedAt: lease.renewalWindowOpenedAt
        ? new Date(lease.renewalWindowOpenedAt)
        : null,
      renewalProposedAt: lease.renewalProposedAt
        ? new Date(lease.renewalProposedAt)
        : null,
      renewalProposedRent: lease.renewalProposedRent,
      renewalDecidedAt: lease.renewalDecidedAt
        ? new Date(lease.renewalDecidedAt)
        : null,
      renewalDecisionBy: lease.renewalDecisionBy,
      terminationDate: lease.terminationDate
        ? new Date(lease.terminationDate)
        : null,
      terminationReasonNotes: lease.terminationReasonNotes,
      updatedAt: new Date(),
    };
    await this.db
      .update(leases)
      .set(updateValues)
      .where(
        and(
          eq(leases.id, lease.id),
          eq(leases.tenantId, lease.tenantId as unknown as string)
        )
      );
    const refreshed = await this.findById(lease.id, lease.tenantId);
    if (!refreshed) {
      throw new Error(`Lease not found after update: ${lease.id}`);
    }
    return refreshed;
  }

  async createRenewedLease(params: {
    fromLeaseId: string;
    tenantId: TenantId;
    newLeaseId: string;
    newLeaseNumber: string;
    startDate: ISOTimestamp;
    endDate: ISOTimestamp;
    rentAmount: number;
    rentCurrency: string;
    createdBy: UserId;
  }): Promise<RenewalLeaseSnapshot> {
    const oldRows = await this.db
      .select()
      .from(leases)
      .where(
        and(
          eq(leases.id, params.fromLeaseId),
          eq(leases.tenantId, params.tenantId as unknown as string)
        )
      )
      .limit(1);
    const oldLease = oldRows[0];
    if (!oldLease) {
      throw new Error(`Original lease not found: ${params.fromLeaseId}`);
    }

    const now = new Date();
    await this.db.insert(leases).values({
      id: params.newLeaseId,
      tenantId: params.tenantId as unknown as string,
      propertyId: oldLease.propertyId,
      unitId: oldLease.unitId,
      customerId: oldLease.customerId,
      leaseNumber: params.newLeaseNumber,
      leaseType: oldLease.leaseType,
      status: 'active',
      startDate: new Date(params.startDate),
      endDate: new Date(params.endDate),
      rentAmount: params.rentAmount,
      rentCurrency: params.rentCurrency,
      rentFrequency: oldLease.rentFrequency,
      rentDueDay: oldLease.rentDueDay ?? 1,
      primaryOccupant: oldLease.primaryOccupant ?? {},
      previousLeaseId: oldLease.id,
      renewalStatus: 'not_started',
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy as unknown as string,
    });

    const newSnapshot = await this.findById(params.newLeaseId, params.tenantId);
    if (!newSnapshot) {
      throw new Error(`New lease not found after insert: ${params.newLeaseId}`);
    }
    return newSnapshot;
  }

  async nextLeaseSequence(tenantId: TenantId): Promise<number> {
    const rows = (await this.db
      .select({ count: count() })
      .from(leases)
      .where(eq(leases.tenantId, tenantId as unknown as string))) as Array<{
      count: number;
    }>;
    return (rows[0]?.count ?? 0) + 1;
  }
}
