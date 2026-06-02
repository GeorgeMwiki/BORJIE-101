/**
 * Buyer-mobile API client — WS-2 bid chat (thread per RFB response),
 * post-settlement seller ratings, seller reputation, and market intel.
 *
 * Mirrors the backend surface in
 * services/api-gateway/src/routes/mining/bid-messaging.hono.ts and the
 * market-intel handler in mining/marketplace.hono.ts.
 *
 * Tenant + user are resolved server-side from the JWT; nothing
 * tenant-scoped is sent client-side. Sends are idempotent — each carries
 * an `Idempotency-Key` so a flaky-network retry never double-posts.
 */

import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import {
  newIdempotencyKey,
  normalizeThreadMessages,
  type ThreadMessage,
  type ThreadMessageWire,
  type SellerReputation,
} from '@/marketplace/threadMessages'

const BID_MESSAGING_PREFIX = `${MINING_PREFIX}/bid-messaging`

interface ThreadResponse {
  readonly success: boolean
  readonly data: {
    readonly responseId: string
    readonly rfbId: string
    readonly role: 'buyer' | 'seller'
    readonly messages: ReadonlyArray<ThreadMessageWire>
  }
}

export interface ThreadView {
  readonly responseId: string
  readonly rfbId: string
  readonly role: 'buyer' | 'seller'
  readonly messages: ReadonlyArray<ThreadMessage>
}

/** Fetch the message thread for an RFB response (oldest-first). */
export async function fetchThread(responseId: string): Promise<ThreadView> {
  const res = await apiFetch<ThreadResponse>(
    `${BID_MESSAGING_PREFIX}/threads/${encodeURIComponent(responseId)}/messages`,
  )
  return {
    responseId: res.data.responseId,
    rfbId: res.data.rfbId,
    role: res.data.role,
    messages: normalizeThreadMessages(res.data.messages),
  }
}

export interface SendThreadMessageInput {
  readonly responseId: string
  readonly body: string
  /** Optional explicit key so a retried mutation reuses the same one. */
  readonly idempotencyKey?: string
}

interface SendMessageResponse {
  readonly success: boolean
  readonly data: {
    readonly id: string
    readonly senderRole: 'buyer' | 'seller'
    readonly body: string
    readonly createdAt: string
  }
}

/** Send a message into a thread. Idempotent via the Idempotency-Key header. */
export async function sendThreadMessage(
  input: SendThreadMessageInput,
): Promise<SendMessageResponse['data']> {
  const res = await apiFetch<SendMessageResponse>(
    `${BID_MESSAGING_PREFIX}/threads/${encodeURIComponent(input.responseId)}/messages`,
    {
      method: 'POST',
      body: { body: input.body },
      headers: {
        'Idempotency-Key': input.idempotencyKey ?? newIdempotencyKey('msg'),
      },
    },
  )
  return res.data
}

export interface RateSellerInput {
  readonly settlementId: string
  readonly stars: number
  readonly comment?: string
}

interface RateResponse {
  readonly success: boolean
  readonly data: { id: string; stars: number; createdAt: string }
}

/** Rate the seller after a settlement (post-delivery). */
export async function rateSeller(
  input: RateSellerInput,
): Promise<RateResponse['data']> {
  const res = await apiFetch<RateResponse>(
    `${BID_MESSAGING_PREFIX}/settlements/${encodeURIComponent(input.settlementId)}/rate`,
    {
      method: 'POST',
      body: {
        stars: input.stars,
        comment: input.comment && input.comment.length > 0 ? input.comment : undefined,
      },
    },
  )
  return res.data
}

interface ReputationResponse {
  readonly success: boolean
  readonly data: SellerReputation
}

/** Fetch a seller's public reputation aggregate (for the org profile). */
export async function fetchSellerReputation(
  sellerTenantId: string,
): Promise<SellerReputation> {
  const res = await apiFetch<ReputationResponse>(
    `${BID_MESSAGING_PREFIX}/reputation/${encodeURIComponent(sellerTenantId)}`,
  )
  return res.data
}

// ───────────────────────── market intel ─────────────────────────────

export interface MarketIntelFilters {
  readonly commodity?: string
  readonly region?: string
  readonly windowDays?: number
}

export interface MarketIntel {
  readonly commodity: string
  readonly region: string | null
  readonly lbma: {
    readonly amUsdPerOz: number | null
    readonly pmUsdPerOz: number | null
    readonly unit: string
    readonly source: string
    readonly asOf: string | null
  } | null
  readonly fx: {
    readonly pair: string
    readonly tzsPerUsd: number | null
    readonly source: string
    readonly asOf: string | null
  } | null
  readonly trend: ReadonlyArray<{ readonly asOf: string; readonly priceTzs: number }>
  readonly benchmarkTzs: number | null
  readonly windowDays: number
  readonly asOf: string
}

interface MarketIntelResponse {
  readonly success: boolean
  readonly data: MarketIntel
}

/** Fetch real market intelligence (LBMA fix + FX + marketplace trend). */
export async function fetchMarketIntel(
  filters: MarketIntelFilters = {},
): Promise<MarketIntel> {
  const res = await apiFetch<MarketIntelResponse>(
    `${MINING_PREFIX}/marketplace/market-intel`,
    {
      query: {
        commodity: filters.commodity,
        region: filters.region,
        windowDays: filters.windowDays,
      },
    },
  )
  return res.data
}
