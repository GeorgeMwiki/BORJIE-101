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

export const apiConfig = {
  baseUrl: readBaseUrl(),
  timeoutMs: 5_000
} as const

export type ApiConfig = typeof apiConfig

/**
 * Canonical prefix for the api-gateway mining surface. All buyer flows
 * (marketplace, bids, KYC) live under this prefix.
 */
export const MINING_PREFIX = '/api/v1/mining'
