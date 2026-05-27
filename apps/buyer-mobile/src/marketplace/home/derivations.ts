import type { Bid, BidStatus, Listing } from '@/types/listing'

// Pure derivations used by the marketplace home. Kept here so the section
// components stay rendering-only and remain testable without React.

export interface PipelineCounts {
  readonly negotiating: number
  readonly accepted: number
  readonly closed: number
  readonly total: number
}

// Maps the four `BidStatus` values onto the deal-pipeline kanban stages
// from §5 of the SOTA spec. We collapse to three buckets at the summary
// level — full kanban lives on the deal-detail screen.
export function summarisePipeline(bids: readonly Bid[]): PipelineCounts {
  const counters: Record<BidStatus, number> = {
    pending: 0,
    countered: 0,
    accepted: 0,
    rejected: 0
  }
  for (const bid of bids) {
    counters[bid.status] += 1
  }
  return {
    negotiating: counters.pending + counters.countered,
    accepted: counters.accepted,
    closed: counters.rejected,
    total: bids.length
  }
}

// Listings ranked by listedAt desc + status=open take the lobby slot until
// the gateway exposes a real `closesAt` / `endsAt`. We keep this pure so a
// later sort key change is a single function edit.
export function selectLiveLobby(
  listings: readonly Listing[],
  limit = 6
): readonly Listing[] {
  const open = listings.filter((listing) => listing.status === 'open')
  const sorted = [...open].sort(
    (a, b) => Date.parse(b.listedAt) - Date.parse(a.listedAt)
  )
  return sorted.slice(0, limit)
}

// Recommended feed seed: we currently rank by seller rating then price
// hint, deterministic so React Query caches stably. ML rank will land on
// the gateway later (per Borjie cognitive composition); when it does, the
// home swaps in the ranked feed without changing component contracts.
export function selectRecommended(
  listings: readonly Listing[],
  limit = 5
): readonly Listing[] {
  const open = listings.filter((listing) => listing.status === 'open')
  const sorted = [...open].sort((a, b) => {
    if (b.seller.rating !== a.seller.rating) {
      return b.seller.rating - a.seller.rating
    }
    return a.priceHintTzs - b.priceHintTzs
  })
  return sorted.slice(0, limit)
}

export function selectActiveBids(bids: readonly Bid[], limit = 6): readonly Bid[] {
  const active = bids.filter(
    (bid) => bid.status === 'pending' || bid.status === 'countered'
  )
  const sorted = [...active].sort(
    (a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt)
  )
  return sorted.slice(0, limit)
}
