/**
 * Drizzle-backed GDPR repository — Wave 9 enterprise polish.
 *
 * Straightforward mapping between `GdprDeletionRequest` entity and the
 * `gdpr_deletion_requests` table.
 */
import { eq, and } from 'drizzle-orm';
import { gdprDeletionRequests } from '@borjie/database';
import type { GdprDeletionRequest, GdprRepository, GdprDeletionStatus } from './gdpr-service.js';

/** Loose drizzle chain — see iot-service for the convention. */
interface GdprDrizzleChain extends PromiseLike<Record<string, unknown>[]> {
  values: (..._args: unknown[]) => GdprDrizzleChain;
  returning: (..._args: unknown[]) => GdprDrizzleChain;
  from: (..._args: unknown[]) => GdprDrizzleChain;
  where: (..._args: unknown[]) => GdprDrizzleChain;
  set: (..._args: unknown[]) => GdprDrizzleChain;
  limit: (..._args: unknown[]) => GdprDrizzleChain;
  orderBy: (..._args: unknown[]) => GdprDrizzleChain;
  [method: string]: unknown;
}

export interface DrizzleLike {
  select: (..._args: unknown[]) => GdprDrizzleChain;
  insert: (..._args: unknown[]) => GdprDrizzleChain;
  update: (..._args: unknown[]) => GdprDrizzleChain;
  [k: string]: unknown;
}

export class DrizzleGdprRepository implements GdprRepository {
  constructor(private readonly db: DrizzleLike) {}

  async insert(row: GdprDeletionRequest): Promise<GdprDeletionRequest> {
    await this.db.insert(gdprDeletionRequests).values(toRow(row));
    return row;
  }

  async update(row: GdprDeletionRequest): Promise<GdprDeletionRequest> {
    await this.db
      .update(gdprDeletionRequests)
      .set(toRow(row))
      .where(eq(gdprDeletionRequests.id, row.id));
    return row;
  }

  async findById(
    id: string,
    tenantId: string,
  ): Promise<GdprDeletionRequest | null> {
    const rows = await this.db
      .select()
      .from(gdprDeletionRequests)
      .where(
        and(
          eq(gdprDeletionRequests.id, id),
          eq(gdprDeletionRequests.tenantId, tenantId),
        ),
      )
      .limit(1);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? fromRow(r) : null;
  }

  async findByIdAny(id: string): Promise<GdprDeletionRequest | null> {
    const rows = await this.db
      .select()
      .from(gdprDeletionRequests)
      .where(eq(gdprDeletionRequests.id, id))
      .limit(1);
    const r = (rows as Record<string, unknown>[])[0];
    return r ? fromRow(r) : null;
  }

  async listByTenant(
    tenantId: string,
  ): Promise<readonly GdprDeletionRequest[]> {
    const rows = await this.db
      .select()
      .from(gdprDeletionRequests)
      .where(eq(gdprDeletionRequests.tenantId, tenantId));
    return (rows as Record<string, unknown>[]).map(fromRow);
  }
}

function toRow(r: GdprDeletionRequest): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    customerId: r.customerId,
    status: r.status,
    requestedBy: r.requestedBy,
    requestedAt: new Date(r.requestedAt),
    executedBy: r.executedBy,
    executedAt: r.executedAt ? new Date(r.executedAt) : null,
    rejectedReason: r.rejectedReason,
    pseudonymId: r.pseudonymId,
    affectedTables: [...r.affectedTables],
    notes: r.notes,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
  };
}

function fromRow(row: Record<string, unknown>): GdprDeletionRequest {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    customerId: row.customerId as string,
    status: (row.status as GdprDeletionStatus) ?? 'pending',
    requestedBy: row.requestedBy as string,
    requestedAt: toIso(row.requestedAt as Date | string),
    executedBy: (row.executedBy as string | null) ?? null,
    executedAt: row.executedAt ? toIso(row.executedAt as Date | string) : null,
    rejectedReason: (row.rejectedReason as string | null) ?? null,
    pseudonymId: (row.pseudonymId as string | null) ?? null,
    affectedTables: Array.isArray(row.affectedTables)
      ? (row.affectedTables as string[])
      : [],
    notes: (row.notes as string | null) ?? null,
    createdAt: toIso(row.createdAt as Date | string),
    updatedAt: toIso(row.updatedAt as Date | string),
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}