/**
 * Buyer-mobile API client — KI-007 cross-tenant inquiries ("Ask the seller").
 *
 * Consumes the BUILT inquiry endpoints that buyer-mobile had no caller for:
 *   - raise:  POST /api/v1/mining/flows/inquiries
 *             (services/api-gateway/src/routes/mining/flows/inquiry-flow.hono.ts,
 *              mounted mining → /flows; `raiseInquirySchema` = { listingId, message })
 *   - list:   GET  /api/v1/buyer/inquiries
 *             (buyerInquiriesRouter, mounted /api/v1/buyer/inquiries; ReBAC,
 *              returns only runs the authenticated buyer originated)
 *
 * The inquiry is the honest cross-tenant mechanism: a buyer can browse a
 * seller's listing across tenants but cannot bid intra-tenant, so on a
 * cross-tenant listing the UI raises an inquiry instead of a bid.
 *
 * Tenant + user are resolved server-side from the JWT — nothing
 * tenant-scoped is sent from the client. The pure body/row shaping lives in
 * `@/marketplace/inquiryWire` so it can be unit-tested without the client.
 */

import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import {
  mapBuyerInquiry,
  toRaiseInquiryPayload,
  type BuyerInquiry,
  type GatewayInquiryRow,
  type RaiseInquiryInput,
} from '@/marketplace/inquiryWire'

export type { BuyerInquiry, RaiseInquiryInput } from '@/marketplace/inquiryWire'

/** Buyer-scoped (non-mining) gateway prefix for the inquiries list. */
const BUYER_PREFIX = '/api/v1/buyer'

export interface RaisedInquiry {
  readonly id: string
  readonly state: string
}

interface RaiseInquiryResponse {
  readonly success: boolean
  readonly data: RaisedInquiry
}

/** Raise an inquiry on a (cross-tenant) listing — the seller's tenant gets the run. */
export async function raiseInquiry(
  input: RaiseInquiryInput,
): Promise<RaisedInquiry> {
  const response = await apiFetch<RaiseInquiryResponse>(
    `${MINING_PREFIX}/flows/inquiries`,
    {
      method: 'POST',
      body: toRaiseInquiryPayload(input),
    },
  )
  return response.data
}

interface BuyerInquiriesResponse {
  readonly success: boolean
  readonly data: ReadonlyArray<GatewayInquiryRow>
}

/** List the buyer's own inquiries (ReBAC: own-originated only). */
export async function fetchBuyerInquiries(): Promise<ReadonlyArray<BuyerInquiry>> {
  const response = await apiFetch<BuyerInquiriesResponse>(
    `${BUYER_PREFIX}/inquiries`,
  )
  return response.data.map(mapBuyerInquiry)
}
