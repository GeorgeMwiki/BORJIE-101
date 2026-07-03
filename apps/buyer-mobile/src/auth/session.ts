import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { clearAuthToken, setAuthToken } from './token'
import { getSupabaseClient } from './supabaseClient'
import { parseSupabaseTokenForBuyer } from './buyerClaims'
import { classifyOtpError, classifyOtpMessage, type OtpErrorCode } from './otp-error'
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
  phone: '',
  tenantId: null
}

type Listener = (user: BuyerUser | null) => void

let currentUser: BuyerUser | null = null
// Cached single-flight bootstrap promise. Held so that the splash gate
// (which `await`s it before checking `isAuthenticated()`) and any
// `useSession()` subscriber share ONE in-flight `getSession()` call —
// every awaiter resolves only after the stored Supabase session has been
// loaded and projected.
let bootstrapPromise: Promise<void> | null = null
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
    phone: phoneFormatted,
    tenantId: claims.tenantId
  }
}

export function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise === null) {
    bootstrapPromise = runBootstrap()
  }
  return bootstrapPromise
}

async function runBootstrap(): Promise<void> {
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
        // Hydrate the real KYC status from the gateway so the trust pill
        // reflects approval/rejection rather than the conservative
        // 'pending' default. Fire-and-forget — never blocks app boot.
        void refreshKycStatus()
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
        void refreshKycStatus()
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
  // The tenant claim is JWT-derived (the profile-update response does not
  // carry it). Preserve the known tenant when the incoming user omits one
  // so cross-tenant detection (KI-006) stays stable across a profile save.
  const tenantId = user.tenantId ?? currentUser?.tenantId ?? null
  currentUser = { ...user, tenantId }
  emit()
}

/**
 * Map the gateway KYC record `stage` onto the buyer session `kycStatus`.
 * The verify screen's `KycStage` carries a `reviewing` state which the
 * session model folds into `submitted` (both render as "in review").
 */
function kycStatusFromStage(
  stage: 'submitted' | 'reviewing' | 'approved' | 'rejected'
): BuyerUser['kycStatus'] {
  switch (stage) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'submitted':
    case 'reviewing':
      return 'submitted'
    default:
      return 'pending'
  }
}

/**
 * Hydrate the real KYC status from the gateway into the session so the
 * trust pill reflects approval/rejection rather than the conservative
 * `'pending'` default. Best-effort: on 404 (no KYC record yet) or any
 * error we keep the current status — we NEVER fabricate an approval.
 * Uses a dynamic import to avoid any module-init import cycle through the
 * api client.
 */
export async function refreshKycStatus(): Promise<void> {
  const user = currentUser
  if (!user?.id) {
    return
  }
  try {
    const { fetchKycStatus } = await import('@/api/buyers')
    const record = await fetchKycStatus(`kyc-${user.id}`)
    const nextStatus = kycStatusFromStage(record.stage)
    // Guard against a stale write if the user changed mid-flight.
    if (currentUser?.id === user.id && currentUser.kycStatus !== nextStatus) {
      currentUser = { ...currentUser, kycStatus: nextStatus }
      emit()
    }
  } catch {
    // No record yet / endpoint unavailable — keep the conservative default.
  }
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
  /**
   * A stable, provider-agnostic error CODE on failure (never the raw
   * provider string). The login screen maps this code to localized copy
   * via `t('auth.<code>')` so no English backend string is rendered under
   * an `sw` locale.
   */
  readonly code?: OtpErrorCode
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
    // Classify the raw provider message into a stable CODE — never return
    // `error.message` (an English string that renders as zero-mix under sw).
    if (error) return { code: classifyOtpMessage(error.message) }
    return {}
  } catch (err) {
    return { code: classifyOtpError(err) }
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
    if (error) return { code: classifyOtpMessage(error.message) }
    return {}
  } catch (err) {
    return { code: classifyOtpError(err) }
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
