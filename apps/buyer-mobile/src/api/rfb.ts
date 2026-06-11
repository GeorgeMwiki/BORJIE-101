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

/**
 * A single response to a buyer's RFB, as returned by
 * GET /api/v1/marketplace/rfb/:id/responses.
 * The endpoint is Wave-C planned — the screen handles a 404 gracefully.
 */
export interface RfbResponse {
  readonly id: string
  readonly rfb_id: string
  readonly seller_id: string
  readonly seller_name: string
  readonly grade: string | null
  readonly tonnage_kg: string
  readonly price_per_unit_tzs: string
  readonly status: 'pending' | 'accepted' | 'rejected' | 'fulfilled'
  readonly notes: string | null
  readonly created_at: string
}

interface RfbResponsesResponse {
  readonly success: boolean
  readonly data: { responses: ReadonlyArray<RfbResponse> }
}

/**
 * Fetch responses to a specific RFB the buyer posted.
 * GET /api/v1/marketplace/rfb/:rfbId/responses
 *
 * NOTE: this endpoint is planned for Wave C. Until it exists the call
 * returns [] (the screen shows the empty state, not an error).
 */
export async function fetchRfbResponses(rfbId: string): Promise<ReadonlyArray<RfbResponse>> {
  try {
    const res = await apiFetch<RfbResponsesResponse>(
      `${RFB_PREFIX}/${encodeURIComponent(rfbId)}/responses`
    )
    return res.data?.responses ?? []
  } catch {
    // Endpoint not yet available — degrade gracefully to empty list.
    return []
  }
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
