/**
 * Push-token registration for buyer-mobile.
 *
 * Wired into `src/auth/session.ts` so every successful Supabase sign-in
 * (re-)posts the device's Expo push token to the api-gateway, which
 * stores it in `device_push_tokens` (migration 0139). The notification
 * dispatcher then resolves all active tokens for a buyer at fan-out
 * time so RFB-fulfilled / bid-accepted / settlement-paid pushes hit
 * every surface the buyer is signed-in on.
 *
 * Permission handling:
 *   - Gracefully no-ops when the user denies notification permission;
 *     the rest of the app keeps working.
 *   - On Expo Go the API call is skipped because Expo Go's push tokens
 *     are sandboxed; registration runs in development builds.
 *   - Web platform short-circuits — we only collect tokens on iOS /
 *     Android.
 *
 * This module never throws — registration MUST NOT block app boot.
 */

import { Platform } from 'react-native'

import { apiFetch } from '@/api/client'

interface ExpoNotificationsModule {
  readonly getPermissionsAsync: () => Promise<{
    readonly status: 'undetermined' | 'granted' | 'denied'
  }>
  readonly requestPermissionsAsync: () => Promise<{
    readonly status: 'undetermined' | 'granted' | 'denied'
  }>
  readonly getExpoPushTokenAsync: (config?: {
    readonly projectId?: string
  }) => Promise<{ readonly data: string }>
}

interface ExpoConstantsModule {
  readonly expoConfig?: {
    readonly extra?: {
      readonly eas?: { readonly projectId?: string }
    } | null
  } | null
  readonly easConfig?: { readonly projectId?: string } | null
}

interface ExpoDeviceModule {
  readonly isDevice: boolean
}

const APP_NAME = 'buyer-mobile' as const

let lastRegisteredToken: string | null = null

function devWarn(message: string, error?: unknown): void {
  if (__DEV__) {
    console.warn(`[push-register] ${message}`, error ?? '') // eslint-disable-line no-console -- reason: DEV-only diagnostic per CLAUDE.md mobile-console rule.
  }
}

async function loadNotifications(): Promise<ExpoNotificationsModule | null> {
  try {
    const mod = (await import('expo-notifications')) as unknown as ExpoNotificationsModule
    return mod
  } catch (error) {
    devWarn('expo-notifications not installed', error)
    return null
  }
}

async function loadConstants(): Promise<ExpoConstantsModule | null> {
  try {
    const mod = await import('expo-constants')
    return (mod.default ?? mod) as ExpoConstantsModule
  } catch {
    return null
  }
}

async function loadDevice(): Promise<ExpoDeviceModule | null> {
  try {
    const mod = await import('expo-device')
    return (mod.default ?? mod) as ExpoDeviceModule
  } catch {
    return null
  }
}

function resolveProjectId(constants: ExpoConstantsModule | null): string | undefined {
  const eas = constants?.expoConfig?.extra?.eas?.projectId
  if (typeof eas === 'string' && eas.length > 0) return eas
  const easCfg = constants?.easConfig?.projectId
  if (typeof easCfg === 'string' && easCfg.length > 0) return easCfg
  return undefined
}

function resolvePlatform(): 'ios' | 'android' | 'web' | null {
  if (Platform.OS === 'ios') return 'ios'
  if (Platform.OS === 'android') return 'android'
  if (Platform.OS === 'web') return 'web'
  return null
}

export interface RegisterPushTokenResult {
  readonly registered: boolean
  readonly reason?: 'permission_denied' | 'no_device' | 'no_token' | 'not_supported' | 'error'
}

/**
 * Idempotently register the device's Expo push token with the backend.
 * Safe to call repeatedly — the backend collapses duplicate
 * `(user, app, token)` triples into a single row via ON CONFLICT.
 */
export async function registerPushToken(): Promise<RegisterPushTokenResult> {
  const platform = resolvePlatform()
  if (!platform || platform === 'web') {
    return { registered: false, reason: 'not_supported' }
  }
  const notifications = await loadNotifications()
  if (!notifications) {
    return { registered: false, reason: 'not_supported' }
  }
  const device = await loadDevice()
  if (device && device.isDevice === false) {
    return { registered: false, reason: 'no_device' }
  }
  try {
    const current = await notifications.getPermissionsAsync()
    let status = current.status
    if (status !== 'granted') {
      const next = await notifications.requestPermissionsAsync()
      status = next.status
    }
    if (status !== 'granted') {
      return { registered: false, reason: 'permission_denied' }
    }
    const constants = await loadConstants()
    const projectId = resolveProjectId(constants)
    const token = projectId
      ? await notifications.getExpoPushTokenAsync({ projectId })
      : await notifications.getExpoPushTokenAsync()
    if (!token?.data) {
      return { registered: false, reason: 'no_token' }
    }
    if (lastRegisteredToken === token.data) {
      return { registered: true }
    }
    await apiFetch('/api/v1/me/device-tokens', {
      method: 'POST',
      body: {
        platform,
        app: APP_NAME,
        expoPushToken: token.data
      }
    })
    lastRegisteredToken = token.data
    return { registered: true }
  } catch (error) {
    devWarn('registerPushToken failed', error)
    return { registered: false, reason: 'error' }
  }
}

/** Test helper — reset dedupe state so unit tests can replay sequences. */
export function __resetPushRegistrationForTests(): void {
  lastRegisteredToken = null
}
