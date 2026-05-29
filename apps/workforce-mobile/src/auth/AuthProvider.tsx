import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, buildStubUser, type AuthContextValue, type OtpResult } from './useAuth'
import { getSupabaseClient } from './supabaseClient'
import { parseSupabaseToken } from './jwtClaims'
import { setAuthToken } from './session'
import type { User } from './types'
import { isRole, type Role } from '../roles/types'
import { registerPushToken } from '../lib/notifications/push-register'

const STORAGE_KEY = 'borjie.auth.role.v1'

interface AuthProviderProps {
  readonly children: ReactNode
}

function deriveNameFromRole(role: Role): string {
  switch (role) {
    case 'owner':
      return 'Owner'
    case 'manager':
      return 'Manager'
    case 'employee':
      return 'Employee'
    default:
      return 'User'
  }
}

/**
 * Build a `User` from a Supabase `Session`. Returns `null` if the token is
 * missing required custom claims (`app_metadata.tenant_id` /
 * `mining_role`) — the caller should then sign the user out and prompt for
 * re-onboarding.
 */
function userFromSession(session: Session): User | null {
  const accessToken = session.access_token
  const claims = parseSupabaseToken(accessToken)
  if (!claims || !claims.tenantId || !claims.role) {
    return null
  }
  const phoneE164 = claims.phone ?? session.user.phone ?? ''
  const fullName =
    (session.user.user_metadata?.full_name as string | undefined) ??
    deriveNameFromRole(claims.role)
  return {
    id: claims.userId || session.user.id,
    role: claims.role,
    tenantId: claims.tenantId,
    fullName,
    preferredLang: 'en',
    accessToken,
    phoneE164: phoneE164.startsWith('+') ? phoneE164 : `+${phoneE164}`
  }
}

function normaliseE164(phone: string): string {
  // Supabase expects E.164 WITHOUT spaces, e.g. +255712345678
  return phone.replace(/\s+/g, '')
}

/**
 * AuthProvider — wires the app to Supabase phone-OTP auth. Keeps the dev-mode
 * role picker (`setRole`) working until that flow is fully retired so
 * downstream components like `RoleGuard` and `BackgroundSyncMount` continue
 * to compile.
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState<boolean>(false)

  useEffect(() => {
    let cancelled = false
    const supabase = getSupabaseClient()

    async function bootstrap(): Promise<void> {
      try {
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          const next = userFromSession(data.session)
          if (next) {
            setUser(next)
            await setAuthToken(data.session.access_token)
            // Fire-and-forget push registration on cold-boot with an
            // existing session — keeps the device token fresh in
            // device_push_tokens. Never blocks app boot.
            void registerPushToken()
          }
        } else {
          // Fallback: dev role picker — keeps Expo Go onboarding working
          // before Supabase is wired in CI/EAS-build.
          const stored = await AsyncStorage.getItem(STORAGE_KEY)
          if (!cancelled && isRole(stored)) {
            setUser(buildStubUser(stored))
          }
        }
      } catch {
        // bootstrap failures fall through to the role picker
      } finally {
        if (!cancelled) {
          setReady(true)
        }
      }
    }
    void bootstrap()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (!session) {
        setUser(null)
        void setAuthToken(null)
        return
      }
      const next = userFromSession(session)
      if (next) {
        setUser(next)
        void setAuthToken(session.access_token)
        // Sign-in / token-refresh — push the latest device token to the
        // backend so any new user_id mapping is recorded.
        void registerPushToken()
      }
    })

    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const setRole = useCallback((role: Role): void => {
    const next = buildStubUser(role)
    setUser(next)
    void AsyncStorage.setItem(STORAGE_KEY, role).catch(() => undefined)
  }, [])

  const signOut = useCallback((): void => {
    const supabase = getSupabaseClient()
    setUser(null)
    void supabase.auth.signOut().catch(() => undefined)
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined)
    void setAuthToken(null)
  }, [])

  const sendOtp = useCallback(async (phoneE164: string): Promise<OtpResult> => {
    try {
      const supabase = getSupabaseClient()
      const { error } = await supabase.auth.signInWithOtp({
        phone: normaliseE164(phoneE164)
      })
      if (error) {
        return { error: error.message }
      }
      return {}
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'send_otp_failed' }
    }
  }, [])

  const verifyOtp = useCallback(
    async (phoneE164: string, code: string): Promise<OtpResult> => {
      try {
        const supabase = getSupabaseClient()
        const { error } = await supabase.auth.verifyOtp({
          phone: normaliseE164(phoneE164),
          token: code,
          type: 'sms'
        })
        if (error) {
          return { error: error.message }
        }
        return {}
      } catch (err) {
        return {
          error: err instanceof Error ? err.message : 'verify_otp_failed'
        }
      }
    },
    []
  )

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, setRole, signOut, sendOtp, verifyOtp }),
    [user, ready, setRole, signOut, sendOtp, verifyOtp]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
