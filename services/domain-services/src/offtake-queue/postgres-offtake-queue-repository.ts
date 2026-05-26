/**
 * Postgres-backed Offtake Queue Repository (Borjie mining).
 *
 * Buyer-side waiting queue for ore parcels: a buyer registers their
 * desired mineral + quantity + max price and the matchmaker pairs
 * them with incoming production once a fit is found.
 *
 * Persists to `offtake_queue`. Tenant isolation enforced via
 * `WHERE tenant_id = :ctx` on every query.
 */

import { and, asc, eq } from 'drizzle-orm';
import { offtakeQueue } from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import {
  canTransition,
  enqueueSchema,
  matchInputSchema,
  OfftakeQueueError,
  rowToEntry,
  type EnqueueInput,
  type MatchInput,
  type OfftakeQueueEntry,
  type OfftakeQueueRepository,
  type OfftakeStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Drizzle client surface
// ---------------------------------------------------------------------------

interface DrizzleLike {
  select: (...args: unknown[]) => unknown;
  insert: (...args: unknown[]) => unknown;
  update: (...args: unknown[]) => unknown;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export class PostgresOfftakeQueueRepository
  implements OfftakeQueueRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async enqueue(
    tenantId: TenantId,
    input: EnqueueInput,
  ): Promise<OfftakeQueueEntry> {
    const validated = enqueueSchema.parse(input);
    const expiresAt = validated.expiresAt ? new Date(validated.expiresAt) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new OfftakeQueueError(
        'invalid expiresAt timestamp',
        'VALIDATION',
      );
    }
    const now = new Date();
    await (
      this.db as unknown as {
        insert: (t: typeof offtakeQueue) => {
          values: (v: Record<string, unknown>) => Promise<unknown>;
        };
      }
    )
      .insert(offtakeQueue)
      .values({
        id: validated.id,
        tenantId: tenantId as unknown as string,
        buyerId: validated.buyerId,
        mineral: validated.mineral,
        requestedQuantityKg: String(validated.requestedQuantityKg),
        maxPriceTzs:
          validated.maxPriceTzs == null ? null : String(validated.maxPriceTzs),
        status: 'waiting',
        priority: validated.priority,
        filters: validated.filters,
        matchedParcelId: null,
        matchedAt: null,
        fulfilledAt: null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    const created = await this.findById(tenantId, validated.id);
    if (!created) {
      throw new Error(
        `enqueue failed to persist offtake-queue entry ${validated.id}`,
      );
    }
    return created;
  }

  async findById(
    tenantId: TenantId,
    id: string,
  ): Promise<OfftakeQueueEntry | null> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof offtakeQueue) => {
            where: (cond: unknown) => {
              limit: (n: number) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(offtakeQueue)
      .where(
        and(
          eq(offtakeQueue.id, id),
          eq(offtakeQueue.tenantId, tenantId as unknown as string),
        ),
      )
      .limit(1)) as readonly Record<string, unknown>[];
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async listWaiting(
    tenantId: TenantId,
    mineral?: string,
  ): Promise<readonly OfftakeQueueEntry[]> {
    const where = mineral
      ? and(
          eq(offtakeQueue.tenantId, tenantId as unknown as string),
          eq(offtakeQueue.status, 'waiting'),
          eq(offtakeQueue.mineral, mineral),
        )
      : and(
          eq(offtakeQueue.tenantId, tenantId as unknown as string),
          eq(offtakeQueue.status, 'waiting'),
        );
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof offtakeQueue) => {
            where: (cond: unknown) => {
              orderBy: (
                ...cols: unknown[]
              ) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(offtakeQueue)
      .where(where)
      .orderBy(asc(offtakeQueue.priority), asc(offtakeQueue.createdAt))) as readonly Record<
      string,
      unknown
    >[];
    return rows.map(rowToEntry);
  }

  async listForBuyer(
    tenantId: TenantId,
    buyerId: string,
  ): Promise<readonly OfftakeQueueEntry[]> {
    const rows = (await (
      this.db as unknown as {
        select: () => {
          from: (t: typeof offtakeQueue) => {
            where: (cond: unknown) => {
              orderBy: (col: unknown) => Promise<readonly Record<string, unknown>[]>;
            };
          };
        };
      }
    )
      .select()
      .from(offtakeQueue)
      .where(
        and(
          eq(offtakeQueue.tenantId, tenantId as unknown as string),
          eq(offtakeQueue.buyerId, buyerId),
        ),
      )
      .orderBy(asc(offtakeQueue.createdAt))) as readonly Record<
      string,
      unknown
    >[];
    return rows.map(rowToEntry);
  }

  async markMatched(
    tenantId: TenantId,
    id: string,
    input: MatchInput,
  ): Promise<OfftakeQueueEntry> {
    const validated = matchInputSchema.parse(input);
    return this.applyTransition(tenantId, id, 'matched', {
      matchedParcelId: validated.matchedParcelId,
      matchedAt: new Date(),
    });
  }

  async markFulfilled(
    tenantId: TenantId,
    id: string,
  ): Promise<OfftakeQueueEntry> {
    return this.applyTransition(tenantId, id, 'fulfilled', {
      fulfilledAt: new Date(),
    });
  }

  async cancel(
    tenantId: TenantId,
    id: string,
    reason?: string,
  ): Promise<OfftakeQueueEntry> {
    const extra: Record<string, unknown> = {};
    if (reason !== undefined) {
      extra.filters = { cancellationReason: reason };
    }
    return this.applyTransition(tenantId, id, 'cancelled', extra);
  }

  private async applyTransition(
    tenantId: TenantId,
    id: string,
    toStatus: OfftakeStatus,
    extra: Record<string, unknown>,
  ): Promise<OfftakeQueueEntry> {
    const current = await this.findById(tenantId, id);
    if (!current) {
      throw new OfftakeQueueError(
        `offtake-queue entry ${id} not found`,
        'NOT_FOUND',
      );
    }
    if (!canTransition(current.status, toStatus)) {
      throw new OfftakeQueueError(
        `cannot transition from ${current.status} to ${toStatus}`,
        'INVALID_TRANSITION',
      );
    }
    const now = new Date();
    await (
      this.db as unknown as {
        update: (t: typeof offtakeQueue) => {
          set: (v: Record<string, unknown>) => {
            where: (cond: unknown) => Promise<unknown>;
          };
        };
      }
    )
      .update(offtakeQueue)
      .set({ status: toStatus, updatedAt: now, ...extra })
      .where(
        and(
          eq(offtakeQueue.id, id),
          eq(offtakeQueue.tenantId, tenantId as unknown as string),
        ),
      );
    const after = await this.findById(tenantId, id);
    if (!after) {
      throw new Error(
        `offtake-queue entry ${id} not found after status transition`,
      );
    }
    return after;
  }
}
