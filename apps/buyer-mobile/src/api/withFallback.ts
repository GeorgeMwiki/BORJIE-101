import { apiConfig } from './config'
import { isNetworkError } from './errors'

// Resolve a promise, but if the API call fails with a transport-level error
// and fallback is enabled, swap in mock data so the UI can still render.
//
// All non-network errors (4xx, 5xx, validation) are re-thrown so callers see
// real backend failures — only network/offline failures fall back to mocks.
export async function withMockFallback<T>(
  call: () => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (apiConfig.allowMockFallback && isNetworkError(err)) {
      return await fallback()
    }
    throw err
  }
}
