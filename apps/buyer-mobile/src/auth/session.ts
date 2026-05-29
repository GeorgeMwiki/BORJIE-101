import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { clearAuthToken, setAuthToken } from './token'
import { getSupabaseClient } from './supabaseClient'
import { parseSupabaseTokenForBuyer } from './buyerClaims'
import type { BuyerUser } from '@/types/auth'
import { registerPushToken } from '@/lib/notifications/push-register'

// Reactive in-memory session store, backed by Supabase phone OTP.
// The mobile UI consumes `useSession()` — when Supabase emits a session
// change (sign-in, refresh, sign-out), we project it to a BuyerUser and
// notify subscribers so React components re-render.
//
// `GUEST_USER` is the unauthenticated sentinel: it contains no PII and is
// only used to keep screens that read `user.preferredLang` (i18n) and
// `user.id` (KYC route param) from crashing before the user signs in.
// Routing guards must use `isAuthenticated()` to redirect to /auth/login.

const GUEST_USER: BuyerUser = {
  id: '',
  role: 'buyer',
  companyName: '',
  countryCode: 'TZ',
  preferredLang: 'en',
  kycStatus: 'pending',
  phone: ''
}

type Listener = (user: BuyerUser | null) => void

let currentUser: BuyerUser | null = null
let bootstrapped = false
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) {
    listener(currentUser)
  }
}

function projectSession(session: Session | null): BuyerUser | null {
  if (!session) return null
  const accessToken = session.access_token
  const claims = parseSupabaseTokenForBuyer(accessToken)
  if (!claims) return null
  const phone = (claims.phone ?? session.user.phone ?? '').replace(/\s+/g, '')
  const phoneFormatted = phone.startsWith('+') ? phone : phone.length > 0 ? `+${phone}` : ''
  const companyName =
    (session.user.user_metadata?.company_name as string | undefined) ?? 'Buyer'
  return {
    id: claims.userId || session.user.id,
    role: 'buyer',
    companyName,
    countryCode: 'TZ',
    preferredLang: 'en',
    kycStatus: 'pending',
    phone: phoneFormatted
  }
}

async function ensureBootstrapped(): Promise<void> {
  if (bootstrapped) return
  bootstrapped = true
  try {
    const supabase = getSupabaseClient()
    const { data } = await supabase.auth.getSession()
    const next = projectSession(data.session)
    if (next) {
      currentUser = next
      if (data.session) {
        await setAuthToken(data.session.access_token)
        // Fire-and-forget push registration on cold-boot — keeps the
        // device token fresh in `device_push_tokens`. Never blocks app boot.
        void registerPushToken()
      }
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      const projected = projectSession(session)
      currentUser = projected
      if (session) {
        void setAuthToken(session.access_token)
        // Sign-in or token-refresh — push the latest device token so
        // any new user_id mapping is recorded server-side.
        void registerPushToken()
      } else {
        void clearAuthToken()
      }
      emit()
    })
    emit()
  } catch {
    // Bootstrap failed (e.g. missing env in dev) — leave currentUser null;
    // subscribers will render unauthenticated state.
  }
}

export function getCurrentUser(): BuyerUser {
  return currentUser ?? GUEST_USER
}

export function isAuthenticated(): boolean {
  return Boolean(currentUser?.id)
}

export function setCurrentUser(user: BuyerUser): void {
  currentUser = user
  emit()
}

export function setPreferredLang(lang: BuyerUser['preferredLang']): void {
  if (!currentUser) {
    return
  }
  currentUser = { ...currentUser, preferredLang: lang }
  emit()
}

export async function logout(): Promise<void> {
  try {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
  } catch {
    // ignore — local state is the source of truth for the UI
  }
  currentUser = null
  await clearAuthToken()
  emit()
}

export interface OtpResult {
  readonly error?: string
}

function normaliseE164(phone: string): string {
  return phone.replace(/\s+/g, '')
}

export async function sendBuyerOtp(phoneE164: string): Promise<OtpResult> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithOtp({
      phone: normaliseE164(phoneE164)
    })
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'send_otp_failed' }
  }
}

export async function verifyBuyerOtp(
  phoneE164: string,
  code: string
): Promise<OtpResult> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.verifyOtp({
      phone: normaliseE164(phoneE164),
      token: code,
      type: 'sms'
    })
    if (error) return { error: error.message }
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'verify_otp_failed' }
  }
}

export function subscribe(listener: Listener): () => void {
  void ensureBootstrapped()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSession(): BuyerUser {
  const [user, setUser] = useState<BuyerUser>(() => getCurrentUser())
  useEffect(() => subscribe((next) => setUser(next ?? GUEST_USER)), [])
  return user
}
