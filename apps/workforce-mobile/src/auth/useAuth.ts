import { createContext, useContext } from 'react'
import type { AuthState, User } from './types'
import type { Role } from '../roles/types'

export interface AuthContextValue extends AuthState {
  setRole: (role: Role) => void
  signOut: () => void
}

const DEFAULT_STATE: AuthContextValue = {
  user: null,
  ready: false,
  setRole: () => undefined,
  signOut: () => undefined
}

export const AuthContext = createContext<AuthContextValue>(DEFAULT_STATE)

export function useAuth(): AuthContextValue {
  return useContext(AuthContext)
}

/**
 * Returns a stub user for a given role. Used by AuthProvider while we wire up
 * a real identity backend. Pure factory — does not touch storage.
 */
export function buildStubUser(role: Role): User {
  return {
    id: `dev-${role}-001`,
    role,
    tenantId: 'tenant-dev',
    fullName: stubName(role),
    preferredLang: 'en'
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
