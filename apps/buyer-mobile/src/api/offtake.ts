/**
 * Buyer-mobile API client — the BUYER leg of the offtake completion-law loop.
 *
 * COMPLETION-LAW: when a seller ACCEPTS a marketplace bid the gateway
 * crystallizes a binding offtake contract (one `offtake_agreements` row per
 * accepted bid). The seller sees it in the owner cockpit's
 * `OfftakeContractsPanel`; before this client the BUYER had no surface for the
 * very contract that now binds them. This consumes the BUILT buyer endpoint:
 *
 *   GET /api/v1/mining/bids/offtake-agreements/mine
 *     (services/api-gateway/src/routes/mining/bids.hono.ts) — tenant-scoped
 *     (RLS) + buyer-scoped: returns only the calling buyer's agreements.
 *
 * Tenant + buyer identity are resolved server-side from the JWT; nothing
 * tenant-scoped is sent from the client.
 *
 * WIRE SHAPE: the gateway returns Drizzle rows selected from the table object,
 * so the keys are the JS field names (camelCase: `agreedPriceTzs`,
 * `quantityKg`, `paymentTerms`, `createdAt`). We read camelCase as canonical
 * and fall back to snake_case defensively, then coerce the numeric/text
 * columns to a stable typed shape (same adapter discipline as the owner panel).
 */

import { apiFetch } from './client'
import { MINING_PREFIX } from './config'

const OFFTAKE_MINE_PATH = `${MINING_PREFIX}/bids/offtake-agreements/mine`

/** Lifecycle of a crystallized offtake contract. Mirrors the gateway enum. */
export type OfftakeStatus =
  | 'pending_signature'
  | 'signed'
  | 'cancelled'
  | 'completed'

/** Canonical lifecycle literals — source for status mapping (GROUNDED). */
export const OFFTAKE_STATUSES: ReadonlyArray<OfftakeStatus> = [
  'pending_signature',
  'signed',
  'cancelled',
  'completed',
]

const OFFTAKE_STATUS_SET = new Set<OfftakeStatus>(OFFTAKE_STATUSES)

/** A binding offtake agreement crystallized from the buyer's accepted bid. */
export interface OfftakeAgreement {
  readonly id: string
  readonly listingId: string
  readonly bidId: string
  /** CONTRACT TERM — agreed price in TZS (never a ledger entry). */
  readonly agreedPriceTzs: number
  /** CONTRACT TERM — agreed volume in kg. */
  readonly quantityKg: number
  readonly paymentTerms: string | null
  readonly status: OfftakeStatus
  readonly signedAt: string | null
  readonly createdAt: string
}

/** Raw row as it can arrive over the wire (camelCase canonical, snake fallback). */
interface RawOfftakeRow {
  readonly id?: string
  readonly listingId?: string
  readonly listing_id?: string
  readonly bidId?: string
  readonly bid_id?: string
  readonly agreedPriceTzs?: string | number | null
  readonly agreed_price_tzs?: string | number | null
  readonly quantityKg?: string | number | null
  readonly quantity_kg?: string | number | null
  readonly paymentTerms?: string | null
  readonly payment_terms?: string | null
  readonly status?: string
  readonly signedAt?: string | null
  readonly signed_at?: string | null
  readonly createdAt?: string
  readonly created_at?: string
}

interface OfftakeMineResponse {
  readonly success: boolean
  readonly data: ReadonlyArray<RawOfftakeRow>
}

function toFiniteNumber(value: string | number | null | undefined): number {
  if (value == null) return 0
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function firstString(
  ...values: ReadonlyArray<string | null | undefined>
): string | null {
  for (const v of values) {
    if (typeof v === 'string') return v
  }
  return null
}

function coerceStatus(value: string | undefined): OfftakeStatus {
  return typeof value === 'string' && OFFTAKE_STATUS_SET.has(value as OfftakeStatus)
    ? (value as OfftakeStatus)
    : 'pending_signature'
}

/** Adapt a raw wire row → typed agreement, or null when it carries no id. */
function adaptOfftake(row: RawOfftakeRow): OfftakeAgreement | null {
  if (typeof row.id !== 'string' || row.id.length === 0) return null
  return {
    id: row.id,
    listingId: firstString(row.listingId, row.listing_id) ?? '',
    bidId: firstString(row.bidId, row.bid_id) ?? '',
    agreedPriceTzs: toFiniteNumber(row.agreedPriceTzs ?? row.agreed_price_tzs),
    quantityKg: toFiniteNumber(row.quantityKg ?? row.quantity_kg),
    paymentTerms: firstString(row.paymentTerms, row.payment_terms),
    status: coerceStatus(row.status),
    signedAt: firstString(row.signedAt, row.signed_at),
    createdAt: firstString(row.createdAt, row.created_at) ?? '',
  }
}

/**
 * List the calling buyer's binding offtake agreements (own-scoped server-side).
 * The buyer's accepted-bid contracts, newest first.
 */
export async function fetchMyOfftakeAgreements(
  signal?: AbortSignal,
): Promise<ReadonlyArray<OfftakeAgreement>> {
  const res = await apiFetch<OfftakeMineResponse>(OFFTAKE_MINE_PATH, { signal })
  return (res.data ?? [])
    .map(adaptOfftake)
    .filter((a): a is OfftakeAgreement => a !== null)
}

/** The single agreement crystallized from a given accepted bid, if any. */
export async function fetchOfftakeForBid(
  bidId: string,
  signal?: AbortSignal,
): Promise<OfftakeAgreement | null> {
  const agreements = await fetchMyOfftakeAgreements(signal)
  return agreements.find((a) => a.bidId === bidId) ?? null
}
