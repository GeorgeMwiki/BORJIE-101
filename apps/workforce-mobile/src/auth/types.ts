import type { Role } from '../roles/types'

export type Lang = 'sw' | 'en'

export interface User {
  readonly id: string
  readonly role: Role
  readonly tenantId: string
  readonly fullName: string
  readonly preferredLang: Lang
  /**
   * Supabase access token (JWT) — used as the bearer for api-gateway calls.
   * Empty string for the legacy stub user path (kept for compatibility while
   * the dev-mode role picker exists). The real OTP path always populates it.
   */
  readonly accessToken: string
  /** E.164 phone number, e.g. `+255712345678` (no spaces). */
  readonly phoneE164: string
}

export interface AuthState {
  readonly user: User | null
  readonly ready: boolean
}
