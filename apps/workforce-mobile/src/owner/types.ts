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
  expiresOn: string
  daysLeft: number
  bucket: LicenceBucket
}

export interface LicencesResponse {
  generatedAt: string
  licences: ReadonlyArray<Licence>
}
