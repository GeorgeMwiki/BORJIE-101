import Constants from 'expo-constants'

/**
 * Resolve API gateway URL with this precedence:
 *  1. EXPO_PUBLIC_API_GATEWAY_URL env var (highest — set in EAS / .env)
 *  2. expoConfig.extra.apiGatewayUrl from app.json (dev fallback)
 *  3. hard fallback to localhost:3001 (matches the api-gateway dev port)
 *
 * The URL never ends with a trailing slash so callers can safely concatenate.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_GATEWAY_URL
  const fromConfig = Constants.expoConfig?.extra?.['apiGatewayUrl'] as
    | string
    | undefined
  const raw = fromEnv ?? fromConfig ?? 'http://localhost:3001'
  return raw.replace(/\/+$/u, '')
}

/**
 * Feature flag: when 'false' the app falls back to mock/offline behaviour
 * and never issues network requests against the gateway. Defaults to 'true'
 * so production builds talk to the real backend.
 */
function resolveUseLiveApi(): boolean {
  const raw = process.env.EXPO_PUBLIC_USE_LIVE_API
  if (typeof raw === 'string') {
    return raw.toLowerCase() !== 'false'
  }
  return true
}

export const API_BASE_URL: string = resolveBaseUrl()
export const USE_LIVE_API: boolean = resolveUseLiveApi()
export const DEFAULT_TIMEOUT_MS = 5_000

// Legacy prefixes — kept so existing field/owner/chat call sites continue to
// compile while screens migrate to the canonical mining prefix.
export const FIELD_PREFIX = '/api/v1/field'
export const OWNER_PREFIX = '/api/v1/owner'
export const CHAT_PREFIX = '/api/v1/chat'

/**
 * Canonical prefix for the api-gateway mining surface. All new wiring
 * (sync queue flushes, screen fetches) must go through this prefix; legacy
 * prefixes above are deprecated and will be removed once callers migrate.
 */
export const MINING_PREFIX = '/api/v1/mining'

export interface ApiPaths {
  readonly field: string
  readonly owner: string
  readonly chat: string
  readonly mining: string
}

export const apiPaths: ApiPaths = {
  field: `${API_BASE_URL}${FIELD_PREFIX}`,
  owner: `${API_BASE_URL}${OWNER_PREFIX}`,
  chat: `${API_BASE_URL}${CHAT_PREFIX}`,
  mining: `${API_BASE_URL}${MINING_PREFIX}`
}
