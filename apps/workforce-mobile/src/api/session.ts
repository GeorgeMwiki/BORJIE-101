/**
 * Auth-token session cache — SECURE storage (hardening B1, 2026-06-11).
 *
 * The bearer token previously persisted to AsyncStorage, which is
 * plaintext and JS-readable: device theft or a malware app with storage
 * access yielded a token good for every workforce operation. It now lives
 * in `expo-secure-store` (Keychain on iOS, EncryptedSharedPreferences on
 * Android) — the same pattern auth/supabaseClient.ts already uses for the
 * Supabase session.
 *
 * Migration: on first load we read the legacy AsyncStorage key once; if a
 * token is found it is moved into SecureStore and the plaintext copy is
 * deleted, so existing logged-in devices upgrade transparently and the
 * plaintext value stops existing.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'

const TOKEN_KEY = 'borjie.auth.token.v1'
// SecureStore keys may only contain [A-Za-z0-9._-]; the legacy key is valid.
const SECURE_TOKEN_KEY = TOKEN_KEY

interface SessionCache {
  token: string | null
  loaded: boolean
}

const cache: SessionCache = { token: null, loaded: false }

/** One-time migration: move any legacy plaintext token into SecureStore. */
async function migrateLegacyToken(): Promise<string | null> {
  try {
    const legacy = await AsyncStorage.getItem(TOKEN_KEY)
    if (legacy !== null) {
      await SecureStore.setItemAsync(SECURE_TOKEN_KEY, legacy)
      await AsyncStorage.removeItem(TOKEN_KEY)
      return legacy
    }
  } catch {
    // Migration is best-effort; a failed read falls through to SecureStore.
  }
  return null
}

async function ensureLoaded(): Promise<void> {
  if (cache.loaded) {
    return
  }
  try {
    const stored = await SecureStore.getItemAsync(SECURE_TOKEN_KEY)
    cache.token = stored ?? (await migrateLegacyToken())
  } catch {
    cache.token = null
  } finally {
    cache.loaded = true
  }
}

export async function getAuthToken(): Promise<string | null> {
  await ensureLoaded()
  return cache.token
}

export async function setAuthToken(token: string | null): Promise<void> {
  cache.token = token
  cache.loaded = true
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync(SECURE_TOKEN_KEY)
      // Defensive: clear any stale legacy plaintext copy too.
      await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined)
      return
    }
    await SecureStore.setItemAsync(SECURE_TOKEN_KEY, token)
  } catch (error) {
    console.error('Failed to persist auth token:', error)
  }
}

export function getCachedAuthToken(): string | null {
  return cache.token
}
