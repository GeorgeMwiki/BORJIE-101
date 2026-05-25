/**
 * Operations repositories — DispatchEvent, CompletionProof, VendorAssignment.
 *
 * These schemas existed in packages/database/src/schemas/maintenance.schema.ts
 * but had no matching repository. Added here so the api-gateway maintenance
 * routes can read/write them through a tenant-scoped, soft-delete-aware API.
 *
 * The schema/repo drift documented in PR #132 (missing dispatchEvents
 * lifecycle timestamps, completionProofs verify/reject columns, and
 * vendorAssignments.endsAt) was closed by adding the columns to
 * maintenance.schema.ts in this PR. @ts-nocheck has been removed.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DatabaseClient } from '../client.js';
import {
  dispatchEvents,
  completionProofs,
  vendorAssignments,
} from '../schemas/maintenance.schema.js';

type DispatchEventRow = typeof dispatchEvents.$inferSelect;
type CompletionProofRow = typeof completionProofs.$inferSelect;
type VendorAssignmentRow = typeof vendorAssignments.$inferSelect;

// ---------------------------------------------------------------------------
// DispatchEventRepository
// ---------------------------------------------------------------------------

export class DispatchEventRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<DispatchEventRow | null> {
    const rows = await this.db
      .select()
      .from(dispatchEvents)
      .where(
        and(eq(dispatchEvents.id, id), eq(dispatchEvents.tenantId, tenantId))
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForWorkOrder(
    workOrderId: string,
    tenantId: string
  ): Promise<DispatchEventRow[]> {
    return this.db
      .select()
      .from(dispatchEvents)
      .where(
        and(
          eq(dispatchEvents.tenantId, tenantId),
          eq(dispatchEvents.workOrderId, workOrderId)
        )
      )
      .orderBy(desc(dispatchEvents.createdAt));
  }

  async listForTenant(
    tenantId: string,
    opts: { status?: DispatchEventRow['status']; limit?: number } = {}
  ): Promise<DispatchEventRow[]> {
    const conds = [eq(dispatchEvents.tenantId, tenantId)];
    if (opts.status) conds.push(eq(dispatchEvents.status, opts.status));
    const q = this.db
      .select()
      .from(dispatchEvents)
      .where(and(...conds))
      .orderBy(desc(dispatchEvents.createdAt));
    return opts.limit ? q.limit(opts.limit) : q;
  }

  async create(
    input: Omit<DispatchEventRow, 'createdAt' | 'updatedAt'>
  ): Promise<DispatchEventRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(dispatchEvents)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error('Failed to create dispatch event');
    return row;
  }

  async updateStatus(
    id: string,
    tenantId: string,
    status: DispatchEventRow['status'],
    timestamps: Partial<
      Pick<
        DispatchEventRow,
        | 'acknowledgedAt'
        | 'enRouteAt'
        | 'onSiteAt'
        | 'completedAt'
        | 'cancelledAt'
      >
    > = {}
  ): Promise<DispatchEventRow | null> {
    const [row] = await this.db
      .update(dispatchEvents)
      .set({ status, ...timestamps, updatedAt: new Date() })
      .where(
        and(eq(dispatchEvents.id, id), eq(dispatchEvents.tenantId, tenantId))
      )
      .returning();
    return row ?? null;
  }
}

// ---------------------------------------------------------------------------
// CompletionProofRepository
// ---------------------------------------------------------------------------

export class CompletionProofRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<CompletionProofRow | null> {
    const rows = await this.db
      .select()
      .from(completionProofs)
      .where(
        and(eq(completionProofs.id, id), eq(completionProofs.tenantId, tenantId))
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForWorkOrder(
    workOrderId: string,
    tenantId: string
  ): Promise<CompletionProofRow[]> {
    return this.db
      .select()
      .from(completionProofs)
      .where(
        and(
          eq(completionProofs.tenantId, tenantId),
          eq(completionProofs.workOrderId, workOrderId)
        )
      )
      .orderBy(desc(completionProofs.createdAt));
  }

  async create(
    input: Omit<CompletionProofRow, 'createdAt' | 'updatedAt'>
  ): Promise<CompletionProofRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(completionProofs)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error('Failed to create completion proof');
    return row;
  }

  async verify(
    id: string,
    tenantId: string,
    verifiedBy: string
  ): Promise<CompletionProofRow | null> {
    const [row] = await this.db
      .update(completionProofs)
      .set({
        verifiedBy,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(completionProofs.id, id), eq(completionProofs.tenantId, tenantId))
      )
      .returning();
    return row ?? null;
  }

  async reject(
    id: string,
    tenantId: string,
    reason: string
  ): Promise<CompletionProofRow | null> {
    const now = new Date();
    const [row] = await this.db
      .update(completionProofs)
      .set({
        rejectedReason: reason,
        rejectedAt: now,
        updatedAt: now,
      })
      .where(
        and(eq(completionProofs.id, id), eq(completionProofs.tenantId, tenantId))
      )
      .returning();
    return row ?? null;
  }
}

// ---------------------------------------------------------------------------
// VendorAssignmentRepository
// ---------------------------------------------------------------------------

export class VendorAssignmentRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findById(id: string, tenantId: string): Promise<VendorAssignmentRow | null> {
    const rows = await this.db
      .select()
      .from(vendorAssignments)
      .where(
        and(eq(vendorAssignments.id, id), eq(vendorAssignments.tenantId, tenantId))
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForVendor(
    vendorId: string,
    tenantId: string
  ): Promise<VendorAssignmentRow[]> {
    return this.db
      .select()
      .from(vendorAssignments)
      .where(
        and(
          eq(vendorAssignments.tenantId, tenantId),
          eq(vendorAssignments.vendorId, vendorId)
        )
      )
      .orderBy(desc(vendorAssignments.createdAt));
  }

  async listForProperty(
    propertyId: string,
    tenantId: string
  ): Promise<VendorAssignmentRow[]> {
    return this.db
      .select()
      .from(vendorAssignments)
      .where(
        and(
          eq(vendorAssignments.tenantId, tenantId),
          eq(vendorAssignments.propertyId, propertyId)
        )
      )
      .orderBy(desc(vendorAssignments.priority));
  }

  async listByIds(
    ids: string[],
    tenantId: string
  ): Promise<VendorAssignmentRow[]> {
    if (!ids.length) return [];
    return this.db
      .select()
      .from(vendorAssignments)
      .where(
        and(
          eq(vendorAssignments.tenantId, tenantId),
          inArray(vendorAssignments.id, ids)
        )
      );
  }

  async create(
    input: Omit<VendorAssignmentRow, 'createdAt' | 'updatedAt'>
  ): Promise<VendorAssignmentRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(vendorAssignments)
      .values({ ...input, createdAt: now, updatedAt: now })
      .returning();
    if (!row) throw new Error('Failed to create vendor assignment');
    return row;
  }

  async deactivate(
    id: string,
    tenantId: string
  ): Promise<VendorAssignmentRow | null> {
    const [row] = await this.db
      .update(vendorAssignments)
      .set({ endsAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(vendorAssignments.id, id), eq(vendorAssignments.tenantId, tenantId))
      )
      .returning();
    return row ?? null;
  }
}
