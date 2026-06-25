/**
 * Offtake query hooks — the buyer leg of the completion-law loop.
 *
 * `useOfftakeForBid` resolves the binding offtake contract crystallized from
 * a specific accepted bid; it is enabled only when the bid is `accepted` so we
 * never fire the request for a bid that cannot yet have a contract.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  fetchMyOfftakeAgreements,
  fetchOfftakeForBid,
  type OfftakeAgreement,
} from '@/api/offtake'
import { queryKeys } from '@/api/queryKeys'

/** All of the calling buyer's binding offtake contracts (newest first). */
export function useMyOfftakeAgreements(): UseQueryResult<
  ReadonlyArray<OfftakeAgreement>
> {
  return useQuery({
    queryKey: queryKeys.offtakeAgreements(),
    queryFn: ({ signal }) => fetchMyOfftakeAgreements(signal),
    staleTime: 30_000,
  })
}

/**
 * The offtake contract for a single bid. `enabled` gates the request to
 * accepted bids only — a contract only exists once the seller accepts.
 */
export function useOfftakeForBid(
  bidId: string,
  enabled: boolean,
): UseQueryResult<OfftakeAgreement | null> {
  return useQuery({
    queryKey: queryKeys.offtakeForBid(bidId),
    queryFn: ({ signal }) => fetchOfftakeForBid(bidId, signal),
    enabled: enabled && bidId.length > 0,
    staleTime: 30_000,
  })
}
