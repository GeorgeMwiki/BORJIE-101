// Centralised API config. EXPO_PUBLIC_* env vars are inlined at build time
// so they are safe to read from any runtime (web, iOS, Android).

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

function readBaseUrl(): string {
  const raw =
    typeof process !== 'undefined' &&
    typeof process.env !== 'undefined' &&
    process.env.EXPO_PUBLIC_API_GATEWAY_URL
  if (typeof raw === 'string' && raw.length > 0) {
    return raw.replace(/\/+$/, '')
  }
  // Fail loudly in a release build rather than silently target localhost,
  // which is guaranteed to fail in production.
  if (isReleaseBuild()) {
    throw new Error(
      'EXPO_PUBLIC_API_GATEWAY_URL is not configured for this release build. ' +
        'Set it in EAS env before shipping.'
    )
  }
  return DEV_GATEWAY_FALLBACK
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
