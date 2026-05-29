/**
 * Push-token registration for workforce-mobile.
 *
 * Wired into AuthProvider so every successful Supabase sign-in (re-)posts
 * the device's Expo push token to the api-gateway, which stores it in
 * `device_push_tokens` (migration 0139). The dispatcher in
 * `services/notifications/src/dispatcher.ts` then resolves all active
 * tokens for a user at fan-out time so notifications hit every surface
 * the worker is signed-in on.
 *
 * Permission handling:
 *   - Gracefully no-ops when the user denies notification permission;
 *     the rest of the app keeps working (push is opt-in by OS policy).
 *   - On Expo Go the API call is skipped because Expo Go's push tokens
 *     are sandboxed; we still attempt registration in development
 *     builds.
 *   - Web platform short-circuits — we only collect tokens on iOS /
 *     Android where notifications are meaningful for a field worker.
 *
 * Failure surfaces:
 *   - Network error → logged under __DEV__ via console.warn; the next
 *     auth state change will retry.
 *   - 4xx from gateway → swallowed; user-visible UI is unaffected.
 *
 * This module never throws — registration MUST NOT block app boot.
 */

import { Platform } from 'react-native'

import { request } from '../../api/client'
import { API_BASE_URL } from '../../api/config'

/**
 * Minimal expo-notifications shape we depend on. We import lazily so a
 * test environment without the native module installed (vitest) does
 * not blow up at module load.
 */
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

const APP_NAME = 'workforce-mobile' as const

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
    // Simulator / emulator — Expo cannot mint a real push token here.
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
      // Already registered in this app lifetime — backend upsert is cheap
      // but skipping saves a round-trip.
      return { registered: true }
    }
    await postRegistration(platform, token.data)
    lastRegisteredToken = token.data
    return { registered: true }
  } catch (error) {
    devWarn('registerPushToken failed', error)
    return { registered: false, reason: 'error' }
  }
}

interface DeviceTokenPayload {
  readonly platform: 'ios' | 'android' | 'web'
  readonly app: typeof APP_NAME
  readonly expoPushToken: string
}

async function postRegistration(
  platform: 'ios' | 'android' | 'web',
  expoPushToken: string,
): Promise<void> {
  const body: DeviceTokenPayload = {
    platform,
    app: APP_NAME,
    expoPushToken
  }
  // The token endpoint lives at the api-gateway root (/api/v1/me/device-tokens),
  // not under the mining or owner prefix, so we hit it with the raw
  // request helper rather than any of the prefixed clients.
  await request(`${API_BASE_URL}/api/v1/me/device-tokens`, {
    method: 'POST',
    body
  })
}

/**
 * Test helper — reset the in-memory dedupe so unit tests can assert
 * multiple registrations in sequence.
 */
export function __resetPushRegistrationForTests(): void {
  lastRegisteredToken = null
}
