export type BuyerRole = 'buyer'
export type LanguageCode = 'sw' | 'en'

export type CountryCode = 'TZ' | 'KE' | 'CD' | 'CN' | 'AE' | 'CH'

export interface BuyerUser {
  readonly id: string
  readonly role: BuyerRole
  readonly companyName: string
  readonly countryCode: CountryCode
  readonly preferredLang: LanguageCode
  readonly kycStatus: 'pending' | 'submitted' | 'approved' | 'rejected'
  readonly phone: string
}
