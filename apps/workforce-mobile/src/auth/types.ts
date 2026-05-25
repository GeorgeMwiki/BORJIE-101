import type { Role } from '../roles/types'

export type Lang = 'sw' | 'en'

export interface User {
  id: string
  role: Role
  tenantId: string
  fullName: string
  preferredLang: Lang
}

export interface AuthState {
  user: User | null
  ready: boolean
}
