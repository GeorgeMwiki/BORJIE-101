/**
 * Buyer-mobile API — commercial chain L7 notifications.
 *
 * Backed by /api/v1/buyer/notifications on the api-gateway. Each row
 * represents an L7 fulfilment notification (RFB fulfilled, settlement
 * paid, response received) the seller-side handlers enqueued.
 */

import { apiFetch } from './client'

const NOTIFICATIONS_PREFIX = '/api/v1/buyer/notifications'

export type BuyerNotificationKind =
  | 'rfb_fulfilled'
  | 'rfb_response_received'
  | 'settlement_paid'

export interface BuyerNotificationRow {
  readonly id: string
  readonly buyer_tenant_id: string
  readonly buyer_user_id: string
  readonly seller_tenant_id: string
  readonly rfb_id: string
  readonly response_id: string | null
  readonly task_id: string | null
  readonly kind: BuyerNotificationKind
  readonly title_sw: string
  readonly title_en: string
  readonly body_sw: string
  readonly body_en: string
  readonly payload: Record<string, unknown>
  readonly read_at: string | null
  readonly created_at: string
}

export interface ListNotificationsInput {
  readonly limit?: number
  readonly cursor?: string
  readonly unreadOnly?: boolean
}

export interface ListNotificationsResult {
  readonly notifications: ReadonlyArray<BuyerNotificationRow>
  readonly nextCursor: string | null
}

interface ListResponse {
  readonly success?: boolean
  readonly data?: {
    readonly notifications?: ReadonlyArray<BuyerNotificationRow>
    readonly nextCursor?: string | null
  }
}

export async function listBuyerNotifications(
  input: ListNotificationsInput = {},
): Promise<ListNotificationsResult> {
  const query: Record<string, string | number | boolean | undefined> = {}
  if (input.limit) query.limit = input.limit
  if (input.cursor) query.cursor = input.cursor
  if (input.unreadOnly) query.unreadOnly = 'true'
  const res = await apiFetch<ListResponse>(NOTIFICATIONS_PREFIX, { query })
  const data = res.data ?? {}
  return {
    notifications: data.notifications ?? [],
    nextCursor: data.nextCursor ?? null,
  }
}

export async function markBuyerNotificationRead(id: string): Promise<void> {
  await apiFetch<{ success: boolean }>(
    `${NOTIFICATIONS_PREFIX}/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  )
}
