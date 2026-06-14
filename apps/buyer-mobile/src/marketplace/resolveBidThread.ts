/**
 * Pure resolution for the bid-entry chat screen (app/chat/index.tsx).
 *
 * Reached with an optional `bidId` (no `responseId`). The screen must decide
 * which canonical thread — if any — to open. The legacy `/bids/:id/messages`
 * route never existed on the gateway, so a bid only has a live chat thread
 * when it carries a `threadResponseId` (an RFB-response key the bid-messaging
 * surface serves). This helper centralises that decision so it is unit-tested
 * without React.
 */

export interface BidThreadCandidate {
  readonly id: string
  readonly status: string
  readonly threadResponseId?: string | null
}

export type BidThreadResolution =
  | { readonly kind: 'thread'; readonly responseId: string }
  | { readonly kind: 'no_thread' }
  | { readonly kind: 'empty' }

/**
 * Pick the active bid id: an explicit `bidId` wins; otherwise the first
 * pending/countered bid, else the first bid of any status. Returns null when
 * there are no bids.
 */
export function pickActiveBidId(
  bidId: string | undefined,
  bids: ReadonlyArray<BidThreadCandidate> | undefined,
): string | null {
  if (bidId) {
    return bidId
  }
  const live = bids?.find((b) => b.status === 'pending' || b.status === 'countered')
  return live?.id ?? bids?.[0]?.id ?? null
}

/**
 * Resolve which surface the chat screen should render for the active bid:
 *   - `thread`     → delegate to the canonical ResponseThread (has a live thread)
 *   - `no_thread`  → honest empty-state (marketplace bid, seller not yet replied)
 *   - `empty`      → no active bid at all
 */
export function resolveBidThread(
  bid: BidThreadCandidate | undefined,
): BidThreadResolution {
  if (!bid) {
    return { kind: 'empty' }
  }
  if (typeof bid.threadResponseId === 'string' && bid.threadResponseId.length > 0) {
    return { kind: 'thread', responseId: bid.threadResponseId }
  }
  return { kind: 'no_thread' }
}
