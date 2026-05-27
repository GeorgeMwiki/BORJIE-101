/**
 * Optimistic-wiring helper for Manager home.
 *
 * Some endpoints (B-Manager agent is building them in parallel) may return
 * 404 or 501 today. We don't want to crash the screen — instead, the card
 * renders a PreviewBanner kind='env-missing' with the missing path surfaced.
 * React-query will retry on next focus / refetch, so the moment the backend
 * lands the screen auto-recovers without a reload.
 *
 * `classifyEndpointError` returns:
 *   - 'missing'  → render PreviewBanner
 *   - 'transient' → render error retry state
 *   - 'unknown'  → propagate (caller decides)
 */

import { ApiError } from '../../api/errors'

export type EndpointErrorKind = 'missing' | 'transient' | 'unknown'

export function classifyEndpointError(error: unknown): EndpointErrorKind {
  if (!(error instanceof ApiError)) {
    return 'unknown'
  }
  if (error.status === 404 || error.status === 501) {
    return 'missing'
  }
  if (error.status === 0 || error.status >= 500) {
    return 'transient'
  }
  if (error.status === 408 || error.status === 429) {
    return 'transient'
  }
  return 'unknown'
}

export function endpointPathFromError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return ''
  }
  // ApiError.url is the absolute URL. Strip protocol+host so the surfaced
  // path matches the spec wire format (/v1/mining/...).
  try {
    const parsed = new URL(error.url)
    return parsed.pathname
  } catch {
    return error.url
  }
}
