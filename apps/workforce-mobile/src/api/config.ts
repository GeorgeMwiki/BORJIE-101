import Constants from 'expo-constants'

// api-gateway dev port. The gateway listens on :3001 locally (NOT :4001 —
// that was a stale fallback that silently pointed the app at a dead port).
const DEV_GATEWAY_FALLBACK = 'http://localhost:3001'

/**
 * True only when we positively know this is a RELEASE React Native bundle
 * (RN sets the `__DEV__` global to `false` in production builds). When
 * `__DEV__` is absent (Node test runner, tooling) we do NOT treat it as a
 * release build, so the dev fallback applies and tests/imports don't throw.
 */
function isReleaseBuild(): boolean {
  const g = globalThis as unknown as { __DEV__?: boolean }
  return g.__DEV__ === false
}

/**
 * Resolve API gateway URL with this precedence:
 *  1. EXPO_PUBLIC_API_GATEWAY_URL env var (highest — set in EAS / .env)
 *  2. expoConfig.extra.apiGatewayUrl from app.json (dev fallback)
 *  3. dev-only hard fallback to localhost:3001 (the api-gateway dev port)
 *
 * In a RELEASE build with no configured URL we throw loudly rather than
 * silently fall back to localhost (which would 100% fail in production).
 * The URL never ends with a trailing slash so callers can safely concatenate.
 */
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_GATEWAY_URL
  const fromConfig = Constants.expoConfig?.extra?.['apiGatewayUrl'] as
    | string
    | undefined
  const configured = fromEnv ?? fromConfig
  if (configured && configured.length > 0) {
    return configured.replace(/\/+$/u, '')
  }
  if (isReleaseBuild()) {
    throw new Error(
      'EXPO_PUBLIC_API_GATEWAY_URL is not configured for this release build. ' +
        'Set it in EAS env / app.json extra.apiGatewayUrl before shipping.'
    )
  }
  return DEV_GATEWAY_FALLBACK
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
