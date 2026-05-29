/**
 * Buyer-mobile API client — R11 buyer-initiated RFB.
 *
 * Mirrors the backend surface in
 * `services/api-gateway/src/routes/marketplace/rfb.hono.ts`. The
 * buyer-mobile only needs the buyer-side endpoints (create, list_mine,
 * cancel) — the seller `nearby` + respond endpoints surface in the
 * future seller-mobile / owner cockpit.
 *
 * Tenant scoping is handled by the gateway via the JWT auth header;
 * no tenantId is sent client-side. The buyer's user id is also
 * resolved server-side from the token.
 */

import { apiFetch } from './client'

const RFB_PREFIX = '/api/v1/marketplace/rfb'

export type RfbStatus = 'open' | 'filled' | 'expired' | 'cancelled'

export interface RfbCreateInput {
  readonly mineralKind: string
  readonly gradeMin?: string
  readonly tonnageMin: number
  readonly tonnageMax?: number
  readonly unitPriceTzs: number
  /** YYYY-MM-DD */
  readonly deliveryBy: string
  readonly locationLat?: number
  readonly locationLon?: number
  readonly radiusKm: number
  readonly notes?: string
}

export interface RfbSummary {
  readonly id: string
  readonly mineral_kind: string
  readonly grade_min: string | null
  readonly tonnage_min: string
  readonly tonnage_max: string | null
  readonly unit_price_tzs: string
  readonly delivery_by: string
  readonly status: RfbStatus
  readonly created_at: string
  readonly expires_at: string
  readonly pending_response_count: number
}

interface CreateResponse {
  readonly success: boolean
  readonly data: { id: string; createdAt: string; expiresAt: string }
}

interface MineResponse {
  readonly success: boolean
  readonly data: { rfbs: ReadonlyArray<RfbSummary> }
}

interface CancelResponse {
  readonly success: boolean
  readonly data: { id: string; status: RfbStatus }
}

export async function createRfb(input: RfbCreateInput): Promise<CreateResponse['data']> {
  const res = await apiFetch<CreateResponse>(RFB_PREFIX, {
    method: 'POST',
    body: input
  })
  return res.data
}

export async function fetchMyRfbs(): Promise<ReadonlyArray<RfbSummary>> {
  const res = await apiFetch<MineResponse>(`${RFB_PREFIX}/mine`)
  return res.data.rfbs
}

export async function cancelRfb(rfbId: string): Promise<CancelResponse['data']> {
  const res = await apiFetch<CancelResponse>(`${RFB_PREFIX}/${encodeURIComponent(rfbId)}`, {
    method: 'PATCH',
    body: { status: 'cancelled' }
  })
  return res.data
}

/** Mineral kinds the gateway accepts. Matches the zod enum on the route. */
export const RFB_MINERAL_KINDS = [
  'gold',
  'tanzanite',
  'diamond',
  'copper',
  'cobalt',
  'nickel',
  'iron',
  'coal',
  'silver',
  'rare_earth',
  'limestone',
  'gypsum',
  'salt',
  'gemstone_other'
] as const

export type RfbMineralKind = (typeof RFB_MINERAL_KINDS)[number]
