/**
 * Offtake queue — types, enums, Zod validators.
 *
 * Buyers waiting for ore parcels of a given mineral. Each entry tracks
 * the requested quantity, max price (TZS), priority, and per-buyer
 * filters (refinery requirement, grade band, etc.). Status moves
 * forward only: waiting → matched → fulfilled (or expired/cancelled).
 */

import { z } from 'zod';
import type { TenantId } from '@borjie/domain-models';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const OFFTAKE_STATUSES = [
  'waiting',
  'matched',
  'fulfilled',
  'expired',
  'cancelled',
] as const;
export type OfftakeStatus = (typeof OFFTAKE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Domain shapes
// ---------------------------------------------------------------------------

export interface OfftakeQueueEntry {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly buyerId: string;
  readonly mineral: string;
  readonly requestedQuantityKg: number;
  readonly maxPriceTzs: number | null;
  readonly status: OfftakeStatus;
  readonly priority: number;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly matchedParcelId: string | null;
  readonly matchedAt: string | null;
  readonly fulfilledAt: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const enqueueSchema = z.object({
  id: z.string().min(1),
  buyerId: z.string().min(1),
  mineral: z.string().min(1).max(80),
  requestedQuantityKg: z.number().positive(),
  maxPriceTzs: z.number().nonnegative().nullable().optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  filters: z.record(z.string(), z.unknown()).default({}),
  expiresAt: z.string().nullable().optional(),
});
export type EnqueueInput = z.infer<typeof enqueueSchema>;

export const matchInputSchema = z.object({
  matchedParcelId: z.string().min(1),
});
export type MatchInput = z.infer<typeof matchInputSchema>;

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface OfftakeQueueRepository {
  enqueue(
    tenantId: TenantId,
    input: EnqueueInput,
  ): Promise<OfftakeQueueEntry>;
  findById(
    tenantId: TenantId,
    id: string,
  ): Promise<OfftakeQueueEntry | null>;
  listWaiting(
    tenantId: TenantId,
    mineral?: string,
  ): Promise<readonly OfftakeQueueEntry[]>;
  listForBuyer(
    tenantId: TenantId,
    buyerId: string,
  ): Promise<readonly OfftakeQueueEntry[]>;
  markMatched(
    tenantId: TenantId,
    id: string,
    input: MatchInput,
  ): Promise<OfftakeQueueEntry>;
  markFulfilled(
    tenantId: TenantId,
    id: string,
  ): Promise<OfftakeQueueEntry>;
  cancel(
    tenantId: TenantId,
    id: string,
    reason?: string,
  ): Promise<OfftakeQueueEntry>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class OfftakeQueueError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'VALIDATION'
      | 'NOT_FOUND'
      | 'TENANT_MISMATCH'
      | 'INVALID_TRANSITION',
  ) {
    super(message);
    this.name = 'OfftakeQueueError';
  }
}

// ---------------------------------------------------------------------------
// Status helpers (pure)
// ---------------------------------------------------------------------------

const ALLOWED_TRANSITIONS: Readonly<Record<OfftakeStatus, readonly OfftakeStatus[]>> =
  Object.freeze({
    waiting: ['matched', 'expired', 'cancelled'],
    matched: ['fulfilled', 'cancelled', 'expired'],
    fulfilled: [],
    expired: [],
    cancelled: [],
  });

export function canTransition(
  from: OfftakeStatus,
  to: OfftakeStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d ?? new Date().toISOString());
}

function nullableIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

export function rowToEntry(row: Record<string, unknown>): OfftakeQueueEntry {
  const statusRaw = String(row.status ?? 'waiting');
  const status: OfftakeStatus = (OFFTAKE_STATUSES as readonly string[]).includes(
    statusRaw,
  )
    ? (statusRaw as OfftakeStatus)
    : 'waiting';
  return {
    id: String(row.id),
    tenantId: row.tenantId as TenantId,
    buyerId: String(row.buyerId),
    mineral: String(row.mineral ?? ''),
    requestedQuantityKg: Number(row.requestedQuantityKg ?? 0),
    maxPriceTzs:
      row.maxPriceTzs == null ? null : Number(row.maxPriceTzs),
    status,
    priority: Number(row.priority ?? 100),
    filters: (row.filters as Record<string, unknown>) ?? {},
    matchedParcelId: (row.matchedParcelId as string | null) ?? null,
    matchedAt: nullableIso(row.matchedAt),
    fulfilledAt: nullableIso(row.fulfilledAt),
    expiresAt: nullableIso(row.expiresAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}
