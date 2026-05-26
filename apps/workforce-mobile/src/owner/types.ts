export interface DailyBriefCard {
  id: string
  kind: 'cash_runway' | 'open_decisions' | 'today_blockers' | 'generic'
  title: string
  value: string
  caption?: string
}

export interface DailyBriefResponse {
  generatedAt: string
  cards: ReadonlyArray<DailyBriefCard>
}

export type LicenceBucket = 't7' | 't30' | 't90' | 'expired'

export interface Licence {
  id: string
  pmlNumber: string
  siteName: string
  /** Optional mineral type (gold, copper, gemstone, etc.). */
  mineral?: string
  /** ISO-8601 expiry; preferred over `expiresOn` for client-side bucketing. */
  expiresAt?: string
  /** Legacy date-only expiry string. */
  expiresOn: string
  daysLeft: number
  bucket: LicenceBucket
}

export interface LicencesResponse {
  generatedAt: string
  licences: ReadonlyArray<Licence>
}

/**
 * Server response for POST /api/v1/mining/licences/:id/renew.
 * Echoed back so the UI can confirm the queued renewal id and the new
 * expiry it will apply on success.
 */
export interface LicenceRenewalResponse {
  renewalId: string
  licenceId: string
  status: 'queued' | 'submitted' | 'accepted'
  submittedAt: string
}
