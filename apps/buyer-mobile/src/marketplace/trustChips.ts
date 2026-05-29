/**
 * trustChips — pure derivation logic for the marketplace trust-chip
 * stack. Lives separately from `TrustChipStack.tsx` so it can be unit-
 * tested in a JS environment without pulling React Native imports.
 *
 * See `Docs/RESEARCH/buyer-marketplace-sota.md` §7.
 */

import type { Listing } from '@/types/listing'

export type TrustChipKind =
  | 'gov-licensed'
  | 'lab-assayed'
  | 'borjie-vetted'
  | 'chain-of-custody'
  | 'seller-history'

export interface TrustChip {
  readonly kind: TrustChipKind
  readonly label: string
  /**
   * Visual tone:
   *  - 'verified'   = green/gold, source-backed
   *  - 'attention'  = amber, expiring or partial
   *  - 'neutral'    = grey, informational only
   */
  readonly tone: 'verified' | 'attention' | 'neutral'
  /**
   * Optional evidence handle for deep-linking (license number, PDF
   * URL, chain hash). Absent when fixture does not carry it.
   */
  readonly evidenceHandle?: string
}

export interface DeriveTrustChipsArgs {
  readonly listing: Listing
  readonly translate: (key: string) => string
  /** Injectable for tests + offline-safe defaults. */
  readonly now?: Date
}

const ASSAY_FRESHNESS_DAYS = 30

/**
 * Returns the chip list given the fixture. Order is stable: gov → lab
 * → borjie → custody → history.
 */
export function deriveTrustChips(args: DeriveTrustChipsArgs): ReadonlyArray<TrustChip> {
  const { listing, translate, now } = args
  const chips: TrustChip[] = []
  const nowDate = now ?? new Date()

  if (listing.seller.pmlNumber.length > 0) {
    chips.push({
      kind: 'gov-licensed',
      label: translate('marketplace.trust.gov_licensed'),
      tone: 'verified',
      evidenceHandle: listing.seller.pmlNumber
    })
  }

  if (listing.assayPdfUrl.length > 0) {
    const listed = new Date(listing.listedAt)
    const ageDays = Math.floor(
      (nowDate.getTime() - listed.getTime()) / (1000 * 60 * 60 * 24)
    )
    const isFresh = Number.isFinite(ageDays) && ageDays <= ASSAY_FRESHNESS_DAYS
    chips.push({
      kind: 'lab-assayed',
      label: translate(
        isFresh ? 'marketplace.trust.lab_assayed' : 'marketplace.trust.lab_assayed_stale'
      ),
      tone: isFresh ? 'verified' : 'attention',
      evidenceHandle: listing.assayPdfUrl
    })
  }

  if (listing.seller.verified) {
    chips.push({
      kind: 'borjie-vetted',
      label: translate('marketplace.trust.borjie_vetted'),
      tone: 'verified'
    })
  }

  if (listing.chainOfCustody.length > 0) {
    chips.push({
      kind: 'chain-of-custody',
      label: translate('marketplace.trust.chain_of_custody'),
      tone: 'verified',
      evidenceHandle: listing.chainOfCustody[0]
    })
  }

  const rating = Number.isFinite(listing.seller.rating) ? listing.seller.rating : 0
  if (rating > 0) {
    const tone: TrustChip['tone'] = rating >= 4.0 ? 'verified' : 'attention'
    const label = translate('marketplace.trust.seller_history') + ` · ${rating.toFixed(1)}★`
    chips.push({ kind: 'seller-history', label, tone })
  }

  return chips
}
