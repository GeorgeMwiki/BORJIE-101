/**
 * Buyer-superpowers persistence — Drizzle reads/writes behind the
 * `routes/buyer/superpowers.hono.ts` handlers.
 *
 * Reuses the SAME stores the owner superpowers wiring uses:
 *   - `undo_journal`   for the batch Undo chip (journal-first)
 *   - `pinned_items`   for the buyer watchlist (bulk_watch + bookmark)
 *   - `marketplace_listings` + `request_for_bids` for universal search
 *
 * Every query is tenant-scoped. The api-gateway database middleware
 * already binds `app.current_tenant_id` so RLS FORCE applies; the
 * explicit `tenantId` predicates here mirror the owner routes for
 * defence-in-depth and to keep the queries readable.
 */

import { and, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import {
  marketplaceListings,
  pinnedItems,
  requestForBids,
  undoJournal,
} from '@borjie/database';

import type {
  BuyerBulkActionInput,
  BuyerPinInput,
} from './superpowers-schemas';

/**
 * Minimal structural type for the Drizzle client surface this store
 * uses. Avoids importing the heavy `DatabaseClient` namespace type
 * (TS2709 drift) the way the owner dispatchers do.
 */
export interface BuyerSuperpowersDb {
  insert: (table: unknown) => {
    values: (v: unknown) => {
      returning: (cols?: unknown) => Promise<ReadonlyArray<Record<string, unknown>>>;
    };
  };
  update: (table: unknown) => {
    set: (v: unknown) => {
      where: (cond: unknown) => {
        returning: (cols?: unknown) => Promise<ReadonlyArray<Record<string, unknown>>>;
      };
    };
  };
  select: (cols?: unknown) => {
    from: (table: unknown) => {
      where: (cond: unknown) => {
        orderBy?: (...args: unknown[]) => { limit: (n: number) => Promise<ReadonlyArray<Record<string, unknown>>> };
        limit: (n: number) => Promise<ReadonlyArray<Record<string, unknown>>>;
      };
    };
  };
}

/** Narrow a Drizzle `.returning()` result to its first row (or throw). */
function firstRow(
  rows: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> {
  const row = rows[0];
  if (!row) {
    throw new Error('expected a returning() row but got none');
  }
  return row;
}

// ─── Bulk action ──────────────────────────────────────────────────────

export interface BulkActionResult {
  readonly accepted: true;
  readonly action: BuyerBulkActionInput['action'];
  readonly processed: number;
  readonly failed: number;
  readonly processedIds: ReadonlyArray<string>;
  readonly failedIds: ReadonlyArray<{ readonly id: string; readonly reason: string }>;
  readonly undoJournalIds: ReadonlyArray<string>;
}

interface BulkActionArgs {
  readonly tenantId: string;
  readonly actorId: string;
  readonly input: BuyerBulkActionInput;
  readonly idempotencyKey: string | null;
}

/**
 * Records one undo-journal row per id (journal-first, like the owner
 * route) and, for `bulk_watch`, additionally pins the entity to the
 * buyer's watchlist. The pinned-item id is folded into the journal
 * row's provenance so `undoLastBatch` can reverse the pin.
 */
export async function recordBulkAction(
  db: BuyerSuperpowersDb,
  args: BulkActionArgs,
): Promise<BulkActionResult> {
  const { tenantId, actorId, input, idempotencyKey } = args;
  const provenanceBase = {
    ...input.provenance,
    persona: 'buyer' as const,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };

  const undoJournalIds: string[] = [];
  const processedIds: string[] = [];
  const failedIds: Array<{ readonly id: string; readonly reason: string }> = [];

  for (const id of input.ids) {
    try {
      let pinnedItemId: string | null = null;
      if (input.action === 'bulk_watch') {
        pinnedItemId = await pinForBulkWatch(db, {
          tenantId,
          ownerId: actorId,
          entityType: input.entityType,
          entityId: id,
        });
      }
      const row = firstRow(
        await db
          .insert(undoJournal)
          .values({
            tenantId,
            actorId,
            entityType: input.entityType,
            entityId: id,
            actionKind: input.action === 'bulk_watch' ? 'pin' : 'bulk_update',
            toolId: `buyer.ui.${input.action}`,
            beforeState: null,
            afterState: { action: input.action, reason: input.reason },
            windowSeconds: 300,
            provenance: {
              ...provenanceBase,
              action: input.action,
              ...(pinnedItemId ? { pinnedItemId } : {}),
            },
          })
          .returning(),
      );
      undoJournalIds.push(String(row.id));
      processedIds.push(id);
    } catch (e) {
      failedIds.push({ id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    accepted: true,
    action: input.action,
    processed: processedIds.length,
    failed: failedIds.length,
    processedIds,
    failedIds,
    undoJournalIds,
  };
}

async function pinForBulkWatch(
  db: BuyerSuperpowersDb,
  args: {
    readonly tenantId: string;
    readonly ownerId: string;
    readonly entityType: string;
    readonly entityId: string;
  },
): Promise<string> {
  const result = await upsertPinnedItem(db, {
    tenantId: args.tenantId,
    ownerId: args.ownerId,
    input: {
      entityType: args.entityType as BuyerPinInput['entityType'],
      entityId: args.entityId,
      persona: 'buyer',
      provenance: { via: 'bulk_watch' },
    },
  });
  return result.pinnedItemId;
}

// ─── Pinned items ─────────────────────────────────────────────────────

export interface PinResult {
  readonly pinnedItemId: string;
  readonly label: string;
  readonly created: boolean;
}

interface PinArgs {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly input: BuyerPinInput;
}

function defaultPinLabel(entityType: string, entityId: string): string {
  return `${entityType}:${entityId.slice(0, 12)}`;
}

/**
 * Pin an entity to the buyer's watchlist. Idempotent on re-pin:
 * reactivates a soft-deleted pin, returns the existing active pin, or
 * inserts a fresh row — exactly the owner pinned-items semantics.
 */
export async function upsertPinnedItem(
  db: BuyerSuperpowersDb,
  args: PinArgs,
): Promise<PinResult> {
  const { tenantId, ownerId, input } = args;
  const label = input.label ?? defaultPinLabel(input.entityType, input.entityId);

  const existingRows = await db
    .select()
    .from(pinnedItems)
    .where(
      and(
        eq(pinnedItems.tenantId, tenantId),
        eq(pinnedItems.ownerId, ownerId),
        eq(pinnedItems.entityType, input.entityType),
        eq(pinnedItems.entityId, input.entityId),
      ),
    )
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    if (existing.unpinnedAt) {
      const row = firstRow(
        await db
          .update(pinnedItems)
          .set({ unpinnedAt: null, label, provenance: input.provenance, pinnedAt: new Date() })
          .where(eq(pinnedItems.id, existing.id))
          .returning(),
      );
      return { pinnedItemId: String(row.id), label: String(row.label), created: false };
    }
    return {
      pinnedItemId: String(existing.id),
      label: String(existing.label),
      created: false,
    };
  }

  const row = firstRow(
    await db
      .insert(pinnedItems)
      .values({
        tenantId,
        ownerId,
        entityType: input.entityType,
        entityId: input.entityId,
        label,
        provenance: input.provenance,
      })
      .returning(),
  );
  return { pinnedItemId: String(row.id), label: String(row.label), created: true };
}

// ─── Undo last batch ──────────────────────────────────────────────────

export interface UndoResult {
  readonly undone: number;
  readonly journalIds: ReadonlyArray<string>;
  readonly unpinned: number;
}

interface UndoArgs {
  readonly tenantId: string;
  readonly actorId: string;
  readonly journalIds: ReadonlyArray<string>;
  readonly reason?: string;
}

/**
 * Mark the supplied journal ids as undone (tenant + actor scoped,
 * window-bounded, not-already-undone) and reverse any `bulk_watch`
 * pins they created by unpinning the linked pinned_item.
 */
export async function undoLastBatch(
  db: BuyerSuperpowersDb,
  args: UndoArgs,
): Promise<UndoResult> {
  const { tenantId, actorId, journalIds, reason } = args;

  const rows = await db
    .update(undoJournal)
    .set({
      undoneAt: new Date(),
      undoneById: actorId,
      ...(reason !== undefined ? { undoReason: reason } : {}),
    })
    .where(
      and(
        inArray(undoJournal.id, journalIds as string[]),
        eq(undoJournal.tenantId, tenantId),
        eq(undoJournal.actorId, actorId),
        isNull(undoJournal.undoneAt),
        sql`${undoJournal.performedAt} + (${undoJournal.windowSeconds} || ' seconds')::interval > now()`,
      ),
    )
    .returning();

  const undoneIds = rows.map((r) => String(r.id));
  const pinnedItemIds = rows
    .map((r) => {
      const prov = (r.provenance as Record<string, unknown> | null) ?? {};
      const pid = prov.pinnedItemId;
      return typeof pid === 'string' ? pid : null;
    })
    .filter((v): v is string => v !== null);

  let unpinned = 0;
  if (pinnedItemIds.length > 0) {
    const unpinnedRows = await db
      .update(pinnedItems)
      .set({ unpinnedAt: new Date() })
      .where(
        and(
          inArray(pinnedItems.id, pinnedItemIds),
          eq(pinnedItems.tenantId, tenantId),
          eq(pinnedItems.ownerId, actorId),
          isNull(pinnedItems.unpinnedAt),
        ),
      )
      .returning();
    unpinned = unpinnedRows.length;
  }

  return { undone: undoneIds.length, journalIds: undoneIds, unpinned };
}

// ─── Universal search ─────────────────────────────────────────────────

export interface BuyerSearchResult {
  readonly route: string;
  readonly label: string;
  readonly description?: string;
}

interface SearchArgs {
  readonly tenantId: string;
  readonly actorId: string;
  readonly query: string;
  readonly limit: number;
}

/**
 * Tenant-scoped universal search over visible marketplace listings and
 * the buyer's own request-for-bids. Returns navigate targets the mobile
 * search FAB renders. ILIKE patterns are parameter-bound (no string
 * interpolation) so the query is injection-safe.
 */
export async function runBuyerSearch(
  db: BuyerSuperpowersDb,
  args: SearchArgs,
): Promise<ReadonlyArray<BuyerSearchResult>> {
  const { tenantId, actorId, query, limit } = args;
  const pattern = `%${query.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

  const listingRows = await db
    .select()
    .from(marketplaceListings)
    .where(
      and(
        eq(marketplaceListings.tenantId, tenantId),
        eq(marketplaceListings.status, 'active'),
        or(
          ilike(marketplaceListings.title, pattern),
          ilike(marketplaceListings.description, pattern),
        ),
      ),
    )
    .limit(limit);

  const rfbRows = await db
    .select()
    .from(requestForBids)
    .where(
      and(
        eq(requestForBids.tenantId, tenantId),
        // Buyer search returns only the caller's OWN request-for-bids.
        eq(requestForBids.buyerId, actorId),
        or(
          ilike(requestForBids.mineralKind, pattern),
          ilike(requestForBids.notes, pattern),
        ),
      ),
    )
    .limit(limit);

  const listingResults: BuyerSearchResult[] = listingRows.map((row) => ({
    route: `/marketplace/${String(row.id)}`,
    label: String(row.title ?? 'Listing'),
    ...(row.description ? { description: String(row.description) } : {}),
  }));

  const rfbResults: BuyerSearchResult[] = rfbRows.map((row) => ({
    route: `/rfb/${String(row.id)}`,
    label: `RFB: ${String(row.mineralKind ?? 'mineral')}`,
    ...(row.notes ? { description: String(row.notes) } : {}),
  }));

  return [...listingResults, ...rfbResults].slice(0, limit);
}
