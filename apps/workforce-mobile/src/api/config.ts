import Constants from 'expo-constants'

/**
 * Resolve API gateway URL with this precedence:
 *  1. EXPO_PUBLIC_API_GATEWAY_URL env var (highest — set in EAS / .env)
 *  2. expoConfig.extra.apiGatewayUrl from app.json (dev fallback)
 *  3. hard fallback to localhost (test environment)
 *
 * The URL never ends with a trailing slash so callers can safely concatenate.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_GATEWAY_URL
  const fromConfig = Constants.expoConfig?.extra?.['apiGatewayUrl'] as
    | string
    | undefined
  const raw = fromEnv ?? fromConfig ?? 'http://localhost:4000'
  return raw.replace(/\/+$/u, '')
}

export const API_BASE_URL: string = resolveBaseUrl()

export const FIELD_PREFIX = '/api/v1/field'
export const OWNER_PREFIX = '/api/v1/owner'
export const CHAT_PREFIX = '/api/v1/chat'

export interface ApiPaths {
  readonly field: string
  readonly owner: string
  readonly chat: string
}

export const apiPaths: ApiPaths = {
  field: `${API_BASE_URL}${FIELD_PREFIX}`,
  owner: `${API_BASE_URL}${OWNER_PREFIX}`,
  chat: `${API_BASE_URL}${CHAT_PREFIX}`
}
