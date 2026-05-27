/**
 * Supabase client for the workforce-mobile app.
 *
 * Required env vars (set in `eas.json` env block per profile, mirrored to
 * `app.json` extras at build time, or set as `EXPO_PUBLIC_*` for `expo start`):
 *   - EXPO_PUBLIC_SUPABASE_URL          e.g. https://xyzcompany.supabase.co
 *   - EXPO_PUBLIC_SUPABASE_ANON_KEY     the `anon`/`public` key (never the
 *                                       `service_role` key — that lives only
 *                                       on the server).
 *
 * Storage: sessions are persisted in `expo-secure-store` (Keychain on iOS,
 * EncryptedSharedPreferences on Android) so refresh tokens survive app
 * restart without leaking to the JS-readable AsyncStorage.
 *
 * NOTE: `detectSessionInUrl` is disabled — mobile doesn't have a browser URL
 * fragment to parse, and leaving it on causes Supabase to attempt to read
 * `window.location` which throws in the React Native runtime.
 */

import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface RuntimeConfig {
  readonly supabaseUrl: string
  readonly supabaseAnonKey: string
}

function readConfig(): RuntimeConfig {
  const extra = Constants.expoConfig?.extra ?? {}
  const url =
    (extra as Record<string, unknown>).supabaseUrl as string | undefined ??
    process.env.EXPO_PUBLIC_SUPABASE_URL ??
    ''
  const anonKey =
    (extra as Record<string, unknown>).supabaseAnonKey as string | undefined ??
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    ''
  return { supabaseUrl: url, supabaseAnonKey: anonKey }
}

function assertConfig(cfg: RuntimeConfig): void {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    throw new Error(
      'Supabase config missing — set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY (env) or expo.extra.supabaseUrl / ' +
        'expo.extra.supabaseAnonKey (app.json) before launching workforce-mobile.'
    )
  }
}

/**
 * Adapter that lets `@supabase/supabase-js` persist its auth session in
 * `expo-secure-store`. The SDK calls this with the key namespace
 * `sb-<projectRef>-auth-token` — we forward to SecureStore unchanged.
 */
const secureStorageAdapter = {
  getItem: (key: string): Promise<string | null> =>
    SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key)
}

function buildClient(): SupabaseClient {
  const cfg = readConfig()
  assertConfig(cfg)
  return createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      storage: secureStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  })
}

// Lazy singleton — `buildClient()` throws if env is missing, and we don't
// want to crash the JS bundle at module-load time during unit tests. Calling
// `getSupabaseClient()` at the first auth interaction is sufficient.
let cached: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!cached) {
    cached = buildClient()
  }
  return cached
}

/**
 * Test-only — reset the cached client so tests can re-stub env between
 * `describe` blocks. Not used in production code paths.
 */
export function _resetSupabaseClientForTests(): void {
  cached = null
}
