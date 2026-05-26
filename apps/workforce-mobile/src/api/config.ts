import Constants from 'expo-constants'

/**
 * Resolve API gateway URL with this precedence:
 *  1. EXPO_PUBLIC_API_GATEWAY_URL env var (highest — set in EAS / .env)
 *  2. expoConfig.extra.apiGatewayUrl from app.json (dev fallback)
 *  3. hard fallback to localhost:4001 (matches the api-gateway dev port)
 *
 * The URL never ends with a trailing slash so callers can safely concatenate.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_GATEWAY_URL
  const fromConfig = Constants.expoConfig?.extra?.['apiGatewayUrl'] as
    | string
    | undefined
  const raw = fromEnv ?? fromConfig ?? 'http://localhost:4001'
  return raw.replace(/\/+$/u, '')
}

export const API_BASE_URL: string = resolveBaseUrl()
export const DEFAULT_TIMEOUT_MS = 5_000

// Legacy prefixes — kept so existing field/owner/chat call sites continue to
// compile while screens migrate to the canonical mining prefix.
export const FIELD_PREFIX = '/api/v1/field'
export const OWNER_PREFIX = '/api/v1/owner'
// Master Brain SSE entry — authenticated workforce chat. Public-buyer
// equivalent lives at '/api/v1/public/chat' (used by buyer-mobile).
export const CHAT_PREFIX = '/api/v1/mining/chat'

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
