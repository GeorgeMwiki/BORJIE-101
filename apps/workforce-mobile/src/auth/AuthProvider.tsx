import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { AuthContext, buildStubUser, type AuthContextValue } from './useAuth'
import type { User } from './types'
import { isRole, type Role } from '../roles/types'

const STORAGE_KEY = 'borjie.auth.role.v1'

interface AuthProviderProps {
  children: ReactNode
}

/**
 * Stub auth provider. Persists the chosen role to AsyncStorage so the dev
 * picker only appears once per install (until cleared). Replace with real
 * phone+biometric auth in a later phase.
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    async function bootstrap(): Promise<void> {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY)
        if (!cancelled && isRole(stored)) {
          setUser(buildStubUser(stored))
        }
      } catch {
        // ignore — first launch will simply show role picker
      } finally {
        if (!cancelled) {
          setReady(true)
        }
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  const setRole = useCallback((role: Role): void => {
    const next = buildStubUser(role)
    setUser(next)
    void AsyncStorage.setItem(STORAGE_KEY, role).catch(() => undefined)
  }, [])

  const signOut = useCallback((): void => {
    setUser(null)
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, setRole, signOut }),
    [user, ready, setRole, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
