/**
 * Pure helpers for WS-2 bid-messaging (thread per RFB response) +
 * market-intel rendering. Kept dependency-free (no `@/api/client`,
 * which pulls expo-secure-store and trips the vitest rollup parser) so
 * the mapping logic is unit-testable in isolation.
 */

/** Wire shape of a bid-thread message from the api-gateway. */
export interface ThreadMessageWire {
  readonly id: string
  readonly senderRole: 'buyer' | 'seller'
  readonly senderId?: string
  readonly body: string
  readonly createdAt: string
}

/** Normalised message the chat UI renders (MessageBubble props). */
export interface ThreadMessage {
  readonly id: string
  readonly from: 'buyer' | 'seller'
  readonly body: string
  readonly sentAt: string
}

/**
 * Normalise the gateway thread payload into the UI shape, sorted
 * oldest-first (the gateway already returns ASC, but we re-sort
 * defensively so a re-ordered cache never scrambles the bubbles).
 */
export function normalizeThreadMessages(
  raw: ReadonlyArray<ThreadMessageWire>,
): ReadonlyArray<ThreadMessage> {
  return [...raw]
    .map((m) => ({
      id: m.id,
      from: m.senderRole === 'seller' ? ('seller' as const) : ('buyer' as const),
      body: m.body,
      sentAt: m.createdAt,
    }))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

/**
 * Generate a client-side idempotency key for a message send. RN-safe
 * (no node crypto) — combines a high-resolution timestamp with random
 * entropy. The key is stable for a given draft only if the caller
 * memoises it; a fresh key per logical send is the intended contract,
 * and the backend dedups on (response, sender, key).
 */
export function newIdempotencyKey(prefix = 'msg'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/** Reputation aggregate as surfaced on a seller's org profile. */
export interface SellerReputation {
  readonly sellerTenantId: string
  readonly ratingCount: number
  readonly averageStars: number | null
}

/**
 * Render a reputation aggregate as a short label, e.g. "4.4 ★ (7)".
 * Returns the "no ratings yet" copy when the seller is unrated. The
 * copy strings are passed in so the caller controls locale (CLAUDE.md:
 * bilingual, single-language per active locale).
 */
export function formatReputation(
  rep: SellerReputation,
  noRatingsLabel: string,
): string {
  if (rep.ratingCount === 0 || rep.averageStars === null) {
    return noRatingsLabel
  }
  return `${rep.averageStars.toFixed(1)} ★ (${rep.ratingCount})`
}
