import { apiConfig } from './config'
import { isNetworkError } from './errors'

/**
 * Wrap a live API call so the UI keeps rendering when the backend is
 * unreachable. Behaviour:
 *
 *  - If the EXPO_PUBLIC_USE_LIVE_API flag is 'false', skip the live call
 *    entirely and resolve with the mock immediately. Keeps screenshot /
 *    demo builds deterministic.
 *  - Otherwise attempt the live call. On transport-level failure (network
 *    error, timeout) and when mock fallback is allowed, swap in mocks.
 *  - Any non-network error (4xx, 5xx, validation) is re-thrown so callers
 *    see real backend failures and can show a real error state.
 */
export async function withMockFallback<T>(
  call: () => Promise<T>,
  fallback: () => T | Promise<T>
): Promise<T> {
  if (!apiConfig.useLiveApi) {
    return await fallback()
  }
  try {
    return await call()
  } catch (err) {
    if (apiConfig.allowMockFallback && isNetworkError(err)) {
      return await fallback()
    }
    throw err
  }
}
