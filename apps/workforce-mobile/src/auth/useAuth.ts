import { createContext, useContext } from 'react'
import type { AuthState, User } from './types'
import type { Role } from '../roles/types'

export interface OtpResult {
  readonly error?: string
}

export interface AuthContextValue extends AuthState {
  /** Dev-only: bind the local role for the staged role-picker flow. */
  setRole: (role: Role) => void
  /** Sign out — clears the Supabase session and local state. */
  signOut: () => void
  /**
   * Request a Supabase phone OTP. Returns `{ error }` on failure so the
   * caller (phone screen) can render an inline error without throwing.
   */
  sendOtp: (phoneE164: string) => Promise<OtpResult>
  /** Verify the 6-digit OTP. On success the AuthProvider session updates. */
  verifyOtp: (phoneE164: string, code: string) => Promise<OtpResult>
}

const DEFAULT_STATE: AuthContextValue = {
  user: null,
  ready: false,
  setRole: () => undefined,
  signOut: () => undefined,
  sendOtp: async () => ({ error: 'auth not initialised' }),
  verifyOtp: async () => ({ error: 'auth not initialised' })
}

export const AuthContext = createContext<AuthContextValue>(DEFAULT_STATE)

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

/**
 * @deprecated Use the real Supabase OTP flow via `useAuth().sendOtp` /
 * `verifyOtp`. The stub user remains exported temporarily so the dev-mode
 * role picker keeps compiling; remove in a follow-up commit once the
 * picker is fully retired.
 */
export function buildStubUser(role: Role): User {
  return {
    id: `dev-${role}-001`,
    role,
    tenantId: 'tenant-dev',
    fullName: stubName(role),
    preferredLang: 'en',
    accessToken: '',
    phoneE164: ''
  }
}

function stubName(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Bwana Mkubwa (Dev)'
    case 'manager':
      return 'Meneja wa Mgodi (Dev)'
    case 'employee':
      return 'Mfanyakazi wa Shifti (Dev)'
    default:
      return 'Dev User'
  }
}
