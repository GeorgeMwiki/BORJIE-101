// Centralised API config. EXPO_PUBLIC_* env vars are inlined at build time
// so they are safe to read from any runtime (web, iOS, Android).

const FALLBACK_GATEWAY = 'http://localhost:3001'

function readBaseUrl(): string {
  const raw =
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.EXPO_PUBLIC_API_GATEWAY_URL
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.replace(/\/+$/, '')
  }
  return FALLBACK_GATEWAY
}

/**
 * Feature flag: when 'false' all network calls short-circuit to their mock
 * fallbacks and no fetch is issued. Defaults to true so production builds
 * talk to the live api-gateway.
 */
function readUseLiveApi(): boolean {
  const raw =
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.EXPO_PUBLIC_USE_LIVE_API
  if (typeof raw === 'string') {
    return raw.toLowerCase() !== 'false'
  }
  return true
}

export const apiConfig = {
  baseUrl: readBaseUrl(),
  timeoutMs: 5_000,
  useLiveApi: readUseLiveApi(),
  // When true, transport errors fall back to mock data so the UI keeps
  // rendering during offline development. Disable in production builds.
  allowMockFallback: true
} as const

export type ApiConfig = typeof apiConfig

/**
 * Canonical prefix for the api-gateway mining surface. All buyer flows
 * (marketplace, bids, KYC) live under this prefix.
 */
export const MINING_PREFIX = '/api/v1/mining'
