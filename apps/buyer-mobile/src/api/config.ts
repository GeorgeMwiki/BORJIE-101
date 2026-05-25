// Centralised API config. EXPO_PUBLIC_* env vars are inlined at build time
// so they are safe to read from any runtime (web, iOS, Android).

const FALLBACK_GATEWAY = 'http://localhost:4001'

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
  timeoutMs: 15_000,
  // When true, transport errors fall back to mock data so the UI keeps
  // rendering during offline development. Disable in production builds.
  allowMockFallback: true
} as const

export type ApiConfig = typeof apiConfig
