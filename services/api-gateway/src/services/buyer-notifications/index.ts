/**
 * Buyer-notifications service — commercial chain L7.
 *
 * Pure helpers for inserting + listing rows in the `buyer_notifications`
 * table (migration 0132). No HTTP transport; the handlers in
 * routes/buyer/notifications.hono.ts and the CoC final-step hook in
 * routes/ops/chain-of-custody.hono.ts call these directly.
 *
 * Tenant scope:
 *   * `enqueueRfbFulfillmentNotification` runs in the SELLER's RLS
 *     context (the api-gateway has `app.current_tenant_id` bound to
 *     the seller's tenant). The migration's RLS policy allows the
 *     insert because `seller_tenant_id::text = current_setting(...)`.
 *   * `listBuyerNotifications` runs in the BUYER's RLS context. The
 *     same policy allows the read because `buyer_tenant_id::text =
 *     current_setting(...)`.
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

export interface EnqueueRfbFulfillmentInput {
  readonly buyerTenantId: string;
  readonly buyerUserId: string;
  readonly sellerTenantId: string;
  readonly rfbId: string;
  readonly responseId?: string | null;
  readonly taskId?: string | null;
  readonly mineralKind: string;
  readonly tonnage: number | null;
  readonly parcelId?: string | null;
  readonly extraPayload?: Record<string, unknown>;
}

export interface BuyerNotificationRow {
  readonly id: string;
  readonly buyerTenantId: string;
  readonly buyerUserId: string;
  readonly sellerTenantId: string;
  readonly rfbId: string;
  readonly responseId: string | null;
  readonly taskId: string | null;
  readonly kind: string;
  readonly titleSw: string;
  readonly titleEn: string;
  readonly bodySw: string;
  readonly bodyEn: string;
  readonly payload: Record<string, unknown>;
  readonly readAt: string | null;
  readonly createdAt: string;
}

function adaptRow(r: Record<string, unknown>): BuyerNotificationRow {
  return {
    id: String(r.id ?? ''),
    buyerTenantId: String(r.buyer_tenant_id ?? r.buyerTenantId ?? ''),
    buyerUserId: String(r.buyer_user_id ?? r.buyerUserId ?? ''),
    sellerTenantId: String(r.seller_tenant_id ?? r.sellerTenantId ?? ''),
    rfbId: String(r.rfb_id ?? r.rfbId ?? ''),
    responseId: (r.response_id ?? r.responseId ?? null) as string | null,
    taskId: (r.task_id ?? r.taskId ?? null) as string | null,
    kind: String(r.kind ?? ''),
    titleSw: String(r.title_sw ?? r.titleSw ?? ''),
    titleEn: String(r.title_en ?? r.titleEn ?? ''),
    bodySw: String(r.body_sw ?? r.bodySw ?? ''),
    bodyEn: String(r.body_en ?? r.bodyEn ?? ''),
    payload: ((r.payload ?? {}) as Record<string, unknown>) ?? {},
    readAt: (r.read_at ?? r.readAt ?? null) as string | null,
    createdAt: String(r.created_at ?? r.createdAt ?? ''),
  };
}

/**
 * Insert an `rfb_fulfilled` notification row for the buyer.
 *
 * The bilingual title + body are composed here so the buyer-mobile
 * renderer can show the row without a second round-trip. Optional
 * payload carries the parcel id + any other context the deep-link
 * needs ("view the chain-of-custody history").
 */
export async function enqueueRfbFulfillmentNotification(
  db: DbExecutor,
  input: EnqueueRfbFulfillmentInput,
): Promise<string> {
  const id = randomUUID();
  const tonnageText = input.tonnage != null ? `${input.tonnage}t ` : '';
  const titleSw = `RFB yako imetimizwa: ${tonnageText}${input.mineralKind}`;
  const titleEn = `Your RFB has been fulfilled: ${tonnageText}${input.mineralKind}`;
  const bodySw =
    `Muuzaji amerekodi hatua ya mwisho ya msururu wa udhibiti kwa RFB yako. ` +
    `Tafadhali angalia maelezo ya parcel na uthibitishe upokeaji.`;
  const bodyEn =
    `The seller has logged the final chain-of-custody step for your RFB. ` +
    `Review the parcel details and confirm receipt.`;
  const payload = {
    parcelId: input.parcelId ?? null,
    ...(input.extraPayload ?? {}),
  };

  await db.execute(sql`
    INSERT INTO buyer_notifications (
      id, buyer_tenant_id, buyer_user_id, seller_tenant_id,
      rfb_id, response_id, task_id, kind,
      title_sw, title_en, body_sw, body_en,
      payload, created_at
    ) VALUES (
      ${id}::uuid,
      ${input.buyerTenantId}::uuid,
      ${input.buyerUserId},
      ${input.sellerTenantId}::uuid,
      ${input.rfbId}::uuid,
      ${input.responseId ?? null},
      ${input.taskId ?? null},
      'rfb_fulfilled',
      ${titleSw},
      ${titleEn},
      ${bodySw},
      ${bodyEn},
      ${JSON.stringify(payload)}::jsonb,
      NOW()
    )
    ON CONFLICT DO NOTHING
  `);
  return id;
}

export interface ListBuyerNotificationsInput {
  readonly buyerTenantId: string;
  readonly buyerUserId: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly unreadOnly?: boolean;
}

export interface ListBuyerNotificationsResult {
  readonly notifications: ReadonlyArray<BuyerNotificationRow>;
  readonly nextCursor: string | null;
}

export async function listBuyerNotifications(
  db: DbExecutor,
  input: ListBuyerNotificationsInput,
): Promise<ListBuyerNotificationsResult> {
  const limit = Math.min(Math.max(input.limit, 1), 100);
  const cursorClause = input.cursor
    ? sql`AND created_at < ${input.cursor}::timestamptz`
    : sql``;
  const unreadClause = input.unreadOnly ? sql`AND read_at IS NULL` : sql``;
  const res = await db.execute(sql`
    SELECT id::text AS id,
           buyer_tenant_id::text AS buyer_tenant_id,
           buyer_user_id,
           seller_tenant_id::text AS seller_tenant_id,
           rfb_id::text AS rfb_id,
           response_id::text AS response_id,
           task_id::text AS task_id,
           kind,
           title_sw, title_en, body_sw, body_en,
           payload,
           read_at,
           created_at
      FROM buyer_notifications
     WHERE buyer_tenant_id = ${input.buyerTenantId}::uuid
       AND buyer_user_id = ${input.buyerUserId}
       ${cursorClause}
       ${unreadClause}
     ORDER BY created_at DESC
     LIMIT ${limit + 1}
  `);
  const rows = rowsOf(res).map(adaptRow);
  // Pagination — emit a cursor only when we have more rows than the
  // requested limit. The cursor is the last-included row's createdAt
  // so the next page's WHERE clause is `created_at < cursor`.
  const hasMore = rows.length > limit;
  const sliced = rows.slice(0, limit);
  const nextCursor = hasMore ? sliced[sliced.length - 1]?.createdAt ?? null : null;
  return { notifications: sliced, nextCursor };
}
