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
  /**
   * The buyer's own platform tenant, from the JWT `app_metadata.tenant_id`
   * claim (UI-routing only — never authorisation). Drives cross-tenant
   * detection on a listing (KI-006): a listing whose seller tenant differs
   * from this is biddable only via an inquiry, not a place-bid. Null when
   * the token carried no tenant claim.
   */
  readonly tenantId: string | null
}
