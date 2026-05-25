/**
 * Postgres-backed waitlist repositories (Drizzle).
 *
 * Two repos over `unit_waitlists` (mutable) and `waitlist_outreach_events`
 * (append-only). Dedup of active waitlist rows is enforced at the DB
 * level by a unique index on (tenant_id, unit_id, customer_id).
 *
 * Every query enforces row-level tenant isolation via WHERE tenant_id.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  unitWaitlists,
  waitlistOutreachEvents,
} from '@borjie/database';
import type { TenantId } from '@borjie/domain-models';
import type {
  UnitWaitlistEntry,
  WaitlistId,
  WaitlistOutreachEvent,
  WaitlistOutreachEventId,
  WaitlistOutreachRepository,
  WaitlistRepository,
} from './types.js';

export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// ============================================================================
// Waitlist
// ============================================================================

export class PostgresWaitlistRepository implements WaitlistRepository {
  constructor(private readonly db: DrizzleLike) {}

  async findById(
    id: WaitlistId,
    tenantId: TenantId
  ): Promise<UnitWaitlistEntry | null> {
    const rows = await this.db
      .select()
      .from(unitWaitlists)
      .where(
        and(
          eq(unitWaitlists.id, id as unknown as string),
          eq(unitWaitlists.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToEntry(row) : null;
  }

  async findActiveForCustomerUnit(
    tenantId: TenantId,
    unitId: string,
    customerId: string
  ): Promise<UnitWaitlistEntry | null> {
    const rows = await this.db
      .select()
      .from(unitWaitlists)
      .where(
        and(
          eq(unitWaitlists.tenantId, tenantId as unknown as string),
          eq(unitWaitlists.unitId, unitId),
          eq(unitWaitlists.customerId, customerId),
          eq(unitWaitlists.status, 'active')
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToEntry(row) : null;
  }

  async create(entry: UnitWaitlistEntry): Promise<UnitWaitlistEntry> {
    await this.db.insert(unitWaitlists).values(entryToRow(entry));
    return entry;
  }

  async update(
    id: WaitlistId,
    tenantId: TenantId,
    patch: Partial<UnitWaitlistEntry>
  ): Promise<UnitWaitlistEntry> {
    const updateValues = buildEntryUpdate(patch);
    await this.db
      .update(unitWaitlists)
      .set(updateValues)
      .where(
        and(
          eq(unitWaitlists.id, id as unknown as string),
          eq(unitWaitlists.tenantId, tenantId as unknown as string)
        )
      );
    const after = await this.findById(id, tenantId);
    if (!after) throw new Error(`Waitlist entry not found: ${id}`);
    return after;
  }

  async listActiveForUnit(
    tenantId: TenantId,
    unitId: string
  ): Promise<ReadonlyArray<UnitWaitlistEntry>> {
    const rows = await this.db
      .select()
      .from(unitWaitlists)
      .where(
        and(
          eq(unitWaitlists.tenantId, tenantId as unknown as string),
          eq(unitWaitlists.unitId, unitId),
          eq(unitWaitlists.status, 'active')
        )
      )
      .orderBy(asc(unitWaitlists.priority), asc(unitWaitlists.createdAt));
    return rows.map(rowToEntry);
  }

  async listForCustomer(
    tenantId: TenantId,
    customerId: string
  ): Promise<ReadonlyArray<UnitWaitlistEntry>> {
    const rows = await this.db
      .select()
      .from(unitWaitlists)
      .where(
        and(
          eq(unitWaitlists.tenantId, tenantId as unknown as string),
          eq(unitWaitlists.customerId, customerId)
        )
      )
      .orderBy(asc(unitWaitlists.createdAt));
    return rows.map(rowToEntry);
  }
}

// ============================================================================
// Waitlist Outreach (APPEND-ONLY)
// ============================================================================

export class PostgresWaitlistOutreachRepository
  implements WaitlistOutreachRepository
{
  constructor(private readonly db: DrizzleLike) {}

  async append(event: WaitlistOutreachEvent): Promise<WaitlistOutreachEvent> {
    await this.db.insert(waitlistOutreachEvents).values(eventToRow(event));
    return event;
  }

  async listByWaitlist(
    waitlistId: WaitlistId,
    tenantId: TenantId
  ): Promise<ReadonlyArray<WaitlistOutreachEvent>> {
    const rows = await this.db
      .select()
      .from(waitlistOutreachEvents)
      .where(
        and(
          eq(
            waitlistOutreachEvents.waitlistId,
            waitlistId as unknown as string
          ),
          eq(waitlistOutreachEvents.tenantId, tenantId as unknown as string)
        )
      )
      .orderBy(asc(waitlistOutreachEvents.occurredAt));
    return rows.map(rowToEvent);
  }
}

// ============================================================================
// Row <-> Entity mapping
// ============================================================================

function entryToRow(e: UnitWaitlistEntry): Record<string, unknown> {
  return {
    id: e.id,
    tenantId: e.tenantId,
    unitId: e.unitId,
    listingId: e.listingId,
    customerId: e.customerId,
    priority: e.priority,
    source: e.source,
    status: e.status,
    notificationPreferenceId: e.notificationPreferenceId,
    preferredChannels: e.preferredChannels,
    createdAt: new Date(e.createdAt),
    expiresAt: e.expiresAt ? new Date(e.expiresAt) : null,
    convertedAt: e.convertedAt ? new Date(e.convertedAt) : null,
    optedOutAt: e.optedOutAt ? new Date(e.optedOutAt) : null,
    optOutReason: e.optOutReason,
    lastNotifiedAt: e.lastNotifiedAt ? new Date(e.lastNotifiedAt) : null,
    notificationCount: e.notificationCount,
    updatedAt: new Date(e.updatedAt),
  };
}

function buildEntryUpdate(
  patch: Partial<UnitWaitlistEntry>
): Record<string, unknown> {
  const u: Record<string, unknown> = {};
  if (patch.priority !== undefined) u.priority = patch.priority;
  if (patch.status !== undefined) u.status = patch.status;
  if (patch.preferredChannels !== undefined)
    u.preferredChannels = patch.preferredChannels;
  if (patch.notificationPreferenceId !== undefined)
    u.notificationPreferenceId = patch.notificationPreferenceId;
  if (patch.expiresAt !== undefined)
    u.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
  if (patch.convertedAt !== undefined)
    u.convertedAt = patch.convertedAt ? new Date(patch.convertedAt) : null;
  if (patch.optedOutAt !== undefined)
    u.optedOutAt = patch.optedOutAt ? new Date(patch.optedOutAt) : null;
  if (patch.optOutReason !== undefined) u.optOutReason = patch.optOutReason;
  if (patch.lastNotifiedAt !== undefined)
    u.lastNotifiedAt = patch.lastNotifiedAt
      ? new Date(patch.lastNotifiedAt)
      : null;
  if (patch.notificationCount !== undefined)
    u.notificationCount = patch.notificationCount;
  u.updatedAt = new Date();
  return u;
}

function rowToEntry(row: Record<string, unknown>): UnitWaitlistEntry {
  return {
    id: row.id as WaitlistId,
    tenantId: row.tenantId as TenantId,
    unitId: (row.unitId as string | null) ?? null,
    listingId: (row.listingId as string | null) ?? null,
    customerId: row.customerId as string,
    priority: row.priority as number,
    source: row.source as UnitWaitlistEntry['source'],
    status: row.status as UnitWaitlistEntry['status'],
    notificationPreferenceId:
      (row.notificationPreferenceId as string | null) ?? null,
    preferredChannels:
      (row.preferredChannels as UnitWaitlistEntry['preferredChannels']) ?? [],
    createdAt: toIso(row.createdAt as Date | string) as UnitWaitlistEntry['createdAt'],
    expiresAt: row.expiresAt
      ? (toIso(row.expiresAt as Date) as UnitWaitlistEntry['expiresAt'])
      : null,
    convertedAt: row.convertedAt
      ? (toIso(row.convertedAt as Date) as UnitWaitlistEntry['convertedAt'])
      : null,
    optedOutAt: row.optedOutAt
      ? (toIso(row.optedOutAt as Date) as UnitWaitlistEntry['optedOutAt'])
      : null,
    optOutReason: (row.optOutReason as string | null) ?? null,
    lastNotifiedAt: row.lastNotifiedAt
      ? (toIso(row.lastNotifiedAt as Date) as UnitWaitlistEntry['lastNotifiedAt'])
      : null,
    notificationCount: (row.notificationCount as number) ?? 0,
    updatedAt: toIso(row.updatedAt as Date | string) as UnitWaitlistEntry['updatedAt'],
  };
}

function eventToRow(e: WaitlistOutreachEvent): Record<string, unknown> {
  return {
    id: e.id,
    tenantId: e.tenantId,
    waitlistId: e.waitlistId,
    eventType: e.eventType,
    channel: e.channel,
    messagePayload: e.messagePayload,
    correlationId: e.correlationId,
    occurredAt: new Date(e.occurredAt),
    providerMessageId: e.providerMessageId,
    errorCode: e.errorCode,
    errorMessage: e.errorMessage,
  };
}

function rowToEvent(row: Record<string, unknown>): WaitlistOutreachEvent {
  return {
    id: row.id as WaitlistOutreachEventId,
    tenantId: row.tenantId as TenantId,
    waitlistId: row.waitlistId as WaitlistId,
    eventType: row.eventType as WaitlistOutreachEvent['eventType'],
    channel: row.channel as WaitlistOutreachEvent['channel'],
    messagePayload: (row.messagePayload as Record<string, unknown>) ?? {},
    correlationId: (row.correlationId as string | null) ?? null,
    occurredAt: toIso(row.occurredAt as Date | string) as WaitlistOutreachEvent['occurredAt'],
    providerMessageId: (row.providerMessageId as string | null) ?? null,
    errorCode: (row.errorCode as string | null) ?? null,
    errorMessage: (row.errorMessage as string | null) ?? null,
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}